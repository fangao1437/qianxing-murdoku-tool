// tools/gil/set_own_image.mjs —— 给【控件自身】写 imageId（**不是** `bg` 子控件）
//
// 为什么单独写一个（用户 2026-10-15 指令 ✓）：
//   ★ `set_key_art.mjs` 只改**子控件** `bg` 的图 ✗
//   ★ 而关卡内那七颗 `hex.*` 图标是 **62×62、0 个子控件** ⇒ **图挂在控件自己身上** ✓
//     （`_probe_modal.mjs` 实测：`hit.back` 子控件列表 0 个 ✓）
//   ⇒ 换左右箭头图就得写**控件自身**的那处引用 ✓
//
// ★ 图片引用的权威位置（沿用 `set_key_art.mjs` 实测结论 ✓）：
//     · 路径 `/505/503/84#503`（imageId）✓
//     · `/505/503/84#502` = imageSource ✓（不动它 ⇒ 沿用控件自己的 source ✓）
//   ★ 层级不能按字段号下钻（中间节点会重复）⇒ 只能**递归收集叶子、按路径字符串匹配** ✓
//   ★ 保存必须 encodeMsg(g.tree) → g.pack(body) ✓
//
// 用法：
//   node tools/gil/set_own_image.mjs --in=<存档> --out=<输出> --set="名:imageId[,名:imageId…]"
//   例：node tools/gil/set_own_image.mjs --in=a.gil --out=b.gil --set="select.prev:100104,select.next:100103"
//
// ★ 收尾必跑：`node tools/gil/roundtrip.mjs <输出>`（自带从磁盘重读断言 ✓）

import fs from 'node:fs';
import { readGil, encodeMsg } from './gilread.mjs';

const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
const IN = argOf('in'), OUT = argOf('out'), SET = argOf('set');
if (!IN || !OUT || !SET) {
  console.error('用法: node tools/gil/set_own_image.mjs --in=<存档> --out=<输出> --set="名:imageId[,…]"');
  process.exit(1);
}

const IMG_PATH = '/505/503/84#503';

function leaves(fields, path, out) {
  for (const f of fields) {
    if (f.sub) { leaves(f.sub, path + '/' + f.field, out); continue; }
    out.push([path + '#' + f.field, f]);
  }
  return out;
}
function imgIdOf(rec) {
  const o = leaves(rec.field.sub, '', []);
  const l = o.filter(([p, f]) => p === IMG_PATH && f.wt === 0);
  return l.length ? Number(l[0][1].num) : null;
}
function setImgId(rec, id) {
  const o = leaves(rec.field.sub, '', []);
  let n = 0;
  for (const [p, f] of o) {
    if (p === IMG_PATH && f.wt === 0) { f.num = BigInt(id); n++; }
  }
  return n;
}

const g = readGil(IN);
console.log('  读入 ' + IN + '  记录 ' + g.recs.length);

const jobs = [];
for (const part of SET.split(',')) {
  const m = /^([^:]+):(\d+)$/.exec(part.trim());
  if (!m) { console.error('✗ 解析不了 --set 的一段：' + part); process.exit(1); }
  jobs.push([m[1], Number(m[2])]);
}

let changed = 0;
for (const [name, id] of jobs) {
  const rec = g.recs.find((r) => r.name === name);
  if (!rec) { console.error('  ✗ 找不到 ' + name); process.exit(2); }
  const before = imgIdOf(rec);
  const n = setImgId(rec, id);
  if (n === 0) { console.error('  ✗ ' + name + ' 自身没有图片引用字段（' + IMG_PATH + '）'); process.exit(3); }
  changed += n;
  console.log('  ' + name.padEnd(18) + ' id=' + rec.id + '  imageId ' + before + ' → ' + id + '（改 ' + n + ' 处）');
}

const body = encodeMsg(g.tree);
const buf = g.pack(body);
fs.writeFileSync(OUT, buf);
console.log('  ★ 已写出 ' + OUT + '  ' + buf.length + ' 字节（共改 ' + changed + ' 处）');

const g2 = readGil(OUT);
for (const [name, id] of jobs) {
  const rec = g2.recs.find((r) => r.name === name);
  const got = imgIdOf(rec);
  console.log('  ' + (got === id ? '✅' : '❌') + ' ' + name.padEnd(18) + ' 复读 imageId=' + got);
}
process.exit(0);
