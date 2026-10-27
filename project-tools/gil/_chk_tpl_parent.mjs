import { readGil } from './gilread.mjs';
const g = readGil('259-回退到v117-方案乙-v121.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
console.log('=== 关键：模板 clue 挂在谁下面 ===');
for (const n of ['clue', 'clues.grid', 'clues', 'tpl-container', 'tpl.cell']) {
  const r = g.recs.find((x) => x.name === n);
  if (!r) { console.log('  ' + n.padEnd(14) + ' 不存在'); continue; }
  const p = byId.get(r.parentId);
  console.log('  ' + n.padEnd(14) + ' #' + r.id + '  父 = ' + (p ? p.name + ' #' + p.id : '（无）'));
}
console.log('');
console.log('=== clues.grid 的子控件（官方：配在视窗层级下的不参与滚动）===');
const grid = g.recs.find((x) => x.name === 'clues.grid');
const kids = grid ? g.recs.filter((x) => x.parentId === grid.id) : [];
if (kids.length === 0) console.log('  （无子控件）');
else kids.forEach((k) => console.log('  子: ' + k.name + ' #' + k.id));
console.log('');
const clue = g.recs.find((x) => x.name === 'clue');
const cg = g.recs.find((x) => x.name === 'clues.grid');
const same = clue && cg && clue.parentId === cg.id;
console.log('  clue 的父级 id = ' + (clue ? clue.parentId : '?'));
console.log('  clues.grid 的 id = ' + (cg ? cg.id : '?'));
console.log('  => ' + (same
  ? '❌ clue 就挂在视窗下面 —— 正是官方说「不会应用滚动效果」的那种'
  : '✅ clue 不在视窗的直接子级里'));
// 再往上追溯 clue 的祖先链
let cur = clue;
const chain = [];
for (let i = 0; i < 6 && cur; i++) { chain.push(cur.name); cur = byId.get(cur.parentId); }
console.log('  clue 的祖先链: ' + chain.join(' ← '));
