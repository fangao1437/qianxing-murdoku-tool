// tools/gil/img_block.mjs —— **只读**：摊开一条记录里"图片引用块" `/#505/#503/#84`
//
// 为什么：选关卡片 `select.card.N` 是 `hex.back` 的克隆 + 换图（官方白板 `100108`），
//   而真机上它**看起来不像 310×432 的竖卡** ✗。要判断"是图不对、还是填充方式不对"，
//   必须先把图片块的**全部字段**摊出来（id / source / 填充类型 …）。
//
// 用法：
//   node tools/gil/img_block.mjs <存档.gil> <名字…>

import path from 'node:path';
import { readGil } from './gilread.mjs';

const file = process.argv[2];
const names = process.argv.slice(3);
if (!file || !names.length) {
  console.error('用法: node tools/gil/img_block.mjs <存档.gil> <名字…>');
  process.exit(1);
}
const g = readGil(file);
console.log('文件：' + path.basename(file) + '\n');

function blocksAtPath(fields, want, path = '', out = []) {
  for (const f of fields) {
    const here = path + '/#' + f.field;
    if (f.sub && here === want) { out.push(f); continue; }
    if (f.sub) blocksAtPath(f.sub, want, here, out);
  }
  return out;
}

for (const nm of names) {
  const r = g.byName.get(nm);
  if (!r) { console.log(nm + '：(找不到)'); continue; }
  const blocks = blocksAtPath(r.field.sub, '/#505/#503/#84');
  console.log('# ' + nm + '  #' + r.id + '  图片块 ' + blocks.length + ' 个');
  for (const b of blocks) {
    console.log('  #84 msg(' + b.sub.length + '):');
    for (const f of b.sub) {
      if (f.sub) console.log('    #' + f.field + ' msg(' + f.sub.length + ') ' +
        f.sub.map((x) => '#' + x.field + (x.wt === 0 ? '=' + x.num : x.wt === 5 ? '=' + Number(x.f).toFixed(2) : x.wt === 2 ? '(bytes' + (x.len || 0) + ')' : '')).join(' '));
      else if (f.wt === 0) console.log('    #' + f.field + ' = ' + f.num);
      else if (f.wt === 5) console.log('    #' + f.field + ' = ' + Number(f.f).toFixed(3) + ' (float)');
      else console.log('    #' + f.field + ' ' + (f.isText ? 'str=' + JSON.stringify(f.payload.toString('utf8')) : 'bytes[' + (f.len || 0) + ']'));
    }
  }
  console.log('');
}
