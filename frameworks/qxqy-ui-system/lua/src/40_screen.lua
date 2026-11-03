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
