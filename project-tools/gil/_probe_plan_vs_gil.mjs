// tools/gil/_probe_plan_vs_gil.mjs —— ★ 只读：**.gil 的原始坐标** vs **规划（layout-plan.json）**逐控件对账
//
// ════════════════════════════════════════════════════════════════════════════
// ★★★ 为什么必须有它（2026-10-16 立 ✓ 修完"首页四键"之后立刻要的下一件事）
// ════════════════════════════════════════════════════════════════════════════
//   ★ 背景 ✓：★ v248 起「几何归编辑器」⇒ ★ 存档里那份**就是**运行时那份 ✓
//     ⇒ ★ 于是每一条"存档值与规划值不一致"的记录，都会**直接变成屏幕上的错位** ✗
//   ★ 而 v248 之前，脚本每帧把**规划值**盖上去 ⇒ ★ 这些不一致**全都看不见** ✗✓
//   ⇒ ★★ 所以本轮要的判据只有一句话 ✓：
//        ★ **凡"用户没特意改过"的控件，存档值应当 = 规划值** ✓
//        ★ 差了就是错位 ✓（要么把规划值写进存档 ✓ 要么把该控件交回脚本 ✓）
//
// ★ 坐标口径（两边都能直接比 ✓ 已核 ✓）：
//   ★ `.gil` 的 `#504` = **控件中心在画布里的绝对坐标 − 画布中心**（画布 1600×900、y 向上）
//     ⇒ ★ 还原成"编辑器的位置 X,Y"（**原点左下**）= `(800 + X, 450 + Y)` ✓
//   ★ `layout-plan.json` 的 `cx/cy` = ★ **就是编辑器那个"位置 X,Y"**（原点左下）✓
//     ⇒ ★ 两边同一个坐标系 ✓ 直接相减 ✓
//
// ★ 用法：node tools/gil/_probe_plan_vs_gil.mjs <存档.gil> [--plan=tools/sim/out/layout-plan.json]
//        [--tol=2] [--all]
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const file = argv.find((s) => !s.startsWith('--'));
const argOf = (k, d) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const PLAN = path.resolve(ROOT, argOf('plan', 'tools/sim/out/layout-plan.json'));
const TOL = Number(argOf('tol', '2'));
const ALL = argv.includes('--all');
if (!file) { console.error('用法: node tools/gil/_probe_plan_vs_gil.mjs <存档.gil> [--tol=2] [--all]'); process.exit(2); }
const CW = 1600, CH = 900;

const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kids = (r) => {
  const cl = findChildListTop(r.field.sub);
  return cl ? (asIdList(cl.payload, true) || []).map((i) => byId.get(Number(i))).filter(Boolean) : [];
};
function msg2(blk, field) {
  const hit = (function w(fs) {
    for (const x of fs) {
      if (x.field === field && x.sub) return x.sub;
      if (x.sub) { const r2 = w(x.sub); if (r2) return r2; }
    }
    return null;
  })(blk.sub);
  if (!hit) return null;
  const get = (n) => { const y = hit.find((z) => z.field === n); return y && typeof y.f === 'number' ? y.f : null; };
  const a = get(501), b = get(502);
  return (a === null || b === null) ? null : { a, b };
}
const gil = new Map();
for (const r of g.recs) {
  if (!r.name || !r.states || !r.states.length) continue;
  const off = msg2(r.states[0], 504), size = msg2(r.states[0], 505);
  if (!off || !size) continue;
  if (!gil.has(r.name)) gil.set(r.name, { off, size });
}

const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
console.log('存档 ' + path.basename(file) + '　规划 ' + path.basename(PLAN)
  + '（' + plan.nodes.length + ' 项）　容差 ' + TOL + 'px');

const rows = [];
let miss = 0;
for (const n of plan.nodes) {
  const gg = gil.get(n.id);
  if (!gg) { miss += 1; continue; }
  const gx = CW / 2 + gg.off.a, gy = CH / 2 + gg.off.b;      // ★ 还原成"编辑器位置 X,Y"（原点左下）
  const dx = gx - n.cx, dy = gy - n.cy;
  const dw = gg.size.a - n.w, dh = gg.size.b - n.h;
  rows.push({ id: n.id, kind: n.kind, dx, dy, dw, dh, gilCenter: { x: gx, y: gy }, planCenter: { x: n.cx, y: n.cy },
    gilSize: { w: gg.size.a, h: gg.size.b }, planSize: { w: n.w, h: n.h },
    parent: n.parent || null });
}
const bad = rows.filter((r) => Math.abs(r.dx) > TOL || Math.abs(r.dy) > TOL || Math.abs(r.dw) > TOL || Math.abs(r.dh) > TOL);
bad.sort((a, b) => (Math.abs(b.dx) + Math.abs(b.dy)) - (Math.abs(a.dx) + Math.abs(a.dy)));
console.log('★ 规划里有、存档里也有几何的控件 ' + rows.length + ' 个（存档缺几何 ' + miss + ' 个）');
console.log('★★ **与规划不一致**（任一维 > ' + TOL + 'px）的 ' + bad.length + ' 个：');
console.log('');
for (const r of (ALL ? rows : bad)) {
  const flag = bad.includes(r) ? '✗' : ' ';
  console.log(' ' + flag + ' ' + r.id + '　(父=' + (r.parent || '—') + ')');
  console.log('     位置 存档(' + r.gilCenter.x.toFixed(1) + ',' + r.gilCenter.y.toFixed(1) + ')'
    + ' vs 规划(' + r.planCenter.x.toFixed(1) + ',' + r.planCenter.y.toFixed(1) + ')'
    + '　Δ(' + r.dx.toFixed(1) + ',' + r.dy.toFixed(1) + ')');
  console.log('     尺寸 存档 ' + r.gilSize.w + '×' + r.gilSize.h + ' vs 规划 ' + r.planSize.w + '×' + r.planSize.h
    + '　Δ(' + r.dw.toFixed(1) + ',' + r.dh.toFixed(1) + ')');
}
