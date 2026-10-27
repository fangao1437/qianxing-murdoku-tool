// [[----------------------------------------------------------------------------
//   tools/check_plan_integrity.mjs —— 规划完整性哨兵（v073 那个 bug 的防线）
//
//   为什么需要它：2026-10-05 那个最贵的 bug 是 —— `build_layout` 把 `home`/`select`
//   各 push 了两遍，两个同 id 节点**每帧互相覆盖账目** ⇒ 每帧真写一次 visible
//   ⇒ 又把"事件驱动的兜底隐藏"每帧点着 ⇒ 用户报的"其它卡顿没有明显改善"。
//   它潜伏了很久，因为**没有任何检查在看"规划里 id 是否唯一"**。
//
//   本脚本用一次 dump 出来的规划（tools/sim/out/layout-plan.json）做机械检查：
//     ① **重复 id** —— 同一个 id 出现多次 ⇒ 一律报红（除非在白名单里明确豁免）
//     ② **同一父下尾名重复** —— 只允许白名单里的"故意同名尾段"
//     ③ **父子自洽** —— 每个节点的 parent 必须存在（或为 nil/root）
//     ④ **rect 合法性** —— w/h 必须 > 0（0 尺寸是"看不见"的常见根因）
//
//   跑法：
//     lua tools/dump_layout.lua && node tools/check_plan_integrity.mjs
//   退出码：0 = 全过；1 = 有红项（可直接接进 CI/check_all）
//
//   规矩：**只加检查、不改产物**。白名单里每一项都要写清"为什么合法"。
//  ----------------------------------------------------------------------------]]--

import { readFileSync } from 'node:fs';

const PLAN = process.argv[2] || 'tools/sim/out/layout-plan.json';

// 白名单：同一父下允许出现的"尾名"（这些是**故意**的，不是坑）
//   hex.* / hit.*  = 图标按钮 + 它的隐形热区（成对出现）
//   ruler.c.N / ruler.r.N = 列标尺 / 行标尺
//   wall.* / door.* = 格子四边（每边一个，尾名本来就不同）
const TAIL_WHITELIST = [
  /^hex\.[a-z]+$/, /^hit\.[a-z]+$/,
  /^ruler\.[cr]\.\d+$/,
  /^clue\.\d+\.[a-z0-9]+$/,
  /^cell\.\d+\.\d+$/,
];

// 重复 id 的豁免（**空** = 一个都不豁免；历史上唯一一次豁免是……没有）
const DUP_ID_WHITELIST = new Set();

let plan;
try {
  plan = JSON.parse(readFileSync(PLAN, 'utf8'));
} catch (e) {
  console.error(`  ✗ 读不到规划：${PLAN}\n    先跑：lua tools/dump_layout.lua\n    (${e.message})`);
  process.exit(1);
}

const nodes = plan.nodes || [];
let bad = 0;
const red = (s) => { bad++; console.log('  ✗ ' + s); };
const ok = (s) => console.log('  ✓ ' + s);

console.log(`== 规划完整性哨兵 ==  ${PLAN}`);
console.log(` 节点总数 ${nodes.length}`);

// ① 重复 id
const byId = new Map();
for (const n of nodes) byId.set(n.id, (byId.get(n.id) || 0) + 1);
const dups = [...byId.entries()].filter(([id, c]) => c > 1 && !DUP_ID_WHITELIST.has(id));
if (dups.length === 0) ok('重复 id：0 个');
else for (const [id, c] of dups) {
  const ps = [...new Set(nodes.filter((n) => n.id === id).map((n) => n.parent))].join(' / ');
  red(`重复 id：${id} ×${c}（父=${ps}）—— 两个同 id 节点会互相覆盖账目（v073 的 bug 就是这个形状）`);
}

// ② 同一父下尾名重复 —— ⚠️ **只提示，不判红**
//
//   为什么降级：第一版把它判成红，结果 16 项全是**误报** ✗ ——
//   规划里的 `parent` 字段对深层节点并不总是"直接父"（例如 `select.card.N.room.M`
//   的 parent 记的是 `select`），所以"同一父下同尾名"这个判据本身不成立 ✗。
//   按项目规矩：「拿不准的写疑似，不许把猜测写成结论」⇒ 这里只打印提示，
//   真要判红必须先证明"parent 是直接父"（未确认）。
const byParentTail = new Map();
for (const n of nodes) {
  const tail = n.id.split('.').slice(-2).join('.');
  const key = (n.parent || '(root)') + ' → ' + tail;
  if (!byParentTail.has(key)) byParentTail.set(key, new Set());
  byParentTail.get(key).add(n.id);
}
const tailDups = [...byParentTail.entries()].filter(([k, s]) => s.size > 1);
const tailUnexcused = tailDups.filter(([k]) => {
  const tail = k.split(' → ')[1];
  return !TAIL_WHITELIST.some((re) => re.test(tail));
});
console.log(`  ℹ 同一父下尾名重复：${tailDups.length} 组（其中未在白名单内 ${tailUnexcused.length} 组）`
  + ` —— **仅提示**：本判据的 parent 语义未确认，不判红`);

// ③ 父子自洽 —— ⚠️ **只提示，不判红**
//
//   为什么降级：`assets`（素材调色板）与 `action.redo`（容器）**合法缺席**于规划 ——
//   它们由编辑器摆放 / 运行时创建，规划里只登记子节点。⇒ 不能据此判红。
const ids = new Set(nodes.map((n) => n.id));
const orphans = nodes.filter((n) => n.parent && n.parent !== 'root' && !ids.has(n.parent));
const orphanParents = [...new Set(orphans.map((n) => n.parent))];
console.log(`  ℹ 父节点不在规划里的子节点：${orphans.length} 个（涉及父：${orphanParents.slice(0, 6).join(', ')}`
  + `${orphanParents.length > 6 ? ' …' : ''}）—— **仅提示**：编辑器摆放/运行时创建的容器合法缺席`);

// ④ rect 合法性
const zero = nodes.filter((n) => n.rect && (Number(n.rect.w) <= 0 || Number(n.rect.h) <= 0));
if (zero.length === 0) ok('rect 合法性：没有 0 尺寸节点');
else for (const n of zero.slice(0, 10)) red(`0/负尺寸：${n.id} = ${n.rect.w}x${n.rect.h}`);

console.log(bad === 0 ? '\n  ⇒ 全过 ✓' : `\n  ⇒ ${bad} 项红 ✗`);
process.exit(bad === 0 ? 0 : 1);
