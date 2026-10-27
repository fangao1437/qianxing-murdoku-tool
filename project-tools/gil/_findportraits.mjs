import { readGil } from './gilread.mjs';
const g = readGil('214.3.gil');
const out = [];
function walk(fs, path, name) {
  for (const f of fs) {
    if (f.sub) { walk(f.sub, path + '/' + f.field, name); continue; }
    const p = f.payload;
    if (!p || p.length === undefined) continue;
    const b = Buffer.from(p);
    if (b.length === 4) {
      const u = b.readUInt32BE(0);
      if (u >= 100000 && u <= 9999999) out.push([name, path + '#' + f.field, 'id=' + u]);
      if (u > 4000000000) out.push([name, path + '#' + f.field, 'src=' + u]);
    }
  }
}
for (const r of g.recs) {
  const n = String(r.name || '');
  if (!/face|portrait|badge|clue/i.test(n)) continue;
  walk(r.field.sub, '', n + '(id=' + r.id + ')');
}
const byName = new Map();
for (const [n, p, v] of out) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(p + ' = ' + v); }
for (const [n, arr] of byName) console.log('  ' + n + '\n      ' + arr.slice(0, 5).join('\n      '));
console.log('  ★ 共 ' + byName.size + ' 条含图片引用的记录');