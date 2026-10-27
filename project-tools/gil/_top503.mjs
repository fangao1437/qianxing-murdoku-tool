import { readGil, asIdList } from './gilread.mjs';
function topFields(rec) {
  return rec.field.sub.map((f) => {
    if (f.wt === 0) return '#' + f.field;
    if (f.sub !== null) return '#' + f.field + '{}';
    return '#' + f.field + (f.isText ? '(s)' : '(b)');
  }).join(' ');
}
function childListTop(rec) {
  for (let i = 0; i < rec.field.sub.length; i++) {
    const f = rec.field.sub[i];
    if (f.wt === 2 && f.sub === null && !f.isText && f.payload) {
      const ids = asIdList(f.payload, true);
      if (ids !== null) return { at: i, ids };
    }
  }
  return null;
}
for (const file of ['208.1.gil', '223-批量.gil']) {
  const g = readGil(file);
  console.log('  ═══ ' + file + '   记录 ' + g.recs.length + ' ═══');
  for (const name of ['root', 'home', 'select', 'board', 'tray', 'assets', 'clues', 'modal', 'stage', 'proto.btn']) {
    const r = g.recs.find((x) => x.name === name);
    if (!r) { console.log('    ' + name.padEnd(11) + ' 缺'); continue; }
    const cl = childListTop(r);
    const pos = r.field.sub.findIndex((f) => f.field === 503 && f.wt === 2 && f.sub === null && !f.isText);
    console.log('    ' + name.padEnd(11) + '顶层字段: ' + topFields(r).padEnd(40)
      + ' | 顶层#503 位置=' + (pos >= 0 ? pos : '**无**')
      + ' 子控件=' + (cl ? cl.ids.length : '—'));
  }
}