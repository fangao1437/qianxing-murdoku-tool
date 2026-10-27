// tools/gil/_probe_dupids.mjs —— 只读：查**重复的控件 GUID**（编辑器报"开关控件GUID重复:xxx"时用）
//   判据：所有记录自己的 `#501`（GUID）里出现次数 > 1 的，就是重复 ✓
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '401-选关修复-门墙-v257.gil';
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

const byId = new Map();
for (const r of g.recs) {
  const k = String(r.id);
  if (!byId.has(k)) byId.set(k, []);
  byId.get(k).push(r.name || '(无名)');
}
const dups = [...byId.entries()].filter(([, ns]) => ns.length > 1);
console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length + '　唯一 GUID ' + byId.size);
console.log('重复 GUID = ' + dups.length);
for (const [id, names] of dups.sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const recs = g.recs.filter((r) => String(r.id) === id);
  console.log('  #' + id + '  ×' + names.length + '：' + names.join(' | ')
    + '　父=' + recs.map((r) => r.parentId).join(','));
}
if (!dups.length) console.log('  （没有重复）');
