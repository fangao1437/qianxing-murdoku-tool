// tools/gil/_probe_idrefs.mjs —— 只读：**数字 id 在存档里出现的所有位置**（含"只是引用、不是记录"的）
//   用法：node tools/gil/_probe_idrefs.mjs <存档.gil> <id> [<id>…]
//   场景：编辑器报「开关控件GUID重复:1073742787」时，先看这个号码到底挂在哪些记录/字段上 ✓
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [file, ...ids] = process.argv.slice(2);
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));
const want = new Set(ids.map((x) => String(Number(x))));
console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length
  + '　查：' + [...want].join(', '));

// 每条记录：自己的 #501，以及其子树里任何等于目标值的 varint
function scan(fields, pathStr, owners) {
  for (const f of fields) {
    const p = pathStr + '/#' + f.field;
    if (f.wt === 0) {
      const v = String(Number(f.num));
      if (want.has(v)) owners.push({ where: p, v, self: p === '/#501' });
    } else if (f.sub) {
      scan(f.sub, p, owners);
    }
  }
}

let selfHits = 0;
for (const r of g.recs) {
  const hits = [];
  scan(r.field.sub, '', hits);
  if (!hits.length) continue;
  const own = String(r.id);
  const refs = hits.filter((h) => h.v !== own);
  const selfs = hits.filter((h) => h.v === own && h.self);
  if (!refs.length && !selfs.length) continue;
  console.log('  ' + String(r.name || '(无名)').padEnd(22) + '#' + own
    + '　父=' + r.parentId
    + (selfs.length ? '　[自身 #501]' : '')
    + (refs.length ? '　引用→ ' + refs.map((h) => h.v + '@' + h.where).join(', ') : ''));
  selfHits += selfs.length;
}
console.log('命中自身 #501 的 ' + selfHits + ' 条（上面已列出）');
