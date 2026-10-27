// tools/gil/check_id_diff.mjs —— **按 ID**（不是按名字）核对"改存档没伤到老记录"
//
// 为什么必须按 ID（2026-10-07，本项目的常备知识）：
//   这个存档里**重名控件很多**（`content`×2、`cell.1.1`×2、`clue`×2、`1`/`2`/`3` 多份）。
//   按**名字**配对会把两份不同的记录串位，报出大量**假阳性**（实测同一对文件：
//   名字口径报 44 条"父级变了"，ID 口径是 **0 条**）。⇒ 一律按 ID 配对。
//
// 判据（三条都要过）：
//   ① 基准里每条记录的 ID 在产物里**都存在**；
//   ② 同 ID 的**父级 ID 不变**；
//   ③ 同 ID 的**名字不变**。
//   ⚠️ 只加"子控件/子列表条目"不算改动 —— 那正是加控件的正常代价（父的子列表必须登记新 ID）。
//
// 用法：node tools/gil/check_id_diff.mjs <基准.gil> <产物.gil>
// 退出码：0=三条全过 / 1=有差异 / 2=参数或文件问题

import fs from 'node:fs';
import { readGil } from './gilread.mjs';

const A = process.argv[2], B = process.argv[3];
if (!A || !B) { console.error('用法：node tools/gil/check_id_diff.mjs <基准.gil> <产物.gil>'); process.exit(2); }
if (!fs.existsSync(A) || !fs.existsSync(B)) { console.error('缺文件：' + (!fs.existsSync(A) ? A : B)); process.exit(2); }

const a = readGil(A), b = readGil(B);
const bIds = new Map(b.recs.map((r) => [r.id, r]));
const bNames = new Map(b.recs.map((r) => [r.name, r]));
const label = (r) => (r.name || '(无名)') + ' #' + r.id;

const gone = [], parentChanged = [], renamed = [];
for (const r of a.recs) {
  const o = bIds.get(r.id);
  if (!o) { gone.push(label(r)); continue; }
  if (r.parentId !== o.parentId) parentChanged.push(label(r) + '：父 ' + r.parentId + ' → ' + o.parentId);
  if (r.name !== o.name) renamed.push('#' + r.id + '：' + r.name + ' → ' + o.name);
}

// 附带统计：重名（说明为什么不能按名字比）
const dup = new Map();
for (const r of a.recs) if (r.name) dup.set(r.name, (dup.get(r.name) || 0) + 1);
const dupNames = [...dup.entries()].filter(([, n]) => n > 1);

console.log('基准：' + A + '（' + a.recs.length + ' 条）');
console.log('产物：' + B + '（' + b.recs.length + ' 条，+' + (b.recs.length - a.recs.length) + '）');
console.log('  ① 基准 ID 在产物里都存在：' + (a.recs.length - gone.length) + '/' + a.recs.length + (gone.length ? '  ❌' : '  ✅'));
if (gone.length) for (const x of gone) console.log('     ✗ 丢了：' + x);
console.log('  ② 父级改动：' + parentChanged.length + (parentChanged.length ? '  ❌' : '  ✅'));
for (const x of parentChanged) console.log('     ✗ ' + x);
console.log('  ③ 改名：' + renamed.length + (renamed.length ? '  ❌' : '  ✅'));
for (const x of renamed) console.log('     ✗ ' + x);
if (dupNames.length) {
  console.log('  ⓘ 基准里的重名（按名字比对会串位，共 ' + dupNames.length + ' 组）：'
    + dupNames.slice(0, 12).map(([n, k]) => n + '×' + k).join(', ')
    + '　⇒ 新记录按名字找可能命中旧的那份：' + (bNames.size < b.recs.length ? '是' : '否'));
}

const bad = gone.length + parentChanged.length + renamed.length;
console.log('\n' + (bad === 0 ? '★ ID 口径核对通过：老记录零丢失、零改父、零改名' : '❌ ID 口径有 ' + bad + ' 处差异'));
process.exit(bad === 0 ? 0 : 1);
