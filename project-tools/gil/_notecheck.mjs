import { readGil } from './gilread.mjs';
function scalars(rec) {
  const out = {};
  (function walk(fs, path) {
    for (const f of fs) {
      if (f.sub) { walk(f.sub, path + '/' + f.field); continue; }
      if (f.isText) { out[path + '/' + f.field + '(s)'] = f.payload.toString('utf8'); continue; }
      if (f.payload && f.payload.length <= 8) {
        let v = 0n; for (const b of f.payload) v = (v << 8n) | BigInt(b);
        out[path + '/' + f.field] = v.toString();
      }
    }
  })(rec.field.sub, '');
  return out;
}
for (const file of ['213.1.gil', '213-弹窗四键.gil']) {
  let g; try { g = readGil(file); } catch (e) { console.log('  ' + file + ' 读不了: ' + e.message); continue; }
  console.log('  ══ ' + file + '  记录数=' + g.recs.length + ' ══');
  const notes = g.recs.filter((r) => (r.name || '') === 'note' || /\.note$/.test(r.name || ''));
  console.log('  名为 note 的记录 = ' + notes.length);
  for (const r of notes.slice(0, 3)) {
    const s = scalars(r);
    const keys = Object.keys(s).filter((k) => /8[0-9]$|1[0-9]$|size|align|width|height/i.test(k) || s[k].length > 4);
    console.log('    id=' + r.id + '  name=' + r.name + '  字段数=' + Object.keys(s).length);
    console.log('      ' + keys.slice(0, 14).map((k) => k + '=' + s[k]).join('  '));
    const txt = Object.entries(s).filter(([k]) => k.includes('(s)'));
    if (txt.length) console.log('      文本字段: ' + txt.map(([k, v]) => k + '=' + v).join('  '));
  }
}