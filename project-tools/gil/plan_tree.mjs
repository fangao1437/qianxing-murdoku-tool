// tools/gil/plan_tree.mjs —— 打印 layout-plan.json 的**父子树**，并统计各类控件挂在哪
//
// 用途：核对"规划想让控件挂哪"与"生成出来的存档里实际挂哪"是否一致；
//       以及一眼看出某个容器下混了哪些种类（例如 topbar 里混进了 tool/action）。
//
// 用法：
//   node tools/gil/plan_tree.mjs                 # 打印树
//   node tools/gil/plan_tree.mjs --kind          # 按"父 × 种类"统计

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'sim', 'out', 'layout-plan.json'), 'utf8'));
const byId = new Map(plan.nodes.map((n) => [n.id, n]));
const kids = new Map();
for (const n of plan.nodes) {
  const p = n.parent || '(无父)';
  if (!kids.has(p)) kids.set(p, []);
  kids.get(p).push(n);
}
for (const [, arr] of kids) arr.sort((a, b) => a.id.localeCompare(b.id));

if (process.argv.includes('--kind')) {
  console.log('父 × 种类 统计（只列有子的父）：\n');
  const parents = [...kids.keys()].filter((p) => p !== '(无父)').sort();
  for (const p of parents) {
    const arr = kids.get(p);
    const byKind = new Map();
    for (const n of arr) byKind.set(n.kind, (byKind.get(n.kind) || 0) + 1);
    const desc = [...byKind.entries()].map(([k, c]) => k + '×' + c).join('  ');
    console.log('  ' + p.padEnd(14) + '（' + byId.get(p)?.kind + '）  子 ' + String(arr.length).padStart(3)
      + '   ' + desc);
  }
  process.exit(0);
}

if (process.argv.includes('--diff')) {
  // 对比：规划想让控件挂在谁下面 vs 生成出来的存档里实际挂在谁下面
  const { readGil } = await import('./gilread.mjs');
  const gilFile = process.argv[process.argv.indexOf('--diff') + 1];
  const g = readGil(gilFile);
  const gByName = new Map();
  for (const r of g.recs) if (r.name && !gByName.has(r.name)) gByName.set(r.name, r);
  const nameOfId = new Map(g.recs.map((r) => [r.id, r.name]));
  console.log('对比：' + path.basename(gilFile) + '\n');
  let bad = 0, ok = 0, missing = 0;
  for (const n of plan.nodes) {
    if (/^cell\./.test(n.id)) continue;                    // 格子由脚本运行时生成
    const r = gByName.get(n.id);
    if (!r) { console.log('  ❌ 存档里没有 ' + n.id); missing++; continue; }
    const actualParent = nameOfId.get(r.parentId) || ('#' + r.parentId);
    const wantParent = n.parent || '(画布)';
    const same = (n.parent && actualParent === n.parent) || (!n.parent && actualParent.startsWith('#'));
    if (same) ok++;
    else { bad++; console.log('  ❌ ' + n.id.padEnd(24) + ' 规划父=' + wantParent.padEnd(12) + ' 实际父=' + actualParent); }
  }
  console.log('\n父级一致 ' + ok + '，不一致 ' + bad + '，缺失 ' + missing);
  process.exit(bad + missing === 0 ? 0 : 2);
}

const roots = [...kids.keys()].filter((p) => !byId.has(p));
console.log('顶层（父不是规划节点）：' + roots.join(', ') + '\n');
function dump(id, depth) {
  const n = byId.get(id);
  const pad = '  '.repeat(depth);
  console.log(pad + id.padEnd(24) + String(n?.kind || '?').padEnd(10)
    + ' (' + (n ? n.cx + ',' + n.cy : '?') + ') ' + (n ? n.w + 'x' + n.h : ''));
  for (const c of kids.get(id) || []) dump(c.id, depth + 1);
}
for (const r of roots) for (const n of kids.get(r)) dump(n.id, 0);
