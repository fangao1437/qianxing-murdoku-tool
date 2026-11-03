--[[==========================================================================
  60_input.lua —— 输入路由（点击 / 键盘 / 长按）

  官方事实（《客户端控件API文档》§17(2)/§18(2)/§13(5)、§24(1)）：
    · 只有 预设按钮 / 光标检测区域 / 网格视窗 能收光标事件；
      「点击」用 CursorClick（完成点击），不要用 CursorDown。
    · 容器节点的 showCursor 必须为真，否则所有 CursorEvent 失效。
      ⇒ 这是**编辑器/存档字段**，Lua 侧没有 setter，本工程在存档里置真。
    · 没有长按事件 ⇒ 用 Down/Up + 自己累加 dt 实现（本文件 M.hold）。
    · 按键是**控件**方法 `ctrl:AddKeyEventListener(key, cb)`，
      cb 返回 true = 已处理、同容器其它控件不再响应。
      键名取法各版本不同（KeyboardKeyCode / KeyCode / 字符串），逐个试，
      全失败就降级（键盘是加分项，不影响触屏/鼠标）。

  两条纪律（抄自真机事故）：
    1. **回调里现查控件**（Bind.get），不捕获句柄 —— 控件重建后仍然命中活的。
    2. **同一 (控件, 事件) 只挂一份回调**，且保存引用以便移除。
--]]--

local M = {}

local handlers = {}   -- name → fn(data)
local bound = {}      -- name → 真正挂上去的回调（用于移除）
local holds = {}      -- ctrl → { threshold, cb, elapsed, pressed }
local key_binds = {}  -- { ctrl, key_value, cb }
local enabled = false

function M.reset()
  handlers = {}
  bound = {}
  holds = {}
  key_binds = {}
  enabled = false
end

------------------------------------------------------------------- 点击 --
-- 只登记「名字 → 处理函数」。真正挂事件在 bind_all()，这样 boot 顺序无关。
function M.on_click(name, fn)
  if type(name) ~= "string" or type(fn) ~= "function" then return false end
  handlers[name] = fn
  return true
end

local function make_click_cb(name)
  return function(data)
    local ctrl = Bind.get(name)          -- ← 现查，不捕获
    if ctrl == nil then return end
    local fn = handlers[name]
    if fn == nil then return end
    local ok, err = pcall(fn, ctrl, data)
    if not ok then Util.warn("click[%s] 处理异常: %s", name, tostring(err)) end
  end
end

-- 给所有已登记的控件挂 CursorClick。返回 (成功数, 失败名单)
function M.bind_all()
  local okn, fail = 0, {}
  for name in pairs(handlers) do
    if not bound[name] then
      local ctrl = Bind.get(name)
      if ctrl == nil then
        fail[#fail + 1] = name .. ":找不到"
      else
        local cb = make_click_cb(name)
        if Engine.on_click(ctrl, cb) then
          bound[name] = cb
          okn = okn + 1
        else
          fail[#fail + 1] = name .. ":不支持光标事件"
        end
      end
    end
  end
  return okn, fail
end

------------------------------------------------------------------- 长按 --
-- 官方没有长按事件 ⇒ 用 CursorDown/Up + dt 累加。
-- 返回 true 表示登记成功（控件不支持 Down/Up 时返回 false，调用方可降级）。
function M.hold(name, seconds, on_hold)
  local ctrl = Bind.get(name)
  if ctrl == nil then return false end
  local et = (rawget(_G, "Enum") or {}).CursorEventType
  if et == nil or et.CursorDown == nil or et.CursorUp == nil then return false end
  local rec = { threshold = tonumber(seconds) or 0.6, cb = on_hold, elapsed = 0, pressed = false }
  local ok = pcall(function()
    ctrl:AddCursorEventListener(et.CursorDown, function()
      rec.pressed = true
      rec.elapsed = 0
    end)
    ctrl:AddCursorEventListener(et.CursorUp, function()
      rec.pressed = false
      rec.elapsed = 0
    end)
  end)
  if not ok then return false end
  holds[#holds + 1] = rec
  return true
end

------------------------------------------------------------------- 键盘 --
-- 键名取法逐个试：Enum.KeyboardKeyCode → Enum.KeyCode → 原字符串
local KEY_ENUM_PATHS = { "KeyboardKeyCode", "KeyCode", "CursorKeyCode" }

local function resolve_key(name)
  local e = rawget(_G, "Enum")
  if e ~= nil then
    for _, path in ipairs(KEY_ENUM_PATHS) do
      local group = e[path]
      if group ~= nil then
        local v = group[name]
        if v ~= nil then return v, "Enum." .. path end
      end
    end
  end
  return name, "string"
end

-- 在候选控件里找第一个支持按键事件的控件，绑定 keymap = { {key="Left", action="prev"}, ... }
function M.enable_keys(candidate_names, keymap, on_action)
  if type(keymap) ~= "table" or #keymap == 0 then return false, "无可绑键位" end
  local ctrl, used, misses = nil, nil, {}
  for _, n in ipairs(candidate_names or {}) do
    local c = Bind.get(n)
    if c == nil then
      misses[#misses + 1] = n .. "=找不到"
    elseif c.AddKeyEventListener == nil then
      misses[#misses + 1] = n .. "=不支持按键"
    else
      ctrl, used = c, n
      break
    end
  end
  if ctrl == nil then
    return false, "无可用控件(" .. Util.join(misses, ";") .. ")"
  end
  local forms = {}
  local n_ok = 0
  for _, item in ipairs(keymap) do
    local key_value, form = resolve_key(item.key)
    local cb = function()
      local ok, handled = pcall(on_action, item.action)
      if ok and handled == false then return false end
      return true
    end
    local ok = pcall(function() ctrl:AddKeyEventListener(key_value, cb) end)
    if ok then
      key_binds[#key_binds + 1] = { ctrl = ctrl, key = key_value, cb = cb }
      n_ok = n_ok + 1
      forms[#forms + 1] = item.key .. "@" .. form
    end
  end
  enabled = n_ok > 0
  if enabled then
    Util.log("KEY_BIND ctrl=%s n=%d %s", used, n_ok, Util.join(forms, " "))
    return true, used
  end
  return false, "注册全部失败"
end

function M.keys_enabled() return enabled end

------------------------------------------------------------------- 帧更新 --
function M.tick(dt)
  local d = tonumber(dt) or 0
  if d <= 0 then return end
  for i = 1, #holds do
    local rec = holds[i]
    if rec.pressed then
      rec.elapsed = rec.elapsed + d
      if rec.elapsed >= rec.threshold then
        rec.pressed = false   -- 只触发一次
        if type(rec.cb) == "function" then pcall(rec.cb) end
      end
    end
  end
end

function M.bound_count()
  local n = 0
  for _ in pairs(bound) do n = n + 1 end
  return n
end

return M
