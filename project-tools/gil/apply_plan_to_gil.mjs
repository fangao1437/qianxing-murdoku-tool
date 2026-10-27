// tools/gil/apply_plan_to_gil.mjs —— ★ 把**规划里的位置/尺寸**批量写进 `.gil`（"几何归编辑器"之后的收口）
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么需要它（2026-10-16 立 ✓ 用户原话：「直接从 gil 侧给他们改到规划位置」）
// ════════════════════════════════════════════════════════════════════════════
//   ★ v248 起「几何归编辑器」⇒ ★ **存档里那份就是运行时那份** ✓
//     ⇒ ★ 于是每一处"存档 ≠ 规划"的地方，都**直接变成屏幕上的错位** ✗
//   ★ 而 v248 之前，脚本每帧把**规划值**盖上去 ⇒ ★ 这些不一致**全都看不见** ✗✓
//   ⇒ ★★ 本工具做的事 ✓：★ **把规划值写进存档**（= 把"以前脚本兜的那层"补进数据 ✓）
//
// ★★ 但**不能全都改** ✗ —— ★ 用户**特意改过**的那些，存档值才是对的 ✓
//   ⇒ ★ 排除名单写死在 `SKIP` 里（每条都带理由 ✓ 见下 ✓）
//
// ★ 坐标口径 ✓：★ 规划 `cx/cy` = 编辑器的"位置 X,Y"（**原点左下** ✓）
//   ★ `.gil` 的 `#504` = **控件中心 − 画布中心**（画布 1600×900、y 向上 ✓）
//   ⇒ ★ 写进去的是 `(cx − 800, cy − 450)` ✓ 尺寸直接抄 ✓
//
// ★ 用法：
//   node tools/gil/apply_plan_to_gil.mjs --in=<存档.gil> --out=<输出.gil> \
//        [--plan=tools/sim/out/layout-plan.json] [--tol=2] [--dry]
//
// ★ 判据：★ 每个被写的记录都打印 `旧 → 新` ✓；落盘后**从磁盘重读**核对 ✓
//   ★ 收尾必跑：`node tools/gil/roundtrip.mjs <输出>` ＋ `_probe_plan_vs_gil.mjs <输出>` ✓
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg, stateBlocks, pairOf, pairValue, setPair } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k, d) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const IN = argOf('in'), OUT = argOf('out');
const PLAN = path.resolve(ROOT, argOf('plan', 'tools/sim/out/layout-plan.json'));
const TOL = Number(argOf('tol', '2'));
const DRY = argv.includes('--dry');
// ★ 只改这些前缀（★ 2026-10-16 加 ✓）：★ **不许全量刷** ✗ ——
//   ★ 一大批控件（`hud.*` / `hex.*` / `topbar` …）"存档 ≠ 规划"但**屏幕上是对的** ✓
//     （因为它们的**父级**在两边也不同 ✓ 相对关系自洽 ✓）⇒ ★ 拿规划盖会**把对的改坏** ✗✓
//   ⇒ ★ 只改**用户点名错位**的那一族 ✓
const ONLY = (argOf('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!IN || !OUT) { console.error('用法: node tools/gil/apply_plan_to_gil.mjs --in=<存档.gil> --out=<输出.gil> [--only=a.,b.] [--dry]'); process.exit(1); }
const CW = 1600, CH = 900;

// ★★★★★★★★ 排除名单（★ 用户**特意改过**的 ⇒ 存档值才是对的 ✓ 别拿规划盖掉 ✓）
const SKIP = {
  'select.card.1': '用户把四张卡缩到 90%（组中心缩放）',
  'select.card.2': '同上',
  'select.card.3': '同上',
  'select.card.4': '同上',
  'hit.select.card.1': '卡片命中层，必须与卡片同框',
  'hit.select.card.2': '同上',
  'hit.select.card.3': '同上',
  'hit.select.card.4': '同上',
  'clues.grid': '用户原话：「网格视窗的大小我已经改了」（360×490）',
  'clues.bg': '同上（线索区底板跟着网格）',
  'clues': '线索区整块：用户 2026-10-05 定「位置大小都是原本摆好的」⇒ 显式 pos_runtime=false',
  'settle.btn': '用户指令①：结算按钮挪到「提示」(hex.hint) 同位置',
  'stage': '棋盘框：本轮已按脚本原本写的 (100,20) 584×584 写进档 ✓ 与规划同值',
  'cell.1.1': '格子：几何按关卡 N 由脚本实算（pos_runtime/自建控件）⇒ 存档那份只当编辑器参照',
  'modal': '弹窗卡片：尺寸由规划给（633×600），位置居中；★ 见下"特例"',
};

const g = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));

// ① 名字 → 记录（★ 重名要报出来 ⇒ 那时必须换写法 ✓）
const byName = new Map(), dup = [];
for (const r of g.recs) if (r.name) { if (byName.has(r.name)) dup.push(r.name); else byName.set(r.name, r); }
if (dup.length) console.log('⚠️ 重名记录（本次跳过，需人工）：' + [...new Set(dup)].join(' '));

/** 确保某个状态块里有 #504 位置对（没有就**新建** —— `set_control_size` 做不到这一点 ✓） */
function ensurePair(block, fieldNo, beforeFieldNo) {
  let p = pairOf(block, fieldNo);
  if (p) return { pair: p, created: false };
  p = { field: fieldNo, wt: 2, sub: [], payload: null, len: 0, s1: 0 };
  const at = block.sub.findIndex((x) => x.field === beforeFieldNo);
  if (at >= 0) block.sub.splice(at, 0, p); else block.sub.push(p);
  return { pair: p, created: true };
}

const touched = [], skippedPresent = [], missing = [];
for (const n of plan.nodes) {
  if (SKIP[n.id]) { if (byName.has(n.id)) skippedPresent.push(n.id); continue; }
  if (ONLY.length && !ONLY.some((p) => n.id === p || n.id.startsWith(p))) continue;
  if (ONLY.length && n.id.slice(-1) === '.' && false) continue;
  const rec = byName.get(n.id);
  if (!rec) { missing.push(n.id); continue; }
  const bl = []; stateBlocks(rec.field.sub, bl);
  if (!bl.length) { missing.push(n.id + '(无状态块)'); continue; }
  const wantX = n.cx - CW / 2, wantY = n.cy - CH / 2;
  const before = [];
  let wrote = 0, created = 0;
  for (const b of bl) {
    const pos = ensurePair(b, 504, 505);
    const sz = ensurePair(b, 505, 506);
    if (pos.created) created += 1;
    const oldX = pairValue(pos.pair, 0), oldY = pairValue(pos.pair, 1);
    const oldW = pairValue(sz.pair, 0), oldH = pairValue(sz.pair, 1);
    const same = Math.abs(oldX - wantX) <= TOL && Math.abs(oldY - wantY) <= TOL
      && Math.abs(oldW - n.w) <= TOL && Math.abs(oldH - n.h) <= TOL;
    before.push({ oldX, oldY, oldW, oldH });
    if (same) continue;
    setPair(pos.pair, wantX, wantY);
    setPair(sz.pair, n.w, n.h);
    wrote += 1;
  }
  if (wrote === 0) continue;
  touched.push({ id: n.id, recId: rec.id, blocks: bl.length, wrote, created, wantX, wantY, w: n.w, h: n.h, before: before[0],
    parent: n.parent || null });
  const b0 = before[0];
  console.log('  ✎ ' + n.id.padEnd(24) + '#' + rec.id + '  块 ' + bl.length + ' 改 ' + wrote
    + (created ? '（新建位置对 ' + created + '）' : '')
    + '\n      位置 (' + b0.oldX.toFixed(1) + ',' + b0.oldY.toFixed(1) + ') → (' + wantX + ',' + wantY + ')'
    + '　尺寸 ' + b0.oldW + '×' + b0.oldH + ' → ' + n.w + '×' + n.h);
}

console.log('\n★ 改写 ' + touched.length + ' 个控件；★ 排除名单命中 ' + skippedPresent.length
  + ' 个；★ 规划里有但存档里没有（跳过）' + missing.length + ' 个');
console.log('  排除名单：' + Object.keys(SKIP).filter((k) => skippedPresent.includes(k)).join(' '));
if (DRY) { console.log('（--dry：没有落盘 ✓）'); process.exit(0); }

fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
console.log('\n已写出：' + path.basename(OUT) + '（' + fs.statSync(OUT).size + ' 字节）');

// ── 从磁盘重读断言（项目铁律 ✓）──
const g2 = readGil(OUT);
let bad = 0;
for (const t of touched) {
  const rec = g2.recs.find((r) => r.id === t.recId);
  if (!rec) { console.log('  ❌ ' + t.id + ' 没了'); bad += 1; continue; }
  const bl = []; stateBlocks(rec.field.sub, bl);
  const ok = bl.every((b) => {
    const p = pairOf(b, 504), s = pairOf(b, 505);
    return p && s && Math.abs(pairValue(p, 0) - t.wantX) <= 0.01 && Math.abs(pairValue(p, 1) - t.wantY) <= 0.01
      && Math.abs(pairValue(s, 0) - t.w) <= 0.01 && Math.abs(pairValue(s, 1) - t.h) <= 0.01;
  });
  if (!ok) bad += 1;
}
console.log(bad === 0 ? '★ 复读核对：' + touched.length + ' 个全部写对 ✓' : '❌ 复读不对的 ' + bad + ' 个');
console.log('⚠️ 收尾必跑：node tools/gil/roundtrip.mjs ' + path.basename(OUT)
  + '　＋　node tools/gil/_probe_plan_vs_gil.mjs ' + path.basename(OUT));
process.exit(bad === 0 ? 0 : 3);
