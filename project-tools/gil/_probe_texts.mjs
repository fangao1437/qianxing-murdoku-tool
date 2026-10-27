// tools/gil/_probe_texts.mjs —— ★ 只读：把 `.gil` 里**所有状态块中的文本字段**打出来
//
//   ★ 要回答的问题 ✓：★ **`.gil` 到底能不能存控件的文字内容？** ✗✓
//     · 项目旧结论（2026-09-28）✓：「控件的文字内容**根本不存进 `.gil`** ✓
//       证据：`hud.title` 里唯一的文本字段内容是 **它自己的名字** ✓」
//     · 而 2026-10-16 用户说「主页四键的**我已经填了**」✓ ⇒ ★ 必须重新核一遍 ✓
//       （★ 结论即假设 ✓ 旧结论也要复核 ✓）
//   ★ 判据 ✓：★ 只要有一条记录的文本 **≠ 它自己的名字** ⇒ ★ **能存** ✓✓
//
// 用法：node tools/gil/_probe_texts.mjs <存档.gil> [--all]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, stateBlocks } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2];
const ALL = process.argv.includes('--all');
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

let n = 0, notName = 0, notNameInState = 0;
const rows = [];
for (const r of g.recs) {
  const bl = []; stateBlocks(r.field.sub, bl);
  const texts = [];
  for (const b of bl) {
    (function w(fs, p) {
      for (const x of fs) {
        if (x.wt === 2 && x.isText) texts.push({ path: p + '/#' + x.field, v: x.payload.toString('utf8') });
        if (x.sub) w(x.sub, p + '/#' + x.field);
      }
    })(b.sub, '状态块');
  }
  if (!texts.length) continue;
  n += 1;
  const other = texts.filter((t) => t.v !== r.name);
  if (other.length) { notName += 1; notNameInState += other.length; rows.push({ name: r.name, id: r.id, other, own: texts.filter((t) => t.v === r.name).length }); }
}
console.log('存档 ' + path.basename(file) + '　记录 ' + g.recs.length + '　带文本字段的记录 ' + n);
console.log('★★ 文本 **≠ 记录自己的名字** 的记录：' + notName + ' 个（字段 ' + notNameInState + ' 个）');
console.log('');
for (const r of rows.slice(0, ALL ? rows.length : 40)) {
  console.log('  ' + r.name + ' #' + r.id + '　（自身名字字段 ' + r.own + ' 个）');
  for (const t of r.other) console.log('        ' + t.path + ' = ' + JSON.stringify(t.v));
}
if (!rows.length) {
  console.log('★ 结论：★ **没有任何一条记录的文本内容不是它自己的名字** ⇒');
  console.log('  ⇒ ★ **`.gil` 存不下控件的文字内容** ✗（与项目 2026-09-28 的结论一致 ✓）');
  console.log('  ⇒ ★ 文字只能 ① 在编辑器里手填 ② 或由脚本运行时写 ✓');
} else {
  console.log('★ 结论：★ **`.gil` 里确实有"非名字"的文本内容** ✓ ⇒ 文本**能存** ✓（可以照这些字段的位置填 ✓）');
}
