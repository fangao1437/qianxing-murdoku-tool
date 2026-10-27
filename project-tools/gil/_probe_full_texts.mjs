// tools/gil/_probe_full_texts.mjs —— ★ 只读：**全树**扫文本叶子（对比 `_probe_texts.mjs` 的范围局限）
//
//   ★ 为什么要有这个 ✓：`_probe_texts.mjs` 只扫**状态块内部** ✓（`stateBlocks`）
//     ＋ `textsOf` 只收 `len <= 64` ✗
//     ⇒ ★ 若文本存在状态块外面 / 长度 > 64 ⇒ 旧探针会【假阴性】✗
//   ★★ 本探针 ✓：从每条记录的 **完整字段树** 递归收集 `wt=2 && isText` 叶子 ✓
//     ★ 不限长度 ✓ ★ 不限位置 ✓ ★ 逐条给出字段路径 ✓
//   ★ 判据 ✓：★ 存在「文本 ≠ 记录自己的名字」且「不是已知类型名」⇒ ★ **文本能存** ✓
//
// 用法：node tools/gil/_probe_full_texts.mjs <存档.gil> [--all]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, KNOWN_TYPES } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2];
const ALL = process.argv.includes('--all');
if (!file) { console.error('用法: node tools/gil/_probe_full_texts.mjs <存档.gil> [--all]'); process.exit(2); }
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

function walk(fields, pathParts, sink) {
  for (const f of fields) {
    const p = pathParts + '/#' + f.field;
    if (f.wt === 2 && f.isText) {
      const v = f.payload.toString('utf8');
      sink.push({ p, v, len: f.len, field: f.field });
    } else if (f.sub) walk(f.sub, p, sink);
  }
}

const rows = [];
let recWithText = 0, recWithOther = 0, otherFields = 0;
const lenBuckets = { '<=32': 0, '33-64': 0, '65-256': 0, '257-4096': 0, '>4096': 0 };

for (const r of g.recs) {
  const sink = [];
  walk(r.field.sub, '', sink);
  if (!sink.length) continue;
  recWithText++;
  for (const t of sink) {
    if (t.len <= 32) lenBuckets['<=32']++;
    else if (t.len <= 64) lenBuckets['33-64']++;
    else if (t.len <= 256) lenBuckets['65-256']++;
    else if (t.len <= 4096) lenBuckets['257-4096']++;
    else lenBuckets['>4096']++;
  }
  const other = sink.filter((t) => t.v !== r.name && !KNOWN_TYPES.has(t.v));
  if (other.length) {
    recWithOther++;
    otherFields += other.length;
    rows.push({ r, other });
  }
}

console.log('存档 ' + path.basename(file));
console.log('  记录 ' + g.recs.length + '　带文本叶子的记录 ' + recWithText);
console.log('  文本叶子长度分布 ' + JSON.stringify(lenBuckets));
console.log('★★ 文本≠记录名（且非已知类型）的记录：' + recWithOther + ' 个 / 字段 ' + otherFields + ' 个');
console.log('');
const shown = ALL ? rows.length : Math.min(rows.length, 35);
for (let i = 0; i < shown; i++) {
  const { r, other } = rows[i];
  const small = other.filter((t) => t.len <= 256);
  const big = other.filter((t) => t.len > 256);
  console.log('  ' + (r.name || '(无名)') + ' #' + r.id + '  父=' + r.parentId);
  for (const t of small.slice(0, 4)) console.log('      ' + t.p + ' [' + t.len + 'B] = ' + JSON.stringify(t.v));
  for (const t of big.slice(0, 2)) console.log('      ' + t.p + ' [' + t.len + 'B 大块] = ' + JSON.stringify(t.v.slice(0, 60)) + '…');
}
if (!rows.length) {
  console.log('★ 全树扫：没有任何"非名字文本" ⇒ 支持"存不了文本"');
} else {
  console.log('★ 全树扫：存在"非名字文本" ⇒ 文本**能存**（上面是位置）');
}
