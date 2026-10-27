// tools/gil/ensure_geom.mjs —— ★ 给"**状态块为空**"的记录补上一块几何（位置 + 尺寸）
//
//   ★★ 为什么需要它（2026-10-16 用户指令 ✓）：
//     ★ 用户原话 ✓：「★ **现在 root 的位置不在画布正中，你把它改到 800，450，
//       造成的位置偏移你也一并修正，避免后续添加时出现坐标偏移**」✓
//     ★ 实测 `394.gil`：★ `root #1073741846` **状态块 0 个** ✗ ——
//       ★ 也就是 `root` **在存档里根本没有位置/尺寸** ✓
//     ★ 而运行时是**脚本**把它撑成整屏（`ui_controller` 的 `root` 那条 ✓）⇒
//       ★ 屏幕上是对的 ✓，★ 但**编辑器里** `root` 不在画布正中 ✗
//       ⇒ ★ 后果（正是用户说的那件事 ✓）：★ 在编辑器里**新加到 `root` 下的控件**，
//         坐标是相对"编辑器认为的那个 root 位置"写的 ✗ ⇒ ★ 运行时会整体偏移 ✗
//
//   ★ 做法 ✓：★ 从另一条**同类记录**（默认 `win`，也是个容器 ✓）**克隆一整块状态块** ✓，
//     再把 `#504`（位置对 ✓）与 `#505`（尺寸对 ✓）写成目标值 ✓
//   ⚠️ 位置/尺寸的单位 = **画布 px**（1600×900 ✓ 与 `.gil` 其余记录同一套 ✓）；
//      ★ `#504 = 控件中心 − 画布中心`（`y` 向上 ✓）⇒ **画布正中就是 (0,0)** ✓✓
//
// 用法：
//   node tools/gil/ensure_geom.mjs --in=<存档> --out=<输出> [--name=root] [--from=win] [--size=1600x900] [--pos=0,0] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg, cloneField, stateBlocks, pairOf, setPair, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k, d) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : d; };
const DRY = argv.includes('--dry');
const IN = argOf('in'), OUT = argOf('out');
const NAME = argOf('name', 'root'), FROM = argOf('from', 'win');
const SIZE = argOf('size', '1600x900'), POS = argOf('pos', '0,0');
if (!IN || !OUT) { console.error('用法: node tools/gil/ensure_geom.mjs --in= --out= [--name=root] [--from=win] [--size=1600x900] [--pos=0,0] [--dry]'); process.exit(1); }

const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const g = readGil(P(IN));
const rec = g.recs.find((r) => r.name === NAME);
const src = g.recs.find((r) => r.name === FROM);
if (!rec) { console.error('✗ 找不到目标记录 ' + NAME); process.exit(2); }
if (!src) { console.error('✗ 找不到原型记录 ' + FROM); process.exit(2); }

const bl = []; stateBlocks(rec.field.sub, bl);
console.log('存档 ' + path.basename(P(IN)) + '　目标 ' + NAME + ' #' + rec.id + '　现有状态块 ' + bl.length);
if (bl.length > 0) {
  // ★ 已经有状态块 ⇒ 只改几何（不克隆 ✓ 免得盖掉别的东西 ✓）
  let n = 0;
  for (const b of bl) {
    const p = pairOf(b, 504); if (p) { setPair(p, Number(POS.split(',')[0]), Number(POS.split(',')[1])); n++; }
    const s = pairOf(b, 505); if (s) { setPair(s, Number(SIZE.split('x')[0]), Number(SIZE.split('x')[1])); }
  }
  console.log('  ★ 已有状态块 ⇒ 只改几何（位置块 ' + n + ' 个 ✓）');
} else {
  const sbl = []; stateBlocks(src.field.sub, sbl);
  if (!sbl.length) { console.error('✗ 原型 ' + FROM + ' 也没有状态块'); process.exit(2); }
  const tpl = sbl[0];                                  // ★ 拿原型的第一块当模板 ✓
  const zx = Number(POS.split(',')[0]), zy = Number(POS.split(',')[1]);
  const sw = Number(SIZE.split('x')[0]), sh = Number(SIZE.split('x')[1]);
  let built = 0;
  for (const b of sbl) {
    const c = cloneField(b);
    const p = pairOf(c, 504); if (p) setPair(p, zx, zy);
    const s = pairOf(c, 505); if (s) setPair(s, sw, sh);
    rec.field.sub.push(c);                             // ★ 追加到目标记录 ✓（与原型的第一块同构 ✓）
    built++;
  }
  console.log('  ★ 状态块为空 ⇒ 从 ' + FROM + ' 克隆 ' + built + ' 块（位置 ' + POS + '、尺寸 ' + SIZE + ' ✓）');
  if (built === 0) { console.error('✗ 一块都没建出来'); process.exit(2); }
}

if (DRY) { console.log('  （--dry：不落盘）'); process.exit(0); }
fs.writeFileSync(P(OUT), g.pack(encodeMsg(g.tree)));
console.log('已写出：' + path.basename(P(OUT)) + '（' + fs.statSync(P(OUT)).size + ' 字节）');

// ── 从磁盘重读断言 ──
const g2 = readGil(P(OUT));
const r2 = g2.recs.find((r) => r.name === NAME);
const b2 = []; stateBlocks(r2.field.sub, b2);
const p2 = b2[0] ? pairOf(b2[0], 504) : null;
const s2 = b2[0] ? pairOf(b2[0], 505) : null;
const wantX = Number(POS.split(',')[0]), wantY = Number(POS.split(',')[1]);
const wantW = Number(SIZE.split('x')[0]), wantH = Number(SIZE.split('x')[1]);
const okP = p2 && Math.abs(pairValue(p2, 0) - wantX) < 0.01 && Math.abs(pairValue(p2, 1) - wantY) < 0.01;
const okS = s2 && Math.abs(pairValue(s2, 0) - wantW) < 0.01 && Math.abs(pairValue(s2, 1) - wantH) < 0.01;
console.log('\n── 复读核对（从磁盘重读）──');
console.log('  ' + (b2.length ? '✅' : '❌') + ' ' + NAME + ' 状态块 = ' + b2.length);
console.log('  ' + (okP ? '✅' : '❌') + ' 位置 = ' + (p2 ? '(' + pairValue(p2, 0) + ',' + pairValue(p2, 1) + ')' : '?')
  + '（期望 (' + wantX + ',' + wantY + ') = 画布正中 ✓）');
console.log('  ' + (okS ? '✅' : '❌') + ' 尺寸 = ' + (s2 ? pairValue(s2, 0) + '×' + pairValue(s2, 1) : '?'));
console.log('\n' + (b2.length && okP && okS ? '★ 成功 ✓' : '❌ 有问题'));
process.exit(b2.length && okP && okS ? 0 : 3);
