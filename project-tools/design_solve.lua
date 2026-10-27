--[[----------------------------------------------------------------------------
  tools/design_solve.lua —— **设计期校准工具：求解器**

  ★★ 2026-10-18 **从运行时里搬出来的**（用户要求）✗✓
    「求解器是不必要的算力消耗，胜利那里我们只需要预输入答案就行了，
     求解器从关卡运行里删除，把它单独拿出来当一个关卡设计的独立校准工具」

  ⇒ 运行时（`lua/` 打进客户端脚本的那一份）现在**没有任何求解代码** ✓
    胜利判定走 `Core:submit()`（只校验硬约束＋摆满）＋ 关卡预输入的 `roles` ✓
  ⇒ 本文件**不进 bundle**（`entry_client_script.lua` 不 require 它 ✓）
    只在离线工具里用：`tools/validate_levels.lua` ✓

  用法：
    local Solve = require("tools.design_solve")
    local solutions = Solve.solve(core, 2)   -- 解数上限 2

  ★ 函数体是从 `murdoku_core.lua` **整段搬来的**，一个字没改 ✓
    （`self` 就是 Core 实例 —— 它用到的 `self.clues` / `self.general_clues` /
      `self:structure_report` / `self:clue_results` 全是公开接口 ✓）
----------------------------------------------------------------------------]]--

local Core = require("murdoku_core")
require("tools.design_rules")   -- ★ 设计期：把结构规则挂回 Core（运行时没有它 ✓）
local make_context = Core.make_context   -- ★ 核心导出的那个（不增加运行时开销 ✓）

local M = {}

function M.solve(self, limit)
  limit = limit or 2
  local solutions = {}
  local rules = self:rules()
  local ids = {}
  for i = 1, #self.pieces do ids[i] = self.pieces[i].id end
  -- ★★ 2026-10-11：★ 读**槽位表** ✓ ＋ ★ **先看有没有"真判据"** ✗
  --   ★ 槽位（★ 由棋盘规格生成 ✓ 内容待 `row.*` 填 ✓）**没有 `type`** ✗
  --     ⇒ ★ 它们**还不能判真假** ⇒ ★★ **`solve` 无从下嘴** ✓
  --   ⇒ ★ 如实返回**空解表** ✓ ★ **不猜、不编解** ✗✓
  --     ★（★ 上层：`validate_levels` 报"未测" ✓ ★ 作者拿到的是"还没内容"而不是"多解" ✓）
  -- ★★ 2026-10-17：**通用线索也参与搜索** ✗✓
  --   ★ 它们没有卡位 ✓ 但同样是"这个摆位必须成立的事实" ✓
  --   ⇒ 拼成一张本地清单给下面的剪枝/叶子判定用（不改 `self.clues` ✓ 卡位数量不受影响 ✓）
  local clues = {}
  for i = 1, #(self.clues or {}) do clues[#clues + 1] = self.clues[i] end
  for i = 1, #(self.general_clues or {}) do clues[#clues + 1] = self.general_clues[i] end
  local real = 0
  for i = 1, #clues do if clues[i] and clues[i].type then real = real + 1 end end
  if real == 0 then return {} end
  local allowed = self.allowed_false or 0

  -- 角色候选：盗窃者不能是受害者；同伙可以为 nil
  local rpairs = {}
  for i = 1, #ids do
    local t = ids[i]
    if t ~= self.victim_id then
      rpairs[#rpairs + 1] = { thief = t, accomplice = nil }
      for j = 1, #ids do
        local a = ids[j]
        if a ~= t and a ~= self.victim_id then
          rpairs[#rpairs + 1] = { thief = t, accomplice = a }
        end
      end
    end
  end

  -- 摆位状态（grid / pos / row_count / col_count）在整趟搜索里**增量维护**。
  -- 早期版本每到一个叶子就 install() 把整盘重算一遍，7×7 时那是主要开销，
  -- 现在由 place_at 在放置/回溯时同步这几个表；搜索结束后统一还原。
  local grid = {}
  for r = 1, self.rows do grid[r] = {} end

  local function fits(r, c)
    if self:is_blocked(r, c) then return false end
    if rules.one_per_row then
      for cc = 1, self.cols do if grid[r][cc] then return false end end
    end
    if rules.one_per_col then
      for rr = 1, self.rows do if grid[rr][c] then return false end end
    end
    if rules.one_per_room then
      for rr = 1, self.rows do
        for cc = 1, self.cols do
          if grid[rr][cc] and self.room[rr][cc] == self.room[r][c] then return false end
        end
      end
    end
    return true
  end

  -- ── 边搜边剪 ────────────────────────────────────────────────────────────
  -- 朴素做法是"摆满整盘再看线索"，但摆位总数是 N! × N!（7×7 就是 2540 万），
  -- 再乘上角色组合就彻底跑不完了（2026-09-26 实测：7×7 关卡校验直接超时）。
  --
  -- 这里改成**一放下棋子就立刻检查"它牵涉到的那些线索"**：
  --   · 只使用**引用全是具体棋子**的线索（`col_offset A V` 这种），
  --     带角色别名（@thief / @accomplice）的线索要等角色定下来才能判，跳过；
  --   · 一条线索引用的棋子全放下了，才去判它；
  --   · 违反数一旦超过 allowed 就地剪枝。
  --
  -- 摆位用的 grid / pos / row_count / col_count 在整趟搜索里**增量维护**，
  -- 不再每到一个叶子就 install 重算一遍（那也是个大头）。
  local ctx = make_context(self)          -- roles 用关卡声明的，够判具体棋子的线索

  local partial = {}
  for i = 1, #clues do
    local cl = clues[i]
    local def = Core.clues[cl.type]
    if def ~= nil then
      local refs, has_alias = {}, false
      local params = def.params or {}
      for pi = 1, #params do
        local v = cl[params[pi]]
        if type(v) == "string" then
          if Core.ROLE_ALIASES[v] ~= nil then
            has_alias = true
          else
            refs[#refs + 1] = v
          end
        end
      end
      -- 引用了非棋子字符串（例如 not_role 的 role、beside_object 的家具名）时，
      -- 那个"棋子"永远不会被摆上，于是这条线索永远不会被判定 —— 自动跳过，安全。
      if not has_alias and #refs > 0 then
        partial[#partial + 1] = { c = cl, refs = refs, def = def }
      end
    end
  end

  local function partial_violations()
    local n = 0
    for i = 1, #partial do
      local p = partial[i]
      local ready = true
      local refs = p.refs
      for k = 1, #refs do
        if self.pos[refs[k]] == nil then ready = false break end
      end
      if ready and not p.def.validate(ctx, p.c) then
        n = n + 1
        if n > allowed then return n end
      end
    end
    return n
  end

  local saved_grid, saved_pos = self.grid, self.pos
  local saved_rc, saved_cc = self.row_count, self.col_count
  self.row_count, self.col_count = {}, {}
  for r = 1, self.rows do self.row_count[r] = 0 end
  for c = 1, self.cols do self.col_count[c] = 0 end

  -- 一个完整摆位 + 一组角色归属是否成立
  -- （此时 self.grid / self.pos 就是当前搜索路径上的摆位，不需要 install）
  local function consider()
    local stop = false
    for i = 1, #rpairs do
      local roles = {
        thief = rpairs[i].thief,
        accomplice = rpairs[i].accomplice,
        victim = self.victim_id,
      }
      local sok = self:structure_report(roles)
      if sok then
        local rctx = make_context(self, roles)
        local failed = 0
        for ci = 1, #clues do
          local def = Core.clues[clues[ci].type]
          if not def or not def.validate(rctx, clues[ci]) then
            failed = failed + 1
            if failed > allowed then break end
          end
        end
        if failed <= allowed then
          local snap = {}
          for r = 1, self.rows do
            snap[r] = {}
            for c = 1, self.cols do snap[r][c] = grid[r][c] end
          end
          solutions[#solutions + 1] = {
            placement  = snap,
            thief      = roles.thief,
            accomplice = roles.accomplice,
          }
          if #solutions >= limit then
            stop = true
            break
          end
        end
      end
    end
    return stop
  end

  local function place_at(k)
    if k > #ids then return consider() end
    local id = ids[k]
    local preferred = self.solution[id]
    local order = {}
    if preferred then order[#order + 1] = preferred end
    for r = 1, self.rows do
      for c = 1, self.cols do
        if not (preferred and preferred.r == r and preferred.c == c) then
          order[#order + 1] = { r = r, c = c }
        end
      end
    end
    for i = 1, #order do
      local p = order[i]
      if not grid[p.r][p.c] and fits(p.r, p.c) then
        grid[p.r][p.c] = id
        self.pos[id] = p
        self.row_count[p.r] = self.row_count[p.r] + 1
        self.col_count[p.c] = self.col_count[p.c] + 1

        -- ★ 放下就剪：这一层已经违反了太多线索的分支不用再往下走
        local stop = false
        if partial_violations() <= allowed then
          stop = place_at(k + 1)
        end

        grid[p.r][p.c] = nil
        self.pos[id] = nil
        self.row_count[p.r] = self.row_count[p.r] - 1
        self.col_count[p.c] = self.col_count[p.c] - 1
        if stop then return true end
      end
    end
    return false
  end

  self.grid = grid
  self.pos = {}
  place_at(1)
  self.grid, self.pos = saved_grid, saved_pos
  self.row_count, self.col_count = saved_rc, saved_cc
  return solutions
end


return M
