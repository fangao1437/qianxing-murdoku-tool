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
