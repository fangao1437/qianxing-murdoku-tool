// tools/gil_rawname.mjs —— 找"实例名"到底存在哪条路径上（对比有名/无名记录）
// 用法：node tools/gil_rawname.mjs <file.gil> <id> [<id> ...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const [file, ...ids] = process.argv.slice(2);
const g = readGil(path.resolve(REPO, file));

for (const idStr of ids) {
  const id = Number(idStr);
  const rec = g.recs.find((r) => r.id === id);
  if (!rec) {
    console.log(`(${id} 未找到)`);
    continue;
  }
  console.log(`\n=== ${id} name=${JSON.stringify(rec.name)} parent=${rec.parentId} states=${rec.states.length} ===`);
  // 打印所有字符串 + 路径
  (function walk(fields, pathStr, depth) {
    for (const f of fields) {
      const here = `${pathStr}/#${f.field}`;
      if (f.wt === 2 && f.isText) {
        console.log(`  str @${here} = ${JSON.stringify(f.payload.toString('utf8'))}`);
      } else if (f.wt === 2 && f.sub && depth < 8) {
        walk(f.sub, here, depth + 1);
      }
    }
  })(rec.field.sub, '', 0);
}
