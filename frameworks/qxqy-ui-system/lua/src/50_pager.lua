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
