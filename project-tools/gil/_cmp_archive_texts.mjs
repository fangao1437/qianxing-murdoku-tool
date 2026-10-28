// 权威对照：v356(576) vs v361(583) 每条 td.* 文本【逐字符】比较
import { readGil } from './gilread.mjs';

const [aPath, bPath] = process.argv.slice(2);
function nodesAt(fields, pathArr) {
  let lv = fields;
  for (let i = 0; i < pathArr.length; i++) {
    const hits = lv.filter((f) => f.field === pathArr[i] && f.sub);
    if (i === pathArr.length - 1) return hits;
    lv = hits.flatMap((f) => f.sub);
  }
  return [];
}
function info(rec) {
  const ns = nodesAt(rec.field.sub, [505, 503, 75]);
  if (ns.length !== 1) return null;
  const grp = ns[0];
  const tn = grp.sub.find((f) => f.field === 510 && f.sub);
  const tl = tn && tn.sub.find((f) => f.field === 501 && f.wt === 2);
  const num = (fld) => { const l = grp.sub.find((x) => x.field === fld && x.wt === 0); return l ? Number(l.num) : 0; };
  return { text: tl && tl.payload ? tl.payload.toString('utf8') : '', size: num(512), color: num(504) };
}
const A = readGil(aPath), B = readGil(bPath);
const a = new Map(), b = new Map();
for (const r of A.recs) if (r.name && r.name.startsWith('td.') && !a.has(r.name)) a.set(r.name, info(r));
for (const r of B.recs) if (r.name && r.name.startsWith('td.') && !b.has(r.name)) b.set(r.name, info(r));

const names = new Set([...a.keys()].filter((n) => b.has(n)));
let same = 0, diff = 0, onlyA = 0, onlyB = 0;
const diffs = [];
for (const n of names) {
  const ia = a.get(n), ib = b.get(n);
  if (!ia || !ib) continue;
  if (ia.text === ib.text) same++;
  else { diff++; if (diffs.length < 30) diffs.push({ n, a: ia.text, b: ib.text }); }
}
for (const n of a.keys()) if (!b.has(n)) onlyA++;
for (const n of b.keys()) if (!a.has(n)) onlyB++;
console.log('A=' + aPath.split(/[\\/]/).pop() + '  td.* ' + a.size);
console.log('B=' + bPath.split(/[\\/]/).pop() + '  td.* ' + b.size);
console.log('  共有 ' + names.size + '　文本【逐字符相同】 ' + same + '　不同 ' + diff);
console.log('  只在 A ' + onlyA + '　只在 B ' + onlyB);
for (const d of diffs) {
  const tag = (s) => JSON.stringify(s);
  console.log('  • ' + d.n + '\n      A=' + tag(d.a) + '\n      B=' + tag(d.b));
}
