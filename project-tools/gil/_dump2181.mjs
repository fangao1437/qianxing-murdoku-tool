import { readGil } from './gilread.mjs';
const g = readGil('218.1.gil');
function walk(fs, path, out) {
  for (const f of fs) {
    if (f.sub) { walk(f.sub, path + '/' + f.field, out); continue; }
    if (f.wt !== 0) continue;
    out.push([path + '#' + f.field, Number(f.num)]);
  }
}
for (const n of ['portrait.A', 'row.1.1']) {
  const r = g.recs.find((x) => x.name === n);
  const o = []; walk(r.field.sub, '', o);
  console.log('  ★ ' + n + '（id=' + r.id + '）wt0 叶 ' + o.length + ' 个');
  const big = o.filter(([, v]) => v > 1000);
  console.log('      数值 >1000 的：' + (big.length ? '' : '（无）'));
  for (const [p, v] of big) console.log('        ' + p.padEnd(30) + ' = ' + v + (v > 100000 && v < 200000 ? '   ← ★ 像素材 id' : ''));
}
console.log('  ★ 参照：模板 clue.face 里同样的位置：');
const clue = g.recs.find((x) => x.name === 'clue');
const face = g.recs.find((x) => x.parentId === clue.id && x.name === 'face');
const o2 = []; walk(face.field.sub, '', o2);
console.log('      face wt0 叶 ' + o2.length + ' 个，>1000 的：' + o2.filter(([, v]) => v > 1000).map(([p, v]) => p + '=' + v).join('  ') || '（无）');