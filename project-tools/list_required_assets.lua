-- tools/list_required_assets.lua —— **列出"美术素材该有哪些"**（给 check_assets.mjs 用）
--
-- 为什么要有它：美术改造的 ⑤/⑥ 卡在"等素材"上。素材进 `assets` 之后，
-- 得有人告诉你**齐没齐、缺哪个** —— 总不能靠人肉比对。
--
-- ★ 这份清单是**推导出来的，不是手抄的**：
--     · `portrait.<id>` —— 从每个关卡的 `suspects[].portrait` 收集
--     · `obj.<kind>`     —— 从每个关卡的 `objects[].kind` 收集
--       （没写 `kind` 的物件退回中文名 `obj.<名字>`，和 `ui_controller.object_key_of` 一致）
--     · 界面用的一次性素材 —— 只有这一小撮是硬编码的（下面 FIXED 表）
--
-- 输出：一行 JSON（`{"required":[...]}`），由 Node 侧读走比对。
--
-- 用法：lua tools/list_required_assets.lua

package.path = "./lua/?.lua;./lua/?/init.lua;" .. package.path

local Levels = require("levels.init")

-- 界面用的一次性素材（**只在这里定义一处**）。
--
-- ⚠️ 这些是"素材到了就配上"的目标名，**现在多半还没有** —— 所以 check_assets
--   会把它们报成"缺"，那是**预期的**，不是出错。真正要盯的是：
--   关卡数据里已经在用、但 assets 里还没有的那些。
local FIXED = {
  -- ⑥ 右侧三个六边形按钮（撤销/提交/揭示）共用的深色底图
  "btn.hex",
  -- ⑥ 左上「返回列表」「重置关卡」、右下「放大镜」也可以用同一张（列出来提醒）
  "icon.back", "icon.reset", "icon.hint",
}

local out = {}
local seen = {}
local function add(name)
  if type(name) ~= "string" or name == "" then return end
  if seen[name] then return end
  seen[name] = true
  out[#out + 1] = name
end

for _, lv in ipairs(Levels.all()) do
  for _, it in ipairs(lv.suspects or {}) do
    add(it.portrait)
  end
  for name, def in pairs(lv.objects or {}) do
    local kind = type(def) == "table" and def.kind or nil
    if type(kind) == "string" and kind ~= "" then
      add("obj." .. kind)
    else
      -- 和 ui_controller.object_key_of 一致的退回规则
      add("obj." .. tostring(name))
    end
  end
end

for i = 1, #FIXED do add(FIXED[i]) end
table.sort(out)

-- 极简 JSON（只要一个字符串数组，不值得引依赖）
local parts = {}
for i = 1, #out do
  parts[#parts + 1] = '"' .. out[i]:gsub('"', '\\"') .. '"'
end
print('{"required":[' .. table.concat(parts, ",") .. ']}')
