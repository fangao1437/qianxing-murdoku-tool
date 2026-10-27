// tools/gil/_probe_stretch.mjs —— 只读：列出带**拉伸锚点**（anchorMin ≠ anchorMax）的记录
//   ★ 用途：改"格子子控件铺满格子"之前，先证明这套存档里**确实有**拉伸锚点的先例（不是我们发明的用法）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '397-线索提示-things-门墙-v255.gil';
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

let n = 0;
const rows = [];
for (const r of g.recs) {
  const bs = [];
  stateBlocks(r.field.sub, bs);
  if (!bs.length) continue;
  const b = bs[0];
  const amin = pairOf(b, 502), amax = pairOf(b, 503);
  if (!amin || !amax) continue;
  const a1 = pairValue(amin), a2 = pairValue(amax);
  if (!a1 || !a2) continue;
  if (Math.abs(a1[0] - a2[0]) > 1e-6 || Math.abs(a1[1] - a2[1]) > 1e-6) {
    n++;
    const sz = pairOf(b, 505);
    const sv = sz ? pairValue(sz) : null;
    rows.push((r.name || '(无名)').padEnd(20) + ' #' + r.id
      + '  anchorMin=' + a1.map((x) => x.toFixed(2)).join(',')
      + '  anchorMax=' + a2.map((x) => x.toFixed(2)).join(',')
      + (sv ? '  size=' + sv.map((x) => x.toFixed(0)).join('x') : ''));
  }
}
console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length);
for (const s of rows.slice(0, 25)) console.log('  ' + s);
console.log('拉伸锚点记录数 = ' + n);
