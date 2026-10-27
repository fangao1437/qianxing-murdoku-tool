import { readGil, findChildListTop, asIdList } from './gilread.mjs';
const g = readGil('214.3.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kids = (r) => { const l = findChildListTop(r.field?.sub || []); return l ? (asIdList(l.payload, true) || []) : []; };
console.log('  记录 = ' + g.recs.length);
console.log('  ★ 顶层（无父或父不在表里）：');
for (const r of g.recs) if (!byId.has(r.parentId)) console.log('    ' + (r.name || '(无名)') + '  id=' + r.id + '  子=' + kids(r).length);
const root = g.recs.find((r) => r.name === 'root');
if (root) console.log('  ★ root 子顺序：' + kids(root).map((k) => (byId.get(k) || {}).name || k).join(' , '));
for (const nm of ['xxx', 'assets']) {
  const r = g.recs.find((x) => x.name === nm);
  if (!r) { console.log('  ★ ' + nm + ' = 不存在'); continue; }
  const p = byId.get(r.parentId);
  const sib = p ? kids(p).map((k) => (byId.get(k) || {}).name || k) : [];
  console.log('  ★ ' + nm + '：父=' + (p ? p.name : r.parentId) + '  在同级第 ' + (sib.indexOf(nm) + 1) + '/' + sib.length + '（★ 顺序即层序 ✓ 越靠前越在下 ✓）');
  console.log('     同级：' + sib.join(' , '));
}
const rows = g.recs.filter((r) => /^row\./.test(String(r.name || '')));
console.log('  ★ row.* 共 ' + rows.length + ' 个：' + rows.slice(0, 12).map((r) => r.name + '(父=' + ((byId.get(r.parentId) || {}).name || r.parentId) + ')').join(' , '));