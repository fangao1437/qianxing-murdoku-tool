// tools/gil/_offs.mjs —— 打印指定控件的字节区间（喂给 dumpone.mjs 用）
// 用法: node tools/gil/_offs.mjs <gil> <父名> [子名]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const g = readGil(path.resolve(ROOT, process.argv[2]));
const pname = process.argv[3];
const cname = process.argv[4] || null;

const recs = g.recs;
const keys = recs.filter((r) => r.name === pname);
console.log('名字 ' + pname + ' 命中 ' + keys.length + ' 条');
for (const r of keys) {
  console.log('  id=' + r.id + '  parentId=' + r.parentId + '  bytes=[' + r.s0 + ',' + r.s1 + ')  states=' + (r.states || []).length);
  if (cname) {
    const kids = recs.filter((x) => x.parentId === r.id);
    console.log('    子控件 ' + kids.length + ' 个：' + kids.map((k) => k.name + '(id=' + k.id + ',bytes=[' + k.s0 + ',' + k.s1 + '),states=' + (k.states || []).length + ')').join('  '));
  }
}
