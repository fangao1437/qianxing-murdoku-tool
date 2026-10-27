// tools/gil/_probe_proto.mjs —— 确认"搬 hex/hit"要用的两个原型长什么样
//   规格（见 `接手待办.md`）：
//     · `hex.*` = **纯图片**（能渲染、收不到光标事件）⇒ 找个纯图片控件当原型 ✓
//     · `hit.*` = **能收点击、什么都不画** ⇒ 找个按钮、把会画东西的子控件去掉 ✓
//   用法：node tools/gil/_probe_proto.mjs <存档.gil>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const g = readGil(path.resolve(ROOT, process.argv[2] || '229-四键图片分量补上.gil'));

const shape = (rec) => (((rec.field && rec.field.sub) || []).map((s) => '#' + s.field
  + (s.sub ? '[' + s.sub.length + ']' : '')).join(' '));
const geo = (rec) => {
  const o = []; stateBlocks(rec.field.sub, o);
  if (!o[0]) return '（无状态块）';
  return 'pos=(' + pairValue(pairOf(o[0], 504), 0) + ',' + pairValue(pairOf(o[0], 504), 1) + ')'
    + ' size=(' + pairValue(pairOf(o[0], 505), 0) + '×' + pairValue(pairOf(o[0], 505), 1) + ')';
};
const comps = (rec) => {
  const subs = (rec.field && rec.field.sub) || [];
  const out = [];
  for (const f of subs) {
    if (f.field !== 502) continue;
    const kind = (f.sub || []).find((s) => s.wt === 2 && s.field >= 11 && s.field <= 20);
    out.push(kind ? '#' + kind.field : '?');
  }
  return out.join(',');
};

const show = (rec, tag) => {
  console.log('  ' + tag.padEnd(26) + ' #' + String(rec.id).padEnd(12) + ' ' + geo(rec));
  console.log('     分量=' + comps(rec) + '   字段=' + shape(rec));
};

console.log('=== 候选原型 A：纯图片（给 hex.*）===');
const cell = g.recs.find((r) => r.name === 'cell.1.1');
console.log('cell.1.1 #' + (cell ? cell.id : '?'));
if (cell) {
  const kids = g.recs.filter((r) => r.parentId === cell.id);
  for (const k of kids) {
    show(k, k.name);
    for (const kk of g.recs.filter((r) => r.parentId === k.id)) show(kk, '  └' + kk.name);
  }
}
// 顶层有没有纯图片控件
console.log('\n=== root 的现有子控件（前 12 个）===');
const root = g.recs.find((r) => r.name === 'root');
if (root) {
  for (const k of g.recs.filter((r) => r.parentId === root.id).slice(0, 12)) show(k, k.name);
}

console.log('\n=== 候选原型 B：能点、画得少（给 hit.*）===');
for (const n of ['home.bag', 'home.select', 'action.back']) {
  const rec = g.byName.get(n);
  if (!rec) { console.log('  ' + n + ' 缺'); continue; }
  show(rec, n);
  for (const k of g.recs.filter((r) => r.parentId === rec.id)) show(k, '  └' + k.name);
}

console.log('\n=== root / 存档概况 ===');
console.log('  root #' + (root ? root.id : '?') + '  记录总数=' + g.recs.length + '  maxId=' + g.maxId);
