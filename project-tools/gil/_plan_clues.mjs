import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('tools/sim/out/layout-plan.json', 'utf8'));
const nodes = j.nodes || j;
const want = (id) => nodes.find((n) => n.id === id);
console.log('  ── plan 里 clues 相关的可见判定 ──');
for (const n of nodes.filter((x) => x.id && x.id.startsWith('clues'))) {
  console.log('    ' + n.id.padEnd(14) + 'kind=' + String(n.kind).padEnd(10) + 'parent=' + String(n.parent).padEnd(8) + 'visible=' + n.visible + (n.states ? '  states=' + JSON.stringify(n.states) : ''));
}
console.log('  ── 对照：board.bg / cell.1.1 / modal ──');
for (const id of ['board.bg','cell.1.1','modal','modal.exit','stage','clues']) {
  const n = want(id);
  console.log('    ' + id.padEnd(12) + (n ? 'visible=' + n.visible + '  parent=' + n.parent + (n.states ? '  states=' + JSON.stringify(n.states) : '') : '缺'));
}