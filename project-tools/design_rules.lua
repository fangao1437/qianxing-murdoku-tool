--[[----------------------------------------------------------------------------
  tools/design_rules.lua —— **设计期规则判断**（从运行时核心搬出来的）

  ★★ 2026-10-18 用户定：
    「核心中的规则和求解器一起应该被移除，规则是内容部分，独立于脚本，
      原设计已经收口了，脚本里的判断行和规则行对于关卡运行都是冗余内容」

  ⇒ 运行时**不再判断任何结构规则**（R3/R4、tie_policy、无辜人数、k）✓
    关卡答案本来就是**预输入**的（`roles` + `solution`），运行期不需要再校验一遍 ✓
    这些规则现在只用于：**关卡设计期的校准**（validate_levels / new_level / dump_level）✓

  ★ 用法：`require("tools.design_rules")` —— 它会把方法**挂回** Core 类上，
    所以老代码 `core:structure_report()` / `core:tie_policy()` 照样能用 ✓
    本文件**不进 bundle**（`entry_client_script.lua` 不 require 它 ✓）

  ★ 函数体是从 `murdoku_core.lua` 整段搬来的，一个字没改 ✓
----------------------------------------------------------------------------]]--

-- ★ 注意：`murdoku_core` 返回的是模块表 M，**类**在 M.Core 上 ✓
local M = require("murdoku_core")   -- ★ 搬来的函数体里用了 `M.TIE_FORBID` ⇒ 必须留 M ✓
local Core = M.Core

function Core:tie_policy()
  local r = self.level.rules or {}
  return r.tie_policy or M.TIE_FORBID
end

-- 某区域内的“无辜人数” = 该区域内既不是盗窃者也不是同伙的人数
function Core:innocent_count(room_id, roles)
  roles = roles or self.roles or {}
  local n = 0
  for r = 1, self.rows do
    for c = 1, self.cols do
      local id = self.grid[r][c]
      if id and self.room[r][c] == room_id and id ~= roles.thief and id ~= roles.accomplice then
        n = n + 1
      end
    end
  end
  return n
end

function Core:people_in_room(room_id)
  local n = 0
  for r = 1, self.rows do
    for c = 1, self.cols do
      if self.grid[r][c] and self.room[r][c] == room_id then n = n + 1 end
    end
  end
  return n
end

-- 结构检查：返回 ok, errors, info
--   info 里带 victim_room / adjacent / innocent_counts / best / best_rooms / k
--   界面可以直接把 info 展示给玩家当推理助手（这些量玩家自己也能数出来）
function Core:structure_report(roles)
  roles = roles or self.roles or {}
  local errors = {}
  local info = { roles = roles }
  if not roles.thief then
    return false, { "关卡没有声明 roles.thief" }, info
  end

  local vp = nil
  if self.victim_id then vp = self.pos[self.victim_id] end
  if not vp then vp = self.victim_fixed end
  if not vp then
    return false, { "受害者还没摆上棋盘" }, info
  end
  local rv = self.room[vp.r][vp.c]
  info.victim_room = rv

  local adj = {}
  for other in pairs(self.adjacency[rv] or {}) do adj[#adj + 1] = other end
  table.sort(adj)
  info.adjacent = adj
  if #adj == 0 then
    errors[#errors + 1] = "受害者所在区域没有任何门相邻区域，R3 无法成立"
    return false, errors, info
  end

  local counts, best, best_rooms = {}, -1, {}
  for i = 1, #adj do
    local room_id = adj[i]
    local n = self:innocent_count(room_id, roles)
    counts[room_id] = n
    if n > best then
      best = n
      best_rooms = { room_id }
    elseif n == best then
      best_rooms[#best_rooms + 1] = room_id
    end
  end
  info.innocent_counts = counts
  info.best = best
  info.best_rooms = best_rooms
  info.k = self:people_in_room(rv)

  if #best_rooms > 1 and self:tie_policy() == M.TIE_FORBID then
    errors[#errors + 1] = string.format("相邻区域无辜人数并列（都等于 %d），tie_policy=forbid 视为非法", best)
  end

  local tp = self.pos[roles.thief]
  if not tp then
    errors[#errors + 1] = "盗窃者还没摆上棋盘"
  else
    local tr = self.room[tp.r][tp.c]
    info.thief_room = tr
    if not (self.adjacency[rv] or {})[tr] then
      errors[#errors + 1] = "盗窃者不在受害者的相邻区域内"
    end
    local is_best = false
    for i = 1, #best_rooms do
      if best_rooms[i] == tr then is_best = true end
    end
    if not is_best then
      errors[#errors + 1] = "盗窃者所在区域不是相邻区域里无辜人数最多的"
    end
  end

  -- ★★ 2026-10-18 【同伙规则已废止】（用户决定；此前只落在 main 分支，这里补到开发线）
  --
  --   被删掉的旧规则有两条，它们互相咬合、把"受害者房间里还有别人"与"必须有同伙"绑死：
  --     ⑪ 受害者所在区域人数 k >= 2  ⇒ 盗窃者必然有且只有一个同伙
  --     ⑫ 同伙必须与盗窃者待在同一个区域
  --   用户判断：这条规则**过度约束了变化性** —— 只要 k>=2 就强制多出一个角色。
  --
  --   现在的语义：
  --     · k 取任何值都**不再**要求同伙；
  --     · 关卡在 roles 里声明了 accomplice，那个角色才存在（旧关卡不受影响）；
  --     · 同伙**不再**被要求与盗窃者同区。
  --   R3（盗窃者所在区域 = 受害者相邻区域里无辜人数最多的那个）**保持不变**。
  local has_acc = roles.accomplice ~= nil
  info.has_accomplice = has_acc
  if has_acc then
    local ap = self.pos[roles.accomplice]
    if not ap then
      errors[#errors + 1] = "同伙还没摆上棋盘"
    end
  end

  return #errors == 0, errors, info
end

----------------------------------------------------------------------------
-- 约束与线索状态
----------------------------------------------------------------------------


return { installed = true }
