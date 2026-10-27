import { readGil, encodeMsg } from './gilread.mjs';
const a = readGil('208.2.gil'), b = readGil('211-弹窗底图.gil');
const key = (g, n) => { const r = g.recs.find((x) => x.name === n); return r ? encodeMsg(r.field.sub) : null; };
const names = ['clues','clues.bg','clues.grid','clue','stage','board.bg','cell.1.1','tpl.cell','tpl.stage','content','face','note','x','wall.up','wall.left','door.up','right','hud.title','hud.subtitle'];
console.log('  ── 208.2 → 211：这些记录的字段字节是否被改 ──');
let changed = 0, same = 0, absent = 0;
for (const n of names) {
  const A = key(a, n), B = key(b, n);
  if (!A && !B) { console.log('    ' + n.padEnd(14) + '两边都没有'); absent++; continue; }
  if (!A || !B) { console.log('    ' + n.padEnd(14) + '★ 只有一边有: 208.2=' + (A?'有':'无') + ' 211=' + (B?'有':'无')); changed++; continue; }
  if (A.equals(B)) { same++; }
  else { changed++; console.log('    ' + n.padEnd(14) + '✗ 字节不同  208.2=' + A.length + '  211=' + B.length); }
}
console.log('    相同 ' + same + ' / 改动 ' + changed + ' / 缺失 ' + absent);
console.log('  ── 211 比 208.2 多出来的记录名（前 40）──');
const ai = new Set(a.recs.map((r) => r.id));
const nw = b.recs.filter((r) => !ai.has(r.id) && r.name).map((r) => r.name);
console.log('    共 ' + nw.length + ' 个: ' + nw.slice(0, 40).join(' '));
console.log('  ── clues.grid 的关键属性（itemPrefabIndex 1073742421 还在吗）──');
for (const [tag, g] of [['208.2', a], ['211', b]]) {
  const r = g.recs.find((x) => x.name === 'clues.grid');
  if (!r) { console.log('    ' + tag + ' clues.grid 缺'); continue; }
  const bytes = encodeMsg(r.field.sub);
  const hay = bytes.toString('latin1');
  console.log('    ' + tag + ' clues.grid 长度=' + bytes.length + '  含 1073742421=' + hay.includes('1073742421'));
}