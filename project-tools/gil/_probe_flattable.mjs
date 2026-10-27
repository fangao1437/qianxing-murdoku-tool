// tools/gil/_probe_flattable.mjs —— 只读：查**扁平控件表**（档头 `#9/#502`）里的 GUID 是否重复
//   背景：编辑器报「界面控件里的…GUID重复:1073742787」，而记录表里只有一个。
//   ⇒ 扁平表是编辑器枚举"界面控件"的另一份来源，必须一起核对 ✓
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '401-选关修复-门墙-v257.gil';
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

// 档头：找 field 9 的那条消息，其 sub 里 field 502 是扁平表
let flat = null;
(function walk(fields) {
  for (const f of fields || []) {
    if (f.field === 9 && f.sub) {
      const t = f.sub.find((x) => x.field === 502 && x.sub);
      if (t) flat = t;
    }
    if (f.sub && !flat) walk(f.sub);
  }
})(g.tree);

if (!flat) { console.log('找不到扁平表 #9/#502'); process.exit(0); }
const rows = flat.sub;
console.log('扁平表行数 = ' + rows.length);

const ids = [];
for (const row of rows) {
  const f501 = row.sub ? row.sub.find((x) => x.field === 501 && x.wt === 0) : null;
  ids.push(f501 ? String(Number(f501.num)) : '(无)');
}
const count = new Map();
for (const id of ids) count.set(id, (count.get(id) || 0) + 1);
const dups = [...count.entries()].filter(([, n]) => n > 1);
console.log('扁平表里重复的 GUID = ' + dups.length);
for (const [id, n] of dups.slice(0, 12)) {
  const where = [];
  for (const r of g.recs) if (String(r.id) === id) where.push(r.name || '(无名)');
  console.log('  #' + id + ' ×' + n + '　记录表里的同名记录：' + (where.join(',') || '(没有)'));
}
if (!dups.length) console.log('  （扁平表没有重复）');

// 记录表 vs 扁平表 的差集（谁多谁少）
const recIds = new Set(g.recs.map((r) => String(r.id)));
const flatOnly = [...count.keys()].filter((k) => !recIds.has(k));
const recOnly = [...recIds].filter((k) => !count.has(k));
console.log('只在扁平表里 = ' + flatOnly.length + (flatOnly.length ? '：' + flatOnly.slice(0, 8).join(',') : ''));
console.log('只在记录表里 = ' + recOnly.length + (recOnly.length ? '：' + recOnly.slice(0, 8).join(',') : ''));
