// tools/gil/_probe_visible.mjs —— 临时探针：找出"可见/不可见"存在哪个字段
//   目的：四键"没有图文"—— 而存档里 bg 的 imageId 已经是 107179 ✓
//   ⇒ 头号嫌疑是 **bg/label 自己 visible=false**（`gen_btn_art.mjs:47-59` 记过这个坑 ✓）
//   用法：node tools/gil/_probe_visible.mjs <存档.gil>
import { readGil } from './gilread.mjs';

const g = readGil(process.argv[2] || '228-四键配图修好.gil');

const scan = (rec, tag) => {
  const subs = (rec.field && rec.field.sub) || [];
  const out = [];
  for (const s of subs) {
    if (s.wt === 0) out.push('#' + s.field + '=' + s.num);
    else out.push('#' + s.field + '[wt2 n=' + ((s.sub || []).length) + ']');
  }
  console.log(tag.padEnd(24) + ' ' + out.join('  '));
};

console.log('=== 四键的子控件 ===');
for (const k of ['modal.exit', 'modal.save', 'modal.settle', 'modal.cancel']) {
  const rec = g.byName.get(k);
  if (!rec) { console.log(k + ' 缺'); continue; }
  scan(rec, k + ' (本体)');
  for (const nm of ['bg', 'label']) {
    const c = g.recs.find((r) => r.parentId === rec.id && r.name === nm);
    if (c) scan(c, '  .' + nm);
  }
}

console.log('\n=== 对照：格子里明确 visible 的 ===');
const cell = g.recs.find((r) => r.name === 'cell.1.1');
if (cell) {
  scan(cell, 'cell.1.1');
  for (const nm of ['face', 'note', 'x', 'content']) {
    const c = g.recs.find((r) => r.parentId === cell.id && r.name === nm);
    if (c) scan(c, '  .' + nm);
  }
}
console.log('\n（真机日志给的对照：cell.1.1 的 face visible=true、note visible=false、x visible=false）');
