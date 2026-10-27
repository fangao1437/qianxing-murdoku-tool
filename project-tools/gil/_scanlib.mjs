import { readGil } from './gilread.mjs';
const g = readGil('214.3.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
function nums(fs, out) {
  for (const f of fs) {
    if (f.sub) { nums(f.sub, out); continue; }
    const p = f.payload; if (!p || p.length === undefined) continue;
    const b = Buffer.from(p);
    if (b.length === 4) { const u = b.readUInt32BE(0); if (u > 100000) out.push(f.field + ':' + u); }
    if (b.length === 8) { out.push(f.field + ':8B'); }
  }
}
const lib = g.recs.filter((r) => r.parentId === 1 || r.parentId === 1073741844 || r.parentId === 1073741825);
console.log('  ★ 库层记录 ' + lib.length + ' 条：');
for (const r of lib) {
  const o = []; nums(r.field.sub, o);
  console.log('    ' + String(r.name || '(无名)').padEnd(20) + ' id=' + r.id + ' 父=' + r.parentId
    + '  数字=[' + o.slice(0, 6).join(' ') + ']  顶层字段=' + r.field.sub.length);
}
console.log('  ★ 全档里出现过的 107374xxxx 引用值（★ 前 20 个 ✓ 可能是 prefab/元件索引 ✓）：');
const seen = new Set();
for (const r of g.recs) { const o = []; nums(r.field.sub, o); for (const s of o) { const v = Number(String(s).split(':')[1]); if (v > 1073700000 && v < 1074300000) seen.add(v); } }
console.log('    ' + [...seen].slice(0, 20).join(' , ') + '   （共 ' + seen.size + ' 个）');