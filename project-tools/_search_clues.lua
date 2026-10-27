--[[ 设计期辅助脚本：枚举结构合法的 (摆位 × 角色) 组合，挑选一组线索使解唯一。
     只用于离线设计；不属于规则引擎。 ]]--

local here = (arg and arg[0]) or "tools/_search_clues.lua"
local root = here:gsub("tools[/\\]_search_clues%.lua$", "")
package.path = table.concat({
  package.path,
  root .. "lua/?.lua",
  root .. "lua/?/init.lua",
  root .. "?.lua",
}, ";")

local Core = require("murdoku_core")

local target_id = arg and arg[1] or "case_001"
local LV = require("levels." .. target_id)

-- 这一份副本去掉 meta.false_clue（设计阶段 clues 还是空的，会超出范围）
local SANDBOX = {}
for k, v in pairs(LV) do SANDBOX[k] = v end
local sandbox_meta = {}
for k, v in pairs(LV.meta or {}) do sandbox_meta[k] = v end
sandbox_meta.false_clue = nil
SANDBOX.meta = sandbox_meta
SANDBOX.clues = {}

local core, cerr = Core.new(SANDBOX)
if not core then
  for _, e in ipairs(cerr or {}) do print("!! " .. e) end
  error("level invalid")
end

local ids = {}
for i = 1, #core.pieces do ids[i] = core.pieces[i].id end

local rpairs = {}
for i = 1, #ids do
  local t = ids[i]
  if t ~= core.victim_id then
    rpairs[#rpairs + 1] = { thief = t, accomplice = nil }
    for j = 1, #ids do
      local a = ids[j]
      if a ~= t and a ~= core.victim_id then
        rpairs[#rpairs + 1] = { thief = t, accomplice = a }
      end
    end
  end
end

local configs = {}
local grid = {}
for r = 1, core.rows do grid[r] = {} end

local function install(g)
  local saved_grid, saved_pos = core.grid, core.pos
  local saved_rc, saved_cc = core.row_count, core.col_count
  core.grid = g
  core.pos = {}
  core.row_count, core.col_count = {}, {}
  for r = 1, core.rows do core.row_count[r] = 0 end
  for c = 1, core.cols do core.col_count[c] = 0 end
  for r = 1, core.rows do
    for c = 1, core.cols do
      local id = g[r][c]
      if id then
        core.pos[id] = { r = r, c = c }
        core.row_count[r] = core.row_count[r] + 1
        core.col_count[c] = core.col_count[c] + 1
      end
    end
  end
  return function()
    core.grid, core.pos = saved_grid, saved_pos
    core.row_count, core.col_count = saved_rc, saved_cc
  end
end

local function consider()
  local restore = install(grid)
  for i = 1, #rpairs do
    local roles = {
      thief = rpairs[i].thief,
      accomplice = rpairs[i].accomplice,
      victim = core.victim_id,
    }
    if core:structure_report(roles) then
      local snap = {}
      for r = 1, core.rows do
        snap[r] = {}
        for c = 1, core.cols do snap[r][c] = grid[r][c] end
      end
      configs[#configs + 1] = { placement = snap, roles = roles }
    end
  end
  restore()
end

local function place_at(k)
  if k > #ids then return consider() end
  local id = ids[k]
  for r = 1, core.rows do
    for c = 1, core.cols do
      if not grid[r][c] and not core:is_blocked(r, c) then
        local rowhit, colhit = false, false
        for cc = 1, core.cols do if grid[r][cc] then rowhit = true end end
        for rr = 1, core.rows do if grid[rr][c] then colhit = true end end
        if not rowhit and not colhit then
          grid[r][c] = id
          place_at(k + 1)
          grid[r][c] = nil
        end
      end
    end
  end
end
place_at(1)

local function ck(cfg)
  local parts = {}
  for r = 1, core.rows do
    for c = 1, core.cols do
      local id = cfg.placement[r][c]
      if id then parts[#parts + 1] = r .. ":" .. c .. "=" .. id end
    end
  end
  table.sort(parts)
  return cfg.roles.thief .. "/" .. tostring(cfg.roles.accomplice) .. "|" .. table.concat(parts, ",")
end

local function key_of_roles(roles)
  local ps = {}
  for id, p in pairs(LV.solution) do ps[#ps + 1] = p.r .. ":" .. p.c .. "=" .. id end
  table.sort(ps)
  return (roles.thief or "") .. "/" .. tostring(roles.accomplice) .. "|" .. table.concat(ps, ",")
end

local TK = key_of_roles(LV.roles)
print("目标 key = " .. TK)
print("结构合法组合数 = " .. #configs)
local targetIndex = nil
for i = 1, #configs do
  if ck(configs[i]) == TK then targetIndex = i end
end
print("目标组合序号 = " .. tostring(targetIndex))

local function eval_clue(cfg, cl)
  local restore = install(cfg.placement)
  local saved = core.level.clues
  core.level.clues = { cl }
  local res = core:clue_results(cfg.roles)
  core.level.clues = saved
  restore()
  return res[1].satisfied
end

local objects = LV.objects or {}
local object_names = {}
for name in pairs(objects) do object_names[#object_names + 1] = name end
table.sort(object_names)
local victim_room = core.room[LV.solution[core.victim_id].r][LV.solution[core.victim_id].c]
local adj_rooms = {}
for x in pairs(core.adjacency[victim_room] or {}) do adj_rooms[#adj_rooms + 1] = x end

local pool = {}
local seen = {}
local function add(builder)
  local okc, cl = pcall(builder, LV.roles)
  if not okc or type(cl) ~= "table" then return end
  local key = tostring(cl.type) .. "|" .. tostring(cl.who or cl.a) .. "|" .. tostring(cl.b or cl.other or cl.role or cl.object or "") ..
              "|" .. tostring(cl.r or cl.c or cl.d or cl.n or cl.dr or cl.dc or cl.dir or cl.room or "")
  if seen[key] then return end
  seen[key] = true
  pool[#pool + 1] = cl
end

for _, who in ipairs(ids) do
  for r = 1, core.rows do
    for c = 1, core.cols do
      add(function() return { type = "at", who = who, r = r, c = c } end)
    end
    add(function() return { type = "in_row", who = who, r = r } end)
  end
  for c = 1, core.cols do add(function() return { type = "in_col", who = who, c = c } end) end
  for _, other in ipairs(ids) do
    if other ~= who then
      for d = 1, 4 do
        add(function() return { type = "distance", a = who, b = other, d = d } end)
      end
      add(function() return { type = "above", a = who, b = other } end)
      add(function() return { type = "below", a = who, b = other } end)
      add(function() return { type = "left_of", a = who, b = other } end)
      add(function() return { type = "right_of", a = who, b = other } end)
      add(function() return { type = "same_room", a = who, b = other } end)
      add(function() return { type = "different_room", a = who, b = other } end)
      add(function() return { type = "beside", a = who, b = other } end)
      add(function() return { type = "not_beside", a = who, b = other } end)
    end
  end
  for _, name in ipairs(object_names) do
    add(function() return { type = "beside_object", who = who, object = name } end)
    add(function() return { type = "not_beside_object", who = who, object = name } end)
    add(function() return { type = "same_room_as_object", who = who, object = name } end)
  end
end
for r = 1, core.rows do add(function() return { type = "only_one_in_row", r = r } end) end
for _, name in ipairs(object_names) do add(function() return { type = "one_on_object", object = name } end) end
for _, room in ipairs(adj_rooms) do
  add(function() return { type = "room_has", room = room, n = 4 } end)
  add(function() return { type = "room_size_hint", room = room, n = 4 } end)
end

print("候选线索数 = " .. #pool)

local P = #pool
local hold = {}
for i = 1, P do
  hold[i] = {}
  for j = 1, #configs do hold[i][j] = eval_clue(configs[j], pool[i]) and 1 or 0 end
end

local remaining = {}
local remN = 0
for j = 1, #configs do
  if j ~= targetIndex then remaining[j] = true; remN = remN + 1 end
end
print("需要排除的其它组合数 = " .. remN)

local chosen = {}
local function greedy()
  while remN > 0 do
    local bestI, bestGain = nil, 0
    for i = 1, P do
      if not chosen[i] then
        local gain = 0
        for j = 1, #configs do
          if remaining[j] and hold[i][j] == 0 then gain = gain + 1 end
        end
        if gain > bestGain then bestGain = gain; bestI = i end
      end
    end
    if not bestI then break end
    chosen[bestI] = true
    for j = 1, #configs do
      if remaining[j] and hold[bestI][j] == 0 then remaining[j] = false; remN = remN - 1 end
    end
  end
end
greedy()

local primal = {}
for i = 1, P do if chosen[i] then primal[#primal + 1] = i end end
print("贪心初始集合 " .. #primal .. " 条")

-- 反向剪枝：逐条尝试删除，若仍有解唯一（在候选组合池内）就删掉
local eliminated = {}
local function computeElim(list)
  local n = 0
  for j = 1, #configs do
    if j ~= targetIndex then
      local bad = false
      for _, i in ipairs(list) do
        if hold[i][j] == 0 then bad = true; break end
      end
      if bad then n = n + 1 end
    end
  end
  return n
end

local changed = true
while changed do
  changed = false
  for k = #primal, 1, -1 do
    local trial = {}
    for m = 1, #primal do if m ~= k then trial[#trial + 1] = primal[m] end end
    if computeElim(trial) >= remN + #primal * 0 + (#configs - 1) then
      primal = trial
      changed = true
      break
    end
  end
end
print("剪枝后集合 " .. #primal .. " 条（排除 " .. computeElim(primal) .. "/" .. (#configs - 1) .. "）")

----------------------------------------------------------------------
-- 唯一解验证
----------------------------------------------------------------------
local function build_level(clueList, falseIdx)
  local lv = {}
  for k, v in pairs(LV) do lv[k] = v end
  local clues = {}
  for n = 1, #clueList do
    local cl = {}
    for k, v in pairs(clueList[n]) do cl[k] = v end
    clues[n] = cl
  end
  lv.clues = clues
  local meta = {}
  for k, v in pairs(LV.meta or {}) do meta[k] = v end
  meta.false_clue = falseIdx
  lv.meta = meta
  return lv
end

local function try_false(falseIdx)
  local list = {}
  for n = 1, #primal do
    if n ~= falseIdx then list[#list + 1] = pool[primal[n]] end
  end
  local lv = build_level(list, falseIdx and falseIdx or nil)
  local c2, cerr2 = Core.new(lv)
  if not c2 then return false, 0, cerr2 end
  local sols = c2:solve(3)
  return #sols == 1, #sols
end

local found = nil
for fi = 1, #primal do
  local okv, n = try_false(fi)
  print(string.format("  把第 %d 条（%s）当假话 → 解数 %d %s", fi, pool[primal[fi]].type, n, okv and "OK" or ""))
  if okv then found = fi end
end
if not found then
  local okv, n = try_false(nil)
  print("  无假话 → 解数 " .. n .. (okv and " OK" or ""))
end

print("---- 全部选中线索（含假话） ----")
for n = 1, #primal do
  local cl = pool[primal[n]]
  local parts = { "type=" .. cl.type }
  for _, k in ipairs({ "who", "a", "b", "other", "role", "object", "r", "c", "d", "n", "dr", "dc", "dir", "room" }) do
    if cl[k] ~= nil then parts[#parts + 1] = k .. "=" .. tostring(cl[k]) end
  end
  print(string.format("  %d) {%s},", n, table.concat(parts, ", ")))
end
