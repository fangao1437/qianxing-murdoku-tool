// tools/gil/leaves.mjs —— **只读**：把一条记录摊成"路径 = 值"的叶子清单（可 diff 两条记录）
//
// 用途：找"某个语义存在哪个字段里"（例如图片的填充方式、对齐、状态引用 …）。
//   做法：把两条记录各自的叶子清单打出来，用 diff 看**除了 id/父/名字/几何/图**之外
//   还有哪些字段不同 ⇒ 那些就是"控件自己的属性"。
//
// 用法：
//   node tools/gil/leaves.mjs <存档.gil> <名字>
//   node tools/gil/leaves.mjs <存档.gil> <名字A> <名字B>     # 并排对照，标出不同

import path from 'node:path';
import { readGil } from './gilread.mjs';

const file = process.argv[2];
const names = process.argv.slice(3);
if (!file || !names.length) {
  console.error('用法: node tools/gil/leaves.mjs <存档.gil> <名字…>');
  process.exit(1);
}
const g = readGil(file);

function leaves(fields, p, out) {
  for (const f of fields) {
    const here = p + '/#' + f.field;
    if (f.sub) leaves(f.sub, here, out);
    else if (f.wt === 0) out.set(here, String(f.num));
    else if (f.wt === 5) out.set(here, Number(f.f).toFixed(2));
    else if (f.wt === 1) out.set(here, 'fixed64');
    else out.set(here, f.isText ? 'str:' + f.payload.toString('utf8') : 'bytes[' + (f.len || 0) + ']');
  }
  return out;
}

const maps = names.map((nm) => {
  const r = g.byName.get(nm);
  if (!r) { console.error('找不到 ' + nm); process.exit(2); }
  return { nm, id: r.id, map: leaves(r.field.sub, '', new Map()) };
});

if (maps.length === 1) {
  console.log('# ' + maps[0].nm + '  #' + maps[0].id + '   叶子 ' + maps[0].map.size + ' 个');
  for (const [k, v] of maps[0].map) console.log('  ' + k.padEnd(34) + ' = ' + v);
  process.exit(0);
}

const A = maps[0], B = maps[1];
console.log('文件：' + path.basename(file));
console.log('A = ' + A.nm + ' #' + A.id + '（叶子 ' + A.map.size + '）');
console.log('B = ' + B.nm + ' #' + B.id + '（叶子 ' + B.map.size + '）\n');

const keys = [...new Set([...A.map.keys(), ...B.map.keys()])].sort();
let same = 0, diff = 0, onlyA = 0, onlyB = 0;
for (const k of keys) {
  const a = A.map.get(k), b = B.map.get(k);
  if (a === undefined) { onlyB++; console.log('  ＋只有B  ' + k.padEnd(30) + ' = ' + b); continue; }
  if (b === undefined) { onlyA++; console.log('  －只有A  ' + k.padEnd(30) + ' = ' + a); continue; }
  if (a === b) { same++; continue; }
  diff++;
  console.log('  ≠ ' + k.padEnd(30) + ' A=' + a + '   B=' + b);
}
console.log('\n相同 ' + same + ' 处；不同 ' + diff + ' 处；只有A ' + onlyA + '；只有B ' + onlyB);
