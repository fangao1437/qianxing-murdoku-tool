// tools/gil/plan_diff.mjs —— 对比两份 layout-plan.json：几何是否变了 + 父级变了哪些
//
// 用途：改结构（只动 parent、不动 rect）之后，确认**控件没有被挪动**。
//   因为 `rect` 是设计空间**绝对坐标**（见 ui_controller L56 的换算注释），
//   只改父级时 cx/cy/w/h 应当**完全不变** —— 这个脚本就是把这件事证明出来。
//
// 用法：node tools/gil/plan_diff.mjs <旧.json> <新.json>

import fs from 'node:fs';
import path from 'node:path';

const [fa, fb] = process.argv.slice(2);
if (!fa || !fb) { console.error('用法：node tools/gil/plan_diff.mjs <旧.json> <新.json>'); process.exit(1); }
const A = JSON.parse(fs.readFileSync(fa, 'utf8'));
const B = JSON.parse(fs.readFileSync(fb, 'utf8'));
const ma = new Map(A.nodes.map((n) => [n.id, n]));
const mb = new Map(B.nodes.map((n) => [n.id, n]));

const added = B.nodes.filter((n) => !ma.has(n.id)).map((n) => n.id);
const removed = A.nodes.filter((n) => !mb.has(n.id)).map((n) => n.id);

console.log('旧 ' + A.nodes.length + ' 节点 → 新 ' + B.nodes.length + ' 节点');
console.log('新增：' + (added.join(', ') || '（无）'));
console.log('删除：' + (removed.join(', ') || '（无）'));

let geoMoved = 0, parentMoved = 0;
const parentChanges = [];
for (const [id, a] of ma) {
  const b = mb.get(id);
  if (!b) continue;
  if (a.cx !== b.cx || a.cy !== b.cy || a.w !== b.w || a.h !== b.h) {
    geoMoved++;
    console.log('  ❌ 几何变了 ' + id + '：(' + a.cx + ',' + a.cy + ') ' + a.w + 'x' + a.h
      + '  →  (' + b.cx + ',' + b.cy + ') ' + b.w + 'x' + b.h);
  }
  if ((a.parent || '') !== (b.parent || '')) {
    parentMoved++;
    parentChanges.push('  → ' + id.padEnd(18) + ' 父 ' + String(a.parent || '(画布)').padEnd(10)
      + ' → ' + String(b.parent || '(画布)'));
  }
}
console.log('\n几何被移动的控件：' + geoMoved + (geoMoved === 0 ? '  ✅ 一个都没动' : '  ❌'));
console.log('父级改变的控件：' + parentMoved);
for (const l of parentChanges) console.log(l);

const ok = geoMoved === 0;
console.log('\n' + (ok
  ? '★ 只改了父子结构，视觉位置完全不变'
  : '❌ 有控件被挪动了 —— 检查 rect 是否被误改'));
process.exit(ok ? 0 : 2);
