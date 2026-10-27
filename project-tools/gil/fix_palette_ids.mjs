// tools/gil/fix_palette_ids.mjs —— 把 portrait.* 的 imageId 改成【已确证】的 4 个值
// 用法： node tools/gil/fix_palette_ids.mjs --in=218.1.gil --out=222-调色板-修正.gil
// ★ 关键（今天学到的）：
//   ① 这个 gil 的层级**不能按字段号下钻**（中间节点会重复 ⇒ 命中 0 个 ✗）
//      ⇒ **只能递归收集叶子、再按“路径字符串”匹配** ✓
//   ② 保存必须 `encodeMsg(g.tree)` → `g.pack(body)`（漏 body 会崩 ✗）
//   ③ 图片引用的权威位置 = 路径 `/505/503/84#503`（imageId）与 `#502`（imageSource）
//      依据：模板 clue.face 就是这里 = 100001，与编辑器显示一致 ✓
import fs from 'node:fs';
import { readGil, encodeMsg } from './gilread.mjs';
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const IN = argOf('in'), OUT = argOf('out');
const IDS = { 'portrait.A': 112042, 'portrait.B': 105104, 'portrait.V': 112031, 'portrait.D': 105105 };
if (!IN || !OUT) { console.error('要 --in= 与 --out='); process.exit(1); }
const g = readGil(IN);
console.log('  读入 ' + IN + '  记录 ' + g.recs.length);
// 递归收集叶子：返回 [路径, 字段对象]
function leaves(fs, path, out) {
  for (const f of fs) {
    if (f.sub) { leaves(f.sub, path + '/' + f.field, out); continue; }
    out.push([path + '#' + f.field, f]);
  }
  return out;
}
let total = 0;
for (const [name, id] of Object.entries(IDS)) {
  const r = g.recs.find((x) => x.name === name);
  if (!r) { console.error('  ✗ 找不到 ' + name); process.exit(2); }
  const o = leaves(r.field.sub, '', []);
  const idLeaves = o.filter(([p, f]) => p === '/505/503/84#503' && f.wt === 0);
  const srcLeaves = o.filter(([p, f]) => p === '/505/503/84#502' && f.wt === 0);
  const before = idLeaves.map(([, f]) => Number(f.num));
  for (const [, f] of idLeaves) f.num = BigInt(id);
  total += idLeaves.length;
  console.log('  ' + name.padEnd(12) + ' imageId ' + JSON.stringify(before) + ' → ' + id
    + '（改了 ' + idLeaves.length + ' 处 ✓）  source=' + JSON.stringify(srcLeaves.map(([, f]) => Number(f.num))));
}
const body = encodeMsg(g.tree);
const buf = g.pack(body);
fs.writeFileSync(OUT, buf);
console.log('  ★ 已写出 ' + OUT + '  ' + buf.length + ' 字节  （共改 ' + total + ' 处）');
// 复读验证（★ 仍用递归匹配 ✓）
const g2 = readGil(OUT);
for (const name of Object.keys(IDS)) {
  const r = g2.recs.find((x) => x.name === name);
  const o = leaves(r.field.sub, '', []);
  const got = o.filter(([p, f]) => p === '/505/503/84#503' && f.wt === 0).map(([, f]) => Number(f.num));
  const ok = got.length > 0 && got.every((v) => v === IDS[name]);
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + name.padEnd(12) + ' 复读 imageId=' + JSON.stringify(got));
}
process.exit(0);