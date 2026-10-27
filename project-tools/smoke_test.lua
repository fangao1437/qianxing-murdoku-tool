--[[----------------------------------------------------------------------------
  tools/smoke_test.lua —— 用「假运行时」跑一遍打包产物

  目的：在没有游戏的情况下，验证 dist/client_script.lua 至少能满足：
    1. 能被 loadfile 加载（语法正确、模块都在）
    2. 定义了官方要求的 7 个生命周期全局函数
    3. OnInit → OnStart → OnUpdate → OnDestroy 全流程不崩
    4. 适配层对着"没有控件的假运行时"只会告警，不会抛错

  跑法：
    lua tools/smoke_test.lua
----------------------------------------------------------------------------]]--

local here = (arg and arg[0]) or "tools/smoke_test.lua"
local ROOT = here:gsub("tools[/\\]smoke_test%.lua$", "")
if ROOT == "" then ROOT = "./" end
if ROOT:sub(-1) ~= "/" and ROOT:sub(-1) ~= "\\" then ROOT = ROOT .. "/" end

-- ===== 假运行时：只实现文档里存在、且我们真正调用的那些接口 =====
local warnings, print_count = 0, 0

Enum = {
  CursorEventType = { CursorClick = 1, CursorDown = 2, CursorUp = 3 },
  ImageSource     = { Asset = 1 },
  EaseType        = { Linear = 0, OutQuad = 1 },
}

local fake_control = {}
local function mk(name, kids)
  local c = {
    name = name, id = 1, prefabIndex = 1, alive = true,
    active = true, visible = true,
    anchoredPositionX = 0, anchoredPositionY = 0,
    sizeDeltaX = 160, sizeDeltaY = 160,
    imageSource = 1, imageId = 0, text = "", interactable = true,
    _kids = kids or {},
  }
  c.GetChildren = function() return c._kids end
  c.GetChild = function(_, child_name)
    for i = 1, #c._kids do
      if c._kids[i].name == child_name then return c._kids[i] end
    end
    return nil
  end
  c.SetVisible = function() end
  c.SetActive = function() end
  c.SetAnchoredPosition = function() end
  c.SetSizeDelta = function() end
  c.SetLocalScale = function() end
  c.SetImage = function() end
  c.AddCursorEventListener = function() end
  return c
end

-- 只假造 board 与 cell.1.1：这样 on_start 能过（找得到 board），
-- 渲染路径会被真正走一遍，其余控件按"未找到"告警——正好用来验证适配层不崩。
local fake_board = mk("board", { mk("cell.1.1") })
local fake_root  = mk("root", { fake_board })

game = {
  GetClientUIRoots   = function() return { fake_root } end,
  FindClientUIRoot   = function(_, n) return n == "root" and fake_root or nil end,
  GetClientUIControl = function() return nil end,
  InstantiateClientUIControl = function() return mk("dynamic") end,
  DestroyClientUIControl     = function() end,
  GetUICanvasSize    = function() return 1920, 1080 end,
  GetCursorUIPos     = function() return 0, 0 end,
  GetDevice          = function() return 1 end,
  Tween              = function()
    local t = {}
    t.Play = function() return t end
    t.SetEase = function() return t end
    t.SetLoops = function() return t end
    t.SetOnComplete = function() return t end
    return t
  end,
  TweenSequence = function()
    local s = {}
    s.Append = function() return s end
    s.AppendInterval = function() return s end
    s.Play = function() return s end
    return s
  end,
  ServerSignal = function()
    local sg = {}
    sg.AddInt = function() return sg end
    sg.AddFloat = function() return sg end
    sg.AddString = function() return sg end
    sg.AddBool = function() return sg end
    sg.SendSignal = function() end
    return sg
  end,
  PlayAudio2D = function() return 1 end,
  StopAudio = function() end,
  GetText = function(id) return tostring(id) end,
  GetLanguageType = function() return 0 end,
  GetStageMode = function() return 0 end,
  IsTestPlay = function() return true end,
  PrintClientUITree = function() end,
}

script = {
  alive = true,
  scriptMappingId = 1,
  path = "smoke",
  enabled = true,
  GetParam = function() return nil end,
  Invoke = function() end,
  EnableUpdate = function() end,
  RegisterServerSignalHandler = function() end,
  UnregisterServerSignalHandler = function() end,
}

-- 把适配层的告警吞掉，只计数（否则会刷几百行"控件未找到"）
printerr = function(...) warnings = warnings + 1 end

local real_print = print
print = function(...) print_count = print_count + 1 end

-- ===== 加载打包产物 =====
local chunk, load_err = loadfile(ROOT .. "dist/client_script.lua")
if not chunk then
  real_print("LOAD FAIL: " .. tostring(load_err))
  os.exit(1)
end

local ok, err = pcall(chunk)
if not ok then
  real_print("CHUNK ERROR: " .. tostring(err))
  os.exit(1)
end
real_print("[1/4] 打包文件加载成功")

-- ===== 生命周期函数是否齐全 =====
local expect = { "OnInit", "OnStart", "OnEnable", "OnDisable", "OnUpdate", "OnLevelUpdate", "OnDestroy" }
local missing = {}
for i = 1, #expect do
  if type(_G[expect[i]]) ~= "function" then missing[#missing + 1] = expect[i] end
end
if #missing > 0 then
  real_print("[2/4] FAIL：缺少生命周期函数 " .. table.concat(missing, ", "))
  os.exit(1)
end
real_print("[2/4] 7 个生命周期函数齐全")

-- ===== 跑一遍全流程 =====
local steps = {
  { "OnInit",   function() OnInit() end },
  { "OnStart",  function() OnStart() end },
  { "OnUpdate", function() for _ = 1, 5 do OnUpdate(0.016) end end },
  { "OnLevelUpdate", function() OnLevelUpdate(0.016) end },
  { "OnEnable", function() OnEnable() end },
  { "OnDisable", function() OnDisable() end },
  { "OnDestroy", function() OnDestroy() end },
}
for i = 1, #steps do
  local name, fn = steps[i][1], steps[i][2]
  local ok2, err2 = pcall(fn)
  if not ok2 then
    real_print("[3/4] FAIL：调用 " .. name .. " 抛错：" .. tostring(err2))
    os.exit(1)
  end
end
real_print(string.format("[3/4] 全流程调用无异常（OnInit→OnStart→OnUpdate→…→OnDestroy）"))
if warnings == 0 then
  real_print("[3/4] 警告：一次告警都没有，说明渲染路径没被走到（假运行时可能建错了）")
else
  real_print(string.format("      适配层告警 %d 次（预期 > 0：只假造了 board 与 cell.1.1，其余控件确实不存在）", warnings))
end
real_print(string.format("      脚本内部日志 %d 行", print_count))
if warnings == 0 then os.exit(1) end
real_print("[4/4] SMOKE OK")
