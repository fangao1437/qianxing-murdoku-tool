// tools/gil/_probe_things.mjs —— 只读：`things` 素材区的 id 分配情况 + 全档 id 分布（查"GUID 撞号"用）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '401-选关修复-门墙-v257.gil';
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

const ids = g.recs.map((r) => Number(r.id)).sort((a, b) => a - b);
console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length);
console.log('最小 id ' + ids[0] + '　最大 id ' + ids[ids.length - 1]);
const thingsRec = g.recs.find((r) => r.name === 'things');
if (!thingsRec) { console.log('（没有 things）'); process.exit(0); }
const kids = g.recs.filter((r) => Number(r.parentId) === Number(thingsRec.id));
console.log('\nthings #' + thingsRec.id + '（父 ' + thingsRec.parentId + '）子控件 ' + kids.length + ' 个：');
for (const k of kids.sort((a, b) => Number(a.id) - Number(b.id))) {
  console.log('  ' + String(k.name).padEnd(14) + '#' + k.id
    + '　（比它大的记录里有 ' + ids.filter((x) => x > Number(k.id)).length + ' 个）');
}
// 看看这些 id 是不是落在"别的东西已经用过"的区间里
const near = ids.filter((x) => x >= 1073742770 && x <= 1073742800);
console.log('\nid ∈ [1073742770, 1073742800] 的记录（撞号高发区）：');
for (const x of near) {
  const r = g.recs.find((rr) => Number(rr.id) === x);
  console.log('  #' + x + ' ' + (r.name || '(无名)') + '　父=' + r.parentId);
}
