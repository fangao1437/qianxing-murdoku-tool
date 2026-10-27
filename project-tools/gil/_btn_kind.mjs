import { readGil, encodeMsg, asIdList, findChildListTop } from './gilread.mjs';
const g = readGil('213-弹窗四键.gil');
const byId = new Map(g.recs.map((r) => [r.id, r]));
function ownChildren(rec) {
  const l = findChildListTop(rec.field.sub);
  return l ? (asIdList(l.payload, true) || []) : [];
}
// 收集一个记录里所有 #505 块中出现的、指向「本记录自己的子控件」的 ID
function stateRefs(rec) {
  const mine = new Set(ownChildren(rec).map(String));
  const refs = new Set();
  (function walk(fs) {
    for (const f of fs) {
      if (f.wt === 2 && f.sub === null && f.payload && f.payload.length) {
        const ids = asIdList(f.payload, true);
        if (ids) for (const id of ids) { if (mine.has(String(id))) refs.add(String(id)); }
      }
      if (f.sub) walk(f.sub);
    }
  })(rec.field.sub);
  return refs;
}
for (const name of ['home.select', 'modal.exit', 'modal.save', 'clues.bg', 'board.bg']) {
  const r = g.recs.find((x) => x.name === name);
  if (!r) { console.log('  ' + name.padEnd(14) + '缺'); continue; }
  const kids = ownChildren(r).map((id) => (byId.get(id) || {}).name || ('#' + id));
  const refs = [...stateRefs(r)].map((id) => (byId.get(BigInt(id)) || byId.get(Number(id)) || {}).name || id);
  const n505 = r.field.sub.filter((f) => f.wt === 2 && f.sub).length;
  console.log('  ' + name.padEnd(14) + '子=[' + kids.join(',') + ']  #505块=' + n505 + '  其中被"自己子控件"引用=' + JSON.stringify(refs));
}
console.log('  ── modal.exit 与 home.select 的顶层字段号序列对比 ──');
for (const name of ['home.select', 'modal.exit']) {
  const r = g.recs.find((x) => x.name === name);
  console.log('  ' + name.padEnd(14) + r.field.sub.map((f) => '#' + f.field + (f.sub ? '{}' : '')).join(' '));
}