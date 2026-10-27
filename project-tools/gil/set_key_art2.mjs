// tools/gil/set_key_art2.mjs —— 给四键 bg 写胶囊底图，并**同时把 imageSource 设为素材库哨兵**
// 用法: node tools/gil/set_key_art2.mjs --in=222-调色板-修正.gil --out=224-四键-胶囊图-图集修正.gil
// ★ 关键（从 portrait.* 的实战学到的）：
//   库里素材要用 `imageSource = 4294967295`（素材库哨兵）+ `imageId = 素材id`
//   只改 imageId、沿用控件自带图集 ⇒ 引擎在旧图集里找不到该 id ⇒ 图不显示
import fs from 'node:fs';
import { readGil, encodeMsg } from './gilread.mjs';
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const IN = argOf('in'), OUT = argOf('out');
const CAPSULE = 107179, LIB = 4294967295;
const KEYS = ['modal.exit', 'modal.save', 'modal.settle', 'modal.cancel'];
if (!IN || !OUT) { console.error('要 --in= 与 --out='); process.exit(1); }
const g = readGil(IN);
function leaves(fs, path, out) { for (const f of fs) { if (f.sub) { leaves(f.sub, path + '/' + f.field, out); continue; } out.push([path + '#' + f.field, f]); } return out; }
function pair(rec) {
  const o = leaves(rec.field.sub, '', []);
  const id = o.filter(([p, f]) => p === '/505/503/84#503' && f.wt === 0);
  const src = o.filter(([p, f]) => p === '/505/503/84#502' && f.wt === 0);
  return { id, src };
}
console.log('  读入 ' + IN);
let n = 0;
for (const k of KEYS) {
  const key = g.recs.find((r) => r.name === k);
  const bg = g.recs.filter((r) => r.parentId === key.id).find((r) => r.name === 'bg');
  if (!bg) { console.error('  ✗ ' + k + ' 下没有 bg'); process.exit(3); }
  const p = pair(bg);
  const before = p.id.length ? Number(p.id[0][1].num) : null;
  const bsrc = p.src.length ? Number(p.src[0][1].num) : null;
  for (const [, f] of p.id) { f.num = BigInt(CAPSULE); n++; }
  for (const [, f] of p.src) { f.num = BigInt(LIB); n++; }
  console.log('  ' + k.padEnd(14) + ' bg=' + bg.id + '  imageId ' + before + '→' + CAPSULE + ' (' + p.id.length + '处)   source ' + bsrc + '→' + LIB + ' (' + p.src.length + '处)');
}
const body = encodeMsg(g.tree);
const buf = g.pack(body);
fs.writeFileSync(OUT, buf);
console.log('  ★ 已写出 ' + OUT + '  ' + buf.length + ' 字节（共改 ' + n + ' 处）');
const g2 = readGil(OUT);
for (const k of KEYS) {
  const key = g2.recs.find((r) => r.name === k);
  const bg = g2.recs.filter((r) => r.parentId === key.id).find((r) => r.name === 'bg');
  const p = pair(bg);
  const id = p.id.length ? Number(p.id[0][1].num) : null;
  const src = p.src.length ? Number(p.src[0][1].num) : null;
  console.log('  ' + (id === CAPSULE && src === LIB ? '✅' : '❌') + ' ' + k.padEnd(14) + ' 复读 imageId=' + id + '  source=' + src);
}
process.exit(0);