--[[----------------------------------------------------------------------------
  tools/make_level_from_grid.lua —— 从"答案网格"一键生成关卡骨架

  用处：你在纸上/表格里排好答案后，不用手写 Lua 表，
        直接把这个网格喂进来，得到一份可用的关卡文件骨架，再补线索即可。

  用法：
    lua tools/make_level_from_grid.lua grid.txt case_001
    lua tools/make_level_from_grid.lua            （从标准输入读）

  网格格式：每行一行，`.` 或 `_` 表示空格，字母表示角色（大小写都行）。
  约定：字母对应 suspects 的 id；**最后一个出现的角色默认当受害者**，
        凶手先占位成第一个角色，记得改。

  例：
    A....
    ..B..
    ....C
    .D...
    ...V.
----------------------------------------------------------------------------]]--

local file = arg and arg[1]
local level_id = (arg and arg[2]) or "new_level"

local text
if file and file ~= "-" then
  local fh, err = io.open(file, "r")
  if not fh then
    io.stderr:write("读不到文件: " .. tostring(file) .. " (" .. tostring(err) .. ")\n")
    os.exit(1)
  end
  text = fh:read("*a")
  fh:close()
else
  text = io.read("*a")
end

if not text or text == "" then
  io.stderr:write("没有输入。用法：lua tools/make_level_from_grid.lua <grid.txt> [level_id]\n")
  os.exit(1)
end

-- 解析网格
local rows = {}
for line in text:gmatch("[^\n]+") do
  line = line:gsub("%s+$", "")
  if line ~= "" then rows[#rows + 1] = line end
end
if #rows == 0 then
  io.stderr:write("输入里没有有效行\n")
  os.exit(1)
end

local cols = #rows[1]
for i = 1, #rows do
  if #rows[i] ~= cols then
    io.stderr:write(string.format("第 %d 行长度 %d，与第 1 行 %d 不一致\n", i, #rows[i], cols))
    os.exit(1)
  end
end

-- 收集角色（按首次出现顺序）
local order, seen = {}, {}
local solution = {}
for r = 1, #rows do
  for c = 1, cols do
    local ch = rows[r]:sub(c, c)
    if ch ~= "." and ch ~= "_" and ch ~= " " then
      local id = ch:upper()
      if not seen[id] then
        seen[id] = true
        order[#order + 1] = id
      end
      solution[id] = { r = r, c = c }
    end
  end
end

if #order == 0 then
  io.stderr:write("网格里没有任何角色\n")
  os.exit(1)
end

local victim = order[#order]
local murderer = order[1]

-- 输出骨架
local out = {}
local function w(s) out[#out + 1] = s end

w(string.format("--[[ 由 tools/make_level_from_grid.lua 生成"))
w(string.format("     棋盘 %dx%d，角色 %d 个", #rows, cols, #order))
w(string.format("     默认：最后出现的角色 %s 当受害者，%s 占位当凶手 —— 记得改！", victim, murderer))
w(string.format("     下一步：填 name、walls、objects、clues，然后"))
w(string.format("       lua tools/validate_levels.lua   校验答案自洽与唯一解"))
w("]]--")
w("")
w("return {")
w(string.format("  id = %q,", level_id))
w(string.format("  name = %q,", "新关卡"))
w("  difficulty = \"normal\",")
w("")
w(string.format("  size = { rows = %d, cols = %d },", #rows, cols))
w("")
w("  rules = {")
w("    one_per_row  = true,")
w("    one_per_col  = true,")
w("    one_per_room = false,")
w("    place_all    = true,")
w("  },")
w("")
w("  -- 墙 = 房间边界：{\"v\", r, c} 挡 (r,c)↔(r,c+1)；{\"h\", r, c} 挡 (r,c)↔(r+1,c)")
w("  walls = {},")
w("")
w("  -- 家具：occupiable = false 的家具所在格不能站人")
w("  objects = {},")
w("  blocked = {},")
w("  water   = {},")
w("")
w("  suspects = {")
for i = 1, #order do
  local id = order[i]
  local tag = (id == victim) and "   -- 受害者" or ""
  w(string.format("    { id = %q, name = %q },%s", id, "角色" .. id, tag))
end
w("  },")
w("")
w(string.format("  victim   = { id = %q, name = %q },", victim, "受害者"))
w(string.format("  murderer = %q,", murderer))
w("")
w("  solution = {")
for i = 1, #order do
  local id = order[i]
  local p = solution[id]
  w(string.format("    %s = { r = %d, c = %d },", id, p.r, p.c))
end
w("  },")
w("")
w("  -- TODO 线索：类型见 docs/关卡数据格式.md 第 6 节（54 种）")
w(string.format("  -- 提示：%dx%d 且每行每列恰好一人，所以 left_of / same_row 这类同排线索恒为假，别用；", #rows, cols))
w("  --       优先用 in_row / in_col / corner_room / beside_object / compass / alone_with_victim 之类。")
w("  clues = {")
w(string.format("    -- { type = \"in_row\", who = %q, r = %d },", order[1], solution[order[1]].r))
w("  },")
w("}")

print(table.concat(out, "\n"))
