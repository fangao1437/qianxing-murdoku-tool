// tools/gil/set_control_size.mjs —— 只改【尺寸】（可选同时给位置），其余字段一个字不动
//
// 为什么单独写一个（而不是改 sync_plan / set_positions ✓）：
//   · `sync_plan.mjs` 补的是**整个计划并集**（实测会多补 123 个控件 ✗）⇒ 不能用于"只动两个控件"✓
//   · `set_positions.mjs` 吃的是**已严重过期**的 `layout-plan.json`（命中率 <60% 会拒跑 ✓）
//   ⇒ 本工具**只做一件事** ✓：把点名控件的尺寸（和可选位置）写进**每一个状态块** ✓
//
// ★ 关键纪律（`gen_icons.mjs` 踩出来的 ✓）：
//   **每个状态块都要写** ✗ —— 只写第一块 ⇒ 其余状态还是旧值 ✓
//
// ★ 图 id / 颜色 / 名字 / 父子 **一律不碰** ✓（用户要求：「素材引用和调色按这张就行」✓）
//
// 用法：
//   node tools/gil/set_control_size.mjs --in=<存档> --out=<输出> --set="名:宽x高[,名:宽x高…]"
//     [--pos="名:x,y"]   （可选，给位置；不写就只改尺寸）
//   例：--set="modal:633x600,modal.bg:633x600"
//
// ★ 收尾必跑：`node tools/gil/roundtrip.mjs <输出>`（本工具自带"从磁盘重读"断言 ✓）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg, stateBlocks, pairOf, pairValue, setPair, findChildListTop, asIdList } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const IN = argOf('in'), OUT = argOf('out'), SET = argOf('set'), POS = argOf('pos');
if (!IN || !SET) {
  console.error('用法: node tools/gil/set_control_size.mjs --in=<存档> --out=<输出> --set="名:宽x高[,…]" [--pos="名:x,y"]');
  process.exit(1);
}

const g = readGil(IN);
console.log('存档 ' + path.basename(IN) + '　记录 ' + g.recs.length);

// 解析 --set
const spec = new Map();
for (const part of SET.split(',')) {
  const m = /^(.+?):(\d+)x(\d+)$/.exec(part.trim());
  if (!m) { console.error('✗ 解析不了 --set 的一段：' + part); process.exit(1); }
  spec.set(m[1], { w: Number(m[2]), h: Number(m[3]) });
}
const posSpec = new Map();
if (POS) {
  // ★ 用 **分号** 分隔多项 ✓ —— 位置本身就写成 `x,y` ✓
  //   用逗号分隔会把 `modal/bg:0,108` 切成两半 ⇒ **静默不写位置** ✗（我第一版就这么错的 ✓）
  for (const part of POS.split(';')) {
    const m = /^([^:]+):(-?\d+),(-?\d+)$/.exec(part.trim());
    if (!m) { console.error('✗ 解析不了 --pos 的一段：' + part + '（应写成 名:x,y，多项用 ; 分隔）'); process.exit(1); }
    posSpec.set(m[1], { x: Number(m[2]), y: Number(m[3]) });
  }
}

// ★ 寻址支持两种写法 ✓：
//   `名`    ⇒ 全局按名字找，**要求唯一** ✗（`bg` 这种重名到处都是 ⇒ 会直接报错让你换写法 ✓）
//   `父/子` ⇒ 只在【父的直接子控件列表】里按名字找 ✓（重名控件必须走这条 ✓）
function findControl(name) {
  if (name.includes('/')) {
    const [pn, cn] = name.split('/');
    const p = g.recs.find((r) => r.name === pn);
    if (!p) { console.error('✗ 找不到父控件 ' + pn); return null; }
    const cl = findChildListTop(p.field.sub);
    const ids = cl ? (asIdList(cl.payload, true) || []) : [];
    for (const id of ids) {
      const c = g.recs.find((r) => r.id === id);
      if (c && c.name === cn) return c;
    }
    console.error('✗ ' + pn + ' 的子控件里没有 ' + cn);
    return null;
  }
  const hits = g.recs.filter((r) => r.name === name);
  if (!hits.length) { console.error('✗ 找不到控件 ' + name); return null; }
  if (hits.length > 1) {
    console.error('✗ 「' + name + '」有 ' + hits.length + ' 个同名记录 ⇒ 请改用「父/子」写法 ✓');
    return null;
  }
  return hits[0];
}

const touched = [];
for (const [name, s] of spec) {
  const rec = findControl(name);
  if (!rec) process.exit(2);
  const bl = []; stateBlocks(rec.field.sub, bl);
  if (!bl.length) { console.error('✗ ' + name + ' 没有状态块'); process.exit(2); }
  let wroteSize = 0, wrotePos = 0;
  for (const b of bl) {
    const sz = pairOf(b, 505);
    if (sz) { setPair(sz, s.w, s.h); wroteSize++; }
    const p = posSpec.get(name);
    if (p) { const pp = pairOf(b, 504); if (pp) { setPair(pp, p.x, p.y); wrotePos++; } }
  }
  touched.push({ name, id: rec.id, blocks: bl.length, wroteSize, wrotePos, want: s, pos: posSpec.get(name) });
  console.log('  + ' + name.padEnd(16) + ' #' + rec.id + '  状态块 ' + bl.length
    + ' → 写尺寸 ' + wroteSize + (posSpec.get(name) ? (' 写位置 ' + wrotePos) : '')
    + '　目标 ' + s.w + '×' + s.h);
}

fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
console.log('\n已写出：' + path.basename(OUT) + '（' + fs.statSync(OUT).size + ' 字节）');

// ── 从磁盘重读断言（项目铁律 ✓）──
const g2 = readGil(OUT);
console.log('\n── 复读核对（从磁盘重读）──');
let bad = 0;
for (const t of touched) {
  const rec = g2.recs.find((r) => r.id === t.id);   // ★ 按 **id** 复读 ✓（`父/子` 那种写法按名字找不到 ✓）
  if (!rec) { console.log('  ❌ ' + t.name + ' 没了'); bad++; continue; }
  const bl = []; stateBlocks(rec.field.sub, bl);
  const sizes = bl.map((b) => {
    const sz = pairOf(b, 505);
    return sz ? (pairValue(sz, 0) + '×' + pairValue(sz, 1)) : '—';
  });
  const allOk = sizes.every((s) => s === (t.want.w + '×' + t.want.h));
  if (!allOk) bad++;
  console.log('  ' + (allOk ? '✅' : '❌') + ' ' + t.name.padEnd(16) + ' 各状态块尺寸 = ' + sizes.join(' / '));
}
console.log('\n' + (bad === 0 ? '★ 全部状态块的尺寸都写对了 ✓' : '❌ 有 ' + bad + ' 个不对'));
console.log('⚠️ 交付前必跑：node tools/gil/roundtrip.mjs ' + path.basename(OUT));
process.exit(bad === 0 ? 0 : 3);
