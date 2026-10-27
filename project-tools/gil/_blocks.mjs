import { readGil } from './gilread.mjs';
function stat(file) {
  const g = readGil(file);
  const cnt = new Map();
  for (const r of g.recs) { const n = r.states.length; cnt.set(n, (cnt.get(n) || 0) + 1); }
  console.log('  ' + file);
  console.log('    记录 ' + g.recs.length + '   状态块分布 ' + [...cnt.entries()].sort((a,b)=>a[0]-b[0]).map(([k,v]) => k+'块×'+v).join('  '));
  return g;
}
const a = stat('208.1.gil');
const b = stat('215-完整界面-可导入.gil');
const aIds = new Set(a.recs.map((r) => r.id));
const nw = b.recs.filter((r) => !aIds.has(r.id));
const cnt2 = new Map();
for (const r of nw) { const n = r.states.length; cnt2.set(n, (cnt2.get(n) || 0) + 1); }
console.log('  ── 215 里【新增的 ' + nw.length + ' 条】的状态块分布 ──');
console.log('    ' + [...cnt2.entries()].sort((x,y)=>x[0]-y[0]).map(([k,v]) => k+'块×'+v).join('  '));
const odd = nw.filter((r) => r.states.length !== 4);
console.log('    不是 4 块的 ' + odd.length + ' 条' + (odd.length ? ' → ' + odd.slice(0,12).map((r)=>(r.name||'?')+'('+r.states.length+')').join(', ') : ' ✓'));
console.log('  ── 208.1 里原有的控件状态块数（抽样）──');
for (const n of ['root','stage','topbar','clues','board.bg','home','home.select','home.title','action.back','clues.grid','tpl.cell','modal']) {
  const r = a.recs.find((x) => x.name === n);
  if (r) console.log('    ' + n.padEnd(14) + r.states.length + ' 块');
}
console.log('  ── 215 里我新建的容器 ──');
for (const n of ['board','tray','assets','proto.btn','proto.text','modal','modal.exit','legend','intro']) {
  const r = b.recs.find((x) => x.name === n);
  if (r) console.log('    ' + n.padEnd(14) + r.states.length + ' 块  父#' + r.parentId);
}