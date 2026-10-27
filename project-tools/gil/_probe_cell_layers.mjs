// tools/gil/_probe_cell_layers.mjs —— 只读：把**所有** `content` 子树里的图层现状打出来
//   用途：模板在存档里有**两份**（顶层无父 / 原型层级根下），改完必须两份都核对。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '399-贴格-门墙-v256.gil';
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

function imageBlock(rec) {
  let hit = null;
  (function walk(fs_) {
    for (const f of fs_ || []) {
      if (f.field === 84 && f.sub) { hit = f; return; }
      if (f.sub && !hit) walk(f.sub);
    }
  })(rec.field.sub);
  return hit;
}
const numOf = (blk, no) => {
  const f = blk && blk.sub.find((x) => x.field === no && x.wt === 0);
  return f ? Number(f.num) : null;
};
const hex = (v) => (v == null ? '—' : '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0'));

const contents = g.recs.filter((r) => r.name === 'content');
console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length);
console.log('content 记录 ' + contents.length + ' 个：' + contents.map((c) => '#' + c.id + '(父 ' + c.parentId + ')').join('  '));
for (const c of contents) {
  const kids = g.recs.filter((r) => Number(r.parentId) === Number(c.id));
  console.log('\n── content #' + c.id + ' 的 ' + kids.length + ' 个子控件 ──');
  for (const k of kids) {
    const blk = imageBlock(k);
    if (!blk) { console.log('  ' + k.name.padEnd(11) + ' #' + k.id + '　(无图片块)'); continue; }
    console.log('  ' + k.name.padEnd(11) + ' #' + k.id
      + '　imageColor=' + hex(numOf(blk, 502))
      + '　imageId=' + numOf(blk, 503)
      + '　imageType=' + numOf(blk, 504));
  }
}
