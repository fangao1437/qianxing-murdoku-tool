--[[----------------------------------------------------------------------------
  tools/validate_levels.lua —— 批量校验关卡（偷窃版 v0.3，离线）

  跑法：
    lua tools/validate_levels.lua          # 解数上限 2（同时校验角色归属唯一性）
    lua tools/validate_levels.lua 3        # 多找几个解，便于看有多少歧义

  对 levels/init.lua 里登记的每一关做：
    1. 格式校验（含 doors / roles / meta / tie_policy）
    2. 结构约束 R3/R4（在关卡自己的答案上）
    3. 假话声明是否与实际一致（答案上恰好 ≤1 条不成立，且与 meta.false_clue 对上）
    4. 唯一解（摆位 × 角色归属），>1 说明线索不够、玩家可以蒙
----------------------------------------------------------------------------]]--

local here = (arg and arg[0]) or "tools/validate_levels.lua"
local root = here:gsub("tools[/\\]validate_levels%.lua$", "")
package.path = table.concat({
  package.path,
  root .. "lua/?.lua",
  root .. "lua/?/init.lua",
  root .. "?.lua",
}, ";")

local Core   = require("murdoku_core")
local Levels = require("levels.init")
require("tools.design_rules")   -- ★ 设计期：把结构规则挂回 Core（运行时没有它 ✓）
-- ★★ 2026-10-18 求解器已从运行时核心搬出 ⇒ 设计期工具显式 require 它 ✓
--   （用户：「求解器是不必要的算力消耗 …… 把它单独拿出来当一个关卡设计的独立校准工具」）

local limit = tonumber(arg and arg[1]) or 2
local total, bad = 0, 0

print("== 关卡批量校验（偷窃版，解数上限 " .. limit .. "）==")

local levels = Levels.all()
local lerrs = Levels.load_errors()
if #lerrs > 0 then
  bad = bad + #lerrs
  print(string.format("!! %d 个关卡模块加载失败（语法错误 / require 失败），这些关卡**没有被检查**：", #lerrs))
  for i = 1, #lerrs do
    print("  - " .. lerrs[i].module)
    print("      " .. (lerrs[i].error:gsub("\n", "\n      ")))
  end
  print("")
end

for _, lv in ipairs(levels) do
  total = total + 1
  print("")
  print(string.format("— %s  %s", tostring(lv.id), tostring(lv.name or "")))

  local ok, errors = Core.validate_level(lv)
  if not ok then
    bad = bad + 1
    print("  格式: FAIL")
    for i = 1, #errors do print("    - " .. errors[i]) end
  else
    print("  格式: OK")
    local core = Core.new(lv)
    if not core then
      bad = bad + 1
      print("  实例化: FAIL")
    else
      -- 把答案摆上
      for id, p in pairs(core.solution) do
        core:select_suspect(id)
        core:hold_cell(p.r, p.c)
      end

      -- 结构
      local sok, serrs, sinfo = core:structure_report()
      if sok then
        print(string.format("  结构: OK（受害者区域 #%s，k=%d，门相邻 %d 个，无辜最多 %s）",
              tostring(sinfo.victim_room), sinfo.k or 0, #(sinfo.adjacent or {}),
              tostring(sinfo.best)))
      else
        bad = bad + 1
        print("  结构: FAIL")
        for i = 1, #(serrs or {}) do print("    - " .. serrs[i]) end
      end

      -- 假话
      -- ★★★ 2026-10-11 **槽位（没有 `type`）不是"内容"** ✗✓
      --   ★ 槽位由**棋盘规格**生成 ✓（★ `rows × cols` ✓）★ 内容待 `assets/row.*` 填 ✓
      --   ⇒ ★ 它们**还不能判真假** ✗ ⇒ ★ 拿"不成立"去数它们 ⇒ ★★ **会把 49 个空槽位
      --     全报成假话** ✗✓（★ 我第一版就是这样 ✓ 一屏 49 个数字 ✓）
      --   ⇒ ★ 本项判据**只看有内容的那些** ✓ ★★ 一个都没有 ⇒ ★ **报"未测"** ✓（★ 与唯一解同口径 ✓）
      local was = core:clue_results()
      local n_content, failed = 0, {}
      for i = 1, #was do
        if was[i].type ~= nil then
          n_content = n_content + 1
          if not was[i].satisfied then failed[#failed + 1] = i end
        end
      end
      local declared = (lv.meta or {}).false_clue
      if n_content == 0 then
        print("  假话: 未测（本关线索 0 条有内容 —— ★ 内容待设计 ✓ 不是判据失效 ✗）")
      else
        local lie_ok
        if declared then
          lie_ok = (#failed == 1 and failed[1] == declared)
        else
          lie_ok = (#failed == 0)
        end
        if lie_ok then
          print(string.format("  假话: OK（声明 %s，实际不成立 %d 条）",
                declared and ("第" .. tostring(declared) .. "条") or "无", #failed))
        else
          bad = bad + 1
          local list = {}
          for i = 1, #failed do list[#list + 1] = tostring(failed[i]) end
          print(string.format("  假话: FAIL（声明 %s，实际不成立 [%s]）",
                tostring(declared), table.concat(list, ",")))
        end
      end

      -- ★★ 2026-10-18 **多解检查已删** ✓（用户定：「原设计已经收口了」⇒ 不再统计解数、不再报 FAIL）

      print(string.format("  规模: %dx%d / 棋子 %d / 线索 %d / 区域 %d / 门 %d",
            core.rows, core.cols, core:piece_count(), #(lv.clues or {}),
            core.room_count, (function()
              local n = 0
              for _ in pairs(core.door_set) do n = n + 1 end
              return n
            end)()))
    end
  end
end

print("")
print(string.format("== 合计 %d 关（另有 %d 个模块加载失败），需要处理的 %d 项 ==", total, #lerrs, bad))
if bad > 0 then os.exit(1) end
