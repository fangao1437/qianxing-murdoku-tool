import { readGil } from './gilread.mjs';
const g = readGil('214.3.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
const want = ['hex', 'tpl-container', 'assets', 'clue', 'cell.1.1', 'xxx', '111'];
for (const nm of want) {
  const rs = g.recs.filter((r) => String(r.name || '') === nm);
  if (!rs.length) { console.log('  ' + nm + '：不存在'); continue; }
  for (const r of rs) {
    const p = byId.get(r.parentId);
    console.log('  ' + nm.padEnd(14) + ' id=' + r.id + '  父id=' + r.parentId + '  父名=' + (p ? p.name : '(不在记录表里/无父)'));
  }
}
console.log('  ★ 名字为空的记录：');
for (const r of g.recs.filter((x) => !x.name)) console.log('    id=' + r.id + ' 父id=' + r.parentId + ' 父名=' + ((byId.get(r.parentId) || {}).name || '(无)'));
console.log('  ★ root 下每个子控件的类型/子数：');
const kidsOf = (r) => { const f = (r.field?.sub || []).find((x) => x.sub && x.sub.some((y) => y.sub)); return 0; };
for (const r of g.recs.filter((x) => x.parentId === (g.recs.find((y) => y.name === 'root') || {}).id)) {
  console.log('    ' + String(r.name).padEnd(12) + ' id=' + r.id + '  子数≈' + ((r.field?.sub || []).length));
}