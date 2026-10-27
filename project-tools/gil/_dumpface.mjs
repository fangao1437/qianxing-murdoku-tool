import { readGil } from './gilread.mjs';
const g = readGil('214.3.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
const clue = g.recs.find((r) => r.name === 'clue' && r.id === 1073742421);
function leaves(fs, path, out) {
  for (const f of fs) {
    if (f.sub) { leaves(f.sub, path + '/' + f.field, out); continue; }
    const p = f.payload; const b = (p && p.length !== undefined) ? Buffer.from(p) : Buffer.alloc(0);
    let v = '';
    if (b.length === 4) v = 'u32=' + b.readUInt32BE(0) + ' f32=' + b.readFloatBE(0).toFixed(2);
    else if (b.length === 8) v = 'u64bytes=' + b.toString('hex') + ' f32x2=' + b.readFloatBE(0).toFixed(2) + ',' + b.readFloatBE(4).toFixed(2);
    else if (b.length > 0 && b.length < 40) v = 'hex=' + b.toString('hex') + ' txt=' + b.toString('utf8').replace(/[^\x20-\x7e]/g, '.');
    else v = 'len=' + b.length;
    out.push([path + '#' + f.field + ' (wt' + f.wt + ')', v]);
  }
}
for (const nm of ['face', 'backrop1']) {
  const r = g.recs.find((x) => x.parentId === clue.id && x.name === nm);
  if (!r) { console.log('  ' + nm + ' 找不到'); continue; }
  const o = []; leaves(r.field.sub, '', o);
  console.log('  ★ ' + nm + '（id=' + r.id + '）叶字段 ' + o.length + ' 个：');
  for (const [k, v] of o) if (v !== 'len=0') console.log('      ' + k.padEnd(26) + ' = ' + v);
}