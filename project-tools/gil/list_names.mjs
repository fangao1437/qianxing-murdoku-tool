// tools/gil/list_names.mjs —— 列出某个 .gil 里的**控件名**（精确，按记录解析）
//
// 为什么需要：用 `Contains` 在原始字节里搜名字**会误判** —— 短名是长名的前缀
// （实测 `tray.A` 命中 5 次其实来自更长的字符串，用户的存档里根本没有这张卡）。
// 只有按"控件记录 → 实例名字段"解析出来的名字才是真的。
//
// 用法：
//   node tools/gil/list_names.mjs <存档.gil>            # 全部
//   node tools/gil/list_names.mjs <存档.gil> <过滤子串>  # 只看名字含该子串的

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || path.join(ROOT, '完整界面2.gil');
const filter = process.argv[3] || null;

const g = readGil(file);
const rows = g.recs.filter((r) => r.name).sort((a, b) => a.name.localeCompare(b.name));

console.log('文件：' + path.basename(file));
console.log('控件记录 ' + g.recs.length + ' 条，其中有名字的 ' + rows.length + ' 个\n');

const show = filter ? rows.filter((r) => r.name.includes(filter)) : rows;
if (filter) console.log('（过滤：名字含 "' + filter + '"，命中 ' + show.length + ' 个）\n');
for (const r of show) {
  const parent = g.recs.find((x) => x.id === r.parentId);
  const sz = r.states.length ? (() => {
    const p = r.states[0].sub.find((x) => x.field === 505);
    const fl = (p && p.sub ? p.sub : []).filter((x) => x.wt === 5);
    return fl.length === 2 ? fl[0].f.toFixed(0) + 'x' + fl[1].f.toFixed(0) : '?';
  })() : '?';
  console.log('  ' + String(r.id).padStart(11) + '  ' + r.name.padEnd(26)
    + ' 父=' + String(parent ? parent.name : r.parentId).padEnd(14) + ' 尺寸 ' + sz);
}
