import { readGil } from './gilread.mjs';
function walk(rec) {
  const out = [];
  (function go(fs, path) {
    for (const f of fs) {
      if (f.sub) { go(f.sub, path + '/' + f.field); continue; }
      const p = f.payload;
      if (p === undefined || p === null || typeof p === 'number' || typeof p === 'string') continue;
      if (p.length === undefined || f.isText) continue;
      let v = 0n; for (let i = 0; i < p.length; i++) v = (v << 8n) | BigInt(p[i]);
      out.push([path + '/' + f.field, v]);
    }
  })(rec.field.sub, '');
  return out;
}
const g = readGil('214-笔记居中基准.gil');
const ids = [1073741881, 1073741892];
for (const id of ids) {
  const r = g.recs.find((x) => x.id === id);
  if (!r) { console.log('  id ' + id + ' 不在'); continue; }
  const fields = walk(r);
  console.log('  ══ note id=' + id + '（' + r.name + '）字段 ' + fields.length + ' 个 ══');
  // 找出"像尺寸/坐标"的数值：0..2000 之间
  const cand = fields.filter(([, v]) => v > 0n && v <= 2000n);
  console.log('    可能尺寸/坐标的值：' + cand.map(([k, v]) => k + '=' + v).join('  '));
  const hit100 = fields.filter(([, v]) => v === 100n || v === 30n || v === 124n || v === 37n);
  console.log('    ★ 命中 100/30/124/37 的字段：' + (hit100.length ? hit100.map(([k, v]) => k + '=' + v).join('  ') : '（无）'));
}