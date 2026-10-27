// tools/gil/gen_tree_ref.mjs —— ★★★ P0-1/P0-4：把存档的**真实控件树**导出成探针可读的参考
//
// ★ 为什么必须做这一步（★ 本项目付过代价 ✓）：
//   2026-10-13 的性能审计证明：`tests/_wip/render_cost.lua` 与 `perframe_engine_calls.lua`
//   的**手搭假树漏了 8 个边控件**（`wall.up/down/left/right`、`door.up/down/left/right`，
//   真实存在、父＝`content` —— `347.gil` 293 条记录可证 ✓）。
//   ⇒ 每次 `sub(cell, "wall.up")` **注定未命中** ⇒ 凭空造出 **840 笔 `GetChild`/render**，
//     而这笔账**全记在 v192 头上**（v213 有按代未命中记忆 ⇒ 只付一次）
//   ⇒ 于是量出"972 → 132（−86%）"这条**不存在的战果** ✗✗
//   ★ 假树**还反向造了假控件**：`ruler.c.1..5` / `ruler.r.1..5` —— 存档里**没有** ✓
//
// ★★★ 教训（★ 本项目规矩第 ④ 条 ✓）：
//   「★ 探针包了**产线遍历的那棵树**」≠「**那棵树是真的**」✗✓
//   第 ③ 条只说了"探针要打在产线上"，这次它被**形式上**满足了，
//   却栽在**树本身是手搭的** ✓ ⇒ 所以第 ④ 条是：★ **探针的树必须与存档对账** ✓
//
// ★ 本工具的输出怎么用（★ 让第 ④ 条**结构上不可能违反** ✓）：
//   1. 生成 `tests/_wip/tree_ref.lua`（参考树 ＋ 每个相对路径的出现次数）
//   2. 探针在**自己搭完树之后**调 `tree_ref.check(root)` ⇒
//      ★ 扫自己那棵树 ⇒ 得到"我用到的相对路径"计数 ⇒ **与参考比对** ⇒
//      · ★ 用到了参考里**没有**的路径 ⇒ **红**（= 造了假控件 ✓ 正是 `ruler.c.*` 那种 ✓）
//      · ★ 参考里有、但**这一趟探针没用到** ⇒ **不算错** ✓
//        （★ 探针本来就只搭它要量的那一部分 ✓ 要求"全用上"会把工具做成废的 ✓）
//
// ★ 用法：
//   node tools/gil/gen_tree_ref.mjs [存档.gil]        # 默认 347.gil
//   ⇒ 写 tests/_wip/tree_ref.lua
//
// ★ 为什么"相对路径 + 出现次数"能对账 ✓（★ 这是关键设计 ✓）：
//   探针不会把 25 个格子、292 个控件全搭出来 ✗ —— 它搭的是**缩比替身** ✓
//   （★ 假树 149 个控件 vs 存档 293 条 ✓）
//   ⇒ 所以按**绝对名字**比会永远对不上 ✓
//   ⇒ 改成按 **`父名/子名` 这个相对边** 比 ✓ —— 它**与缩比无关** ✓
//     · ★ 真实边：`cell.1.1/content`、`content/wall.up`、`content/face` ✓
//     · ★ 假边（= 错 ✓）：`content/ruler.c.1` ✓ —— 存档里根本没有这条边 ✓
//   ⇒ ★ 一条假边都躲不过 ✓ 而缩比替身照样能过 ✓

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || path.join(ROOT, '347.gil');
const outPath = path.join(ROOT, 'tests', '_wip', 'tree_ref.lua');

const g = readGil(file);
const byId = new Map(g.recs.map((r) => [r.id, r]));

// ── 1. 每条"父 → 子"的边（★ 用名字，不用 id ✓ —— id 会随重建变 ✓）
const edges = new Map();     // "父名\0子名" -> 次数
const childNames = new Map(); // 父名 -> Set(子名)
let named = 0;
for (const r of g.recs) {
  if (!r.name) continue;
  named++;
  const p = byId.get(r.parentId);
  const pn = p && p.name ? p.name : '(根)';
  const k = pn + '\0' + r.name;
  edges.set(k, (edges.get(k) || 0) + 1);
  if (!childNames.has(pn)) childNames.set(pn, new Set());
  childNames.get(pn).add(r.name);
}

// ── 2. 排序输出（★ 稳定 ⇒ 便于 diff ✓）
const keys = [...edges.keys()].sort();
const lines = keys.map((k) => {
  const [p, c] = k.split('\0');
  return { p, c, n: edges.get(k) };
});

// ── 3. 写 Lua（★ 只读数据 ＋ 一个 check 函数 ✓ 探针直接 require ✓）
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const dataRows = lines.map((e) => `  { "${esc(e.p)}", "${esc(e.c)}", ${e.n} },`).join('\n');

const lua = `--[[----------------------------------------------------------------------------
  tests/_wip/tree_ref.lua —— ★★★ 存档真实控件树的【参考边表】（**自动生成，不要手改**）

  ★ 生成命令 ✓：node tools/gil/gen_tree_ref.mjs [存档.gil]
  ★ 来源存档 ✓：${path.basename(file)}（★ 这是"真值" ✓）
  ★ 内容 ✓：每一条"父名 → 子名"的边 ＋ 它在存档里出现几次 ✓
  ★ 用途 ✓：探针搭完自己的树之后调 \`tree_ref.check(root)\` ⇒
    · 用到参考里**没有**的边 ⇒ **红**（造了假控件 ✓ 例如 \`content/ruler.c.1\` ✓）
    · 参考里有、这一趟没用到 ⇒ **不算错** ✓（探针只搭它要量的那部分 ✓）

  ★★★ 为什么必须有这个文件 ✗✓（★ 本项目规矩第 ④ 条 ✓）：
    2026-10-13 审计证明：手搭假树**漏了 8 个真实边控件** ⇒
    凭空造出 840 笔 \`GetChild\`/render 并**全记在 v192 头上** ⇒
    量出"972 → 132（−86%）"这条**不存在的战果** ✗✗
    ⇒ ★「探针包了产线那棵树」≠「那棵树是真的」✓ ⇒ 现在改成**自动对账** ✓
----------------------------------------------------------------------------]]--

local M = {}

-- ★ 参考边：{ 父名, 子名, 存档里出现次数 }
M.edges = {
${dataRows}
}

-- 建索引：父名\0子名 -> 次数
local idx = {}
for i = 1, #M.edges do
  local e = M.edges[i]
  idx[e[1] .. "\\0" .. e[2]] = e[3]
end
M.count = #M.edges

local SEP = "\\0"

-- ★★ 扫描一棵探针树 ⇒ 得到它用到的每条边（按名字 ✓ 与缩比无关 ✓）
--   fakes：父控件对象 → 名字（★ 引擎控件对象本身没有 .name ⇒ 靠调用方给表 ✓）
function M.scan(root, nameOf)
  local used = {}
  local function walk(c)
    if c == nil then return end
    local nm = nameOf(c)
    local kids = nil
    pcall(function() kids = c:GetChildren() end)
    if type(kids) ~= "table" then return end
    for i = 1, #kids do
      local k = kids[i]
      local kn = nameOf(k)
      if nm ~= nil and kn ~= nil then
        local key = nm .. SEP .. kn
        used[key] = (used[key] or 0) + 1
      end
      walk(k)
    end
  end
  walk(root)
  return used
end

-- ★★★ 对账：★ 返回 ok, 报告文本
--   ★ 只查一个方向 ✓：★ "探针用了参考里没有的边" ⇒ 红 ✓
--   ★ 反向不查 ✓：★ 探针只搭它要量的一部分 ✓ 要求全用上会把工具做成废的 ✓
--
--   ⚠️ opt.skipParents ✓：★ **合成父**的名字表 ✓ —— ★ 从这些父出发的边**不检查** ✓
--     ★ 为什么必须有这一条（★ 实测踩到 ✓）：★ 探针的根是**合成的** ✗
--       · ★ 真机：\`cell.1.1\` 是**根级控件**（★ \`347.gil\` 里 \`父=null\` ✓）⇒ 边是 \`(根) → cell.1.1\` ✓
--       · ★ 探针：\`root → cell.1.1\` ✗ —— ★ 这条边在存档里**不存在** ✓
--     ⇒ ★ 若不声明 ⇒ ★ 每个探针都会在"根"这一步误报 ✗ ⇒ ★ 对账器会被当成噪音而弃用 ✓
--     ⚠️ ★ 但**不许**把这条当后门 ✓：★ 只许列**真正合成**的那一层 ✓
--       —— ★ 真控件之间的父子关系**一律照查** ✓（★ \`content → ruler.c.1\` 那种假边躲不过 ✓）
function M.check(root, nameOf, label, opt)
  local skip = (opt and opt.skipParents) or nil
  local used = M.scan(root, nameOf)
  local bad, okn, skipped = {}, 0, 0
  for key, n in pairs(used) do
    local p, c = key:match("^(.-)" .. SEP .. "(.*)$")
    if skip ~= nil and skip[p] then
      skipped = skipped + 1
    elseif idx[key] == nil then
      bad[#bad + 1] = "      ✗ 假边：" .. tostring(p) .. " → " .. tostring(c)
        .. "（探针用了 " .. tostring(n) .. " 次，★ 存档里没有这条边）"
    else
      okn = okn + 1
    end
  end
  table.sort(bad)
  local ok = (#bad == 0)
  local msg = "  [对账] " .. tostring(label or "探针树") .. "：用到 " .. tostring(okn)
    .. " 条**存档里真实存在**的边"
    .. (skipped > 0 and ("（另有 " .. tostring(skipped) .. " 条挂在**声明过的合成父**下，按约定不查 ✓）") or "")
    .. (#bad == 0 and "　⇒ ★ 与存档一致 ✓" or ("　⇒ ★★ 有 " .. tostring(#bad) .. " 条假边 ✗"))
  if not ok then msg = msg .. "\\n" .. table.concat(bad, "\\n") end
  return ok, msg
end

return M
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lua, 'utf8');

// ── 4. 终端回执（★ 让人一眼看出生成了什么 ✓）
const topParents = [...childNames.entries()]
  .map(([p, s]) => [p, s.size])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8);
console.log('存档：' + path.basename(file));
console.log('控件记录 ' + g.recs.length + ' 条，有名字 ' + named + ' 个');
console.log('参考边 ' + lines.length + ' 条（去重后）');
console.log('子控件最多的父：');
for (const [p, n] of topParents) console.log('  ' + p.padEnd(16) + n + ' 个子');
console.log('');
console.log('已写：' + path.relative(ROOT, outPath));
console.log('');
console.log('★ 探针用法（★ 搭完树之后）：');
console.log('   local tree_ref = require("tests._wip.tree_ref")   -- 或按探针自己的路径');
console.log('   local ok, msg = tree_ref.check(root, function(c) return MYNAME[c] end, "我的探针树")');
console.log('   out(msg); if not ok then os.exit(1) end');
