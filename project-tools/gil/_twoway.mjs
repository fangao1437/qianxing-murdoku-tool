import { readGil } from './gilread.mjs';
const g = readGil('218.1.gil');
const r = g.recs.find((x) => x.name === 'portrait.A');
console.log('  portrait.A id=' + r.id + '  顶层字段数=' + r.field.sub.length);
// 方式甲：递归打印叶（脚本 A 用过 ✓）
function walk(fs, path, out) {
  for (const f of fs) {
    if (f.sub) { walk(f.sub, path + '/' + f.field, out); continue; }
    if (f.wt !== 0) continue;
    out.push([path + '#' + f.field, Number(f.num)]);
  }
}
const o = []; walk(r.field.sub, '', o);
console.log('  方式甲：叶 ' + o.length + ' 个；含 84#503 的 = ' + JSON.stringify(o.filter(([p]) => /\/84#503$/.test(p))));
console.log('          含 13/12#502 的 = ' + JSON.stringify(o.filter(([p]) => /13\/12#502$/.test(p))));
// 方式乙：按字段号下钻（脚本 B 用过 ✓）
function nodesAt(fs, path) {
  let cur = fs;
  for (const fno of path) {
    const nxt = [];
    for (const f of cur) { if (!f.sub) continue; for (const x of f.sub) if (x.field === fno && x.sub) nxt.push(x); }
    cur = nxt;
  }
  return cur;
}
const nd = nodesAt(r.field.sub, [505, 503, 84]);
console.log('  方式乙：/505/503/84 命中节点 ' + nd.length + ' 个');
for (const n of nd) {
  const l = (n.sub || []).filter((f) => f.wt === 0 && (f.field === 502 || f.field === 503));
  console.log('        #502/#503 = ' + l.map((f) => '#' + f.field + '=' + Number(f.num)).join(' '));
}