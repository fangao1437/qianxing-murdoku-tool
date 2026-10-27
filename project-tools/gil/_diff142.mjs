import { readGil, findChildListTop, asIdList } from './gilread.mjs';
const A = readGil('214.1.gil'), B = readGil('214.2.gil');
const idA = new Set(A.recs.map((r) => r.id));
const byIdB = new Map(B.recs.map((r) => [r.id, r]));
console.log('  214.1 记录=' + A.recs.length + '   214.2 记录=' + B.recs.length);
const added = [...byIdB.keys()].filter((i) => !idA.has(i));
const removed = [...idA].filter((i) => !byIdB.has(i));
console.log('  ★ 新增 ' + added.length + ' 个：');
for (const i of added) {
  const r = byIdB.get(i);
  console.log('    id=' + i + '  name=' + JSON.stringify(r.name) + '  parent=' + r.parentId);
}
console.log('  ★ 删除 ' + removed.length + ' 个：' + removed.join(', '));
const rootB = B.recs.find((r) => r.name === 'root');
if (rootB) {
  const l = findChildListTop(rootB.field.sub);
  const ids = l ? (asIdList(l.payload, true) || []) : [];
  console.log('  ★ root 子控件顺序（' + ids.length + '）：' + ids.map((x) => (byIdB.get(x) || {}).name || x).join(' , '));
}