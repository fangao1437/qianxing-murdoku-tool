// tools/gil/_probe_btn.mjs —— 临时探针：拿"真机上文字正常的按钮"对照"四键"
//   真机日志 ✓：action.back / home.select / home.bag / home.continue / home.shop
//     「想要 "返回列表" → 读回 返回列表  fontSize=24 visible=true」⇒ **它们正常** ✓
//   而四键「还没有图文」✗ ⇒ 逐字段比对两边的**结构**，差异就是答案 ✓
//   用法：node tools/gil/_probe_btn.mjs <存档.gil>
import { readGil, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const g = readGil(process.argv[2] || '228-四键配图修好.gil');

const shape = (rec) => {
  const subs = (rec.field && rec.field.sub) || [];
  const parts = [];
  for (const s of subs) {
    if (s.wt === 0) parts.push('#' + s.field);
    else parts.push('#' + s.field + '[' + ((s.sub || []).length) + ']');
  }
  return parts.join(' ');
};
const geo = (rec) => {
  const o = []; stateBlocks(rec.field.sub, o);
  if (!o[0]) return '（无状态块）';
  return 'pos=(' + pairValue(pairOf(o[0], 504), 0) + ',' + pairValue(pairOf(o[0], 504), 1) + ')'
    + ' size=(' + pairValue(pairOf(o[0], 505), 0) + '×' + pairValue(pairOf(o[0], 505), 1) + ')';
};
const show = (name) => {
  const rec = g.byName.get(name);
  if (!rec) { console.log('  ' + name + '  —— **不存在** ✗'); return; }
  console.log('  ' + name.padEnd(20) + ' #' + rec.id + '  ' + geo(rec));
  console.log('      ' + shape(rec));
  const kids = g.recs.filter((r) => r.parentId === rec.id);
  for (const k of kids) {
    console.log('      └ ' + k.name.padEnd(14) + ' #' + k.id + '  ' + geo(k));
    console.log('         ' + shape(k));
  }
};

console.log('=== 真机上【文字正常】的按钮 ===');
for (const n of ['action.back', 'home.select', 'home.bag']) show(n);

console.log('\n=== 【没有图文】的四键 ===');
for (const n of ['modal.exit', 'modal.save']) show(n);

console.log('\n=== 对照：格子里明确配好的 face ===');
const cell = g.recs.find((r) => r.name === 'cell.1.1');
if (cell) {
  const f = g.recs.find((r) => r.parentId === cell.id && r.name === 'face');
  if (f) { console.log('  face #' + f.id + '  ' + geo(f)); console.log('      ' + shape(f)); }
}
