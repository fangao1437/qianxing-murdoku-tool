// tools/gil/set_key_art.mjs —— 给四键的 bg 子控件写入胶囊底图 107179
// 用法: node tools/gil/set_key_art.mjs --in=222-调色板-修正.gil --out=223-四键-胶囊图.gil
// ★ 关键（今天学到的）：
//   ① 这个 gil 的层级**不能按字段号下钻**（中间节点会重复）⇒ 只能递归收集叶子、按【路径字符串】匹配
//   ② 图片引用的权威位置 = 路径 `/505/503/84#503`（imageId），`#502` = imageSource（沿用控件自己的）
//   ③ 保存必须 encodeMsg(g.tree) → g.pack(body)
import fs from 'node:fs';
import { readGil, encodeMsg } from './gilread.mjs';
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const IN = argOf('in'), OUT = argOf('out');
const CAPSULE = 107179;
const KEYS = ['modal.exit', 'modal.save', 'modal.settle', 'modal.cancel'];
if (!IN || !OUT) { console.error('要 --in= 与 --out='); process.exit(1); }
const g = readGil(IN);
function leaves(fs, path, out) { for (const f of fs) { if (f.sub) { leaves(f.sub, path + '/' + f.field, out); continue; } out.push([path + '#' + f.field, f]); } return out; }
function imgIdOf(rec) { const o = leaves(rec.field.sub, '', []); const l = o.filter(([p, f]) => p === '/505/503/84#503' && f.wt === 0); return l.length ? Number(l[0][1].num) : null; }
function setImgId(rec, id) { const o = leaves(rec.field.sub, '', []); let n = 0; for (const [p, f] of o) { if (p === '/505/503/84#503' && f.wt === 0) { f.num = BigInt(id); n++; } } return n; }
console.log('  读入 ' + IN + '  记录 ' + g.recs.length);
let changed = 0;
for (const k of KEYS) {
  const key = g.recs.find((r) => r.name === k);
  if (!key) { console.error('  ✗ 找不到 ' + k); process.exit(2); }
  const kids = g.recs.filter((r) => r.parentId === key.id);
  const bg = kids.find((r) => r.name === 'bg');
  if (!bg) { console.error('  ✗ ' + k + ' 下没有 bg（子=' + kids.map((c) => c.name).join(',') + '）'); process.exit(3); }
  const before = imgIdOf(bg);
  const srcLeaves = leaves(bg.field.sub, '', []).filter(([p, f]) => p === '/505/503/84#502' && f.wt === 0);
  const src = srcLeaves.length ? Number(srcLeaves[0][1].num) : null;
  changed += setImgId(bg, CAPSULE);
  console.log('  ' + k.padEnd(14) + ' bg id=' + bg.id + '  imageId ' + before + ' → ' + CAPSULE + '   source=' + src);
}
const body = encodeMsg(g.tree);
const buf = g.pack(body);
fs.writeFileSync(OUT, buf);
console.log('  ★ 已写出 ' + OUT + '  ' + buf.length + ' 字节（共改 ' + changed + ' 处）');
const g2 = readGil(OUT);
for (const k of KEYS) {
  const key = g2.recs.find((r) => r.name === k);
  const bg = g2.recs.filter((r) => r.parentId === key.id).find((r) => r.name === 'bg');
  const got = imgIdOf(bg);
  console.log('  ' + (got === CAPSULE ? '✅' : '❌') + ' ' + k.padEnd(14) + ' 复读 imageId=' + got);
}
process.exit(0);