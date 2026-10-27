// tools/gil/_modal_geom.mjs —— 改 **弹窗四键 / 其 bg / 其 label** 的几何（只改值，不增不删记录）
//
// 为什么单独写一个（不用 set_positions.mjs）：
//   `set_positions.mjs` 只写**位置**，而且数据源是 `layout-plan.json` ——
//   而 `bg` / `label` **根本不在 plan 里**（它们是我用 `gen_btn_art.mjs` 直接写进 .gil 的子控件，
//   plan 只认外层名）⇒ `set_positions.mjs` **碰不到它们** ✗
//   本工具按「父名 → parentId → 子记录」定位（★ 不能按名字找 ✗：
//     四个键各有一个叫 `bg`、一个叫 `label` 的子控件 ⇒ `byName` 里重名 ✓）
//
// 纪律（照抄项目里改 .gil 的四条）：
//   · **只改值** —— 不新增/不删除任何记录或字段（优先级最高的那种改法 ✓）
//   · **每个状态块都改**（`stateBlocks()` —— 只改第一块 ⇒ 其它状态还是旧值 ✗）
//   · 改完**必须复读核对**（内存断言过 ≠ 落盘过 ✗）
//   · 交付前**必须跑** `node tools/gil/roundtrip.mjs <文件>`（逐字节可重编码闸门 ✓）
//
// 用法：
//   node tools/gil/_modal_geom.mjs --gil=<输入> --dump                 # 只看
//   node tools/gil/_modal_geom.mjs --gil=<输入> --out=<输出> --set     # 改并写新档

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg, pairOf, pairValue, setPair, stateBlocks } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const h = process.argv.find((s) => s.startsWith('--' + k + '=')); return h ? h.slice(k.length + 3) : d; };
const P = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

const GIL = P(arg('gil'));
const OUT = P(arg('out', arg('gil')));
const DO_SET = process.argv.includes('--set');

if (!GIL) { console.error('用法: node tools/gil/_modal_geom.mjs --gil=<文件> [--dump] [--out=<文件> --set]'); process.exit(1); }

// ── 目标几何 ────────────────────────────────────────────────────────────────
// 坐标系（`set_positions.mjs` + `gilread.mjs` 的注释，真机验证过）：
//   `.gil` 存的是**相对屏幕中心 (800,450) 的偏移** ⇒ 控件位置 = (cx − 800, cy − 450) ✓
//   画布空间 1600×900，Y 向上、原点左下 ✓
//
// 设计稿 B（用户 2026-10-09 拍板）：
//   四键 **312×60**、cx = **800**（面板水平居中）、cy = **570 / 490 / 410 / 330**
//   面板 `modal` = 633×383 @ (800,450) ⇒ 相对面板中心 = (0,+120)(0,+40)(0,−40)(0,−120) ✓ pitch 80 ✓
//   原值实测：pos=(0,+50)(0,−20)(0,−90)(0,−160)、size=480×56 ⇒ **pitch 70、且偏下** ✓
const KEYS = [
  { name: 'modal.exit',   dy:  120 },
  { name: 'modal.save',   dy:   40 },
  { name: 'modal.settle', dy:  -40 },
  { name: 'modal.cancel', dy: -120 },
];
const KEY_W = 312, KEY_H = 60;
// ★ `label` **只改高度、不动宽度**（保守且够用 ✓）
//   为什么只改高 ✓：真机症状是「**有框没字 / 一个字都不画**」——
//     根因是 **24 号字行高 ≈ 36，而 label 只有 20 高** ⇒ **整行被裁** ✓
//     ⇒ 把高提到 **40**（> 36 ✓）就解决了 ✓
//   ⚠️ 为什么不动宽 ✗：实测宽是 **559 / 125**（`cancel`），而按钮只有 480 / 160
//     —— **本来就比按钮宽** ✓ 说明它一直是"文字框自然宽度"（靠居中显示 ✓）
//     擅自收窄反而可能让长文案（「存档并结算」）被裁 ✗ ⇒ **不碰** ✓
const LABEL_H = 40;

const g = readGil(GIL);
console.log('读入 ' + path.relative(ROOT, GIL) + '  ' + Math.round(fs.statSync(GIL).size / 1024) + ' KB');

/** 按「父记录 → parentId + 名字」定位子控件（★ 不能按名字找：四键各有一个 bg / label 重名 ✗） */
function childOf(parentRec, cname) {
  return g.recs.find((r) => r.parentId === parentRec.id && r.name === cname) || null;
}
const blocksOf = (rec) => { const o = []; stateBlocks(rec.field.sub, o); return o; };
const geom = (rec) => {
  const bs = blocksOf(rec);
  return bs.map((b) => ({
    b,
    x: pairValue(pairOf(b, 504), 0), y: pairValue(pairOf(b, 504), 1),
    w: pairValue(pairOf(b, 505), 0), h: pairValue(pairOf(b, 505), 1),
  }));
};

console.log('\n══ 改前（每个控件 4 个状态块，只列第一块）══');
for (const k of KEYS) {
  const rec = g.byName.get(k.name);
  if (!rec) { console.log('  ✗ 找不到 ' + k.name); continue; }
  for (const [nm, r] of [[k.name, rec], ['  .bg', childOf(rec, 'bg')], ['  .label', childOf(rec, 'label')]]) {
    if (!r) { console.log('  ✗ 找不到 ' + nm); continue; }
    const gs = geom(r);
    console.log('  ' + nm.padEnd(18) + ' 块=' + gs.length
      + '  pos=(' + gs[0].x + ',' + gs[0].y + ')  size=(' + gs[0].w + '×' + gs[0].h + ')');
  }
}

if (!DO_SET) { console.log('\n（--dump 模式，未写文件）'); process.exit(0); }

// ── 写值（只改值 ✓）─────────────────────────────────────────────────────────
// ⚠️ `setPair(pr, x, y)` 对 **0 分量会省略该字段** —— 这正是引擎的写法 ✓
//    （中心对齐的 x=0 会被省掉，`pairValue` 读回来仍是 0 ✓ 见 gilread.mjs:240 那段 ✓）
let touched = 0;
function apply(rec, x, y, w, h) {
  if (!rec) return false;
  for (const gg of geom(rec)) {
    const pp = pairOf(gg.b, 504), sp = pairOf(gg.b, 505);
    if (pp) setPair(pp, x, y);
    if (sp) setPair(sp, w, h);
  }
  touched++;
  return true;
}

const log = [];
for (const k of KEYS) {
  const rec = g.byName.get(k.name);
  if (!rec) { console.log('  ✗ 跳过 ' + k.name); continue; }
  const x = 800 - 800;              // cx = 800 ⇒ 相对中心 x = 0
  const y = (450 + k.dy) - 450;     // = 设计稿 cy − 450
  // ★★ **只有键自己要挪位置** ✓ —— `bg` / `label` 的 pos 实测是 **(0,0)**
  //    = "贴在父控件中心" ✓（父子相对坐标 ✓）⇒ **它们的 pos 一个字都不能改** ✗
  //    我第一版把键的 y 也传给了子控件 ⇒ 会把底图/文字**从按钮中心推开** ✗✓（自查发现 ✓）
  apply(rec, x, y, KEY_W, KEY_H);
  const bg = childOf(rec, 'bg');
  apply(bg, 0, 0, KEY_W, KEY_H);    // 底图与按钮**同尺寸**（原来 480×56 > 新按钮 312 ✗）；pos 保持 (0,0)
  const lb = childOf(rec, 'label');
  if (lb) {
    const cur = geom(lb)[0];
    apply(lb, 0, 0, cur.w, LABEL_H);   // ★ 宽不变、只把高 20 → 40 ✓；pos 保持 (0,0)
    log.push(k.name + '.label 宽保持 ' + cur.w + '，高 ' + cur.h + ' → ' + LABEL_H);
  }
}
console.log('\n共改 ' + touched + ' 个控件（各自全部状态块）');
for (const l of log) console.log('  · ' + l);

const buf = g.pack(encodeMsg(g.tree));
fs.writeFileSync(OUT, buf);
console.log('写出 ' + path.relative(ROOT, OUT) + '  ' + Math.round(buf.length / 1024) + ' KB');

// ── 复读核对（★ 不能只信内存 ✓）────────────────────────────────────────────
console.log('\n══ 复读核对（重新 readGil 读盘）══');
const g2 = readGil(OUT);
let bad = 0;
const check = (nm, rec2, want) => {
  if (!rec2) { console.log('  ✗ ' + nm + ' 复读找不到'); bad++; return; }
  const gs = (() => { const o = []; stateBlocks(rec2.field.sub, o); return o.map((b) => ({
    x: pairValue(pairOf(b, 504), 0), y: pairValue(pairOf(b, 504), 1),
    w: pairValue(pairOf(b, 505), 0), h: pairValue(pairOf(b, 505), 1) })); })();
  const ok = gs.length > 0 && gs.every((v) => v.x === want.x && v.y === want.y && v.w === want.w && v.h === want.h);
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + nm.padEnd(22) + ' pos=(' + want.x + ',' + want.y + ') size=(' + want.w + '×' + want.h + ')  [' + gs.length + ' 块]'
    + (ok ? '' : '  实际 ' + JSON.stringify(gs[0])));
  if (!ok) bad++;
};
for (const k of KEYS) {
  const x = 0, y = (450 + k.dy) - 450;
  const rec2 = g2.byName.get(k.name);
  check(k.name, rec2, { x, y, w: KEY_W, h: KEY_H });
  if (rec2) {
    // ★ 子控件的 pos 必须仍是 **(0,0)**（贴在父中心 ✓）—— 见上面写值那段的长注释 ✓
    const bg2 = g2.recs.find((r) => r.parentId === rec2.id && r.name === 'bg');
    check('  ' + k.name + '.bg', bg2, { x: 0, y: 0, w: KEY_W, h: KEY_H });
    const lb2 = g2.recs.find((r) => r.parentId === rec2.id && r.name === 'label');
    const r0 = g.byName.get(k.name);
    const l0 = r0 ? g.recs.find((r) => r.parentId === r0.id && r.name === 'label') : null;
    if (lb2 && l0) check('  ' + k.name + '.label', lb2, { x: 0, y: 0, w: geom(l0)[0].w, h: LABEL_H });
  }
}
console.log(bad === 0 ? '\n★ 复读全过' : '\n✗ 有 ' + bad + ' 项不符 —— 产物不可交付');
process.exit(bad === 0 ? 0 : 1);
