import { readGil, asIdList, findChildListTop } from './gilread.mjs';
const g = readGil('213-弹窗四键.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
// 遍历记录的全部字段，找出所有"布尔/标量"小字段，用于对比
function scalars(rec) {
  const out = {};
  (function walk(fs, path) {
    for (const f of fs) {
      if (f.sub) { walk(f.sub, path + '/' + f.field); continue; }
      if (f.isText) { out[path + '/' + f.field + '(s)'] = f.payload.toString('utf8'); continue; }
      if (f.payload && f.payload.length <= 8) {
        let v = 0n;
        for (const b of f.payload) v = (v << 8n) | BigInt(b);
        out[path + '/' + f.field] = v.toString();
      }
    }
  })(rec.field.sub, '');
  return out;
}
const pairs = [['home.select.bg', 'modal.exit.bg'], ['home.select.label', 'modal.exit.label']];
for (const [a, b] of pairs) {
  const A = g.recs.find((r) => r.name === a) || null;
  const B = g.recs.find((r) => r.name === b) || null;
  console.log('  ── ' + a + '  vs  ' + b + ' ──');
  if (!A || !B) { console.log('    找不到（注意：子控件的 name 字段可能只存末段）'); }
  const sa = A ? scalars(A) : {}, sb = B ? scalars(B) : {};
  const keys = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].sort();
  let diff = 0;
  for (const k of keys) {
    if (sa[k] !== sb[k]) { diff++; if (diff <= 8) console.log('    ✗ ' + k.padEnd(22) + 'home=' + sa[k] + '   modal=' + sb[k]); }
  }
  console.log('    标量字段 ' + keys.length + ' 个，差异 ' + diff + ' 个');
}
// 直接找所有名字里含 bg 的记录，打印它们的可见相关字段
console.log('  ── 所有 bg 记录的标量（找 visible 类字段）──');
for (const r of g.recs.filter((x) => x.name === 'bg')) {
  const s = scalars(r);
  const keys = Object.keys(s).filter((k) => /#(501|502|504)$/.test(k) || s[k] === '0' || s[k] === '1');
  console.log('    ' + (byId.get(r.parentId) || {}).name + '.bg  id=' + r.id + '  ' + keys.slice(0, 8).map((k) => k + '=' + s[k]).join('  '));
}