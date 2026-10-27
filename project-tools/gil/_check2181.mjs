import { readGil } from './gilread.mjs';
const g = readGil('218.1.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
console.log('  记录数 = ' + g.recs.length);
// 按字段号下钻（★ 这次用对方法 ✓）
function nodesAt(fs, path) {
  let cur = fs;
  for (const fno of path) {
    const nxt = [];
    for (const f of cur) { if (!f.sub) continue; for (const x of f.sub) if (x.field === fno && x.sub) nxt.push(x); }
    cur = nxt;
  }
  return cur;
}
function imgOf(r) {
  const ids = [];
  for (const nd of nodesAt(r.field.sub, [505, 503, 84])) for (const f of (nd.sub || [])) if (f.field === 503 && f.wt === 0) ids.push(Number(f.num));
  return ids;
}
const a = g.recs.find((r) => r.name === 'assets');
console.log('  ★ assets = ' + (a ? ('存在 ✓ 父=' + ((byId.get(a.parentId) || {}).name || a.parentId)) : '**不存在** ✗'));
if (a) {
  const kids = g.recs.filter((r) => r.parentId === a.id);
  console.log('  ★ assets 下 ' + kids.length + ' 个子控件：');
  for (const k of kids) console.log('      ' + String(k.name).padEnd(14) + ' id=' + k.id + '  imageId=[' + imgOf(k).join(', ') + ']');
}
console.log('  ★ 全档里所有 portrait.*：');
for (const r of g.recs) if (/^portrait\./.test(String(r.name || ''))) {
  const p = byId.get(r.parentId);
  console.log('      ' + r.name + '  父=' + (p ? p.name : r.parentId) + '  imageId=[' + imgOf(r).join(', ') + ']');
}
console.log('  ★ 全档里所有 row.*：' + g.recs.filter((r) => /^row\./.test(String(r.name || ''))).length + ' 个');