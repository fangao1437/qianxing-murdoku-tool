import { readGil } from './gilread.mjs';
const g = readGil('214灰白.gil');
const rec = g.recs.find((r) => r.name === 'gray');
function val(f) {
  const p = f.payload;
  if (p === undefined || p === null) return f.value !== undefined ? String(f.value) : '(空)';
  if (typeof p === 'number' || typeof p === 'bigint') return String(p);
  if (typeof p === 'string') return p;
  if (p.length === undefined) return String(p);
  const b = Buffer.from(p);
  if (f.isText) return 'text:' + b.toString('utf8');
  if (b.length === 4) {
    const fv = b.readFloatBE(0);
    if (Number.isFinite(fv) && Math.abs(fv) < 100000 && fv !== 0) return b.readUInt32BE(0) + ' / f32=' + fv.toFixed(2);
  }
  let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x);
  return Number(v) + (b.length === 4 ? ' (hex 0x' + b.readUInt32BE(0).toString(16).toUpperCase().padStart(8, '0') + ')' : '');
}
function walk(fs, path, out) {
  for (const f of fs) {
    if (f.sub) { walk(f.sub, path + '/' + f.field, out); continue; }
    out.push([path + '/' + f.field, val(f)]);
  }
}
const out = [];
walk(rec.field.sub, '', out);
console.log('  gray 字段数 = ' + out.length);
for (const [k, v] of out) console.log('    ' + k + ' = ' + v);