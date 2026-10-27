--[[----------------------------------------------------------------------------
  tools/_probe_pcall_err.lua —— 抓「被 pcall 吞掉的错误」。

  用途（第一遍代码体检）：某个测试从绿变红，而**测试自己把 OnUpdate 包在 pcall 里**
  ⇒ 真正的报错信息一个字都看不到，只能看到"某断言没过"。
  这个探针把全局 `pcall` 换成一个**记账版**：照常执行、照常返回，
  但把每一个失败的错误串去重记下来，最后统一打印。

  为什么不能直接改测试：那条红线（E5）不让动断言/测试；
  而且"改测试让它闭嘴"正是本项目反复吃亏的模式。探针是**外部仪器**，不动被测物。

  踩过的两个坑（都写在代码里了）：
    ① 测试会把全局 `print` 换成日志收集器 ⇒ 摘要必须用**提前存下来的**真 print；
    ② 测试结尾是 `os.exit(code)` ⇒ 直接退出，摘要打不出来。
       第一版把 os.exit 换成"抛错误"⇒ 被测试自己的 pcall 接住 ⇒ 摘要里全是
       `table: 0x...` 垃圾。正解：**在 os.exit 里先打摘要再真退出**。

  用法：lua tools/_probe_pcall_err.lua <测试文件>       默认 tests/grid_cost.lua
----------------------------------------------------------------------------]]--

local target = (arg and arg[1]) or "tests/grid_cost.lua"
local here = (arg and arg[0]) or "tools/_probe_pcall_err.lua"
local root = here:gsub("tools[/\\]_probe_pcall_err%.lua$", "")
if root == "" then root = "./" end
if root:sub(-1) ~= "/" and root:sub(-1) ~= "\\" then root = root .. "/" end

-- ① 测试会 hijack 全局 print ⇒ 先把真正的输出函数留下来自己用。
local out = print
local realpcall = pcall
local realexit = os.exit

local seen, order, total = {}, {}, 0
local dumped = false

_G.pcall = function(f, ...)
  local r = table.pack(realpcall(f, ...))
  if not r[1] then
    total = total + 1
    local msg = tostring(r[2])
    if seen[msg] == nil then
      seen[msg] = { n = 0 }
      order[#order + 1] = msg
    end
    seen[msg].n = seen[msg].n + 1
  end
  return table.unpack(r, 1, r.n)
end

local function summary()
  if dumped then return end
  dumped = true
  out("")
  out("================ 被 pcall 吞掉的错误（去重）================")
  out("失败总数 " .. tostring(total) .. "，去重后 " .. tostring(#order) .. " 种")
  table.sort(order, function(a, b) return seen[a].n > seen[b].n end)
  for i = 1, #order do
    out(string.format("  %6d 次  %s", seen[order[i]].n, order[i]))
  end
  out("（测试自身的断言结果见上方输出；本探针不改任何断言）")
end

-- ② 测试结尾 os.exit ⇒ 先打摘要再真退出（不抛错误，免得被它自己的 pcall 接住）。
os.exit = function(code) summary() realexit(code) end

-- ③ ⚠️ **必须清掉 `arg[1]`**：测试普遍写成
--      `local SCRIPT_PATH = (arg and arg[1]) or (root .. "dist/client_script.lua")`
--    —— 探针自己的参数（测试文件名）会被它当成"待加载的客户端脚本包"，
--    于是它去 loadfile 测试文件本身 ⇒ 一片混乱、断言全跑偏（实测：输出几乎为空）。
--    只保留 `arg[0]`（伪装成测试自己的路径）。
if arg then
  for i = #arg, 1, -1 do arg[i] = nil end
  arg[0] = root .. target
end
local chunk, err = loadfile(root .. target)
if chunk == nil then
  out("loadfile 失败：" .. tostring(err))
  realexit(2)
end
realpcall(chunk)
summary()
realexit(0)
