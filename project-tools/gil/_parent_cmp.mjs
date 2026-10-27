import { readGil } from './gilread.mjs';
const a = readGil('208.1.gil');
const b = readGil('223-完整界面-可导入.gil');
const am = new Map(a.recs.filter((r) => r.name).map((r) => [r.name, r]));
console.log('  ── 208.1 里【已有】的控件，在 223 里的父级有没有变 ──');
let same = 0, moved = 0, lost = 0;
const movedList = [];
for (const [name, ra] of am) {
  const rb = b.recs.find((r) => r.name === name);
  if (!rb) { lost++; movedList.push(name + ' → 丢失'); continue; }
  if (ra.parentId === rb.parentId) same++;
  else { moved++; movedList.push(name + ' 父 ' + ra.parentId + ' → ' + rb.parentId); }
}
console.log('    父级未变 ' + same + '   父级改变 ' + moved + '   丢失 ' + lost);
for (const m of movedList.slice(0, 25)) console.log('    ' + m);
console.log('  ── 223 比 208.1 多出来的控件里，哪些名字是"功能按钮/图标" ──');
const aIds = new Set(a.recs.map((r) => r.id));
const nw = b.recs.filter((r) => !aIds.has(r.id) && r.name);
const keys = ['hex.', 'hit.', 'action.', 'tool.', 'selbtn', 'clues.', 'modal.', 'intro.'];
for (const k of keys) {
  const hit = nw.filter((r) => r.name.startsWith(k));
  console.log('    ' + k.padEnd(10) + hit.length + (hit.length ? '  e.g. ' + hit.slice(0, 4).map((r) => r.name).join(', ') : ''));
}
console.log('  ── 208.1 里 hex./hit. 的父级 vs 223 里同名 ──');
for (const n of ['hex.back', 'hit.back', 'hex.submit', 'hit.submit', 'hex.undo', 'action.back']) {
  const ra = am.get(n); const rb = b.recs.find((r) => r.name === n);
  const nameOf = (id) => { const r = a.recs.find((x) => x.id === id) || b.recs.find((x) => x.id === id); return r && r.name ? r.name : '#' + id; };
  console.log('    ' + n.padEnd(14) + '208 父=' + (ra ? nameOf(ra.parentId) : '缺') + '   223 父=' + (rb ? nameOf(rb.parentId) : '缺'));
}