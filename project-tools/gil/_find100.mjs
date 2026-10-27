import { readGil } from './gilread.mjs';
function dec(p) {
  // 返回该字段可能代表的所有解释
  const out = [];
  const b = Buffer.from(p);
  if (b.length === 4) {
    out.push(['f32be', b.readFloatBE(0)]);
    out.push(['f32le', b.readFloatLE(0)]);
  }
  if (b.length === 8) out.push(['f64be', b.readDoubleBE(0)]);
  let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x);
  out.push(['int', Number(v)]);
  return out;
}
function walk(rec) {
  const rows = [];
  (function go(fs, path) {
    for (const f of fs) {
      if (f.sub) { go(f.sub, path + '/' + f.field); continue; }
      if (f.isText) continue;
      if (!f.payload || f.payload.length === undefined) continue;
      for (const [kind, v] of dec(f.payload)) rows.push({ path: path + '/' + f.field, kind, v });
    }
  })(rec.field.sub, '');
  return rows;
}
const g = readGil('214.1.gil');
console.log('  记录数 = ' + g.recs.length);
const near = (v, t) => Math.abs(v - t) < 0.01;
let hits = [];
for (const r of g.recs) {
  const rows = walk(r);
  const has100 = rows.filter((x) => near(x.v, 100));
  const has30 = rows.filter((x) => near(x.v, 30));
  if (has100.length && has30.length) {
    hits.push({ id: r.id, name: r.name, has100, has30, n: rows.length });
  }
}
console.log('  ★ 同时含 100 与 30 的记录 = ' + hits.length + ' 个');
for (const h of hits.slice(0, 8)) {
  console.log('    ── id=' + h.id + '  name=' + h.name + '（字段 ' + h.n + '）');
  console.log('       100 ⇒ ' + h.has100.map((x) => x.path + '[' + x.kind + ']').join('  '));
  console.log('       30  ⇒ ' + h.has30.map((x) => x.path + '[' + x.kind + ']').join('  '));
}
// 另外：note 记录整体 dump（含浮点）
console.log('  ══ note 记录的全部数值（含浮点）══');
for (const r of g.recs.filter((x) => x.name === 'note').slice(0, 2)) {
  console.log('    id=' + r.id);
  const rows = walk(r);
  const interesting = rows.filter((x) => x.v !== 0 && Math.abs(x.v) < 100000);
  console.log('      ' + interesting.map((x) => x.path + '=' + (Number.isInteger(x.v) ? x.v : x.v.toFixed(2)) + '(' + x.kind + ')').join('\n      '));
}