import { readGil, findChildListTop, asIdList } from './gilread.mjs';
const g = readGil('216-素材区.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kids = (r) => { const l = findChildListTop(r.field?.sub || []); return l ? (asIdList(l.payload, true) || []) : []; };
const A = g.recs.find((r) => r.name === 'assets');
console.log('  记录 = ' + g.recs.length + '   assets 子控件 ' + kids(A).length + ' 个：');
console.log('    ' + kids(A).map((k) => (byId.get(k) || {}).name || k).join(' , '));
for (const nm of ['clue', 'cell.1.1']) {
  const rs = g.recs.filter((r) => r.name === nm);
  console.log('  ' + nm + ' 仍有 ' + rs.length + ' 个（★ 模板不能挪 ✓）父=' + rs.map((r) => (byId.get(r.parentId) || {}).name || r.parentId).join('/'));
}
const root = g.recs.find((r) => r.name === 'root');
console.log('  root 子顺序：' + kids(root).map((k) => (byId.get(k) || {}).name || k).join(' , '));