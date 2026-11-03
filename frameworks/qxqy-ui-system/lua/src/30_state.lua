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
