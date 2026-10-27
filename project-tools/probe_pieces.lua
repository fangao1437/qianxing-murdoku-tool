-- tools/probe_pieces.lua —— 打印某关的棋子/受害者 id，并试一次"选中"是否成功
--
-- 用途（2026-09-27）：真机日志里点 `tray.V` 三次都没有选中效果，
--   而事件链路（点击 → suspect → tap_suspect → select_suspect）代码上看着是通的。
--   `select_suspect` 的第一道门是 `if not self.piece_by_id[id] then return false end` ——
--   所以先离线确认这个 id 到底在不在。
--
-- 用法：lua tools/probe_pieces.lua [关卡id]

package.path = package.path .. ";./lua/?.lua;./lua/?/init.lua"

local Levels = require("levels")
local C = require("murdoku_core")

local want = arg and arg[1] or "selftest_theft_5x5"
local lv = Levels.get(want)
if lv == nil then
  print("找不到关卡：" .. tostring(want))
  print("可用：" .. table.concat(Levels.ids and Levels.ids() or {}, ", "))
  os.exit(1)
end

print("关卡 = " .. tostring(lv.id) .. "   " .. tostring(lv.name or ""))
print("victim_id = " .. tostring(lv.victim_id))
print("rows x cols = " .. tostring(lv.rows) .. " x " .. tostring(lv.cols))

local core = C.new(lv)
print("pieces 个数 = " .. tostring(#core.pieces))
local ids = {}
for i = 1, #core.pieces do ids[#ids + 1] = tostring(core.pieces[i].id) end
print("pieces ids = " .. table.concat(ids, ", "))

local keys = {}
for k in pairs(core.piece_by_id) do keys[#keys + 1] = tostring(k) end
table.sort(keys)
print("piece_by_id keys = " .. table.concat(keys, ", "))

-- 逐个试"选中"，把结果打出来 —— 这就是真机上点头像卡走的那条路
print("\n逐个试 select_suspect：")
for i = 1, #core.pieces do
  local id = core.pieces[i].id
  local ok = core:select_suspect(id)
  print(string.format("  %-6s -> %-5s  selected=%s", tostring(id), tostring(ok), tostring(core.selected)))
  core:select_suspect(id)     -- 还原（再点一次取消）
end

-- 受害者也单独试一次
if lv.victim_id ~= nil then
  local ok = core:select_suspect(lv.victim_id)
  print(string.format("  受害者 %-4s -> %-5s  selected=%s", tostring(lv.victim_id), tostring(ok), tostring(core.selected)))
end

-- view() 里 tray 的 id 是什么（真机点的是 tray.<id>）
local vm = core:view()
print("\nview().tray：")
for i = 1, #vm.tray do
  local t = vm.tray[i]
  print(string.format("  tray.%-4s name=%-8s is_victim=%-5s placed=%-5s",
    tostring(t.id), tostring(t.name), tostring(t.is_victim), tostring(t.placed)))
end
