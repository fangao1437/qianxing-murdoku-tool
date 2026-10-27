import { readGil } from './gilread.mjs';
const g = readGil('219-调色板.gil');
function walk(fs, path, out) {
  for (const f of fs) {
    if (f.sub) { walk(f.sub, path + '/' + f.field, out); continue; }
    if (f.wt !== 0) continue;
    out.push([path + '#' + f.field, Number(f.num)]);
  }
}
const r = g.recs.find((x) => x.name === 'portrait.A');
const o = []; walk(r.field.sub, '', o);
console.log('  portrait.A 的 wt0 叶子共 ' + o.length + ' 个');
const hit = o.filter(([, v]) => v === 112042 || v === 100001 || (v > 100000 && v < 200000));
console.log('  ★ 值像素材 id 的（100000~199999）：');
for (const [p, v] of hit) console.log('      ' + p.padEnd(28) + ' = ' + v + (v === 100001 ? '   ← ★ 残留（★ 编辑器读的可能就是这里 ✓）' : ''));
const big = o.filter(([, v]) => v > 1000000);
console.log('  ★ 大数（可能是 imageSource / 记录 id）：' + big.map(([p, v]) => p + '=' + v).slice(0, 8).join('  '));