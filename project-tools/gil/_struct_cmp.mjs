import fs from 'node:fs';
import { parseMsg, geomPairs, bigIds, textsOf, KNOWN_TYPES } from './gilread.mjs';
function recsOf(file) {
  const buf = fs.readFileSync(file);
  const bodyEnd = 20 + buf.readUInt32BE(16);
  const tree = { sub: parseMsg(buf, 20, bodyEnd, 0) };
  const out = [];
  (function walk(fs2) {
    for (const f of fs2) {
      if (!f.sub) continue;
      if (geomPairs(f.sub, []).length >= 2 && bigIds(f.sub, []).length >= 1) {
        let deeper = 0;
        for (const c of f.sub) if (c.sub && geomPairs(c.sub, []).length >= 2 && bigIds(c.sub, []).length >= 1) deeper++;
        if (deeper === 0) {
          let parent = null;
          (function s(fs3) { for (const g of fs3) { if (g.wt === 0 && g.field === 504 && parent === null) parent = Number(g.num); if (g.sub) s(g.sub); } })(f.sub);
          const strs = textsOf(f.sub, []);
          let name = null;
          for (const t of strs) { const s2 = t.payload.toString('utf8'); if (!KNOWN_TYPES.has(s2)) { name = s2; break; } }
          out.push({ name, id: Number(bigIds(f.sub, [])[0].num), parent });
        }
        continue;
      }
      walk(f.sub);
    }
  })(tree.sub);
  return { recs: out, buf, bodyEnd };
}
for (const file of ['208.1.gil', '210-弹窗四键控件.gil']) {
  const { recs, buf, bodyEnd } = recsOf(file);
  const ids = recs.map((x) => x.id);
  const idSet = new Set(ids);
  const orphans = recs.filter((x) => x.parent !== null && x.parent !== 1 && !idSet.has(x.parent));
  console.log('  ' + file);
  console.log('    头[0..4] = ' + [0,4,8,12,16].map((o) => buf.readUInt32BE(o)).join(', ') + '   文件 ' + buf.length);
  console.log('    体 = ' + (bodyEnd - 20) + '   尾 ' + (buf.length - bodyEnd) + ' 字节 = ' + buf.subarray(bodyEnd).toString('hex'));
  console.log('    记录 ' + recs.length + '   ID ' + Math.min(...ids) + ' ~ ' + Math.max(...ids));
  console.log('    父不存在的 ' + orphans.length + (orphans.length ? ' → ' + orphans.slice(0, 10).map((o) => (o.name || '?') + '(父' + o.parent + ')').join(', ') : '  ✓'));
}
const A = recsOf('208.1.gil'); const B = recsOf('210-弹窗四键控件.gil');
const aIds = new Set(A.recs.map((x) => x.id));
const nw = B.recs.filter((x) => !aIds.has(x.id));
console.log('  ── 210 新增 ' + nw.length + ' 条  ID ' + Math.min(...nw.map((x) => x.id)) + ' ~ ' + Math.max(...nw.map((x) => x.id)) + '   208.1 最大 ID ' + Math.max(...A.recs.map((x) => x.id)));
const bOrph = nw.filter((x) => !new Set(B.recs.map((y) => y.id)).has(x.parent));
console.log('  新增里有 ' + bOrph.length + ' 条父不存在');