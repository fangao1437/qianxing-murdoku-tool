// tools/gil/fix_btn_bg_component.mjs —— 给按钮的 `bg` **补上缺失的 `#12` 图片分量声明**
//
// ── 为什么需要它（2026-10-09 真机 + 存档实测 ✓）────────────────────────────
// 用户：「弹窗四键**还没有图文**」✗
//
// 逐字段对照（`_probe_502.mjs` 实测 ✓）：
//
//   | 控件            | `.bg` 的分量 | `.label` 的分量 |
//   |-----------------|--------------|-----------------|
//   | action.back ✓   | **#11, #12** | #11             |   ← 真机上文字正常 ✓
//   | home.select ✓   | **#11, #12** | #11             |
//   | home.bag ✓      | **#11, #12** | #11             |
//   | **四键** ✗      | **只有 #11** | #11             |
//
//   ⇒ ★ **四键的 `bg` 少了 `#12`** —— 那条正是**图片分量**（`#502[1] = {#12:{#501:18} #501:2 #502:6}`）✓
//     而**图片数据本身早就在**（`gen_btn_art.mjs` 写的 `#505→#503→#84`，imageId=**107179** ✓
//     `bake_bg_image.mjs --dump` 实测 ✓）
//   ⇒ ★ 也就是说：**图配了、但引擎不知道有这个图片分量** ⇒ 从不实例化 ⇒ **画面上什么都没有** ✓
//     （这解释了为什么"图上其实写了 107179"和"真机没图"能同时成立 ✓）
//
//   ⚠️ 而 `.label` 两边**结构完全一样** ⇒ 文字那半**不是结构问题** ✓
//      （真机日志里 `action.back` 那种「想要 X → 读回 X」的回读，四键没做过 ⇒ 待查 ✓）
//
// ── 改法（★ 最保守的一类：**只追加一个字段** ✓ 不删任何东西 ✓）──────────
//   1. 从存档里找一个**同时有 `#11` 和 `#12`** 的 `bg` 当模板（`action.back.bg` 等 ✓）
//   2. 克隆它的那个 `#12` 条目
//   3. **追加**到目标 `bg` 的字段表末尾
//   4. 复读核对 + 必须 `roundtrip` 逐字节 ✓
//
//   ★ 为什么不用改 id：那个条目里的 `#501` 是**常量 18**（不是记录 id ✓ 实测）
//     ⇒ 克隆过来**原样可用** ✓ 不需要 `gen_btn_art.mjs` 那套 id 改写 ✓
//
// 用法：
//   node tools/gil/fix_btn_bg_component.mjs --in=<存档> --dump
//   node tools/gil/fix_btn_bg_component.mjs --in=<存档> --out=<输出> [--keys=modal.exit,modal.save,...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg, cloneField, pairOf, pairValue, stateBlocks } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const P = (p) => (p == null ? null : (path.isAbsolute(p) ? p : path.resolve(ROOT, p)));

const IN = P(arg('in'));
const OUT = P(arg('out', arg('in')));
const DUMP = argv.includes('--dump');
const KEYS = (arg('keys') || 'modal.exit,modal.save,modal.settle,modal.cancel').split(',').map((s) => s.trim()).filter(Boolean);
// 用来当模板的"已知正常"的按钮（真机日志证明它们有图有字 ✓）
const REFS = (arg('refs') || 'action.back,home.select,home.bag,action.undo,action.redo').split(',').map((s) => s.trim());

if (!IN) { console.error('用法: node tools/gil/fix_btn_bg_component.mjs --in=<存档> [--out=<输出>] [--dump]'); process.exit(1); }

const g = readGil(IN);
console.log('存档：' + path.basename(IN) + '（' + g.src.length + ' 字节，记录 ' + g.recs.length + ' 条）');

// ── 取一个控件的子控件 ─────────────────────────────────────────────────────
const childOf = (name, cname) => {
  const rec = g.byName.get(name);
  if (!rec) return null;
  return g.recs.find((r) => r.parentId === rec.id && r.name === cname) || null;
};
// ── 这个控件的 `#502` 分量里有哪些种类（`#11` / `#12` …）──────────────────
const compsOf = (rec) => {
  const out = [];
  for (const f of ((rec.field && rec.field.sub) || [])) {
    if (f.field !== 502) continue;
    const k = (f.sub || []).find((s) => s.wt === 2 && s.field >= 11 && s.field <= 20);
    out.push(k ? k.field : 0);
  }
  return out;
};
const geo = (rec) => {
  const o = []; stateBlocks(rec.field.sub, o);
  if (!o[0]) return '（无状态块）';
  return 'pos=(' + pairValue(pairOf(o[0], 504), 0) + ',' + pairValue(pairOf(o[0], 504), 1) + ')'
    + ' size=(' + pairValue(pairOf(o[0], 505), 0) + '×' + pairValue(pairOf(o[0], 505), 1) + ')';
};

console.log('\n── 改前 ──');
for (const k of KEYS) {
  const bg = childOf(k, 'bg');
  if (!bg) { console.log('  ✗ ' + k + '.bg 不存在'); continue; }
  const cs = compsOf(bg);
  console.log('  ' + k.padEnd(14) + ' bg#' + bg.id + '  ' + geo(bg)
    + '   #502 分量=' + cs.map((c) => '#' + c).join(',') + (cs.includes(12) ? '  ✓有图' : '  ✗**缺 #12**'));
}
console.log('  —— 对照（真机正常）——');
for (const r of REFS) {
  const bg = childOf(r, 'bg');
  if (!bg) continue;
  console.log('  ' + r.padEnd(14) + ' bg#' + bg.id + '  #502 分量=' + compsOf(bg).map((c) => '#' + c).join(','));
}

if (DUMP) { console.log('\n（--dump 模式，未写文件）'); process.exit(0); }

// ── 找一个 `#12` 模板 ──────────────────────────────────────────────────────
let tmpl12 = null, tmplFrom = null;
for (const r of REFS) {
  const bg = childOf(r, 'bg');
  if (!bg) continue;
  const f = ((bg.field && bg.field.sub) || []).find((x) => x.field === 502
    && (x.sub || []).some((s) => s.wt === 2 && s.field === 12));
  if (f) { tmpl12 = f; tmplFrom = r; break; }
}
if (!tmpl12) { console.error('\n❌ 在参照按钮里找不到带 `#12` 的 `bg` —— 换 --refs= 再试'); process.exit(2); }
console.log('\n`#12` 模板取自：' + tmplFrom + '.bg ✓');

let fixed = 0, skipped = 0;
for (const k of KEYS) {
  const bg = childOf(k, 'bg');
  if (!bg) continue;
  if (compsOf(bg).includes(12)) { skipped++; continue; }        // ★ 幂等：已有就不动 ✓
  if (!bg.field.sub) bg.field.sub = [];
  bg.field.sub.push(cloneField(tmpl12));
  fixed++;
}
console.log('补上 `#12` 的 bg：' + fixed + ' 个（本来就有、没动的：' + skipped + ' 个）');

// ⚠️ 保存必须 `g.pack(encodeMsg(g.tree))` —— 项目里 15 个写档工具**全是这个写法** ✓
//   （`fix_palette_ids.mjs` 的注释记着「漏 body 会崩 ✗」；我第一版写成 `encodeMsg(g.top)` 就崩在这 ✓）
const buf = g.pack(encodeMsg(g.tree));
fs.writeFileSync(OUT, buf);
console.log('已写出：' + path.basename(OUT) + '（' + fs.statSync(OUT).size + ' 字节）');

// ── 复读核对（从磁盘重读 ✓）──────────────────────────────────────────────
const g2 = readGil(OUT);
console.log('\n── 复读核对（从磁盘重读）──');
let bad = 0;
for (const k of KEYS) {
  const rec = g2.byName.get(k);
  const bg = rec && g2.recs.find((r) => r.parentId === rec.id && r.name === 'bg');
  const cs = bg ? compsOf(bg) : [];
  const ok = cs.includes(12);
  if (!ok) bad++;
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + k.padEnd(14) + ' 分量=' + cs.map((c) => '#' + c).join(',')
    + '  ' + (bg ? geo(bg) : ''));
}
// 图片数据仍在（顺手确认没被碰掉 ✓）
const IMG_PATH = [503, 84, 503];
const fieldsAtPath = (fields, p) => {
  let level = [fields];
  for (let i = 0; i < p.length; i++) {
    const hits = [];
    for (const list of level) for (const f of list) if (f.field === p[i]) hits.push(f);
    if (!hits.length) return [];
    if (i === p.length - 1) return hits;
    level = hits.map((f) => f.sub).filter(Boolean);
    if (!level.length) return [];
  }
  return [];
};
for (const k of KEYS) {
  const rec = g2.byName.get(k);
  const bg = rec && g2.recs.find((r) => r.parentId === rec.id && r.name === 'bg');
  if (!bg) continue;
  let idv = '—';
  for (const f of ((bg.field && bg.field.sub) || [])) {
    if (f.field !== 505 || !f.sub) continue;
    const hit = fieldsAtPath(f.sub, IMG_PATH)[0];
    if (hit) { idv = String(hit.num); break; }
  }
  console.log('  · ' + k.padEnd(14) + ' 图片数据 imageId=' + idv + '（应仍为 107179 ✓）');
}

console.log('\n' + (bad === 0 ? '★ 全部 ' + KEYS.length + ' 个键的 bg 都有图片分量了 ✓' : '❌ 还有 ' + bad + ' 个没补上'));
console.log('⚠️ 交付前**必须**跑：node tools/gil/roundtrip.mjs ' + path.basename(OUT));
process.exit(bad === 0 ? 0 : 3);
