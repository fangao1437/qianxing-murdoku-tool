import { readGil, asIdList, findChildListTop } from './gilread.mjs';
const g = readGil('213-弹窗四键.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kids = (rec) => { const l = findChildListTop(rec.field.sub); return l ? (asIdList(l.payload, true) || []) : []; };
const nm = (id) => (byId.get(id) || {}).name || ('#' + id);
for (const n of ['modal', 'modal.exit', 'modal.save', 'modal.settle', 'modal.cancel']) {
  const r = g.recs.find((x) => x.name === n);
  if (!r) { console.log('  ' + n + '  ✗ 缺'); continue; }
  console.log('  ' + n.padEnd(14) + ' 记录ID=' + r.id + '  子控件(' + kids(r).length + '): ' + kids(r).map(nm).join(', '));
}
console.log('  ── modal 的直接子控件（编辑器里该看到的清单）──');
const m = g.recs.find((x) => x.name === 'modal');
console.log('  ' + kids(m).map(nm).join('  '));