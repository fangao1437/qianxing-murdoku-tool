--[[==========================================================================
  lua/main.lua —— 千星 2D「翻页单击活动」UI 框架（**由 tools/build_bundle.mjs 生成，请勿手改**）

  源码：workspace/qxqy-ui-system/lua/src/*.lua（模块顺序见 tools/build_bundle.mjs）
  形态：standalone —— 注册 7 个全局生命周期；整份挂到 app.root
==========================================================================]]

-- ==========================================================================
-- module: Util   (lua/src/00_util.lua)
-- ==========================================================================
local Util = (function()
--[[==========================================================================
  00_util.lua —— 基础工具（无引擎依赖，纯函数）

  约定：
    · 所有模块都是「局部表 + return M」，由 tools/build_bundle.mjs 拼成单文件
      lua/main.lua 后挂到 app.root 上运行（单文件是为了绕开 require 导入根的
      路径风险；源码仍然分模块，见 docs/tech-architecture.md）。
    · 日志统一前缀，方便在试玩日志里 grep：`[ui]`。
--]]--

local M = {}

M.PREFIX = "[ui]"

-- 日志前缀可改（并入主脚本时用调用方的前缀，便于在同一份日志里区分模块）
function M.set_prefix(p)
  if type(p) == "string" and p ~= "" then M.PREFIX = p end
end

-- 找"脚本上下文"（官方《客户端控件API文档》§5(1) 的 script 字段）：
--   ① 全局 script；② 回调实参里第一个 table。找不到返回 nil（信号监听会降级跳过）
function M.script_ctx(...)
  local g = rawget(_G, "script")
  if g ~= nil then return g end
  for i = 1, select("#", ...) do
    local v = select(i, ...)
    if type(v) == "table" then return v end
  end
  return nil
end

function M.log(fmt, ...)
  local s = select("#", ...) > 0 and string.format(fmt, ...) or tostring(fmt)
  print(M.PREFIX .. " " .. s)
end

function M.warn(fmt, ...)
  local s = select("#", ...) > 0 and string.format(fmt, ...) or tostring(fmt)
  -- printerr 不阻断运行（官方：日志 print/printerr 均可）
  printerr(M.PREFIX .. "!" .. " " .. s)
end

function M.clamp(v, lo, hi)
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

function M.round(v)
  return math.floor(v + 0.5)
end

-- 数组按 id 查下标：pages[i].id == id
function M.index_of(list, id)
  for i = 1, #list do
    if list[i].id == id then return i end
  end
  return nil
end

function M.count(list)
  if type(list) ~= "table" then return 0 end
  local n = 0
  for _ in pairs(list) do n = n + 1 end
  return n
end

-- 稳定的键名排序后 join，用于 diag 去抖（避免每次打印顺序不同）
function M.keys_sorted(t)
  local ks = {}
  for k in pairs(t or {}) do ks[#ks + 1] = tostring(k) end
  table.sort(ks)
  return ks
end

function M.join(list, sep)
  local out = {}
  for i = 1, #list do out[i] = tostring(list[i]) end
  return table.concat(out, sep or ",")
end

-- 前缀匹配：`tab.p1` 命中前缀 "tab."
function M.starts_with(s, prefix)
  return type(s) == "string" and string.sub(s, 1, #prefix) == prefix
end

return M
end)()

-- ==========================================================================
-- module: Engine   (lua/src/10_engine.lua)
-- ==========================================================================
local Engine = (function()
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
end)()

-- ==========================================================================
-- module: Bind   (lua/src/20_bind.lua)
-- ==========================================================================
local Bind = (function()
--[[==========================================================================
  20_bind.lua —— 控件索引层：名字 → 控件句柄

  为什么需要它：官方**没有**递归按名字查控件的接口，只有
    ctrl:GetChildren() / ctrl:GetChild(name) / ctrl:FindChild(path)
  （《客户端控件API文档》§13(2)），深层控件只能自己遍历建表。

  三条硬约束（来自真机教训 docs/repo-survey.md §2.3）：
    1. **不许缓存陈旧句柄**：传送/断线重连会销毁全部客户端控件（官方 §五.3）。
       所以索引带 generation；外部事件（信号、传送后）可调 Bind.invalidate()
       让下一次 get() 重建。
    2. **不许闭包捕获控件**：事件回调里一律 `Bind.get("btn.next")` 现查，
       控件重建后仍然指向活的那个。
    3. **查找要便宜**：一次 DFS 建表（每个名字只记一次，先出现者赢），
       后续 O(1)。禁止每帧遍历（既有工程实测 300 帧 7020 次 GetChildren）。
--]]--

local M = {}

local index = {}        -- name → ctrl
local order = {}        -- 建表顺序（便于 diag 与调试）
local generation = 0    -- 每次 rebuild +1
local built_from = nil  -- 建表根（用于诊断）

function M.get(name)
  if type(name) ~= "string" then return nil end
  return index[name]
end

function M.has(name)
  return index[name] ~= nil
end

function M.generation()
  return generation
end

function M.names()
  local out = {}
  for i = 1, #order do out[i] = order[i] end
  return out
end

-- 按前缀取名字（例如 "tab." → {"tab.p1","tab.p2"}），保持建表顺序
function M.names_with_prefix(prefix)
  local out = {}
  for i = 1, #order do
    local n = order[i]
    if Util.starts_with(n, prefix) then out[#out + 1] = n end
  end
  return out
end

-- 名字前缀后的短 id：`tab.p1` + "tab." → "p1"
function M.short_id(name, prefix)
  if type(name) ~= "string" then return nil end
  if Util.starts_with(name, prefix) then return string.sub(name, #prefix + 1) end
  return nil
end

function M.invalidate()
  index = {}
  order = {}
  built_from = nil
end

-- 一次 DFS 建表。`roots` 既可以是**数组**（推荐），也可以是单个控件（自动包装）。
-- 判别顺序（踩过坑）：运行时控件是 userdata、内部对象是 table，
--   而「数组」本身也是 table ⇒ **不能**用 `is_ctrl` 判断是不是单个控件，
--   要按「是不是数组」判断：连续编号 1..n 的 table 当数组，其余当单个控件。
-- 同名控件：**先出现者赢**（父在前、兄在前），并把重复项记进 M.duplicates 供 diag。
local function as_list(v)
  if v == nil then return {} end
  if type(v) ~= "table" then return { v } end        -- userdata 控件
  if v[1] ~= nil then return v end                   -- 数组
  if rawget(v, "GetChildren") ~= nil then return { v } end -- 控件对象（模拟器内部形态）
  if next(v) == nil then return v end                -- 空表
  return { v }
end

function M.rebuild(roots)
  M.invalidate()
  local list = as_list(roots)
  M.duplicates = {}
  local seen = {}
  local function walk(ctrl, depth)
    if not Engine.is_ctrl(ctrl) or depth > 32 then return end
    local name = Engine.name_of(ctrl)
    if name ~= nil and name ~= "" then
      if seen[name] then
        M.duplicates[#M.duplicates + 1] = name
      else
        seen[name] = true
        index[name] = ctrl
        order[#order + 1] = name
      end
    end
    for _, kid in ipairs(Engine.children(ctrl)) do walk(kid, depth + 1) end
  end
  for _, r in ipairs(list) do walk(r, 0) end
  generation = generation + 1
  built_from = list
  return generation
end

-- 找直接子控件（不建表场景用：例如给按钮挂事件前确认它属于这个屏）
function M.child(parent, name)
  return Engine.child(parent, name)
end

return M
end)()

-- ==========================================================================
-- module: State   (lua/src/30_state.lua)
-- ==========================================================================
local State = (function()
--[[==========================================================================
  30_state.lua —— 视觉状态层（按钮四态 / 页签选中态）

  官方事实（《预设按钮控件》§三.1(3) / 《客户端控件API文档》§17(1)）：
    · 预设按钮的四态是**编辑器概念**：默认 / 悬停 / 按下 / **不可用**；
      每态可以引用不同的子控件，运行时由引擎自动切换。
    · 脚本**没有**任何接口能改这四态的绑定，也没有「选中态」——
      `hoverChildId/pressedChildId/...` 这些字段名在客户端语料里不存在。
    · 脚本可写的只有 `interactable`（可用与否）。

  所以本层的分工是：
    · 「悬停 / 按下 / 不可用」交给编辑器四态（Lua 不碰）。
    · 「选中（selected）」官方没有 ⇒ 用**显隐子控件**自己实现：
        名字约定 `state.sel`（选中时显示）与 `state.off`（未选中时显示），
        两者都是该控件的直接子控件。
    · 这套显隐同样受「单一可见性权威」约束：只有 State.apply 会写它们。
--]]--

local M = {}

local wanted = {}   -- ctrl → true/false（期望是否 selected）
local order = {}

function M.sel_name() return "state.sel" end
function M.off_name() return "state.off" end

-- 登记一个可选中控件（tab 等）。缺子控件时**不报错**，只记缺失，diag 里汇总。
function M.register(name, ctrl)
  if not Engine.is_ctrl(ctrl) then return false end
  if wanted[ctrl] == nil then order[#order + 1] = ctrl end
  if wanted[ctrl] == nil then wanted[ctrl] = false end
  M._names = M._names or {}
  M._names[ctrl] = name
  local has_sel = Engine.child(ctrl, M.sel_name()) ~= nil
  local has_off = Engine.child(ctrl, M.off_name()) ~= nil
  M._missing = M._missing or {}
  if not has_sel and not has_off then
    M._missing[#M._missing + 1] = name or "?"
  end
  return true
end

function M.set(name_or_ctrl, selected)
  local ctrl = name_or_ctrl
  if type(ctrl) == "string" then ctrl = Bind.get(ctrl) end
  if not Engine.is_ctrl(ctrl) then return false end
  if wanted[ctrl] == nil then order[#order + 1] = ctrl end
  wanted[ctrl] = selected == true
  return M.apply_one(ctrl)
end

function M.is_selected(name_or_ctrl)
  local ctrl = name_or_ctrl
  if type(ctrl) == "string" then ctrl = Bind.get(ctrl) end
  return ctrl ~= nil and wanted[ctrl] == true
end

-- 把单个控件的 state.sel / state.off 显隐写到引擎
function M.apply_one(ctrl)
  if not Engine.is_ctrl(ctrl) then return false end
  local on = wanted[ctrl] == true
  local sel = Engine.child(ctrl, M.sel_name())
  local off = Engine.child(ctrl, M.off_name())
  if sel ~= nil then Engine.set_visible(sel, on) end
  if off ~= nil then Engine.set_visible(off, not on) end
  return true
end

-- 一次性把全部登记过的控件刷到引擎（幂等；一帧最多一次）
function M.apply()
  local n = 0
  for i = 1, #order do
    if M.apply_one(order[i]) then n = n + 1 end
  end
  return n
end

function M.missing()
  return (M._missing and #M._missing > 0) and M._missing or {}
end

function M.reset()
  wanted = {}
  order = {}
  M._missing = nil
end

return M
end)()

-- ==========================================================================
-- module: Screen   (lua/src/40_screen.lua)
-- ==========================================================================
local Screen = (function()
--[[==========================================================================
  40_screen.lua —— 界面（屏）注册表 + 屏级显隐

  这一层是既有工程最痛的地方（docs/repo-survey.md §2.2 / §3 P5·P6·P7·P19）：
  旧实现用「一个 screen 字符串 + 前缀隐藏名单 + render 差集 + forget_visible 账本」
  四套东西描述同一件事，导致「只藏不显」「前缀吃掉合法例外」这类真机事故。

  本层的唯一规则：
    · 屏的可见性**只有一个权威**：Screen.apply()。
      任何地方只改「期望值」（state.want），改完调一次 render()。
    · 不允许用「隐藏容器」切屏：客户端控件容器隐藏 = 控件销毁
      （《客户端控件和客户端脚本》§五.2）⇒ 屏根容器必须恒 active，
      切屏只对**屏根控件**做 SetVisible。
    · 屏根容器恒 active 后，屏内脚本即使隐藏也在跑 —— 这与官方一致
      （visible 只影响可见性，不改变激活状态）。
--]]--

local M = {}

local screens = {}   -- 有序数组：{ id, name, ctrl, pages, tabs, page_index }
local by_id = {}
local want_id = nil  -- 期望显示的屏（nil = 全部隐藏）
local shown_id = nil -- 引擎里当前真正显示的屏
local on_change = nil

function M.reset()
  screens = {}
  by_id = {}
  want_id = nil
  shown_id = nil
end

function M.set_on_change(fn)
  on_change = fn
end

function M.add(id, name, ctrl)
  local rec = {
    id = id,
    name = name,
    ctrl = ctrl,
    pages = {},        -- { id, name, ctrl }
    tabs = {},         -- { page_id, name, ctrl }
    page_index = 0,
  }
  screens[#screens + 1] = rec
  by_id[id] = rec
  return rec
end

function M.list() return screens end
function M.get(id) return by_id[id] end
function M.count() return #screens end

function M.current_id() return want_id end

function M.current()
  return want_id and by_id[want_id] or nil
end

function M.shown_id() return shown_id end

-- 打开一个屏（只改期望值 + 立即渲染一次；渲染幂等）
function M.open(id)
  if id ~= nil and by_id[id] == nil then
    Util.warn("open: 未知屏 %s", tostring(id))
    return false
  end
  want_id = id
  M.apply()
  return true
end

function M.close()
  want_id = nil
  M.apply()
end

function M.toggle(id)
  if want_id == id then M.close() else M.open(id) end
end

-- 唯一可见性权威。幂等：同一状态下重复调用不会重复写引擎。
function M.apply(force)
  local target = want_id and by_id[want_id] or nil
  for i = 1, #screens do
    local s = screens[i]
    local should = (s == target)
    if force or s._shown ~= should then
      s._shown = should
      if should then
        -- 屏根：先 active 再 visible（active 默认 false，忘写就白屏）
        Engine.set_active(s.ctrl, true)
        Engine.set_visible(s.ctrl, true)
      else
        -- 只关可见性，保持 active：屏内脚本继续可用，且容器不会被销毁
        Engine.set_visible(s.ctrl, false)
      end
    end
  end
  local now = target and target.id or nil
  if now ~= shown_id then
    shown_id = now
    if on_change then on_change(target) end
  end
  return true
end

function M.describe()
  local parts = {}
  for i = 1, #screens do
    local s = screens[i]
    parts[#parts + 1] = string.format("%s(%d页/%d签)", s.id, #s.pages, #s.tabs)
  end
  return Util.join(parts, " ")
end

return M
end)()

-- ==========================================================================
-- module: Pager   (lua/src/50_pager.lua)
-- ==========================================================================
local Pager = (function()
--[[==========================================================================
  50_pager.lua —— 页模型与翻页

  「翻页单击活动样式」（教程 GIA 的结构，见 docs/gia-structure.md）在脚本侧的抽象：
    · 一个屏里有多**页**（page.<id>），同一时刻只有一页可见；
    · 页签 tab.<id> 直接跳到 page.<id>；
    · 上一页/下一页按钮 btn.prev / btn.next 做顺序翻页；
    · hud.pager 显示「当前 / 总数」；
    · 边界行为：默认**钳制**（到头不动），可配置成循环 —— 这是活动页常见两种手感，
      留成参数而不是写死。

  页的顺序 = 编辑器里的**同级顺序**（GetChildren 返回顺序），不是名字排序，
  这样在编辑器里拖动顺序就等于改翻页顺序。
--]]--

local M = {}

M.config = {
  wrap = false,            -- true = 首尾循环；默认钳制
  pager_text = "%d / %d",  -- hud.pager 的格式
}

function M.reset_screen(screen)
  if screen == nil then return end
  screen.pages = {}
  screen.tabs = {}
  screen.page_index = 0
end

function M.add_page(screen, id, ctrl)
  if screen == nil then return end
  screen.pages[#screen.pages + 1] = { id = id, ctrl = ctrl, name = Engine.name_of(ctrl) }
end

function M.add_tab(screen, page_id, ctrl)
  if screen == nil then return end
  screen.tabs[#screen.tabs + 1] = { page_id = page_id, ctrl = ctrl, name = Engine.name_of(ctrl) }
end

function M.count(screen)
  return screen and #screen.pages or 0
end

function M.current(screen)
  if screen == nil or screen.page_index < 1 then return nil end
  return screen.pages[screen.page_index]
end

function M.current_id(screen)
  local p = M.current(screen)
  return p and p.id or nil
end

function M.index_of(screen, page_id)
  if screen == nil then return nil end
  for i = 1, #screen.pages do
    if screen.pages[i].id == page_id then return i end
  end
  return nil
end

-- 跳到指定页（方法名用 jump 而不是 goto：Lua 5.3 里 goto 是保留字）。
-- 返回 ok, changed（changed=false 表示本来就在这页）
function M.jump(screen, page_id, opts)
  if screen == nil then return false, false end
  local i = M.index_of(screen, page_id)
  if i == nil then
    Util.warn("jump: %s 里没有页 %s", tostring(screen.id), tostring(page_id))
    return false, false
  end
  local changed = (i ~= screen.page_index)
  screen.page_index = i
  M.apply(screen, opts)
  return true, changed
end

function M.next(screen, opts)
  if screen == nil or #screen.pages == 0 then return false, false end
  local n = #screen.pages
  local i = screen.page_index + 1
  if i > n then
    if M.config.wrap then i = 1 else return false, false end
  end
  local changed = (i ~= screen.page_index)
  screen.page_index = i
  M.apply(screen, opts)
  return true, changed
end

function M.prev(screen, opts)
  if screen == nil or #screen.pages == 0 then return false, false end
  local n = #screen.pages
  local i = screen.page_index - 1
  if i < 1 then
    if M.config.wrap then i = n else return false, false end
  end
  local changed = (i ~= screen.page_index)
  screen.page_index = i
  M.apply(screen, opts)
  return true, changed
end

-- 「重置内容页签」：把当前页回到初始内容。内容由 App 注册的 resetter 决定；
-- 没注册 resetter 的页复位成「只重写一遍默认文本」。
function M.reset_current(screen, opts)
  local page = M.current(screen)
  if page == nil then return false end
  local hook = page.resetter
  if type(hook) == "function" then
    local ok, err = pcall(hook, page, opts)
    if not ok then Util.warn("reset 失败: %s", tostring(err)) end
    return true
  end
  M.apply(screen, opts)
  return true
end

-- 页级显隐 + 页码文本 + 页签选中态（幂等）
function M.apply(screen, opts)
  if screen == nil then return false end
  opts = opts or {}
  local cur = screen.page_index

  for i = 1, #screen.pages do
    local p = screen.pages[i]
    local should = (i == cur)
    if p._shown ~= should then
      p._shown = should
      if should then
        Engine.set_active(p.ctrl, true)
        Engine.set_visible(p.ctrl, true)
      else
        Engine.set_visible(p.ctrl, false)
      end
    end
  end

  local pager = Bind.get("hud.pager")
  if pager ~= nil then
    Engine.set_text(pager, string.format(M.config.pager_text, math.max(cur, 1), #screen.pages))
  end

  local tabs = screen.tabs
  for i = 1, #tabs do
    local t = tabs[i]
    local on = (t.page_id == M.current_id(screen))
    if t._sel ~= on then
      t._sel = on
      State.set(t.ctrl, on)
    end
  end

  if opts.notify ~= false then
    if M.on_page_changed then
      pcall(M.on_page_changed, screen, M.current(screen))
    end
  end
  return true
end

-- App 注入：页变化回调（发信号 / 埋点 / 换素材）
M.on_page_changed = nil

return M
end)()

-- ==========================================================================
-- module: Input   (lua/src/60_input.lua)
-- ==========================================================================
local Input = (function()
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
end)()

-- ==========================================================================
-- module: App   (lua/src/70_app.lua)
-- ==========================================================================
local App = (function()
--[[==========================================================================
  70_app.lua —— 装配层：发现控件、接输入、接服务器、渲染、诊断

  这一层把「布局留白」变成可执行的东西：
    · 界面结构全部由**名字约定**发现（见下），Lua 里不写任何坐标或控件清单；
      以后在编辑器里把控件按名字摆好，框架自动接管，不需要改脚本。
    · 名字一个都没有时也不崩：发现 0 个屏 → 打一行 APP_DIAG 后安静待命。

  名字约定（编辑器里照这个命名；`<x>` 是自定义 id）
    app.root                整屏根容器（客户端控件容器画布里的默认容器节点）
    screen.<id>             一个界面；同时只有一个可见
      page.<id>             一页；页顺序 = 编辑器里的同级顺序
      tab.<id>              页签按钮 → 跳到 page.<id>（可带 state.sel/state.off 子控件）
      btn.prev / btn.next   上一页 / 下一页
      btn.close             关闭当前界面
      btn.reset             重置当前页内容
      hud.pager             页码文本（"%d / %d"）
      hud.title / hud.body  标题 / 正文（正文通常是文本视窗）

  与服务器的分工（官方 §五.1 / §6(3)）：
    · 客户端**不能写**自定义变量 ⇒ 翻页/动作只发信号（ui/nav、ui/action），
      由服务端节点图写变量；界面自身的状态在本地先改，不等回包（信号 ≥100ms）。
    · 服务端下行用 ui/sync，客户端只做「以服务端为准」的校正与日志。
--]]--

local M = {}

M.config = {
  root_name = "app.root",
  screen_prefix = "screen.",
  page_prefix = "page.",
  tab_prefix = "tab.",
  buttons = {
    prev = "btn.prev",
    next = "btn.next",
    close = "btn.close",
    reset = "btn.reset",
  },
  hud = {
    pager = "hud.pager",
    title = "hud.title",
    body = "hud.body",
  },
  keymap = {
    { key = "Left", action = "prev" },
    { key = "Right", action = "next" },
    { key = "A", action = "prev" },
    { key = "D", action = "next" },
    { key = "Escape", action = "close" },
  },
  key_targets = { "app.root", "screen.*" },
  signals = { nav = "ui/nav", action = "ui/action", sync = "ui/sync" },
  auto_open = true,
  start_page = nil,   -- nil = 每个屏的第一页
  -- 是否自己绑键盘。并入关卡主脚本时建议 false：由主脚本在一处裁决 Esc/方向键，
  -- 否则两套监听抢同一次按键（按键"返回 true = 已处理"只在同一容器内有语义）。
  keys_enabled = true,
  boot_retry = 0.15,  -- 启动重试间隔（秒）
  boot_timeout = 3.0, -- 超过这个时间还没发现任何屏 ⇒ APP_NO_SCREENS 后待命
}

M.booted = false
M.root = nil
M.stats = { screens = 0, pages = 0, tabs = 0, clicks = 0, key = false }
M.missing = {}
M.resets = {}   -- page_id → fn

local function push_missing(what)
  M.missing[#M.missing + 1] = what
end

------------------------------------------------------------------ 发现 --
local function collect_children_by_prefix(ctrl, prefix)
  local out = {}
  for _, kid in ipairs(Engine.children(ctrl)) do
    local name = Engine.name_of(kid)
    if name ~= nil and Util.starts_with(name, prefix) then
      out[#out + 1] = { name = name, id = string.sub(name, #prefix + 1), ctrl = kid }
    end
  end
  return out
end

local function root_of()
  -- 优先 FindClientUIRoot(名字)（官方 §6(1)：只查根层）
  local named = Engine.call_global("FindClientUIRoot", M.config.root_name)
  if named ~= nil then return named end
  local roots = Engine.roots()
  for _, r in ipairs(roots) do
    if Engine.name_of(r) == M.config.root_name then return r end
  end
  return roots[1]
end

function M.discover()
  Screen.reset()
  State.reset()
  M.missing = {}

  local root = root_of()
  M.root = root
  M.root_name = root and (Engine.name_of(root) or ("Id=" .. tostring(Engine.id_of(root)))) or "nil"
  if root == nil then
    push_missing("app.root")
    return 0
  end
  -- 屏根容器要恒 active：容器隐藏/销毁会连带销毁其内客户端控件（官方 §五.2）
  Engine.set_active(root, true)
  Engine.show(root, true)

  Bind.rebuild({ root })

  local screens = collect_children_by_prefix(root, M.config.screen_prefix)
  for _, sd in ipairs(screens) do
    local rec = Screen.add(sd.id, sd.name, sd.ctrl)
    Engine.set_active(sd.ctrl, true)   -- 屏根恒 active，只切 visible

    -- 页：顺序 = 编辑器同级顺序
    for _, pd in ipairs(collect_children_by_prefix(sd.ctrl, M.config.page_prefix)) do
      Pager.add_page(rec, pd.id, pd.ctrl)
    end
    -- 页签：tab.<page_id>
    for _, td in ipairs(collect_children_by_prefix(sd.ctrl, M.config.tab_prefix)) do
      Pager.add_tab(rec, td.id, td.ctrl)
      State.register(td.name, td.ctrl)
    end
    M.stats.pages = M.stats.pages + #rec.pages
    M.stats.tabs = M.stats.tabs + #rec.tabs
  end
  M.stats.screens = #screens
  if #screens == 0 then push_missing("screen.*") end
  return #screens
end

------------------------------------------------------------------ 输入 --
local function screen_opts()
  return { notify = true }
end

-- 单个动作的统一入口（点击 / 按键 / 外部都走这里），返回是否真的发生了动作
function M.act(action, source)
  local screen = Screen.current()
  if screen == nil then return false end
  local ok, changed = false, false
  if action == "next" then
    ok, changed = Pager.next(screen, screen_opts())
  elseif action == "prev" then
    ok, changed = Pager.prev(screen, screen_opts())
  elseif action == "reset" then
    ok = Pager.reset_current(screen, screen_opts())
    changed = true
  elseif action == "close" then
    Screen.close()
    ok, changed = true, true
  else
    -- 其它动作名 = 跳到同名页（页签点击走这条）
    ok, changed = Pager.jump(screen, action, screen_opts())
  end
  if ok then
    Util.log("ACT %s<- %s page=%s", tostring(action), tostring(source or "?"), tostring(Pager.current_id(screen)))
    Engine.send_signal(M.config.signals.action, { screen.id, tostring(action) })
  end
  return changed
end

function M.wire_input()
  Input.reset()

  for _, screen in ipairs(Screen.list()) do
    -- 页签：点击 = 跳到对应页
    for _, tab in ipairs(screen.tabs) do
      local page_id = tab.page_id
      Input.on_click(tab.name, function() return M.act(page_id, tab.name) end)
    end
  end

  for action, name in pairs(M.config.buttons) do
    if Bind.has(name) then
      Input.on_click(name, function() return M.act(action, name) end)
    else
      push_missing(name)
    end
  end

  local okn, fail = Input.bind_all()
  M.stats.clicks = okn
  for _, f in ipairs(fail) do push_missing(f) end
  return okn, fail
end

function M.wire_keys()
  if not M.config.keys_enabled then
    Util.log("KEY_SKIP keys_enabled=false（由主脚本裁决按键）")
    return false
  end
  local targets = {}
  for _, n in ipairs(M.config.key_targets) do
    if n == "app.root" then
      if M.root ~= nil then targets[#targets + 1] = M.config.root_name end
    elseif Util.starts_with(n, "screen.") then
      for _, s in ipairs(Screen.list()) do targets[#targets + 1] = s.name end
    else
      targets[#targets + 1] = n
    end
  end
  local ok, detail = Input.enable_keys(targets, M.config.keymap, function(action)
    return M.act(action, "key")
  end)
  M.stats.key = ok
  if not ok then
    -- 键盘是加分项：失败只记录，不影响触屏/鼠标
    Util.log("KEY_SKIP %s", tostring(detail))
  end
  return ok
end

------------------------------------------------------------------ 服务器 --
function M.wire_signals(script_obj)
  if script_obj == nil then return false end
  local ok = Engine.on_server_signal(script_obj, M.config.signals.sync, function(_name, params)
    local page = params and params[1] or nil
    Util.log("APP_SYNC page=%s", tostring(page))
    local screen = Screen.current()
    if screen ~= nil and page ~= nil then
      -- 服务端为准：若服务端记录的页在本屏存在，则校正过去（幂等）
      local i = Pager.index_of(screen, tostring(page))
      if i ~= nil and i ~= screen.page_index then
        screen.page_index = i
        Pager.apply(screen, { notify = false })
        Util.log("APP_SYNC_APPLIED page=%s", tostring(page))
      end
    end
  end)
  if ok then Util.log("SIGNAL_BIND %s", M.config.signals.sync) end
  return ok
end

--------------------------------------------------------------- 页变化钩子 --
function M.on_page_changed(screen, page)
  if screen == nil then return end
  local page_id = page and page.id or ""
  Util.log("PAGE %s/%s idx=%d", screen.id, page_id, screen.page_index)
  -- 上行：让服务端记录当前页（客户端不能写变量，只能发信号）
  Engine.send_signal(M.config.signals.nav, { screen.id, page_id, screen.page_index })
end

------------------------------------------------------------------ 生命周期 --
-- [实测 · 模拟器 mobile-16-9] OnInit 阶段客户端控件树**还没接好**：
--   · game.GetClientUIRoots() 能返回 1 个根对象，但 root:GetChildren() 是空的
--     （此时 game.PrintClientUITree() 已经能打出完整树 —— 它读的是挂载计划，不是活对象）
--   · 所以「root 存在」不等于「可以启动」；判据必须是**发现到屏**
-- ⇒ 启动策略：没有发现到屏就把 pending 置真，由 OnStart/OnEnable/OnUpdate 重试；
--   超过 M.config.boot_timeout 秒仍没有屏则放弃（打 APP_NO_SCREENS），避免无限 DFS。
function M.boot(script_obj)
  if M.booted then
    return true
  end
  if script_obj ~= nil then M.script_obj = script_obj end
  M.attempts = (M.attempts or 0) + 1

  local n = M.discover()
  M.stats.screens = n
  if M.root ~= nil and n > 0 then
    M.booted = true
    M.pending = false
    M.stats.pages, M.stats.tabs = 0, 0
    for _, s in ipairs(Screen.list()) do
      M.stats.pages = M.stats.pages + #s.pages
      M.stats.tabs = M.stats.tabs + #s.tabs
    end

    Util.log("DISCOVER screens=%d pages=%d tabs=%d root=%s", M.stats.screens, M.stats.pages, M.stats.tabs, tostring(M.root_name))
    Pager.on_page_changed = M.on_page_changed
    M.wire_input()
    M.wire_keys()
    M.wire_signals(M.script_obj)

    if M.config.auto_open then
      local first = Screen.list()[1]
      local page_id = M.config.start_page
      if page_id ~= nil and Pager.index_of(first, page_id) ~= nil then
        first.page_index = Pager.index_of(first, page_id)
      elseif #first.pages > 0 then
        first.page_index = 1
      end
      Screen.open(first.id)
      -- ★ 必须显式渲染一次：屏显隐走了 Screen.apply，但**页显隐 / 页码文本 / 页签选中态**
      --   只有 Pager.apply 会写。之前漏了这一步 —— 模拟器里看起来对，只是因为存档的
      --   初始状态恰好和第 1 页一致（p1 可见、页码写着 "1 / 3"）；离线桩不预先摆好，立刻暴露。
      Pager.apply(first, { notify = false })
    end

    M.diag()
    Util.log("APP_READY booted=true attempts=%d", M.attempts)
    return true
  end

  -- 还没就绪（或工程里确实没有按约定命名的屏）
  M.pending = true
  M.wait = (M.wait or 0)
  if M.attempts <= 3 then
    Util.log("BOOT_WAIT attempt=%d root=%s screens=%d", M.attempts, tostring(M.root_name), n)
  end
  return false
end

-- 超过 boot_timeout 仍无屏 ⇒ 认定本工程没有按约定摆放的界面（架构留白状态），
-- 安静待命：仍然 log 一行诊断，方便排查命名写错的情况。
function M.give_up()
  if M.booted then return end
  M.booted = true
  M.pending = false
  M.diag()
  Util.log("APP_NO_SCREENS 超过 %.1fs 仍未发现 screen.*（检查命名约定，见 docs/tech-architecture.md）", M.config.boot_timeout)
end

-- 单行诊断：试玩日志里 grep 一行就能看清框架认到了什么
-- 注：`dup` 只报**数量**。控件内重复的子名（text / plate / state.sel 等）是命名约定的正常现象，
--    只有「本该唯一的语义名（screen./page./tab./btn./hud.）重复」才是问题，那类会被单独列出。
local UNIQUE_PREFIXES = { "app.", "screen.", "page.", "tab.", "btn.", "hud." }
function M.diag()
  local missing = #M.missing > 0 and Util.join(M.missing, ";") or "none"
  local dup_n, dup_bad = 0, {}
  for _, n in ipairs(Bind.duplicates or {}) do
    dup_n = dup_n + 1
    for _, p in ipairs(UNIQUE_PREFIXES) do
      if Util.starts_with(n, p) then
        dup_bad[#dup_bad + 1] = n
        break
      end
    end
  end
  local st = State.missing()
  Util.log(
    "APP_DIAG screens=%d pages=%d tabs=%d clicks=%d keys=%s screen=%s page=%s missing=%s dup=%d dup_bad=%s state_missing=%s",
    M.stats.screens,
    M.stats.pages,
    M.stats.tabs,
    M.stats.clicks,
    tostring(M.stats.key),
    tostring(Screen.current_id()),
    tostring(Screen.current() and Pager.current_id(Screen.current()) or nil),
    missing,
    dup_n,
    #dup_bad > 0 and Util.join(dup_bad, ";") or "none",
    #st > 0 and Util.join(st, ";") or "none"
  )
  return missing
end

function M.tick(dt)
  Input.tick(dt)
  local d = tonumber(dt) or 0
  -- 启动重试：OnStart/OnEnable 会主动再试一次，这里兜底 OnInit 阶段控件树还没接好的情况
  if not M.booted and M.pending then
    M.wait = (M.wait or 0) + d
    M.retry_cd = (M.retry_cd or 0) - d
    if M.retry_cd <= 0 then
      M.retry_cd = M.config.boot_retry
      if M.wait >= M.config.boot_timeout then
        M.give_up()
      else
        M.boot(M.script_obj)
      end
    end
  end
end

-- 供后续「内容设计」用的扩展点 -------------------------------------------
-- 给某一页注册重置钩子（对应「重置内容页签」）
function M.register_reset(page_id, fn)
  if type(page_id) == "string" and type(fn) == "function" then
    M.resets[page_id] = fn
    for _, s in ipairs(Screen.list()) do
      for _, p in ipairs(s.pages) do
        if p.id == page_id then p.resetter = fn end
      end
    end
    return true
  end
  return false
end

function M.set_title(text)
  local ctrl = Bind.get(M.config.hud.title)
  if ctrl ~= nil then return Engine.set_text(ctrl, text) end
  return false
end

function M.set_body(text)
  local ctrl = Bind.get(M.config.hud.body)
  local cur = Screen.current()
  if cur ~= nil then
    local page = Pager.current(cur)
    if page ~= nil then
      local own = Engine.child(page.ctrl, M.config.hud.body)
      if own ~= nil then return Engine.set_text(own, text) end
    end
  end
  if ctrl ~= nil then return Engine.set_text(ctrl, text) end
  return false
end

function M.state()
  return { screen = Screen.current_id(), page = Screen.current() and Pager.current_id(Screen.current()) or nil }
end

return M
end)()

-- ==========================================================================
-- module: Entry   (lua/src/90_entry.lua)
-- ==========================================================================
local Entry = (function()
--[[==========================================================================
  90_entry.lua —— 生命周期入口（官方 §1 的 7 个固定名字）

  只做三件事：
    1. 把「脚本上下文」找出来（不同宿主下 script 可能是全局、也可能作为回调实参）
    2. 保证 boot **只跑一次**（OnInit 与 OnStart 谁先来都能启动）
    3. OnUpdate 只把 dt 转给 Input.tick（长按计时），其余工作都是事件驱动的
  官方没有承诺 OnInit/OnStart 的先后顺序（见 docs/api-notes.md §未查到 1），
  所以这里不依赖顺序。
--]]--

local M = {}

local function script_ctx(...)
  return Util.script_ctx(...)
end

function M.OnInit(...)
  Util.log("LIFECYCLE OnInit")
  App.boot(script_ctx(...))
end

function M.OnStart(...)
  Util.log("LIFECYCLE OnStart")
  if not App.booted then App.boot(script_ctx(...)) end
end

function M.OnEnable(...)
  Util.log("LIFECYCLE OnEnable")
  if not App.booted then App.boot(script_ctx(...)) end
end

function M.OnUpdate(dt, ...)
  -- 兜底：若宿主没有调 OnInit/OnStart，第一帧仍然把框架启动起来
  if not App.booted then App.boot(script_ctx(...)) end
  App.tick(dt)
end

function M.OnLevelUpdate(dt)
  -- 关卡逐帧（受时停影响）：本框架不依赖它，保持空实现，避免宿主报缺失
end

function M.OnDisable() end
function M.OnDestroy() end

return M
end)()

-- ==========================================================================
-- module: Tutorial   (lua/src/91_api.lua)
-- ==========================================================================
local Tutorial = (function()
--[[==========================================================================
  91_api.lua —— 对外 API 门面（Tutorial）

  为什么有这么一层：本框架要能被**两种形态**使用，且行为一致。

  形态 A（standalone，当前交付形态）：
      整份 bundle 挂在一个控件上，引擎按固定名字调用 OnInit/OnStart/OnUpdate…
      ⇒ bundle 末尾把 7 个生命周期注册成全局函数。

  形态 B（module，并入关卡主脚本时）：
      主脚本已经有自己的 OnInit/OnUpdate，**不能再抢全局回调**；
      ⇒ 不注册任何全局生命周期，只暴露全局 `Tutorial`：
          local T = Tutorial.install({ root_name = "tutorial.root", keys_enabled = false })
          -- 在主脚本自己的 OnStart/OnUpdate 里转发：
          T.OnStart(); T.OnUpdate(dt)

  为什么并入主脚本是推荐做法（而不是给教程单独建一个脚本映射）：
    · 独立脚本是**独立的 Lua 环境**，教程读不到关卡的 Lua 状态表；
      只能走 `script:Invoke`（要拿目标 scriptMappingId —— 每次重新导入都要校准）
      或服务端信号（联机 ≥100ms）。教程与关卡的实时联动会被迫异步。
    · 两套脚本各自注册光标/按键监听 ⇒ 谁来"认领"同一次 Esc 由渲染顺序决定，无法在一处裁决。
    · 控件索引、生命周期恢复（传送/断线会销毁全部客户端控件）、构建与交付都会翻倍。
  什么时候才值得独立映射：教程要**运行时实例化多份**（各自独立状态）、要独立发布复用、
  或要在没有关卡脚本时也能跑。三条都不满足就别拆。
--]]--

local M = {}

-- 默认值：与 App.config 同名键合并（只在 install 时覆盖，不破坏 standalone 行为）
M.defaults = {
  root_name = "app.root",
  keys_enabled = true,
  auto_open = true,
  start_page = nil,
  log_prefix = "[ui]",
  signals = nil,        -- nil = 用 App.config.signals
  buttons = nil,        -- nil = 用 App.config.buttons
  hud = nil,            -- nil = 用 App.config.hud
}

local installed_api = nil

-- 把一组配置合并进 App.config（nil 值跳过）
local function merge_config(cfg)
  if type(cfg) ~= "table" then return end
  for k, v in pairs(cfg) do
    if v ~= nil and k ~= "log_prefix" then
      App.config[k] = v
    end
  end
end

-- 安装：合并配置 → 打日志前缀 → 立刻 boot 一次（引擎侧通常已经能取到控件树）
-- 返回 api 表；重复调用返回同一个 api（幂等）
function M.install(cfg)
  if installed_api ~= nil then
    Util.log("Tutorial.install 已安装，忽略重复调用")
    return installed_api
  end
  merge_config(M.defaults)
  merge_config(cfg)
  if type(cfg) == "table" and type(cfg.log_prefix) == "string" then
    Util.set_prefix(cfg.log_prefix)
  end

  local api = {}
  installed_api = api
  local ctx = (type(cfg) == "table" and cfg.script) or Util.script_ctx()

  ---------------------------------------------------------------- 生命周期 --
  api.OnInit = function(...) App.boot(ctx or Util.script_ctx(...)) end
  api.OnStart = function(...) if not App.booted then App.boot(ctx or Util.script_ctx(...)) end end
  api.OnUpdate = function(dt) App.tick(dt) end
  api.OnEnable = function(...) if not App.booted then App.boot(ctx or Util.script_ctx(...)) end end
  api.OnDisable = function() end
  api.OnDestroy = function() end

  -------------------------------------------------------------------- 动作 --
  -- 关/开界面（不入参 = 用 App.config.auto_open 的屏）
  api.hide = function() Screen.close() return true end
  api.show = function(page_id)
    local s = Screen.current() or Screen.list()[1]
    if s == nil then return false end
    if Screen.current_id() ~= s.id then Screen.open(s.id) end
    if page_id ~= nil then Pager.jump(s, page_id, { notify = true }) end
    return true
  end
  api.is_open = function() return Screen.current_id() ~= nil end
  api.act = function(action) return App.act(action, "api") end
  api.state = function() return App.state() end
  api.diag = function() return App.diag() end
  api.set_title = function(t) return App.set_title(t) end
  api.set_body = function(t) return App.set_body(t) end
  api.register_reset = function(page_id, fn) return App.register_reset(page_id, fn) end
  api.print_tree = function() Engine.print_tree() end

  -- 供主脚本在 OnStart/OnEnable 里显式转发（若它不想用 api.OnStart）
  api.boot = function(...) return App.boot(ctx or Util.script_ctx(...)) end

  Util.log("Tutorial.install root=%s keys=%s", tostring(App.config.root_name), tostring(App.config.keys_enabled))
  App.boot(ctx)
  return api
end

function M.api()
  return installed_api
end

function M.installed()
  return installed_api ~= nil
end

return M
end)()

-- ==========================================================================
-- 生命周期回调注册为**全局函数**（官方《客户端控件API文档》§1：按固定名称查找）
-- ==========================================================================
OnInit = Entry.OnInit
OnStart = Entry.OnStart
OnEnable = Entry.OnEnable
OnUpdate = Entry.OnUpdate
OnLevelUpdate = Entry.OnLevelUpdate
OnDisable = Entry.OnDisable
OnDestroy = Entry.OnDestroy

-- 调试入口：试玩控制台/其它脚本可调 `QxUI_PrintTree()` 打整棵控件树
function QxUI_PrintTree() Engine.print_tree() end
function QxUI_Diag() return App.diag() end
function QxUI_Act(action) return App.act(action, "api") end
