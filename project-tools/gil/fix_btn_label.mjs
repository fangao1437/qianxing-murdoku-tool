// tools/gil/fix_btn_label.mjs —— 四键的 `label`：**加居中** ＋ **字色改黑**
//
// ════════════════════════════════════════════════════════════════════════════
// 用户原话（四键出图之后 ✓）：「现在就是把**字放到按钮中间**，然后**颜色改成黑丝**」
//   （"黑丝"按"**黑色**"理解 ✓）
// ════════════════════════════════════════════════════════════════════════════
//
// 字段路径与语义（★ 资料员查的 ✓ 我**逐项复测过** ✓ 数字全对上 ✓）
//
//   | 叶子 | 含义 | 官方 API | 官方枚举 / 取值 | 复测读数 |
//   |---|---|---|---|---|
//   | `/505/503/75/508` | **水平对齐** | `horizontalAlignment` ✓ 读写 | `Left=0 / Middle=1 / Right=2` | 44 条里 **10** 条有它，全部 `=1` ✓ |
//   | `/505/503/75/509` | **垂直对齐** | `verticalAlignment` ✓ 读写 | `Top=0 / Middle=1 / Bottom=2` | 同上，**同一批 10 条** ✓ |
//   | `/505/503/75/504` | **字色** | `fontColor` ✓ 读写 ✓ `ColorValue` | `0xAARRGGBB` | ★ **44/44 条都有** ✓ 白×42 ＋ 黑×2 ✓ |
//   | `/505/503/75/512` | 字号 | `fontSize` | — | 基准 24、四键 20（**本次不动** ✓ 用户没要求 ✓）|
//
//   ★ **508/509 缺 = 默认（左 / 上）** ✓ ⇒ protobuf 省略 0 ✓
//   ★ **哪些记录有它们**（10 条，语义切得干干净净 ✓）：
//       `content/note` · `clue/letter`×2 · `assets/row.1.1–1.5` · `action.back/label`
//       ⇒ ★ **全是"内容居中"那一类** ✓ 而 `clue/who` / `clue/what` / `hud.*` / `modal.*` 全缺
//         ⇒ ★ 与用户"四键的字没居中"**完全一致** ✓
//
// ⚠️⚠️ **一个关键澄清：不是"label 太宽"的问题** ✗（我一开始以为 559 > 312 是原因 ✓）
//   资料员实测几何 ✓：四键的 `label` 与正常的 `action.back/label` **完全同构** ——
//     位置都缺（=0,0）✓ 锚点 min=max=`0.5` ✓ pivot=`0.5` ✓
//     ⇒ ★ **那个 559 宽的框【本身就居中在按钮上】** ✓（定位靠锚点，与宽度无关 ✓）
//     ⇒ ★ 偏的是**框里的字** ✗：缺对齐 ⇒ 字从**框的左边缘**起排
//       ⇒ 框宽 559 ⇒ 字起点在按钮中心**左侧约 279.5 px** ✗✓ **这正是用户看到的"没居中"** ✓
//   ⇒ ★ **所以只改对齐就够，尺寸 559×40 不用动** ✓
//   ★ 顺带闭环 ✓：`home.*` 的 label 也缺对齐，但只有 **59 px 宽** ⇒ 24 号字几乎填满
//     ⇒ **左对齐与居中在视觉上分不出来** ✓ ⇒ **只有四键看起来没居中** ✓
//
// 改法（★ 最保守：能只改值的就只改值 ✓）
//   · `504` **已存在** ⇒ ★ **只改值**（`4294967295` → `4278190080` ✓ 最高优先级那种改法 ✓）
//   · `508` / `509` **缺** ⇒ **追加**（从 `action.back.label` 克隆 ✓ 它是"居中"的现成样本 ✓）
//
// 用法：
//   node tools/gil/fix_btn_label.mjs --in=<存档> --dump
//   node tools/gil/fix_btn_label.mjs --in=<存档> --out=<输出>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg, cloneField, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const P = (p) => (p == null ? null : (path.isAbsolute(p) ? p : path.resolve(ROOT, p)));

const IN = P(arg('in'));
const OUT = P(arg('out', arg('in')));
const DUMP = argv.includes('--dump');
const KEYS = (arg('keys') || 'modal.exit,modal.save,modal.settle,modal.cancel').split(',').map((s) => s.trim()).filter(Boolean);
const REF = arg('ref', 'action.back');            // ★ 现成的"居中 + 已知正常"样本 ✓

const TEXT_NODE = [505, 503, 75];                 // ★ 文字属性组（`fontColor`/对齐/字号/文本 都在这里 ✓）
const L_ALIGN = 508;                              //   水平对齐 ⇒ 1 = Middle
const V_ALIGN = 509;                              //   垂直对齐 ⇒ 1 = Middle
const F_COLOR = 504;                              //   字色 ⇒ ColorValue
const BLACK = 4278190080;                         // ★ 0xFF000000 ✓（同存档先例：`content/note` ✓）

if (!IN) { console.error('用法: node tools/gil/fix_btn_label.mjs --in=<存档> [--out=<输出>] [--dump]'); process.exit(1); }

const g = readGil(IN);
console.log('存档：' + path.basename(IN) + '（记录 ' + g.recs.length + ' 条）');

function nodesAt(fields, p) {
  let level = fields;
  for (let i = 0; i < p.length; i++) {
    const hits = level.filter((f) => f.field === p[i] && f.sub);
    if (i === p.length - 1) return hits;
    level = hits.flatMap((f) => f.sub);
  }
  return [];
}
const childOf = (name, cname) => {
  const rec = g.byName.get(name);
  if (!rec) return null;
  return g.recs.find((r) => r.parentId === rec.id && r.name === cname) || null;
};
const textNodeOf = (rec) => nodesAt(rec && rec.field && rec.field.sub, TEXT_NODE)[0] || null;
const leafOf = (rec, fno) => {
  const nd = textNodeOf(rec);
  if (!nd) return null;
  return (nd.sub || []).find((f) => f.field === fno && f.wt === 0) || null;
};
const geo = (rec) => {
  const o = []; stateBlocks(rec.field.sub, o);
  if (!o[0]) return '（无状态块）';
  return 'pos=(' + pairValue(pairOf(o[0], 504), 0) + ',' + pairValue(pairOf(o[0], 504), 1) + ')'
    + ' size=(' + pairValue(pairOf(o[0], 505), 0) + '×' + pairValue(pairOf(o[0], 505), 1) + ')';
};
const snapshot = (c) => '508=' + (leafOf(c, L_ALIGN) ? String(leafOf(c, L_ALIGN).num) : '缺')
  + '  509=' + (leafOf(c, V_ALIGN) ? String(leafOf(c, V_ALIGN).num) : '缺')
  + '  504(字色)=' + (leafOf(c, F_COLOR) ? String(leafOf(c, F_COLOR).num) : '缺')
  + '  512(字号)=' + (leafOf(c, 512) ? String(leafOf(c, 512).num) : '缺');

// ── 基准：从"居中且正常"的按钮上取现成的对齐叶子 ✓ ───────────────────────
const refLabel = childOf(REF, 'label');
if (!refLabel) { console.error('✗ 找不到基准 ' + REF + '.label'); process.exit(2); }
const refH = leafOf(refLabel, L_ALIGN), refV = leafOf(refLabel, V_ALIGN);
if (!refH || !refV) {
  console.error('✗ 基准 ' + REF + '.label 里没有 505/503/75/508 或 509 —— 换个 --ref= 再试');
  process.exit(2);
}
console.log('基准：' + REF + '.label  #' + refLabel.id + '  ' + snapshot(refLabel) + '  ✓（它就是"居中"的现成样本）');

console.log('\n── 改前 ──');
for (const k of KEYS) {
  const lb = childOf(k, 'label');
  if (!lb) { console.log('  ✗ ' + k + '.label 不存在'); continue; }
  console.log('  ' + k.padEnd(14) + ' label#' + lb.id + '  ' + geo(lb) + '  ' + snapshot(lb));
}

if (DUMP) { console.log('\n（--dump 模式，未写文件）'); process.exit(0); }

// ── 写 ──────────────────────────────────────────────────────────────────────
let addedAlign = 0, setColor = 0;
for (const k of KEYS) {
  const lb = childOf(k, 'label');
  if (!lb) continue;
  const nd = textNodeOf(lb);
  if (!nd) { console.error('  ✗ ' + k + '.label 里找不到 /505/503/75'); continue; }
  if (!nd.sub) nd.sub = [];
  // ① 对齐：缺才追加 ✓（已有就不动 ✓ 幂等 ✓）
  if (!leafOf(lb, L_ALIGN)) { nd.sub.push(cloneField(refH)); addedAlign++; }
  if (!leafOf(lb, V_ALIGN)) { nd.sub.push(cloneField(refV)); addedAlign++; }
  // ② 字色：★ 已存在 ⇒ **只改值** ✓（不改结构 ✓ 最高优先级那种改法 ✓）
  const cf = leafOf(lb, F_COLOR);
  if (cf) { cf.num = BigInt(BLACK); setColor++; }
  else { console.error('  ⚠️ ' + k + '.label 没有 504（字色）—— 本轮不新造，跳过'); }
}
console.log('\n加了对齐叶子 ' + addedAlign + ' 个（水平+垂直 × 4 键 = 8 ✓）');
console.log('字色改成黑 ' + setColor + ' 个（只改值，不动结构 ✓）');

const buf = g.pack(encodeMsg(g.tree));
fs.writeFileSync(OUT, buf);
console.log('已写出：' + path.basename(OUT) + '（' + fs.statSync(OUT).size + ' 字节）');

// ── 复读核对（★ 从磁盘重读 ✓）──────────────────────────────────────────────
const g2 = readGil(OUT);
console.log('\n── 复读核对（从磁盘重读）──');
let bad = 0;
for (const k of KEYS) {
  const rec = g2.byName.get(k);
  const lb = rec && g2.recs.find((r) => r.parentId === rec.id && r.name === 'label');
  const h = lb && leafOf(lb, L_ALIGN), v = lb && leafOf(lb, V_ALIGN), c = lb && leafOf(lb, F_COLOR);
  const ok = h && v && String(h.num) === '1' && String(v.num) === '1' && c && String(c.num) === String(BLACK);
  if (!ok) bad++;
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + k.padEnd(14) + ' ' + (lb ? snapshot(lb) : '（没有 label）')
    + '  ' + (lb ? geo(lb) : ''));
}
// 尺寸**不该动** ✓（用户只要求居中与颜色 ✓ 而"偏心"与宽度无关 ✓）
console.log('\n  ⓘ 尺寸**故意没动** ✓ —— 资料员实测：那个 559 宽的框本身就居中在按钮上 ✓');
console.log('     （定位靠锚点 min=max=0.5 与 pivot=0.5 ✓ 与宽度无关 ✓ 偏的是框里的字 ✓）');
console.log('\n' + (bad === 0 ? '★ 四键的 label 都居中 + 都改黑了 ✓' : '❌ 还有 ' + bad + ' 个不对'));
console.log('⚠️ 交付前**必须**跑：node tools/gil/roundtrip.mjs ' + path.basename(OUT));
console.log('复验建议：node tools/gil/_cmp_child.mjs ' + path.basename(OUT) + ' label ' + REF);
process.exit(bad === 0 ? 0 : 3);
