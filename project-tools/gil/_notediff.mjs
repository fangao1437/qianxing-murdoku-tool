import { readGil } from './gilread.mjs';
function val(f) {
  const p = f.payload;
  if (p === undefined || p === null) return f.value !== undefined ? String(f.value) : '(nil)';
  if (typeof p === 'number' || typeof p === 'bigint') return String(p);
  if (typeof p === 'string') return p;
  if (p.length === undefined) return String(p);
  if (f.isText) return Buffer.from(p).toString('utf8');
  let v = 0n; for (let i = 0; i < p.length; i++) v = (v << 8n) | BigInt(p[i]);
  return v.toString();
}
function scalars(rec) {
  const out = {};
  (function walk(fs, path) {
    for (const f of fs) {
      if (f.sub) { walk(f.sub, path + '/' + f.field); continue; }
      out[path + '/' + f.field] = val(f);
    }
  })(rec.field.sub, '');
  return out;
}
const A = readGil('213-弹窗四键.gil'), B = readGil('213.1.gil');
const pick = (g, id) => g.recs.find((r) => r.id === id);
for (const id of [1073741881]) {
  const a = scalars(pick(A, id)), b = scalars(pick(B, id));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  console.log('  ══ note id=' + id + '  字段 ' + keys.length + ' ══');
  let diff = 0;
  for (const k of keys) if (a[k] !== b[k]) { diff++; console.log('    ✗ ' + k + '  213=' + a[k] + '  213.1=' + b[k]); }
  console.log('    差异 ' + diff + ' 个；213.1 全部字段：');
  for (const k of keys) console.log('      ' + k + ' = ' + b[k]);
}