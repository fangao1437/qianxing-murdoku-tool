// tools/gil/_probe_align.mjs —— ★ 只读：打印文本框的**水平/垂直对齐**（`/505/503/75/508` `509`）
//
//   ★ 口径（`fix_btn_label.mjs` 头部实测 ✓ 也是官方枚举 ✓）：
//     · `75/508` **水平**：★ `0=Left / 1=Middle / 2=Right` ✓（★ **缺 = 0 = 左** ✓ protobuf 省略 0 ✓）
//     · `75/509` **垂直**：★ `0=Top / 1=Middle / 2=Bottom` ✓（缺 = 0 = 上 ✓）
//   ★ 为什么需要它 ✓：★ "文字没居中"这类事**看不出来是哪个字段** ✗ ——
//     ★ 缺字段（= 左对齐）与显式写 0 在屏幕上**一模一样** ✗ ⇒ ★ 必须读原始值 ✓
//
// 用法：node tools/gil/_probe_align.mjs <存档.gil> <父/子 …>      例：home.select/label
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList, stateBlocks } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2];
const specs = process.argv.slice(3);
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kids = (r) => {
  const cl = findChildListTop(r.field.sub);
  return cl ? (asIdList(cl.payload, true) || []).map((i) => byId.get(Number(i))).filter(Boolean) : [];
};
function resolve(spec) {
  const i = spec.indexOf('/');
  if (i < 0) return g.recs.find((r) => r.name === spec) || null;
  const p = g.recs.find((r) => r.name === spec.slice(0, i));
  if (!p) return null;
  return kids(p).find((c) => c.name === spec.slice(i + 1)) || null;
}
/** 在状态块里找 `/75/508` `/75/509`（数字型叶子 ✓） */
function alignOf(blk) {
  let h = null, v = null;
  (function w(fs, in75) {
    for (const x of fs) {
      if (in75 && x.field === 508 && typeof x.num !== 'undefined') h = Number(x.num);
      if (in75 && x.field === 509 && typeof x.num !== 'undefined') v = Number(x.num);
      if (x.sub) w(x.sub, in75 || x.field === 75);
    }
  })(blk.sub, false);
  return { h, v };
}
const H = { 0: 'Left(左)', 1: 'Middle(居中)', 2: 'Right(右)' };
const V = { 0: 'Top(上)', 1: 'Middle(中)', 2: 'Bottom(下)' };
console.log('存档 ' + path.basename(file));
for (const s of specs) {
  const r = resolve(s);
  if (!r) { console.log('  ' + s + ' —— **不在** ✗'); continue; }
  const bl = []; stateBlocks(r.field.sub, bl);
  const a = bl.length ? alignOf(bl[0]) : { h: null, v: null };
  console.log('  ' + s.padEnd(24) + '#' + r.id + '　状态块 ' + bl.length
    + '　水平 508 = ' + (a.h === null ? '**缺** ⇒ ' + H[0] : a.h + ' ⇒ ' + (H[a.h] || '?'))
    + '　垂直 509 = ' + (a.v === null ? '缺 ⇒ ' + V[0] : a.v + ' ⇒ ' + (V[a.v] || '?')));
  if (bl.length > 1) {
    const uniq = new Set(bl.map((b) => JSON.stringify(alignOf(b))));
    if (uniq.size > 1) console.log('      ⚠️ 各状态块**不一致** ✗：' + [...uniq].join('  '));
  }
}
