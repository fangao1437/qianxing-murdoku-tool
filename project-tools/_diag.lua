local here = (arg and arg[0]) or "tools/_diag.lua"
local root = here:gsub("tools[/\\]_diag%.lua$", "")
package.path = table.concat({ package.path, root .. "lua/?.lua", root .. "lua/?/init.lua", root .. "?.lua" }, ";")

local Core = require("murdoku_core")
local id = arg and arg[1] or "case_001"
local LV = require("levels." .. id)

local copy = {}
for k, v in pairs(LV) do copy[k] = v end
copy.clues = {}
copy.meta = { announce = "unknown" }

local core, errs = Core.new(copy)
if not core then
  for _, e in ipairs(errs or {}) do print("!! " .. e) end
  os.exit(1)
end

print(string.format("棋盘 %dx%d，区域数 %d", core.rows, core.cols, core.room_count))
for r = 1, core.rows do
  local t = {}
  for c = 1, core.cols do
    t[#t + 1] = string.format("%2d", core.room[r][c])
  end
  print("  " .. table.concat(t, " "))
end
print("区域相邻：")
for x = 1, core.room_count do
  local l = {}
  for y in pairs(core.adjacency[x] or {}) do l[#l + 1] = y end
  table.sort(l)
  print(string.format("  R%d -> {%s}", x, table.concat(l, ",")))
end
print("门：")
for k in pairs(core.door_set) do print("  " .. k) end
print("不可站格：")
for k in pairs(core.blocked) do print("  " .. k) end

for pid, p in pairs(core.solution) do
  core:select_suspect(pid)
  local ok, msg = core:hold_cell(p.r, p.c)
  if not ok then print(string.format("放置失败 %s (%d,%d): %s", pid, p.r, p.c, tostring(msg))) end
  core:select_suspect(pid)
end
local sok, serrs, sinfo = core:structure_report()
print("结构: " .. tostring(sok))
for _, e in ipairs(serrs or {}) do print("  - " .. e) end
print(string.format("  victim_room=%s k=%s best=%s has_acc=%s",
  tostring(sinfo.victim_room), tostring(sinfo.k), tostring(sinfo.best), tostring(sinfo.has_accomplice)))
for room, n in pairs(sinfo.innocent_counts or {}) do print(string.format("  inno(R%s)=%d", tostring(room), n)) end
