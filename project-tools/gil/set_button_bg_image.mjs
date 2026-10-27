// tools/gil/set_button_bg_image.mjs —— 给若干按钮的 `bg` 子控件写入胶囊底图（107179）
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么写它（2026-10-16 用户指令 ✓）：
//   ★ 用户原话 ✓：「★ **图片引用 107179，顺便把主页另外四颗按钮也这么处理，位置尺寸不变**」✓
//   ★★ 前几轮我**自己另写探针**去猜图片引用在哪 ✗ —— ★ 用户点破 ✓：
//     「★ **编辑 gil，读取 gil，引用图片的各类工具仓库里都有，你对着它们把工作做对就行，
//        不同的工具得出不同结果这件事发生了不止一次，仓库里的东西至少都有生效案例**」✓✓
//   ⇒ ★ 这一份**照抄**本仓已验证的那条路 ✓（`set_key_art.mjs` / `set_own_image.mjs` ✓）：
//     · ★ 图片引用的**权威位置** = 路径 `/505/503/84#503`（imageId ✓）
//       ★ `/505/503/84#502` = imageSource ✓（★ 那个**不改** ✓ —— 沿用原控件的 ✓）
//     · ★ 层级**不能按字段号下钻** ✗（中间节点会重复 ✓）⇒ ★ 只能**递归收集叶子、按路径字符串匹配** ✓
//
//   ★★ 实测对照（本工具写之前，`381` ✓）：
//       | 控件             | imageId  | imageSource |
//       |------------------|----------|-------------|
//       | home.select/bg ✓ | 100108   | 4281536672  |
//       | home.bag/bg    ✓ | 100108   | 4281536672  |
//       | **modal.settle/bg** ✓ | ★ **107179** | 4294967295 |
//       | **settle.btn/bg** | 100108   | 4281536672  |
//     ⇒ ★ 用户说的"弹窗那个素材" = **107179** ✓ —— ★ 而它在存档里**是有值的** ✓
//       （★ 我前两轮说"存档里没有 107179" ✗ 是**我找错了层** ✓：我在**状态块**里找 ✓
//        而它在**记录顶层** `/505/503/84#503` ✓ —— ★ 这个路径就是仓库工具写明的那条 ✓）
//
// 用法：
//   node tools/gil/set_button_bg_image.mjs --in=<in.gil> --out=<out.gil> \
//        --buttons="settle.btn,home.select,home.continue,home.shop,home.bag" [--image=107179] [--dry]
//
// ★ 收尾必跑：`node tools/gil/roundtrip.mjs <输出>`（自带从磁盘重读断言 ✓）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const DRY = argv.includes('--dry');
const IN = argOf('in'), OUT = argOf('out');
const IMAGE = Number(argOf('image') || 107179);
const BUTTONS = (argOf('buttons') || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!IN || !OUT || BUTTONS.length === 0) {
  console.error('用法: --in= --out= --buttons="a,b,c" [--image=107179] [--dry]');
  process.exit(1);
}

const g = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
console.log('读入 ' + path.basename(g.file) + '  记录 ' + g.recs.length);

// ★ 递归收集叶子，按【路径字符串】匹配 ✓（照抄 `set_key_art.mjs` 的 leaves ✓）
function leaves(fs_, p, out) {
  for (const f of fs_) {
    if (f.sub) { leaves(f.sub, p + '/' + f.field, out); continue; }
    out.push([p + '#' + f.field, f]);
  }
  return out;
}
const IMG_PATH = '/505/503/84#503';       // imageId（权威位置 ✓）
const SRC_PATH = '/505/503/84#502';       // imageSource（★ 不动 ✓）

function imgIdOf(rec) {
  const l = leaves(rec.field.sub, '', []).filter(([p, f]) => p === IMG_PATH && f.wt === 0);
  return l.length ? Number(l[0][1].num) : null;
}
function setImgId(rec, id) {
  let n = 0;
  for (const [p, f] of leaves(rec.field.sub, '', [])) {
    if (p === IMG_PATH && f.wt === 0) { f.num = BigInt(id); n++; }
  }
  return n;
}
// ★★ 2026-10-16 **`imageSource` 也得跟着改** ✗✓ —— ★ 否则"同款底图"只是图上同款 ✓
//
//   ★ 实测对照 ✓（同一份 `381` ✓）：
//     | 控件 | imageSource |
//     |---|---|
//     | `home.select/bg` / `home.bag/bg` / `settle.btn/bg` | **4281536672**（0xFF2C2820 ✓ **深色** ✓）|
//     | **`modal.settle/bg`** | ★ **4294967295**（0xFFFFFFFF ✓ **白 = 不变色** ✓）|
//   ⇒ ★ 同一个图元 + 不同 source ⇒ ★ **观感不同** ✓ ⇒ ★ 用户要的是"弹窗那颗同款" ✓
//     ⇒ ★ 所以 source 也要**照弹窗那颗写** ✓（★ 用户点名的是弹窗 ✓）
//   ⚠️ 旧工具 `set_key_art.mjs` 写的是"**不动 source**、沿用控件自己的" ✓
//     ★ 那条对"给四键换胶囊图"是对的 ✓（★ 四键**本来**就该是自己那套色 ✓）
//     ★ 但**这一轮的要求是"同款"** ✓ ⇒ ★ 必须连 source 一起对齐 ✓（两件事不同 ✓）
function setImgSource(rec, v) {
  let n = 0;
  for (const [p, f] of leaves(rec.field.sub, '', [])) {
    if (p === SRC_PATH && f.wt === 0) { f.num = BigInt(v); n++; }
  }
  return n;
}
const IMAGE_SOURCE = argOf('source') !== null ? Number(argOf('source')) : null;

let changed = 0;
const rows = [];
for (const name of BUTTONS) {
  const btn = g.recs.find((r) => r.name === name);
  if (!btn) { console.error('找不到按钮 ' + name); process.exit(2); }
  const kids = g.recs.filter((r) => r.parentId === btn.id);
  const bg = kids.find((r) => r.name === 'bg');
  if (!bg) { console.error(name + ' 下没有 bg（子=' + kids.map((c) => c.name).join(',') + '）'); process.exit(3); }
  const before = imgIdOf(bg);
  const srcL = leaves(bg.field.sub, '', []).filter(([p, f]) => p === SRC_PATH && f.wt === 0);
  const src = srcL.length ? Number(srcL[0][1].num) : null;
  const n = setImgId(bg, IMAGE);
  changed += n;
  const nSrc = IMAGE_SOURCE !== null ? setImgSource(bg, IMAGE_SOURCE) : 0;
  changed += nSrc;
  rows.push([name, bg.id, before, IMAGE, src, n, nSrc]);
  console.log('  ' + name.padEnd(15) + ' bg=#' + bg.id + '  imageId ' + before + ' → ' + IMAGE
    + '   source ' + src + (nSrc ? (' → ' + IMAGE_SOURCE) : '（不动）') + '  改写 ' + (n + nSrc) + ' 处');
}
if (changed === 0) { console.error('一处都没改到 —— 路径对不上？'); process.exit(4); }
if (DRY) { console.log('--dry：不写文件'); process.exit(0); }

const body = encodeMsg(g.tree);
const buf = g.pack(body);
fs.writeFileSync(path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), buf);
console.log('已写出 ' + path.basename(OUT) + '  ' + buf.length + ' 字节（共改 ' + changed + ' 处）');

// ★★ 落盘后【从磁盘重读】断言 ✓（本仓铁律 ✓：内存里的值不算证据 ✓）
const g2 = readGil(path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT));
let bad = 0;
for (const [name, id, before, want, src] of rows) {
  const btn2 = g2.recs.find((r) => r.name === name);
  const bg2 = g2.recs.filter((r) => r.parentId === btn2.id).find((r) => r.name === 'bg');
  const got = imgIdOf(bg2);
  const srcL2 = leaves(bg2.field.sub, '', []).filter(([p, f]) => p === SRC_PATH && f.wt === 0);
  const src2 = srcL2.length ? Number(srcL2[0][1].num) : null;
  const okImg = got === want;
  const okSrc = (IMAGE_SOURCE === null) ? (src2 === src) : (src2 === IMAGE_SOURCE);
  if (!okImg || !okSrc) bad++;
  console.log('  ' + (okImg && okSrc ? '✅' : '❌') + ' ' + name.padEnd(15)
    + ' 复读 imageId=' + got + (okImg ? '' : '（期望 ' + want + '）')
    + '  source=' + src2 + (okSrc ? (IMAGE_SOURCE === null ? '（未变 ✓）' : '（已对齐弹窗 ✓）') : '（✗ 期望 ' + (IMAGE_SOURCE === null ? src : IMAGE_SOURCE) + '）'));
}
// ★ 未点名的控件必须一字未动 ✓（记录数 + 一个样板的几何）
if (g2.recs.length !== g.recs.length) { bad++; console.log('  ❌ 记录数变了 ' + g.recs.length + ' → ' + g2.recs.length); }
const g3 = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
for (const nm of ['settle.btn', 'home.title', 'select.back', 'modal.settle']) {
  const a = g3.recs.find((r) => r.name === nm), b = g2.recs.find((r) => r.name === nm);
  if (!a || !b) continue;
  const geom = (r) => r.states.map((blk) => {
    const pair = (n) => { const p = blk.sub.find((x) => x.field === n); if (!p || !p.sub) return 'null';
      return p.sub.filter((x) => x.wt === 5).map((x) => x.f).join(','); };
    return pair(504) + '|' + pair(505);
  }).join('  ');
  if (geom(a) !== geom(b)) { bad++; console.log('  ❌ ' + nm + ' 几何被改动了'); }
}
console.log(bad === 0 ? '★ 全部通过 ✓' : ('★ 有 ' + bad + ' 项不通过 ✗'));
process.exit(bad === 0 ? 0 : 5);
