--[[----------------------------------------------------------------------------
  tools/_audit_dupes.lua —— 「同一个 id 被 push 多次」的逐状态体检（第一遍代码体检用）。

  为什么需要：`build_layout` 是**一个 1500 行的函数**，里面几十个 `push{...}`。
  同一个 id 出现两次时，两个节点会：
    · 抢同一份属性账本（已被 render 的 `node_key` 按「id\1父容器\1序号」分开 —— 见那里的注释）；
    · 抢同一个引擎控件（`create_control` 只跑一次）、同一份 `handlers[id]`（事件绑定只认第一个）；
    · 把**不同的** `rect` / `visible` / `text` 轮流推给同一个控件（后写的赢）。
  所以"有没有重复"和"重复的那几个**语义是否真的一致**"必须逐个看。

  做法：对每一关、每一个屏幕/弹窗状态，直接调 `Controller:build_layout()`，
  按 id 归组，把重复 id 的每个节点摊开（parent / kind / rect / visible / text 差异）。

  用法：lua tools/_audit_dupes.lua
----------------------------------------------------------------------------]]--

local here = (arg and arg[0]) or "tools/_audit_dupes.lua"
local root = here:gsub("tools[/\\]_audit_dupes%.lua$", "")
if root == "" then root = "./" end
if root:sub(-1) ~= "/" and root:sub(-1) ~= "\\" then root = root .. "/" end
package.path = root .. "lua/?.lua;" .. root .. "lua/?/init.lua;" .. package.path

local out = print
local Core = require("murdoku_core")
local UIC = require("ui_controller")
local Levels = require("levels.init")

local function fmt_rect(r)
  if r == nil then return "nil" end
  return string.format("(%g,%g %gx%g)", r.x or -1, r.y or -1, r.w or -1, r.h or -1)
end
local function sig(n)
  -- ★ 2026-10-05 补两个字段（Round 32）：
  --   原版只比 parent/kind/rect/vis/text ⇒ 判 `root` ×2 为"语义完全一致" ✗。
  --   但另一份报告指出两者**互补**：一个带 `pos_runtime = true`（触发 inherit_pos_runtime，
  --   给整棵 root 子树标"运行时矩形"）、一个带 `style = "screen"`。
  --   这两个字段**都不在**原版签名里 ⇒ 结论「一致」是**假阴性** ✗。
  --   ⇒ 必须把它们纳入签名，否则"冗余 push，无害"这个判断会误导人删错东西 ✗。
  return "parent=" .. tostring(n.parent)
    .. " kind=" .. tostring(n.kind)
    .. " rect=" .. fmt_rect(n.rect)
    .. " vis=" .. tostring(n.visible)
    .. " text=" .. tostring(n.text)
    .. " pos_runtime=" .. tostring(n.pos_runtime)
    .. " style=" .. tostring(n.style)
    .. " image=" .. tostring(n.image)
end

local STATES = {
  { name = "home",              intro = 99, modal = nil,                            screen = "home" },
  { name = "select",            intro = 99, modal = nil,                            screen = "select" },
  { name = "intro",             intro = 1,  modal = nil,                            screen = nil },
  { name = "board",             intro = 99, modal = nil,                            screen = nil },
  { name = "accuse_thief",      intro = 99, modal = { kind = "accuse_thief" },      screen = nil },
  { name = "accuse_accomplice", intro = 99, modal = { kind = "accuse_accomplice" }, screen = nil },
  { name = "result",            intro = 99, modal = { kind = "result", win = true, message = "x" }, screen = nil },
  { name = "share",             intro = 99, modal = { kind = "share", code = "x" }, screen = nil },
  { name = "howto",             intro = 99, modal = { kind = "howto" },             screen = nil },
  { name = "levelselect",       intro = 99, modal = { kind = "levelselect" },       screen = nil },
}

local all = Levels.all()
out("=== 重复 id 体检（build_layout 逐状态）===")
out("关卡数 " .. tostring(#all))
out("")

-- 汇总：id -> { 命中次数、在哪些状态、出现过几种不同的 sig }
local agg = {}

for li = 1, #all do
  local lv = all[li]
  local core = Core.new(lv)
  local ctl = UIC.new(core, {})
  out("### 关卡 " .. tostring(lv.id) .. "（" .. tostring(core.rows) .. "×" .. tostring(core.cols) .. "）")
  for si = 1, #STATES do
    local st = STATES[si]
    ctl.intro_page = st.intro
    ctl.modal = st.modal
    ctl.screen = st.screen
    local ok, nodes = pcall(function() return ctl:build_layout() end)
    if not ok then
      out("  [" .. st.name .. "] build_layout 抛错：" .. tostring(nodes))
    else
      local seen, dup = {}, {}
      for i = 1, #nodes do
        local id = nodes[i].id
        if seen[id] == nil then seen[id] = { nodes[i] } else
          seen[id][#seen[id] + 1] = nodes[i]
          dup[id] = true
        end
      end
      local names = {}
      for id in pairs(dup) do names[#names + 1] = id end
      table.sort(names)
      if #names == 0 then
        out("  [" .. st.name .. "] 节点 " .. tostring(#nodes) .. "，无重复 id")
      else
        out("  [" .. st.name .. "] 节点 " .. tostring(#nodes) .. "，**重复 id " .. tostring(#names) .. " 个**：")
        for k = 1, #names do
          local id = names[k]
          out("      · `" .. id .. "` ×" .. tostring(#seen[id]))
          local sigs = {}
          for j = 1, #seen[id] do
            local s = sig(seen[id][j])
            out("          第" .. j .. "个：" .. s)
            sigs[s] = true
          end
          local n_sig = 0
          for _ in pairs(sigs) do n_sig = n_sig + 1 end
          if n_sig == 1 then
            out("          ⇒ " .. tostring(#seen[id]) .. " 个节点**语义完全一致**（冗余 push，无害但白跑）")
          else
            out("          ⇒ ⚠️ **" .. tostring(n_sig) .. " 种不同语义** —— 后写的会覆盖先写的")
          end
          agg[id] = agg[id] or { n = 0, states = {}, maxsig = 0 }
          agg[id].n = agg[id].n + 1
          agg[id].states[st.name] = true
          if n_sig > agg[id].maxsig then agg[id].maxsig = n_sig end
        end
      end
    end
  end
  out("")
end

out("=== 汇总（跨 4 关 × 10 状态）===")
local rows = {}
for id, v in pairs(agg) do
  local st = {}
  for s in pairs(v.states) do st[#st + 1] = s end
  table.sort(st)
  rows[#rows + 1] = { id = id, n = v.n, sig = v.maxsig, states = table.concat(st, ",") }
end
table.sort(rows, function(a, b) if a.n ~= b.n then return a.n > b.n end return a.id < b.id end)
if #rows == 0 then
  out("  （无重复 id）")
else
  for i = 1, #rows do
    out(string.format("  %-22s 出现于 %2d 个状态   最多 %d 种语义   状态：%s",
      "`" .. rows[i].id .. "`", rows[i].n, rows[i].sig, rows[i].states))
  end
end
