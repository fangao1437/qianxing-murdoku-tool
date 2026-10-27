--[[----------------------------------------------------------------------------
  tools/new_level.lua —— 关卡骨架生成器

  你只画一张「答案图 + 墙 + 门」，它帮你：
    ① 生成一个**格式合法**的关卡 .lua 文件（棋子/受害者/角色归属/答案都填好）
    ② **当场算出空间结构自不自洽**（这是设计时最容易翻车的地方）：
         受害者区域 Rv、k、门相邻区域、各相邻区域的无辜人数、最大的是哪个
       以及按 R3/R4 判断「盗窃者该在哪个区」「要不要同伙」是否与你的设定一致
    ③ 告诉你线索表留空后下一步该干什么（find_clues 或手写）

  ── 输入文件格式（纯 ASCII，UTF-8 保存）────────────────────────────────
      # 井号开头的是注释
      D  .  .  A  .          <- 网格：每行一格，空格分隔
      .  C  .  .  .             字母 = 该格站着哪个角色（id 可以多字符，如 V1）
      .  .  .  .  .             .    = 空格
      .  .  .  .  B
      .  .  V  .  .

      --- walls ---            <- 区域边界（可选）
      h 2 1                    h r c = (r,c) 与 (r+1,c) 之间
      v 3 3                    v r c = (r,c) 与 (r,c+1) 之间

      --- doors ---            <- 门径（决定"相邻"）
      h 2 1

  ── 用法 ────────────────────────────────────────────────────────────────
    lua tools/new_level.lua <图文件> [选项]

    选项：
      --id=case_004            关卡 id（默认 case_00N，N 自动取下一个）
      --name=案件 004 · 标题     关卡名
      --subtitle=...            副标题
      --difficulty=easy|normal|hard
      --victim=V               受害者 id（默认：网格里最后一个字母）
      --thief=D                盗窃者 id（**必填**，或写 --auto-thief 让工具猜）
      --accomplice=C           同伙 id（不写 = 本案没有同伙）
      --announce=none|one|unknown
      --tie=forbid|allow
      --names=A=管家,B=医生,V=老宅主     角色显示名（不写就用「角色A」）
      --out=lua/levels/case_004.lua      输出路径
      --dry                    只算结构、不写文件
----------------------------------------------------------------------------]]--

package.path = "lua/?.lua;lua/?/init.lua;tools/?.lua;" .. package.path

local Core   = require("murdoku_core")
local Levels = require("levels.init")

-- ── 参数解析 ──────────────────────────────────────────────────────────────
local opt, positional = {}, {}
for i = 1, #arg do
  local a = arg[i]
  local k, v = tostring(a):match("^%-%-([%w_%-]+)=(.*)$")
  if k then
    opt[k] = v
  elseif tostring(a):match("^%-%-") then
    opt[tostring(a):sub(3)] = true
  else
    positional[#positional + 1] = a
  end
end

local grid_path = positional[1]
if grid_path == nil then
  io.stderr:write("用法：lua tools/new_level.lua <图文件> --thief=D [--id=...] [--out=...]\n")
  io.stderr:write("      格式见本文件顶部注释；加 --dry 只算结构不写文件\n")
  os.exit(1)
end

local fh, ferr = io.open(grid_path, "rb")
if not fh then
  io.stderr:write("读不了图文件：" .. tostring(ferr) .. "\n")
  os.exit(1)
end
local text = fh:read("*a")
fh:close()
if text:sub(1, 3) == "\239\187\191" then text = text:sub(4) end   -- 去 BOM

-- ── 解析网格 / 墙 / 门 ────────────────────────────────────────────────────
local grid_rows = {}
local walls, doors = {}, {}
local section = "grid"

for line in text:gmatch("[^\r\n]+") do
  local trimmed = line:gsub("^%s+", ""):gsub("%s+$", "")
  if trimmed ~= "" and trimmed:sub(1, 1) ~= "#" then
    local hdr = trimmed:match("^%-%-%-%s*(%a+)%s*%-%-%-$")
    if hdr then
      section = hdr:lower()
    elseif section == "grid" then
      local row = {}
      for tok in trimmed:gmatch("%S+") do row[#row + 1] = tok end
      grid_rows[#grid_rows + 1] = row
    else
      local kind, r, c = trimmed:match("^([hHvV])%s+(%d+)%s+(%d+)$")
      if kind then
        local item = { kind:lower(), tonumber(r), tonumber(c) }
        if section == "walls" then walls[#walls + 1] = item
        elseif section == "doors" then doors[#doors + 1] = item end
      end
    end
  end
end

local rows = #grid_rows
if rows == 0 then
  io.stderr:write("图文件里没解析出网格。检查一下格式（见本文件顶部注释）\n")
  os.exit(1)
end
local cols = #grid_rows[1]
for r = 1, rows do
  if #grid_rows[r] ~= cols then
    io.stderr:write(string.format("第 %d 行有 %d 格，第 1 行有 %d 格 —— 网格必须是矩形\n",
      r, #grid_rows[r], cols))
    os.exit(1)
  end
end
print(string.format("网格 %d×%d，墙 %d 段，门 %d 处", rows, cols, #walls, #doors))

-- ── 从网格里提取棋子与答案 ────────────────────────────────────────────────
local solution, piece_ids, seen = {}, {}, {}
for r = 1, rows do
  for c = 1, cols do
    local tok = grid_rows[r][c]
    if tok ~= "." and tok ~= "_" then
      if seen[tok] then
        io.stderr:write("角色 " .. tok .. " 出现了两次（每行每列恰好一人，同一个角色只能有一枚）\n")
        os.exit(1)
      end
      seen[tok] = true
      piece_ids[#piece_ids + 1] = tok
      solution[tok] = { r = r, c = c }
    end
  end
end

-- 行/列独占自检（提前发现，免得白写文件）
local rseen, cseen = {}, {}
for id, p in pairs(solution) do
  if rseen[p.r] then
    io.stderr:write(string.format("第 %d 行有两个角色（%s 与 %s）—— 违反 one_per_row\n",
      p.r, rseen[p.r], id))
    os.exit(1)
  end
  if cseen[p.c] then
    io.stderr:write(string.format("第 %d 列有两个角色（%s 与 %s）—— 违反 one_per_col\n",
      p.c, cseen[p.c], id))
    os.exit(1)
  end
  rseen[p.r], cseen[p.c] = id, id
end

if #piece_ids ~= rows or #piece_ids ~= cols then
  io.stderr:write(string.format(
    "棋子 %d 个，但棋盘是 %d×%d —— 本作要求 #角色 == rows == cols（每行每列恰好一人）\n",
    #piece_ids, rows, cols))
  os.exit(1)
end

-- ── 角色归属 ──────────────────────────────────────────────────────────────
local victim = opt.victim or piece_ids[#piece_ids]
local thief = opt.thief
if thief == nil or thief == true then
  io.stderr:write("必须指定 --thief=<id>（盗窃者）。可用角色：" .. table.concat(piece_ids, " ") .. "\n")
  os.exit(1)
end
local accomplice = opt.accomplice
if accomplice == true then accomplice = nil end

if not seen[thief] then
  io.stderr:write("--thief=" .. tostring(thief) .. " 不在图里。可用：" .. table.concat(piece_ids, " ") .. "\n")
  os.exit(1)
end
if not seen[victim] then
  io.stderr:write("--victim=" .. tostring(victim) .. " 不在图里。可用：" .. table.concat(piece_ids, " ") .. "\n")
  os.exit(1)
end
if thief == victim then
  io.stderr:write("盗窃者不能是受害者\n")
  os.exit(1)
end
if accomplice ~= nil and (accomplice == thief or accomplice == victim) then
  io.stderr:write("同伙不能是盗窃者或受害者\n")
  os.exit(1)
end

-- 角色显示名
local names = {}
for pair in tostring(opt.names or ""):gmatch("[^,]+") do
  local k, v = pair:match("^%s*([^=]+)%s*=%s*(.-)%s*$")
  if k then names[k] = v end
end

-- ── 组装关卡表 ────────────────────────────────────────────────────────────
local level = {
  id = (type(opt.id) == "string" and opt.id) or nil,
  name = (type(opt.name) == "string" and opt.name) or nil,
  subtitle = (type(opt.subtitle) == "string" and opt.subtitle) or nil,
  difficulty = (type(opt.difficulty) == "string" and opt.difficulty) or "normal",
  size = { rows = rows, cols = cols },
  rules = {
    one_per_row = true, one_per_col = true, one_per_room = false,
    place_all = true,
    tie_policy = (type(opt.tie) == "string" and opt.tie) or "forbid",
  },
  walls = walls,
  doors = doors,
  objects = {},
  blocked = {},
  water = {},
  suspects = {},
  victim = { id = victim, name = names[victim] or ("角色" .. victim) },
  roles = { thief = thief },
  meta = {
    -- 线索留空 → 先不要写 false_clue（写了会报"超出线索范围"）
    announce = (type(opt.announce) == "string" and opt.announce) or "one",
  },
  solution = solution,
  clues = {},
}
if accomplice ~= nil then level.roles.accomplice = accomplice end

for i = 1, #piece_ids do
  local id = piece_ids[i]
  level.suspects[i] = {
    id = id,
    name = names[id] or ("角色" .. id),
    is_victim = (id == victim) or nil,
  }
end

-- 自动补一个关卡 id
if level.id == nil then
  local n = 1
  local all = Levels.all()
  local taken = {}
  for i = 1, #all do taken[all[i].id] = true end
  repeat
    level.id = string.format("case_%03d", n)
    n = n + 1
  until not taken[level.id]
end
if level.name == nil then level.name = "案件 " .. level.id end

-- ── ② 结构自检（这一步才是最有用的）─────────────────────────────────────
print("")
print("===== 空间结构自检 =====")
local core, verrs = Core.new(level)
if not core then
  io.stderr:write("关卡数据有误：\n")
  for i = 1, #(verrs or {}) do io.stderr:write("  - " .. verrs[i] .. "\n") end
  os.exit(1)
end

-- 把答案摆上，才能算结构
for id, p in pairs(solution) do
  core:select_suspect(id)
  core:hold_cell(p.r, p.c)
end
local sok, serrs, sinfo = core:structure_report()
print(string.format("  区域数 %d；受害者 %s 在区域 #%s（k=%d）",
  core.room_count, victim, tostring(sinfo.victim_room), sinfo.k or 0))

if (sinfo.adjacent or {})[1] ~= nil then
  local parts = {}
  for i = 1, #sinfo.adjacent do
    local room = sinfo.adjacent[i]
    local n = (sinfo.innocent_counts or {})[room] or 0
    parts[#parts + 1] = string.format("#%d(无辜 %d)", room, n)
  end
  print("  门相邻区域：" .. table.concat(parts, "  "))
else
  print("  门相邻区域：（一个都没有）")
end
-- 注意 structure_report 的字段语义（容易看错，我第一版就写错了）：
--   info.best       = **人数**（相邻区域里最多的那个无辜人数）
--   info.best_rooms = **区域号列表**（并列时会有多个）
--   info.innocent_counts = { [区域号] = 人数 }
local best_rooms = sinfo.best_rooms or {}
local best_n = sinfo.best or 0
local best_desc = {}
for i = 1, #best_rooms do
  best_desc[#best_desc + 1] = "#" .. tostring(best_rooms[i])
end
print(string.format("  无辜人数最多的是：%s（各 %d 人）",
  table.concat(best_desc, " / "), best_n))
if #best_rooms > 1 then
  print(string.format("  ⚠️ 有 %d 个区域并列 —— tie_policy=%s%s",
    #best_rooms, tostring(level.rules.tie_policy),
    (level.rules.tie_policy == "forbid") and "（forbid 下这算非法，得调人数分布）" or "（allow：允许，但线索要能定生死）"))
end

print("")
if sok then
  print("  ✅ R3/R4 自洽 —— 你的设定站得住")
  print(string.format("     盗窃者在 #%s，正好是人数最多的相邻区域 ✔",
    tostring(sinfo.thief_room)))
  print(string.format("     %s", (sinfo.k or 0) >= 2
    and ("k=" .. tostring(sinfo.k) .. " ≥ 2 → **必须有同伙**（现在 " ..
         (accomplice and ("有：" .. accomplice) or "**没有** ← 要补 --accomplice") .. "）")
    or ("k=1 → 同伙可有可无（现在 " ..
         (accomplice and ("有：" .. accomplice) or "没有") .. "）")))
else
  print("  ❌ R3/R4 不自洽 —— 先改空间/答案/角色，再谈线索：")
  for i = 1, #(serrs or {}) do print("     - " .. serrs[i]) end
  print("")
  print("     常见改法：")
  print("       · 「盗窃者不在相邻区域」→ 加一扇门，或把盗窃者挪到相邻区")
  print("       · 「不是无辜人数最多的」→ 调人数分布（见 docs/关卡设计手册.md 第二节）")
  print("       · 「无辜人数并列」→ 让某个相邻区多/少一个人，或改 --tie=allow")
  print("       · 「k>=2 必须有同伙」→ 补 --accomplice=<id>，或让受害者独处一区")
end

-- ── 写文件 ────────────────────────────────────────────────────────────────
if opt.dry then
  print("")
  print("（--dry：只算了结构，没有写文件）")
  os.exit(sok and 0 or 1)
end

local out_path = (type(opt.out) == "string" and opt.out)
  or ("lua/levels/" .. level.id .. ".lua")

local function lua_str(s) return string.format("%q", tostring(s)) end
local function vec(list, fmt)
  local parts = {}
  for i = 1, #list do parts[#parts + 1] = fmt(list[i]) end
  if #parts == 0 then return "  {}," end
  return "  { " .. table.concat(parts, ", ") .. " },"
end

local L = {}
local function w(s) L[#L + 1] = s end

w("--[[----------------------------------------------------------------------------")
w("  levels/" .. level.id .. ".lua —— " .. tostring(level.name))
w("")
w("  由 tools/new_level.lua 从图文件生成。**线索还没写**，那是下一步：")
w("    · 手写：填 clues，并让 meta.false_clue 对上" )
w("    · 或自动搜：lua tools/find_clues.lua " .. out_path)
w("  写完务必：lua tools/validate_levels.lua 3   （要看到「唯一解: OK」）")
w("")
w("  空间结构（生成时已自检）：")
w(string.format("    区域 %d 个；受害者 %s 在 #%s，k=%d，门相邻 %s",
  core.room_count, victim, tostring(sinfo.victim_room), sinfo.k or 0,
  tostring(sinfo.best)))
w("----------------------------------------------------------------------------]]--")
w("")
w("return {")
w("  id = " .. lua_str(level.id) .. ",")
w("  name = " .. lua_str(level.name) .. ",")
if level.subtitle then w("  subtitle = " .. lua_str(level.subtitle) .. ",") end
w("  difficulty = " .. lua_str(level.difficulty) .. ",")
w("")
w(string.format("  size = { rows = %d, cols = %d },", rows, cols))
w("")
w("  rules = {")
w("    one_per_row  = true,")
w("    one_per_col  = true,")
w("    one_per_room = false,")
w("    place_all    = true,")
w("    tie_policy   = " .. lua_str(level.rules.tie_policy) .. ",")
w("  },")
w("")
w("  -- 墙 = 区域边界（h r c：(r,c) 与 (r+1,c) 之间；v r c：(r,c) 与 (r,c+1) 之间）")
w("  walls = {")
for i = 1, #walls do
  w(string.format("    { %s, %d, %d },", lua_str(walls[i][1]), walls[i][2], walls[i][3]))
end
w("  },")
w("")
w("  -- 门径 = 跨区域通道（与墙同粒度；定义「相邻」）")
w("  doors = {")
for i = 1, #doors do
  w(string.format("    { %s, %d, %d },", lua_str(doors[i][1]), doors[i][2], doors[i][3]))
end
w("  },")
w("")
w("  -- ⚠️ Lua 标识符只能是 ASCII，中文家具名要写成 [\"名\"] = {...}")
w("  objects = {},")
w("  blocked = {},")
w("  water   = {},")
w("")
w("  suspects = {")
for i = 1, #level.suspects do
  local s = level.suspects[i]
  w(string.format("    { id = %s, name = %s%s },", lua_str(s.id), lua_str(s.name),
    s.is_victim and ", is_victim = true" or ""))
end
w("  },")
w("")
w(string.format("  victim = { id = %s, name = %s },", lua_str(victim), lua_str(level.victim.name)))
w("")
w("  roles = {")
w("    thief      = " .. lua_str(thief) .. ",")
if accomplice then w("    accomplice = " .. lua_str(accomplice) .. ",") end
w("  },")
w("")
w("  -- announce = none（全真）| one（有一句假话）| unknown（不告诉玩家）")
w("  meta = {")
w("    -- false_clue = <序号>,   -- ← 写完线索再填（不填 = 全真）")
w("    announce   = " .. lua_str(level.meta.announce) .. ",")
w("  },")
w("")
w("  solution = {")
for i = 1, #piece_ids do
  local id = piece_ids[i]
  w(string.format("    %s = { r = %d, c = %d },", id, solution[id].r, solution[id].c))
end
w("  },")
w("")
w("  clues = {")
w("  },")
w("}")

local outf = io.open(out_path, "w")
if not outf then
  io.stderr:write("写不了 " .. out_path .. "\n")
  os.exit(1)
end
outf:write(table.concat(L, "\n"))
outf:write("\n")
outf:close()

print("")
print("已生成 " .. out_path)
print("")
print("下一步：")
print("  ① 填线索（手写，或 lua tools/find_clues.lua " .. out_path .. "）")
print("  ② 把 " .. out_path:gsub("^lua/", ""):gsub("%.lua$", ""):gsub("/", ".") ..
      " 登记到 lua/levels/init.lua 的 LIST")
print("  ③ lua tools/validate_levels.lua 3    ← 必须看到「唯一解: OK」")
os.exit(sok and 0 or 1)
