-- tests/offline/module_smoke.lua —— module 形态离线冒烟
-- 用法（仓库根）：
--   lua workspace/qxqy-ui-system/tests/offline/module_smoke.lua
--
-- 断言（全部用 print 输出 PASS/FAIL，退出码非 0 = 失败）：
--   1. 载入 module.lua 后**没有**定义任何全局生命周期（OnInit/OnStart/OnUpdate 必须为 nil）
--   2. 全局只有 Tutorial，且 Tutorial.install 可调用
--   3. install 后框架自行 boot：DISCOVER 到 1 屏 2 页 2 页签、缺件为 none
--   4. T.act("next") 翻页：pager 文本变 "2 / 2"、page.p2 可见、page.p1 隐藏
--   5. T.show("p1") 跳回、T.hide() 关闭屏
--   6. T.OnUpdate(dt) 可安全调用（重复 tick 不报错）
local here = debug.getinfo(1, "S").source:match("@(.*)[/\\][^/\\]*$") or "."
local root = here .. "/../../"

-- 先装桩，再载入被测 bundle
local make_stub = dofile(root .. "tests/offline/stub_engine.lua")
local world = make_stub()

local chunk, err = loadfile(root .. "lua/module.lua")
if not chunk then
  print("FAIL loadfile: " .. tostring(err))
  os.exit(1)
end
local ok, run_err = pcall(chunk)
if not ok then
  print("FAIL chunk: " .. tostring(run_err))
  os.exit(1)
end

local passed, failed = 0, 0
local function check(name, cond, extra)
  if cond then
    passed = passed + 1
    print("PASS " .. name)
  else
    failed = failed + 1
    print("FAIL " .. name .. (extra and ("  ← " .. tostring(extra)) or ""))
  end
end

-- 1) module 形态不得抢全局生命周期
check("no global OnInit", rawget(_G, "OnInit") == nil, tostring(OnInit))
check("no global OnStart", rawget(_G, "OnStart") == nil)
check("no global OnUpdate", rawget(_G, "OnUpdate") == nil)

-- 2) 唯一全局入口
check("global Tutorial exists", type(rawget(_G, "Tutorial")) == "table")
check("Tutorial.install is function", type(rawget(_G, "Tutorial").install) == "function")

-- 3) install → 自行 boot
local T = Tutorial.install({ root_name = "app.root", keys_enabled = false, log_prefix = "[tutorial]" })
check("install returns api", type(T) == "table" and type(T.OnUpdate) == "function")
local st = T.state()
check("screen discovered", st.screen == "demo", tostring(st.screen))
check("page is p1", st.page == "p1", tostring(st.page))
check("p1 visible", world.p1.visible == true)
check("p2 hidden", world.p2.visible == false)
check("pager text 1/2", world.pager.text == "1 / 2", world.pager.text)

-- 4) 翻页
T.act("next")
check("pager text 2/2", world.pager.text == "2 / 2", world.pager.text)
check("p2 visible after next", world.p2.visible == true)
check("p1 hidden after next", world.p1.visible == false)
check("ui/nav signal sent", (function()
  for _, s in ipairs(world.sent) do
    if s.name == "ui/nav" and s.params[2] == "p2" then return true end
  end
  return false
end)())

-- 5) 跳页 + 关闭
T.show("p1")
check("pager back to 1/2", world.pager.text == "1 / 2", world.pager.text)
check("screen open", T.is_open() == true)
T.hide()
check("screen hidden", world.screen.visible == false)
check("screen still active (容器不销毁)", world.screen.active == true)

-- 6) tick 安全
local ok_tick = pcall(function()
  for _ = 1, 10 do T.OnUpdate(1 / 30) end
end)
check("OnUpdate x10 ok", ok_tick)

print(string.format("RESULT passed=%d failed=%d", passed, failed))
os.exit(failed == 0 and 0 or 1)
