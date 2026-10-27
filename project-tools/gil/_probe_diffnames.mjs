// tools/gil/_probe_diffnames.mjs —— 只读：两个 .gil 的**控件名**差集（按记录名计数）
//   用法：node tools/gil/_probe_diffnames.mjs <A.gil> <B.gil>
//   ★ 为什么不用 diff_fields：那个按位置比 ⇒ 插入/删除会连带报几千条 ✓（工具自己也会提示 ✓）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const resolve = (f) => (path.isAbsolute(f) ? f : path.join(ROOT, f));
const [fa, fb] = process.argv.slice(2);
if (!fa || !fb) { console.error('用法: node tools/gil/_probe_diffnames.mjs <A.gil> <B.gil>'); process.exit(2); }

const a = readGil(resolve(fa)), b = readGil(resolve(fb));
const cnt = (recs) => { const m = new Map(); for (const r of recs) { const n = r.name || '(无名)'; m.set(n, (m.get(n) || 0) + 1); } return m; };
const ca = cnt(a.recs), cb = cnt(b.recs);

console.log('记录数 A=' + a.recs.length + '  B=' + b.recs.length);
const added = [], removed = [], same = [];
for (const [k, v] of cb) { const old = ca.get(k) || 0; if (v > old) added.push(k + ' ×' + (v - old)); else if (v === old) same.push(k); }
for (const [k, v] of ca) { const now = cb.get(k) || 0; if (v > now) removed.push(k + ' ×' + (v - now)); }
console.log('\n新增记录：' + (added.join('  ') || '(无)'));
console.log('减少记录：' + (removed.join('  ') || '(无)'));
const newOnly = [...cb.keys()].filter((k) => !ca.has(k));
console.log('\n只在 B 里出现的名字：' + (newOnly.map((k) => k + ' ×' + cb.get(k)).join('  ') || '(无)'));

// 顺带：B 里 id 段的新增（记录 id 是新增记录最直接的证据）
const ida = new Set(a.recs.map((r) => r.id)), idb = new Set(b.recs.map((r) => r.id));
const idNew = [...idb].filter((i) => !ida.has(i));
const idGone = [...ida].filter((i) => !idb.has(i));
const nm = new Map(b.recs.map((r) => [r.id, r.name || '(无名)']));
console.log('\nB 新增记录 id：' + (idNew.map((i) => i + '=' + (nm.get(i) || '?')).join('  ') || '(无)'));
console.log('B 消失记录 id：' + (idGone.join('  ') || '(无)'));
