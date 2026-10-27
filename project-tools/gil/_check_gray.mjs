import { readGil, findChildListTop, asIdList } from './gilread.mjs';
const g = readGil('214灰白.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
const rec = g.recs.find((r) => r.name === 'gray');
console.log('  记录数 = ' + g.recs.length + '   找到 gray = ' + (rec ? ('id=' + rec.id) : '**没有**'));
if (!rec) {
  // 看看新增了什么
  const ids = g.recs.map((r) => r.name);
  console.log('  全部名字：' + ids.join(' , '));
} else {
  const par = byId.get(rec.parentId);
  console.log('  父级 = ' + (par ? (par.name + ' (id=' + par.id + ')') : rec.parentId));
  // 在父级子列表里的位置（用于判断是否最上层 = 最后一个）
  const l = findChildListTop(par.field.sub);
  const kids = l ? (asIdList(l.payload, true) || []) : [];
  const idx = kids.indexOf(rec.id);
  console.log('  同级子控件(' + kids.length + ')：' + kids.map((k) => (byId.get(k) || {}).name || k).join(' , '));
  console.log('  ★ 序号 = ' + (idx + 1) + ' / ' + kids.length + (idx === kids.length - 1 ? '  ⇒ 最后一个 = 最上层 ✓' : '  ⇒ **不是最后一个** ✗'));
  // 字段与几何
  function walk(fs, path, out) {
    for (const f of fs) {
      if (f.sub) { walk(f.sub, path + '/' + f.field, out); continue; }
      if (f.isText) { out.push([path + '/' + f.field, 'text:' + f.payload.toString('utf8')]); continue; }
      const b = Buffer.from(f.payload);
      if (b.length === 4) out.push([path + '/' + f.field + ' f32', b.readFloatBE(0).toFixed(2)]);
      let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x);
      out.push([path + '/' + f.field, Number(v)]);
    }
  }
  const out = [];
  walk(rec.field.sub, '', out);
  console.log('  ★ 字段（' + out.length + '）：');
  for (const [k, v] of out) console.log('      ' + k + ' = ' + v);
}