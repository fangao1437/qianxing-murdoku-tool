--[[----------------------------------------------------------------------------
  tools/dump_level.lua —— 把一关导出成 JSON（给模拟器测试 / 预览工具读）

  跑法：
    lua tools/dump_level.lua                    # 注册表里第一关
    lua tools/dump_level.lua case_002           # 指定关卡
    lua tools/dump_level.lua all out.json       # 全部关卡（数组）

  输出字段（模拟器回归测试要用）：
    id / name / subtitle / difficulty
    rows / cols / piece_count
    thief / accomplice / victim
    pieces: [{ id, name, is_victim, r, c }]     ← 答案坐标，直接拿来点
    clue_count / false_clue / announce
    rooms / doors                               ← 区域数与门数（结构性断言用）
----------------------------------------------------------------------------]]--

package.path = "lua/?.lua;lua/?/init.lua;tools/?.lua;" .. package.path

local Core   = require("murdoku_core")
local Levels = require("levels.init")
local JSON   = require("json")

local want = arg and arg[1]
local out_path = (arg and arg[2]) or "tools/sim/out/level.json"

local function one(lv)
  local core, errs = Core.new(lv)
  if not core then
    io.stderr:write(string.format("关卡 %s 数据有误：%s\n", tostring(lv.id),
      table.concat(errs or {}, " / ")))
    os.exit(1)
  end
  local pieces = {}
  for i = 1, #core.pieces do
    local s = core.pieces[i]
    local p = core.solution[s.id]
    pieces[#pieces + 1] = {
      id = s.id,
      name = s.name or tostring(s.id),
      is_victim = (s.is_victim == true) or (core.victim_id == s.id),
      r = p and p.r or nil,
      c = p and p.c or nil,
    }
  end
  local doors = 0
  for _ in pairs(core.door_set) do doors = doors + 1 end

  -- 玩家实际会读到的线索文案（顺带标出哪条是那句假话）
  for id, p in pairs(core.solution) do
    core:select_suspect(id)
    core:hold_cell(p.r, p.c)
  end
  local cres = core:clue_results()
  local clue_texts = {}
  for i = 1, #cres do
    clue_texts[i] = {
      index = i,
      text = cres[i].text,
      satisfied = cres[i].satisfied,
      is_false = ((lv.meta or {}).false_clue == i),
    }
  end
  local sok2, _, sinfo = core:structure_report()

  return {
    id = lv.id,
    name = lv.name,
    subtitle = lv.subtitle,
    difficulty = lv.difficulty,
    rows = core.rows, cols = core.cols,
    piece_count = core:piece_count(),
    thief = core.roles.thief,
    accomplice = core.roles.accomplice,
    victim = core.victim_id,
    pieces = pieces,
    clue_count = #(lv.clues or {}),
    false_clue = (lv.meta or {}).false_clue,
    announce = (lv.meta or {}).announce,
    rooms = core.room_count,
    doors = doors,
    tie_policy = core:tie_policy(),
    clue_texts = clue_texts,
    structure = {
      victim_room = sinfo and sinfo.victim_room,
      k = sinfo and sinfo.k,
      adjacent = sinfo and sinfo.adjacent,
      innocent_counts = sinfo and sinfo.innocent_counts,
      best = sinfo and sinfo.best,
    },
  }
end

local payload
if want == nil or want == "" or want == "all" then
  local all = Levels.all()
  if #all == 0 then
    io.stderr:write("没有已登记的关卡\n")
    os.exit(1)
  end
  local list = {}
  for i = 1, #all do list[i] = one(all[i]) end
  payload = list
  if want == nil or want == "" then payload = list[1] end   -- 不带参数就只导第一关
else
  local lv = Levels.get(want)
  if not lv then
    io.stderr:write("找不到关卡：" .. tostring(want) .. "\n")
    os.exit(1)
  end
  payload = one(lv)
end

local ok, err = JSON.write_file(out_path, payload)
if not ok then
  io.stderr:write("写不了 " .. out_path .. "：" .. tostring(err) .. "\n")
  os.exit(1)
end

if type(payload) == "table" and payload[1] then
  print(string.format("导出 %d 关 → %s", #payload, out_path))
  for i = 1, #payload do
    local p = payload[i]
    print(string.format("  · %-12s %d×%d  棋子 %d  线索 %d  盗窃者 %s  同伙 %s",
      p.id, p.rows, p.cols, p.piece_count, p.clue_count,
      tostring(p.thief), tostring(p.accomplice)))
  end
else
  print(string.format("导出 %s（%d×%d，棋子 %d，线索 %d）→ %s",
    tostring(payload.id), payload.rows, payload.cols, payload.piece_count,
    payload.clue_count, out_path))
end
