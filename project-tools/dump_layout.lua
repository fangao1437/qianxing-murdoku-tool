-- tools/dump_layout.lua —— 把界面布局规格导出成 JSON（画布空间坐标）
--
-- 不需要游戏环境，本机 Lua 直接跑：
--   lua tools/dump_layout.lua              # 把**所有关卡**的界面并集成一份（推荐）
--   lua tools/dump_layout.lua <level_id>   # 只看某一关
--   lua tools/dump_layout.lua all out.json
--
-- 输出每项：{ id, kind, parent, style, cx, cy, w, h, text, visible, states, levels }
--   cx/cy = 编辑器「位置 X, Y」要填的值（pivot 0.5,0.5，原点左下）
--         = 模拟器 posX/posY 要填的值
--
-- 为什么要并集：界面控件的**集合**随关卡变化 —— 6×6 关卡要 36 个格子、
-- 6 个角色要 tray.F，区域不同则 ruler.* 数量不同。编辑器只建一次，
-- 所以必须按"所有关卡里最大的那一份"来建，多出来的由脚本按状态隐藏。
--
-- 这个文件同时被以下两处消费，保证「模拟器预览」和「真机搭建指南」永不脱节：
--   · tools/sim/kit.mjs / play_test.mjs （在模拟器里建出整棵控件树并跑交互）
--   · tools/gen_editor_guide.mjs        （生成 docs/控件坐标表-1600x900.md）

package.path = "lua/?.lua;lua/?/init.lua;" .. package.path

local Core   = require("murdoku_core")
local UIC    = require("ui_controller")
local Levels = require("levels.init")

local level_id = arg and arg[1] or nil
local out_path = (arg and arg[2]) or "tools/sim/out/layout-plan.json"

-- ── 收集要处理的关卡 ──────────────────────────────────────────────────────
local levels = {}
if level_id == nil or level_id == "" or level_id == "all" then
  levels = Levels.all()
else
  local one = Levels.get(level_id)
  if not one then
    io.stderr:write("找不到关卡：" .. tostring(level_id) .. "\n")
    os.exit(1)
  end
  levels = { one }
end
if #levels == 0 then
  io.stderr:write("没有已登记的关卡（检查 lua/levels/init.lua）\n")
  os.exit(1)
end

-- 关卡清单：界面层的「选关面板 / 选关卡片」是按这份清单生成的。
-- 不传的话选关面板就是空的、`home.*` / `select.*` 也不会进编辑器计划，
-- 运行时会报「控件未找到：home.select」这类错误（2026-09-26 / 2026-09-30 都踩到过）。
--
-- ★★★ 2026-09-30：**改调 `Levels.ui_list()`，不再自己复制一份**。
--   这里原来自己写了一版（只带 id/name/difficulty），和 `lua/main.lua` 那份**各写一遍**
--   ⇒ 两处必然漂移：真机上选关卡片有尺寸/人数、而模拟器计划里没有（或反过来），
--   于是"模拟器全绿、真机不对"这种最难查的差异就会出现。
--   ⇒ 和 main.lua 用同一个来源。
local level_list = Levels.ui_list()

-- ── 逐关取布局计划并合并 ──────────────────────────────────────────────────
local order, byId, rank = {}, {}, {}
local max_rows, max_cols = 0, 0
local per_level = {}

for li = 1, #levels do
  local lv = levels[li]
  local core, errors = Core.new(lv)
  if not core then
    io.stderr:write(string.format("关卡 %s 数据有误：%s\n", tostring(lv.id),
      table.concat(errors or {}, " / ")))
    os.exit(1)
  end
  if core.rows > max_rows then max_rows = core.rows end
  if core.cols > max_cols then max_cols = core.cols end

  local ctl = UIC.new(core, { levels = level_list })
  local plan = ctl:layout_plan()
  local pc = core:piece_count()
  -- 本关的"父索引"，供 in_subtree 判断某个控件是否在 board/tray 子树内（见下面的 ★ 注释）
  local pidx = {}
  for i = 1, #plan do pidx[plan[i].id] = plan[i].parent end
  per_level[#per_level + 1] = { id = lv.id, rows = core.rows, cols = core.cols,
                               pieces = pc, count = #plan }

  for i = 1, #plan do
    local n = plan[i]
    local prev = byId[n.id]
    if prev == nil then
      prev = {
        id = n.id, kind = n.kind, parent = n.parent, style = n.style,
        cx = n.cx, cy = n.cy, w = n.w, h = n.h,
        text = n.text, visible = n.visible, states = n.states or {},
        levels = {},
        -- ★ 2026-10-01：**图片素材必须带出来**，否则 `sync_plan` 建控件时
        --   拿不到 `image_id`，新控件就带上原型的图。
        --   （我第一版忘了这行，18 个六边形图元的 image_id 全是 undefined。）
        image_id = n.image_id, imageColor = n.imageColor, rot = n.rot,
        -- ★★★★★ 2026-10-04 **`event` 也要带出来** —— 少了它，"这个按钮点下去有没有动作"
        --   在导出的规划表里**完全看不出来**（我这一轮就因此差点漏判：七个 `hex.*` 图标
        --   明明已经在 `nodes` 里绑好了 `event`，导出来却是 `动作=undefined`）。
        --   只取 `action`（适配层就是按它分发），序列化成字符串，JSON 才干净。
        --   ⚠️ 注意这里读的是 **`n.action`**：`layout_plan()` 已经把 `event.action` 摊平成了
        --      `action` 字段。我第一次写成 `n.event.action` —— 而 `layout_plan()` 的节点里
        --      **没有 `event`** ⇒ 导出来又是 `undefined`（白改一轮）。
        action = n.action,
        -- ★★★★★ 2026-10-05 **`event` 整表也要带出来（第三次同一类链子）** ✗✓
        --
        --   这是第 3 项「点格子没反应」的**最后一环** ✓ —— ★ 这条链子一共经过【两次】摊平：
        --     ① `ui_controller.lua` 的 `layout_plan()`：`action = n.event and n.event.action`
        --        ⇒ ★ 那里我只补了 `event = n.event` ✓（同一次提交 ✓）
        --     ② ★ **这里** ✗ —— 本文件**又建了一张新表**（上面的 `image_id` 那段同理 ✓）
        --        ⇒ 只拷 `action` ⇒ ★ **`event` 被【第二次】丢掉** ✗✓
        --
        --   为什么模拟器需要它（**实测锁定** ✓）：
        --     · `engine_adapter_qianxing.lua:816` 的守卫是
        --       `if node.event ~= nil and (node.kind == "button" or node.kind == "cursor")`
        --       ⇒ ★ **`node.event == nil` ⇒ 从不 `bind_input`** ✗ ⇒ **控件上根本没有监听器** ✓
        --     · **真机**走的是 `build_layout()` ✓ 那里的节点有完整 `event` ✓ ⇒ 守卫放行 ✓
        --     · **模拟器**走的是这份计划 JSON ✗ ⇒ 计划里 `"event"` **0 次** ✗
        --       ⇒ 模拟器里**任何控件都绑不上** ✗ ⇒ 点击到不了脚本 ⇒ `0 / 5` ✓✓
        --   ★ 两个独立代理的实测互证：`[T3Q] _fire#` 四次点击后 **0 次** ✓ · 计划 369 节点**无一带 `event`** ✓
        --   ★★ 这**不是**"放宽断言" ✗ —— ★ **是让模拟器忠实还原真机** ✓✓
        --     真机的节点本来就有 `event` ✓ ⇒ 计划也该有 ✓
        --   ⚠️ **`action` 必须保留** ✗（`kit.mjs` 的负对照等地方按它工作 ✓）—— 只是【再加】一个字段 ✓
        --   ⚠️ 与 `image_id`（2026-10-01）、`action`（2026-10-04）是**同一类链子问题** ✓
        --     ★ 规律：**"值为 nil" 与 "键不存在" 是两回事** ✗✓ —— 每次"再建一张新表"都会丢字段 ✓
        event = n.event,
      }
      byId[n.id] = prev
      order[#order + 1] = prev
      rank[n.id] = pc
    else
      -- ⚠️ 棋盘格子和头像卡是**自适应**的：格子边长随 N 变、卡片列数随人数变，
      --   所以同一 id 在不同关卡里几何不一样。编辑器每个控件只能有一套几何，
      --   于是这里统一取「**最挤的那一关**」（人数最多的）—— 小关卡由脚本在
      --   运行时重新摆正，大关卡直接就是对的。
      --
      -- ★ 2026-09-27 改成**按子树**判断，而不是"直接父级是不是 board/tray"：
      --   坐标尺 `ruler.*` 原来直接挂 `board` 下，后来独立成 `ruler` 容器
      --   （`board → ruler → ruler.c.*`），按直接父级判断就**不再算自适应**了，
      --   于是尺寸从「最挤那关」(7×7 → 97) 变成「最大值」(5×5 → 135) —— 刻度变宽了。
      --   按祖先链判断后，以后再怎么套分组容器都不会坏。
      local function in_subtree(id, rootName)
        local cur, guard = pidx[id], 0
        while cur ~= nil and guard < 16 do
          if cur == rootName then return true end
          cur = pidx[cur]; guard = guard + 1
        end
        return false
      end
      local adaptive = in_subtree(n.id, "board") or in_subtree(n.id, "tray")
      if adaptive then
        if pc > (rank[n.id] or 0) then
          prev.cx, prev.cy, prev.w, prev.h = n.cx, n.cy, n.w, n.h
          rank[n.id] = pc
        end
      else
        -- 其它控件：尺寸取最大值（保证放得下所有关卡）
        if n.w > prev.w then prev.w = n.w end
        if n.h > prev.h then prev.h = n.h end
      end
      -- 文案取最长的那份（占位更清楚）
      if n.text and (not prev.text or #tostring(n.text) > #tostring(prev.text)) then
        prev.text = n.text
      end
      if n.visible then prev.visible = true end
      for k = 1, #(n.states or {}) do prev.states[#prev.states + 1] = n.states[k] end
    end
    prev.levels[#prev.levels + 1] = lv.id
  end
end


-- ── 极小 JSON 编码器（只处理本项目会用到的类型）─────────────────────────
local function esc(s)
  s = tostring(s)
  s = s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
  s = s:gsub("[%z\1-\31]", function(ch) return string.format("\\u%04x", ch:byte()) end)
  return s
end

local function enc(v, indent)
  local t = type(v)
  if v == nil then return "null" end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then
    if v == math.floor(v) and math.abs(v) < 1e15 then return string.format("%d", v) end
    return tostring(v)
  end
  if t == "string" then return '"' .. esc(v) .. '"' end
  if t == "table" then
    local pad = string.rep("  ", indent)
    local pad2 = string.rep("  ", indent + 1)
    if #v > 0 then
      local parts = {}
      for i = 1, #v do parts[i] = pad2 .. enc(v[i], indent + 1) end
      return "[\n" .. table.concat(parts, ",\n") .. "\n" .. pad .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    if #keys == 0 then return "{}" end
    local parts = {}
    for _, k in ipairs(keys) do parts[#parts + 1] = pad2 .. '"' .. esc(k) .. '": ' .. enc(v[k], indent + 1) end
    return "{\n" .. table.concat(parts, ",\n") .. "\n" .. pad .. "}"
  end
  return "null"
end

-- 去重 states / levels，并排序，输出稳定
for i = 1, #order do
  local it = order[i]
  for _, field in ipairs({ "states", "levels" }) do
    local seen, uniq = {}, {}
    for k = 1, #it[field] do
      local v = it[field][k]
      if not seen[v] then seen[v] = true; uniq[#uniq + 1] = v end
    end
    table.sort(uniq)
    it[field] = uniq
  end
end

local meta = {
  scope = (level_id == nil or level_id == "" or level_id == "all") and "all" or level_id,
  levels = per_level,
  max_rows = max_rows, max_cols = max_cols,
  design = { width = UIC.DESIGN.width, height = UIC.DESIGN.height },
  canvas = { width = UIC.CANVAS.width, height = UIC.CANVAS.height },
  scale = UIC.SCALE,
  count = #order,
  nodes = order,
}

local f = assert(io.open(out_path, "w"))
f:write(enc(meta, 0))
f:write("\n")
f:close()

print(string.format("范围 %s（%d 关），最大棋盘 %d×%d", meta.scope, #per_level, max_rows, max_cols))
for i = 1, #per_level do
  local p = per_level[i]
  print(string.format("  · %-28s %d×%d  控件 %d", p.id, p.rows, p.cols, p.count))
end
print(string.format("设计空间 %d×%d → 画布空间 %d×%d（缩放 %.4f）",
  UIC.DESIGN.width, UIC.DESIGN.height, UIC.CANVAS.width, UIC.CANVAS.height, UIC.SCALE))
print(string.format("并集控件 %d 个 → %s", #order, out_path))
