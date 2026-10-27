import { readGil } from './gilread.mjs';
const g = readGil('215-完整界面-可导入.gil');
const seen = new Map();
for (const r of g.recs) {
  if (!r.name) continue;
  const key = r.parentId + '/' + r.name;
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key).push(r.id);
}
const dup = [...seen.entries()].filter(([, v]) => v.length > 1);
console.log('  记录 ' + g.recs.length + ' 条，父下重名 ' + dup.length + ' 组');
for (const [k, v] of dup.slice(0, 20)) console.log('    ' + k + '  ×' + v.length + '  ID=' + v.join(','));
const ids = g.recs.map((r) => r.id);
const idDup = ids.filter((x, i) => ids.indexOf(x) !== i);
console.log('  重复 ID ' + new Set(idDup).size + ' 个' + (idDup.length ? ' → ' + [...new Set(idDup)].slice(0, 10).join(',') : ' ✓'));