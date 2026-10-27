import { readGil } from './gilread.mjs';
const g = readGil('222-调色板-修正.gil');
function leaves(fs, path, out) {
  for (const f of fs) {
    if (f.sub) { leaves(f.sub, path + '/' + f.field, out); continue; }
    if (f.wt !== 0) continue;
    out.push([path + '#' + f.field, Number(f.num)]);
  }
  return out;
}
function findRec(name) { return g.recs.find((x) => x.name === name); }
const modal = findRec('modal');
console.log('  modal id=' + (modal ? modal.id : '?'));
if (modal) {
  const kids = g.recs.filter((r) => r.parentId === modal.id);
  console.log('  modal 直接子（顺序）：' + kids.map((k) => k.name + '(' + k.id + ')').join(' , '));
}
for (const n of ['modal.exit', 'modal.save', 'modal.settle', 'modal.cancel']) {
  const r = findRec(n);
  if (!r) { console.log('  ✗ ' + n + ' 不存在'); continue; }
  const o = leaves(r.field.sub, '', []);
  const small = o.filter(([, v]) => v !== 0 && v < 3000);
  const kids = g.recs.filter((x) => x.parentId === r.id);
  console.log('  ── ' + n + '  id=' + r.id + '  子=' + kids.map((k) => k.name).join(','));
  console.log('     小数值叶：' + small.map(([p, v]) => p.replace('/505/503/', '') + '=' + Math.round(v * 100) / 100).join('  '));
}