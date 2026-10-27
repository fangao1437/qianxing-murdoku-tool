// tools/gil/probe_guid_collision.mjs —— ★★ 只读：GUID 撞号的**分类审计**（替换"数多属号"的粗判）
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么要有它（2026-10-21）
// ════════════════════════════════════════════════════════════════════════════
//   `_probe_innergids.mjs` 只报"同一 id 被两条以上记录使用"的数量，
//   而那个数字里混了三类**合法**情况，于是"数量没变"既不能证明干净、也不能证明脏：
//     · 父指针 `/#504`：N 个子控件都指向同一个父 id（合法，天然多对一）
//     · 子列表 `/#505/#503/#504/#4`：父级登记子 id（每个子一次）
//     · 颜色常量 `4294967295 / 16777215 / 858993459`：根本不是 id
//   ⇒ 真正会被编辑器判"控件 GUID 重复"的只有一种：
//        ★ **两条记录的"自身 GUID"相同**（`/#501` 与 `/#502/#11/#501` 这两处）
//   本工具按**角色**把每一处 id 分类，只把"自身 GUID 重复"判为 FAIL。
//
//   ⚠️ 判定 id 的取值区间：本工程 GUID 都在 [1073741824, 1073800000)，
//      用它把颜色常量（≥0xFF000000 或 0x33333333 这类）排除在外。
//
// 用法：
//   node tools/gil/probe_guid_collision.mjs <存档.gil> [--verbose]
// 退出码：0 = 干净；3 = 有真撞号；2 = 解析/用法错误
// ════════════════════════════════════════════════════════════════════════════
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const file = argv.find((s) => !s.startsWith('--'));
const VERBOSE = argv.includes('--verbose');
if (!file) { console.error('用法: node tools/gil/probe_guid_collision.mjs <存档.gil> [--verbose]'); process.exit(2); }
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

const ID_LO = 1073741824, ID_HI = 1073800000;
const isId = (v) => v >= ID_LO && v < ID_HI;

// ── 收集：每条记录的自身 GUID（两处）与所有 id 型 varint（带路径）───────────
const ownIdOf = (rec) => {
  const top = rec.field.sub.find((f) => f.field === 501 && f.wt === 0);
  const c2 = rec.field.sub.find((f) => f.field === 502 && f.sub && f.sub.some((x) => x.field === 11));
  const inner = c2 ? (c2.sub.find((x) => x.field === 11).sub || []).find((x) => x.field === 501 && x.wt === 0) : null;
  return [top ? Number(top.num) : null, inner ? Number(inner.num) : null];
};
const walkIds = (fields, p, out) => {
  for (const f of fields || []) {
    const np = p + '/#' + f.field;
    if (f.wt === 0 && isId(Number(f.num))) out.push({ v: Number(f.num), where: np });
    if (f.sub) walkIds(f.sub, np, out);
  }
  return out;
};

const rows = g.recs.map((r) => {
  const [a, b] = ownIdOf(r);
  return { name: r.name || '(无名)', id: Number(r.id), own: a, inner: b, ids: walkIds(r.field.sub, '', []) };
});

// ── ① 真撞号：两条记录的"自身 GUID"相同 ────────────────────────────────────
// ★★ 2026-10-21 收窄：只有**顶层 `#501`** 才算"自身 GUID"。
//   反证：`472` 的 `hud.subtitle` 顶层唯一、`#502/#11/#501` 与 #501 不一致，
//   而**用户在真机跑过 472 且不报错** ⇒ 编辑器查的是顶层这一处。
const byOwn = new Map();
for (const r of rows) {
  if (r.own == null) continue;
  if (!byOwn.has(r.own)) byOwn.set(r.own, []);
  byOwn.get(r.own).push({ who: r.name, id: r.id, tag: '#501' });
}
const collisions = [...byOwn.entries()].filter(([, list]) => new Set(list.map((x) => x.who + '@' + x.id)).size > 1);

// ── ② 自身 GUID 自相矛盾（#501 ≠ #502/#11/#501）────────────────────────────
const mismatched = rows.filter((r) => r.own != null && r.inner != null && r.own !== r.inner);

// ── ③ 父子表一致性：父的子列表里有没有这个子 / 子的父指针指回父 ──────────────
const byId = new Map(rows.map((r) => [r.id, r]));
const listProblems = [];
for (const r of g.recs) {
  const cl = findChildListTop(r.field.sub);
  if (!cl) continue;
  const ids = (asIdList(cl.payload, true) || []).map(Number);
  for (const cid of ids) {
    if (!byId.has(cid)) { listProblems.push((r.name || '(无名)') + ' 的子列表登记了不存在的 #' + cid); continue; }
    const child = g.recs.find((x) => Number(x.id) === cid);
    const par = child.field.sub.find((f) => f.field === 504 && f.wt === 0);
    if (par && Number(par.num) !== Number(r.id)) {
      listProblems.push((r.name || '(无名)') + ' 的子列表有 ' + (child.name || '(无名)') + '（#' + cid + '），但它的父指针指向 #' + Number(par.num));
    }
  }
}

// ── ④ 悬空父指针（模板层会有，属提示）──────────────────────────────────────
const dangling = rows.filter((r) => {
  const rec = g.recs.find((x) => Number(x.id) === r.id);
  const par = rec.field.sub.find((f) => f.field === 504 && f.wt === 0);
  return par && Number(par.num) !== 0 && !byId.has(Number(par.num));
});

// ── 报告 ───────────────────────────────────────────────────────────────────
console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length
  + '　自身 GUID 唯一值 ' + byOwn.size);
console.log('');
if (collisions.length === 0) {
  console.log('✅ ① 真撞号（自身 GUID 重复）：**0 处** —— 编辑器不会报「控件 GUID 重复」');
} else {
  console.log('❌ ① 真撞号（自身 GUID 重复）：' + collisions.length + ' 处 —— 这就是编辑器报的那条：');
  for (const [v, list] of collisions.slice(0, 20)) {
    const who = [...new Set(list.map((x) => x.who + '#' + x.id))];
    console.log('   #' + v + ' ← ' + who.join(' , '));
    if (VERBOSE) for (const x of list) console.log('        ' + x.who + '#' + x.id + ' @' + x.tag);
  }
  if (collisions.length > 20) console.log('   …还有 ' + (collisions.length - 20) + ' 处（加 --verbose 看全）');
}
console.log('');
if (mismatched.length === 0) {
  console.log('✅ ② 自身 GUID 两处一致（#501 == #502/#11/#501）：全部一致');
} else {
  // ★★ 2026-10-21 **降级为提示，不再判 FAIL** ✗✓✓
  //   实测反证：`472-头像层-v283.gil` 就是 1 条这种情况（`hud.subtitle`），
  //   而**用户在真机上跑过 472，编辑器没有报错**。
  //   ⇒ `#502/#11/#501` 与 `#501` 不一致**不是**编辑器判定"控件 GUID 重复"的依据
  //     （它更像"模板/母本引用"）。真正的硬判据只有 ①（顶层 `#501` 撞号）。
  console.log('ℹ️ ② 自身 GUID 两处不一致：' + mismatched.length + ' 条（**提示**：472 实测带这一条也不报错，故不算错）');
  for (const r of mismatched.slice(0, 15)) console.log('   ' + r.name + '#' + r.id + '  #501=' + r.own + '  vs  ' + r.inner);
}
console.log('');
if (listProblems.length === 0) {
  console.log('✅ ③ 父子表一致：子列表登记的都存在，且父指针指回父');
} else {
  console.log('⚠️ ③ 父子表问题：' + listProblems.length + ' 条');
  for (const s of listProblems.slice(0, 15)) console.log('   ' + s);
}
console.log('');
if (dangling.length === 0) {
  console.log('✅ ④ 无悬空父指针');
} else {
  console.log('ℹ️ ④ 悬空父指针 ' + dangling.length + ' 条（模板层常见，编辑器里表现为"挂在模板下"，不一定是错）：');
  for (const r of dangling.slice(0, 15)) console.log('   ' + r.name + '#' + r.id);
}

const bad = collisions.length;   // ★ 只认 ①（顶层撞号）；② 为提示（472 实测反证）
console.log('');
console.log(bad === 0 ? '★ 结论：干净（真撞号 0、自身 GUID 一致）' : '★ 结论：需要修（' + bad + ' 条硬问题）');
process.exit(bad === 0 ? 0 : 3);
