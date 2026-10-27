// tools/sim/scale_select_cards.mjs —— 把选关卡片（视觉层 + 命中层）按比例缩放
//
// 2026-10-16 用户指令③：「★ 把棋盘，棋盘背景图，选关卡片的 xy 缩减到现在的 90%」✓
//   ★ 棋盘与棋盘底图：★ 走 `main.lua` 的 `BOARD_W/H`（584 → 525.6）✓ 底图按棋盘自适应 ✓
//   ★ 选关卡片：★ 视觉层 `select.card.1..4` ＋ 命中层 `hit.select.card.1..4` ✓ **两层一起缩** ✓
//     （★ 只缩一层会让"看得见的"和"点得到的"错位 ✓）
//
// 用法：node tools/sim/scale_select_cards.mjs --in=<in.gil> --out=<out.gil> [--k=0.9] [--count=4]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from '../gil/gilread.mjs';
import { writeGil } from '../gil/gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const IN = argOf('in'), OUT = argOf('out');
const K = Number(argOf('k') || 0.9);
const N = Number(argOf('count') || 4);
if (!IN || !OUT) { console.error('用法: --in= --out= [--k=0.9] [--count=4]'); process.exit(1); }

const g = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
const pairOf = (r, n) => {
  const b = r.states[0];
  const p = b.sub.find((x) => x.field === n);
  return p && p.sub ? p.sub.filter((x) => x.wt === 5) : null;
};
function scale(rec, x, y, w, h) {
  let n = 0;
  for (const blk of rec.states) {
    const p4 = blk.sub.find((z) => z.field === 504);
    const p5 = blk.sub.find((z) => z.field === 505);
    const apply = (p, vals) => {
      if (!p || !p.sub) return;
      const fs_ = p.sub.filter((z) => z.wt === 5);
      vals.forEach((v, i) => { if (fs_[i] !== undefined) { fs_[i].f = v; n++; } });
    };
    apply(p4, [x, y]);
    apply(p5, [w, h]);
  }
  return n;
}

const rows = [];
let tot = 0;
for (let i = 1; i <= N; i++) {
  for (const base of ['select.card.', 'hit.select.card.']) {
    const r = g.byName.get(base + i);
    if (!r) { console.log('  ' + base + i + ' 不在'); continue; }
    const p = pairOf(r, 504), s = pairOf(r, 505);
    if (!p || !s || p.length < 2 || s.length < 2) { console.log('  ' + base + i + ' 几何不完整'); continue; }
    const x = p[0].f, y = p[1].f, w = s[0].f, h = s[1].f;
    tot += scale(r, x * K, y * K, w * K, h * K);
    rows.push([base + i, x.toFixed(1) + '→' + (x * K).toFixed(1) + ', ' + y.toFixed(1) + '→' + (y * K).toFixed(1),
      w.toFixed(1) + '×' + h.toFixed(1) + ' → ' + (w * K).toFixed(1) + '×' + (h * K).toFixed(1)]);
  }
}
for (const r of rows) console.log('  ' + r[0].padEnd(22) + r[1].padEnd(28) + r[2]);
console.log('  k=' + K + '  共写 ' + tot + ' 个浮点');

const rep = writeGil(g, path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), {
  label: '选关卡片缩放 k=' + K,
  assert: (g2) => {
    const bad = [];
    // ⚠️ `g` 是【被改过】的那份内存对象 ✗ ⇒ ★ 期望值必须用写之前记下的 `rows` 里的原值 ✓
    //   （★ 我第一版在这里又乘了一次 K ⇒ 期望变成 209 ⇒ 假红 ✗ 已修 ✓）
    const want = new Map();
    for (let i = 1; i <= N; i++) {
      for (const base of ['select.card.', 'hit.select.card.']) {
        const a = g.byName.get(base + i);
        if (!a) continue;
        want.set(base + i, { w: pairOf(a, 505)[0].f, x: pairOf(a, 504)[0].f });
      }
    }
    for (const [nm, v] of want) {
      const b = g2.byName.get(nm);
      if (!b) { bad.push(nm + ' 回读不到'); continue; }
      const wb = pairOf(b, 505)[0].f, xb = pairOf(b, 504)[0].f;
      if (Math.abs(v.w - wb) > 0.01) bad.push(nm + ' 宽回读 ' + wb + '，期望 ' + v.w);
      if (Math.abs(v.x - xb) > 0.01) bad.push(nm + ' x回读 ' + xb + '，期望 ' + v.x);
    }
    // 两层必须仍然重合 ✓（视觉层与命中层同矩形 ✓）
    for (let i = 1; i <= N; i++) {
      const a = g2.byName.get('select.card.' + i), b = g2.byName.get('hit.select.card.' + i);
      if (!a || !b) continue;
      if (Math.abs(pairOf(a, 504)[0].f - pairOf(b, 504)[0].f) > 0.01) bad.push('第 ' + i + ' 张：视觉层与命中层 x 不重合 ✗');
    }
    if (g2.recs.length !== g.recs.length) bad.push('记录数变了');
    return bad.length ? bad.join('；') : true;
  },
});
console.log('  输出 ' + path.basename(OUT) + '（' + rep.bytes + ' 字节，记录 ' + rep.recs + '，diff ' + rep.diffs + '）');
