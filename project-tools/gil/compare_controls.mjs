// tools/gil/compare_controls.mjs —— 对比两个 .gil 里**同名控件**的几何（四状态位置/尺寸）
//
// 用途：把"我生成的文件"和"游戏导入后重新保存的文件"对一遍 ——
//   若数值一致，说明**引擎原样接受了我的写入**（没有做任何归一化/重算）。
//   这是"写入路径"最硬的证据：不靠肉眼读界面，直接比字节解出来的数值。
//
// 用法：
//   node tools/gil/compare_controls.mjs <A.gil> <B.gil> [名字过滤]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, pairOf, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = process.argv[2];
const B = process.argv[3];
const filter = process.argv[4] || null;
if (!A || !B) { console.error('用法：node tools/gil/compare_controls.mjs <A.gil> <B.gil> [过滤]'); process.exit(1); }

const ga = readGil(A), gb = readGil(B);
const pick = (g) => {
  const m = new Map();
  for (const r of g.recs) if (r.name) { if (!m.has(r.name)) m.set(r.name, []); m.get(r.name).push(r); }
  return m;
};
const ma = pick(ga), mb = pick(gb);

const same = (x, y) => x === null || y === null ? x === y : Math.abs(x - y) < 0.01;
const geomOf = (r) => r.states.map((s) => [
  pairValue(pairOf(s, 504), 0), pairValue(pairOf(s, 504), 1),
  pairValue(pairOf(s, 505), 0), pairValue(pairOf(s, 505), 1),
]);

console.log('A：' + path.basename(A) + '（' + ga.recs.length + ' 条记录）');
console.log('B：' + path.basename(B) + '（' + gb.recs.length + ' 条记录）\n');

const names = [...ma.keys()].filter((n) => mb.has(n)).filter((n) => !filter || n.includes(filter)).sort();
console.log('两边同名控件 ' + names.length + ' 个' + (filter ? '（过滤 "' + filter + '"）' : ''));
if (!names.length) { console.log('  （没有可对比的）'); process.exit(0); }

let diff = 0, ok = 0;
for (const n of names) {
  const ra = ma.get(n)[0], rb = mb.get(n)[0];
  const a = geomOf(ra), b = geomOf(rb);
  if (!a.length || !b.length) {
    // 有些记录没有"状态块"（形状不同，例如某些容器的几何编码不一样）——
    // 这类没法按四状态比，单独报出来而不是崩掉。
    console.log('  ⚠️ ' + n.padEnd(16) + ' 状态块数 A=' + a.length + ' B=' + b.length + '（跳过对比）');
    continue;
  }
  const nStates = Math.min(a.length, b.length);
  let bad = a.length !== b.length;
  const marks = [];
  for (let i = 0; i < nStates; i++) {
    const same4 = a[i].every((v, k) => same(v, b[i][k]));
    if (!same4) { bad = true; marks.push('状态' + i + ' A[' + a[i].map((v) => v === null ? '空' : v.toFixed(1)).join(',')
      + '] B[' + b[i].map((v) => v === null ? '空' : v.toFixed(1)).join(',') + ']'); }
  }
  const f = (g) => (m) => { const v = g(m); return v === null ? '空' : v.toFixed(0); };
  console.log('  ' + (bad ? '❌' : '✅') + ' ' + n.padEnd(16)
    + ' A 位置(' + f((x) => x[0])(a[0]) + ',' + f((x) => x[1])(a[0]) + ') 尺寸(' + f((x) => x[2])(a[0]) + 'x' + f((x) => x[3])(a[0]) + ')'
    + (bad ? '   ← ' + marks.join(' | ') : ''));
  if (bad) diff++; else ok++;
}
console.log('\n一致 ' + ok + ' 个，不一致 ' + diff + ' 个');
console.log(diff === 0
  ? '★ 引擎原样接受了写入（无归一化/重算）'
  : '⚠️ 有不一致 —— 说明引擎对某些值做了换算，需要按差量校准生成器');
process.exit(diff === 0 ? 0 : 2);
