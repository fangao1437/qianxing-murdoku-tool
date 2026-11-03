--[[==========================================================================
  10_engine.lua —— 引擎适配层：**唯一**调用 game.* / 控件方法的文件

  为什么要单独一层（抄自既有工程的真机教训，见 docs/repo-survey.md §2.5）：
    · 真机上个别控件不提供某些方法；直接冒号调用会抛错并中断整段逻辑
      ⇒ 这里对**每个**控件方法与 game 方法都做「存在性检查 +
        可选 pcall」，并把失败降级成返回值而不是异常。
    · 调用语法是**实测确认**的（qianxing-murdoku/lua/engine_adapter_qianxing.lua
      第 13-27 行的对照表）：
        game.GetClientUIRoots()                     点号（game 是全局表）
        ctrl:GetChildren() / ctrl:GetChild(name)    冒号
        ctrl:SetVisible(b) / ctrl:SetActive(b)      冒号
        img:SetImage(img.imageSource, imageId)      冒号
        btn:AddCursorEventListener(Enum.CursorEventType.CursorClick, cb)  冒号
        script:RegisterServerSignalHandler(name, cb)                      冒号
      官方文档《客户端控件API文档》§6(1)/§13(2)/§13(5)/§14(2) 与之对应。

  安全边界：
    · 这里**不做**任何业务判断（谁该可见、哪一页是当前页），只做「能调用就调用」。
    · 所有返回 nil 的路径都意味着「引擎侧不存在该能力」，上层必须能接受 nil。
--]]--

local M = {}

local function call(obj, method, ...)
  if obj == nil then return nil end
  local fn = obj[method]
  if fn == nil then return nil end
  local ok, a, b, c, d = pcall(fn, obj, ...)
  if not ok then return nil end
  return a, b, c, d
end

local function call_global(name, ...)
  local fn = rawget(_G, "game") and game[name]
  if fn == nil then return nil end
  local ok, a, b = pcall(fn, ...)
  if not ok then return nil end
  return a, b
end
M.call_global = call_global

-- 控件 / 脚本对象到底是不是 table？
--   [实测 · 模拟器 mobile-16-9] 运行时控件是 **userdata**（tostring 形如 `Control: 0x1ef`），
--   能读 `name` / `visible`、能调方法，但读 `id` 字段会报错（pcall 后拿不到）。
--   所以「这是不是一个控件」的判据必须是 table 或 userdata；
--   写成 `type(x) == "table"` 会把真控件全判成非法 —— 本框架踩过这个坑（发现 0 个屏）。
--   离线桩 / 模拟器内部对象是 table，两条路都要认。
local function ctrl_like(v)
  local t = type(v)
  return t == "table" or t == "userdata"
end
M.is_ctrl = ctrl_like
M.is_script = ctrl_like

------------------------------------------------------------------ 根与遍历 --
-- 官方：GetClientUIRoots() 返回「客户端控件容器画布中的默认容器节点」数组
function M.roots()
  local r = call_global("GetClientUIRoots")
  if type(r) == "table" then return r end
  return {}
end

function M.children(ctrl)
  local r = call(ctrl, "GetChildren")
  if type(r) == "table" then return r end
  return {}
end

-- 按名字取直接子控件；GetChild(名) 是官方唯一的按名接口（§13(2)）
function M.child(ctrl, name)
  if ctrl == nil or name == nil then return nil end
  local c = call(ctrl, "GetChild", tostring(name))
  if c ~= nil then return c end
  -- 兜底：个别构建里 GetChild 只接受下标，退化为线性扫描
  for _, kid in ipairs(M.children(ctrl)) do
    if ctrl_like(kid) then
      local ok, kn = pcall(function() return kid.name end)
      if ok and kn == name then return kid end
    end
  end
  return nil
end

function M.name_of(ctrl)
  if not ctrl_like(ctrl) then return nil end
  local ok, n = pcall(function() return ctrl.name end)
  if ok and type(n) == "string" then return n end
  return nil
end

function M.id_of(ctrl)
  if not ctrl_like(ctrl) then return nil end
  local ok, v = pcall(function() return ctrl.id end)
  if ok then return v end
  return nil
end

--------------------------------------------------------------------- 可见性 --
-- 官方 §13(1)：active 默认 false，且 visible/active 都是只读字段
--            ⇒ 必须走 SetActive/SetVisible，且首帧要显式 SetActive(true)
function M.set_active(ctrl, on)
  return call(ctrl, "SetActive", on == true)
end

function M.set_visible(ctrl, on)
  return call(ctrl, "SetVisible", on == true)
end

-- 显隐总闸：先 active 再 visible（active=false 会让脚本停跑）
function M.show(ctrl, on)
  if on then
    M.set_active(ctrl, true)
    M.set_visible(ctrl, true)
  else
    M.set_visible(ctrl, false)
  end
end

function M.is_visible(ctrl)
  if not ctrl_like(ctrl) then return false end
  local ok, v = pcall(function() return ctrl.visible end)
  return ok and v == true
end

------------------------------------------------------------------- 内容写入 --
-- 文本框/文本视窗：text 是读写字段（官方 §15(1)）
function M.set_text(ctrl, text)
  if not ctrl_like(ctrl) then return false end
  local ok = pcall(function() ctrl.text = tostring(text or "") end)
  return ok
end

function M.get_text(ctrl)
  if not ctrl_like(ctrl) then return nil end
  local ok, v = pcall(function() return ctrl.text end)
  if ok then return v end
  return nil
end

-- 字号必须是整数（官方 §15(1)：fontSize 为 integer）
function M.set_font_size(ctrl, size)
  if not ctrl_like(ctrl) then return false end
  local n = math.floor(tonumber(size) or 0)
  if n <= 0 then return false end
  local ok = pcall(function() ctrl.fontSize = n end)
  return ok
end

-- 图片：imageId 只读，换图只能 SetImage（官方 §14(1)(2)）
function M.set_image(ctrl, image_id)
  if not ctrl_like(ctrl) or image_id == nil then return false end
  local src = nil
  pcall(function() src = ctrl.imageSource end)
  if src == nil then return false end
  return call(ctrl, "SetImage", src, image_id) ~= nil
end

function M.set_image_color(ctrl, argb)
  if not ctrl_like(ctrl) or argb == nil then return false end
  local ok = pcall(function() ctrl.imageColor = argb end)
  return ok
end

-- 按钮可用性（四态里的「不可用」态由编辑器配置；interactable 是唯一可写开关）
function M.set_interactable(ctrl, on)
  if not ctrl_like(ctrl) then return false end
  local ok = pcall(function() ctrl.interactable = on == true end)
  return ok
end

function M.set_raycast(ctrl, on)
  if not ctrl_like(ctrl) then return false end
  local ok = pcall(function() ctrl.raycastTarget = on == true end)
  return ok
end

--------------------------------------------------------------------- 输入 --
local CURSOR = nil
local function cursor_enum()
  if CURSOR ~= nil then return CURSOR end
  local e = rawget(_G, "Enum")
  CURSOR = (e and e.CursorEventType) or false
  return CURSOR
end

-- 只有 预设按钮 / 光标检测区域 / 网格视窗 有光标事件（官方 §17(2)/§18(2)/§20(2)）
function M.on_click(ctrl, cb)
  if not ctrl_like(ctrl) or type(cb) ~= "function" then return false end
  local et = cursor_enum()
  if not et or et.CursorClick == nil then return false end
  local ok = pcall(function() ctrl:AddCursorEventListener(et.CursorClick, cb) end)
  return ok
end

function M.off_click(ctrl, cb)
  if not ctrl_like(ctrl) or type(cb) ~= "function" then return false end
  local et = cursor_enum()
  if not et or et.CursorClick == nil then return false end
  return call(ctrl, "RemoveCursorEventListener", et.CursorClick, cb) ~= nil
end

-- 按键：回调返回 boolean = 已处理（官方 §13(5) 原文），true 会阻断同容器其它控件
-- 注意：移除必须传同一函数引用 ⇒ 本框架只注册一份全局 handler
function M.on_key(script_obj, key, cb)
  if not ctrl_like(script_obj) or type(cb) ~= "function" then return false end
  local fn = script_obj.AddKeyEventListener
  if fn == nil then return false end
  return pcall(fn, script_obj, key, cb)
end

function M.simulate_click(ctrl)
  return call(ctrl, "SimulateCursorClick")
end

--------------------------------------------------------------------- 画布 --
function M.canvas_size()
  local w, h = call_global("GetUICanvasSize")
  if type(w) == "number" and type(h) == "number" then return w, h end
  return nil, nil
end

--------------------------------------------------------------------- 服务器 --
-- 上行：game.ServerSignal(name) → AddString/AddInt… → SendSignal()（官方 §9）
function M.send_signal(name, params)
  if type(name) ~= "string" or name == "" then return false end
  local sig = call_global("ServerSignal", name)
  if sig == nil then return false end
  for _, p in ipairs(params or {}) do
    local t = type(p)
    if t == "number" then
      if math.type and math.type(p) == "integer" then
        call(sig, "AddInt", p)
      else
        call(sig, "AddFloat", p)
      end
    elseif t == "boolean" then
      call(sig, "AddBool", p)
    else
      call(sig, "AddString", tostring(p))
    end
  end
  return call(sig, "SendSignal") ~= nil
end

-- 下行：script:RegisterServerSignalHandler(name, cb)（官方 §5(2)）
function M.on_server_signal(script_obj, name, cb)
  if not ctrl_like(script_obj) or type(cb) ~= "function" then return false end
  local fn = script_obj.RegisterServerSignalHandler
  if fn == nil then return false end
  return pcall(fn, script_obj, name, cb)
end

function M.get_var(entity_type, name)
  return call_global("GetGlobalCustomVariableValue", entity_type, name)
end

function M.print_tree()
  local fn = rawget(_G, "game") and game.PrintClientUITree
  if fn then pcall(fn) end
end

return M
