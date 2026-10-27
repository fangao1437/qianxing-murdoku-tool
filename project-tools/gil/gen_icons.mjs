// tools/gil/gen_icons.mjs —— 把 `hex.*` ×7 ＋ `hit.*` ×7 **建进存档**（用户 2026-10-09 拍板「搬 1」✓）
//
// 为什么搬（用户原话 + 既定原则 ✓）：
//   「尽可能通过直接编辑存档来建控件，这也符合性能最优原则；
//     但只是尽可能而非必须，明显脚本更方便的还是走脚本」
//   用户随后拍板：「**同意搬 1，然后 2，3 保持脚本**」
//     · 搬 1  = `hex.*` + `hit.*` 这 14 个（**固定不变** ⇒ 该进存档 ✓）
//     · 留 2  = `selbtn.*`（随关卡数变 ⇒ 脚本 ✓）
//     · 留 3  = `cell.*`（引擎按索引克隆 ⇒ 脚本 ✓）
//   搬完脚本那边就能把 `auto_create_only` + 自动创建那段**整段删掉** ✓
//
// ⚠️⚠️ 最要紧的设计约束（`ui_controller.lua:1730-1745` 记着用户的对照实验 ✓）：
//   **这两个家族不是同一种控件** ✗ —— 不能拿同一个原型套 ✓
//     · `hex.*` = **纯图片**（能渲染、**收不到光标事件**）—— 负责"看得见" ✓
//     · `hit.*` = **能收点击、什么都不画**（完全透明）—— 负责"点得动" ✓
//     · ★ **顺序**：`hit.*` 必须排在 `hex.*` **之后**（后建的在上面 ✓）
//       ⇒ 射线落在热区上，不会被"不能处理事件的图片控件"吞掉 ✓
//   ⇒ 原型（本工具用的 ✓，都从**当前存档**里取，不凭空造）：
//     · `hex.*` ← `cell.1.1.content.face`（**纯图片**，分量 `#11,#12` ✓）
//     · `hit.*` ← `home.select`（**真机验证可点** ✓）＋ **不建它的 `bg`/`label` 子控件** ⇒ 什么都不画 ✓
//
// 用法：
//   node tools/gil/gen_icons.mjs --in=<存档> --out=<输出> [--probe]
//   （`--probe` = 只看，不写文件）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList, bigIds, textsOf,
  stateBlocks, pairOf, pairValue, setPair,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');
const IN = argOf('in'), OUT = argOf('out');
if (!IN) { console.error('用法: node tools/gil/gen_icons.mjs --in=<存档> --out=<输出> [--probe]'); process.exit(1); }

// ── 规格（全部实测查清 ✓，见 `_probe_hex.mjs` / `接手待办.md`）────────────
//   cx/cy 是**画布坐标**（1600×900，原点左下）✓ `.gil` 存的是**相对屏幕中心 (800,450) 的偏移** ✓
const ICONS = [
  { name: 'hex.back',   img: 100109, cx:   91, cy: 821, w: 62, h: 62, vis: true },
  { name: 'hex.submit', img: 100110, cx: 1483, cy: 817, w: 70, h: 70, vis: true },
  { name: 'hex.redo',   img: 100126, cx: 1483, cy: 721, w: 70, h: 70, vis: true },
  { name: 'hex.undo',   img: 100127, cx: 1483, cy: 625, w: 70, h: 70, vis: true },
  { name: 'hex.hint',   img: 100120, cx: 1483, cy: 171, w: 70, h: 70, vis: true },
  { name: 'hex.ok',     img: 100102, cx:  382, cy: 825, w: 54, h: 54, vis: false },
  { name: 'hex.no',     img: 100101, cx:  444, cy: 825, w: 54, h: 54, vis: false },
];
const HITS = [
  { name: 'hit.back',   cx:   91, cy: 821, w: 62, h: 62 },
  { name: 'hit.submit', cx: 1483, cy: 817, w: 70, h: 70 },
  { name: 'hit.redo',   cx: 1483, cy: 721, w: 70, h: 70 },
  { name: 'hit.undo',   cx: 1483, cy: 625, w: 70, h: 70 },
  { name: 'hit.hint',   cx: 1483, cy: 171, w: 70, h: 70 },
  { name: 'hit.ok',     cx:  382, cy: 825, w: 54, h: 54 },
  { name: 'hit.no',     cx:  444, cy: 825, w: 54, h: 54 },
];
// ★★★★★ 2026-10-09 **图片节点的真实路径 = `#505/#503/#84`**（相对**记录体**，即 `rec.field.sub` ✓）
//   查法 ✓：深度优先把整棵树里所有 `#84` 节点连同**祖先路径**打出来 ⇒
//       `#84 节点  路径=#502/#505/#503/#84  子=#502=4294967295  #503=100001` ✓
//     其中开头那个 `#502` 是**记录自己的包装字段**（`rec.field.field === 502` ✓）
//     ⇒ 真正要写的是最后那个 `#503` = **imageId** ✓（`#502` 是 imageSource ✓）
const IMG_NODES = [505, 503, 84];
const IMG_LEAF = 503;                  //    imageId
const IMG_SRC_LEAF = 502;              //    imageSource

const g = readGil(IN);
console.log('存档：' + path.basename(IN) + '（记录 ' + g.recs.length + ' 条，maxId=' + g.maxId + '）');

// ── 父级：root（14 个全是它的直接子控件 ✓）────────────────────────────────
const root = g.recs.find((r) => r.name === 'root');
if (!root) { console.error('✗ 找不到 root'); process.exit(2); }
console.log('父级 root #' + root.id);

// ── 原型 ────────────────────────────────────────────────────────────────────
const cell = g.recs.find((r) => r.name === 'cell.1.1');
const cont = cell && g.recs.find((r) => r.parentId === cell.id && r.name === 'content');
const protoHex = cont && g.recs.find((r) => r.parentId === cont.id && r.name === 'face');
const protoHit = g.recs.find((r) => r.name === 'home.select');
if (!protoHex) { console.error('✗ 找不到 cell.1.1.content.face（hex 原型）'); process.exit(2); }
if (!protoHit) { console.error('✗ 找不到 home.select（hit 原型）'); process.exit(2); }
console.log('原型：hex ← cell.1.1.content.face #' + protoHex.id
  + '　hit ← home.select #' + protoHit.id + '（**不建它的 bg/label** ⇒ 什么都不画 ✓）');

// ── 工具：找"某条记录所在的那个字段数组"（克隆体要插进同一个数组 ✓）──────
function holderOf(id) {
  const stack = [g.tree];
  while (stack.length) {
    const arr = stack.pop();
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (f.sub) {
        if ((bigIds(f.sub, [])[0] || {}).num === BigInt(id)) return { arr, index: i };
        stack.push(f.sub);
      }
    }
  }
  return null;
}
// ── 工具：按**字段号**下钻（★ 不能按深度 ✗ —— `gen_palette.mjs:80` 那条教训 ✓）──
//   ⚠️ 我第一版写成"先看 `cur` 的**子节点**里有没有 `fno`" ⇒ **多下钻了一层** ✗
//      正确语义（与 `gen_btn_art.mjs:101` 的 `fieldsAtPath` 一致 ✓）：
//        `cur` = **当前这一层的候选节点列表** ⇒ 直接在这一层里挑 `field === fno` 的 ✓
function nodesAt(fields, p) {
  let level = fields;
  for (let i = 0; i < p.length; i++) {
    const hits = level.filter((f) => f.field === p[i] && f.sub);
    if (i === p.length - 1) return hits;
    level = hits.flatMap((f) => f.sub);
  }
  return [];
}
// ── 工具：把克隆体里的某个文本叶子从 oldName 改成 newName ──────────────────
function renameIn(cloneFields, oldName, newName) {
  const t = textsOf(cloneFields, []).find((x) => x.payload && x.payload.toString('utf8') === oldName);
  if (!t) return false;
  t.payload = Buffer.from(newName, 'utf8');
  t.len = t.payload.length;
  return true;
}

const rootHolder = holderOf(root.id);
if (!rootHolder) { console.error('✗ 找不到 root 所在的字段数组'); process.exit(2); }
const rootArr = rootHolder.arr;

let nextId = BigInt(g.maxId) + 1n;
const made = [];        // { name, id, field }
const order = [];       // ★ 建出来的顺序 = 插进树的顺序（hex 先、hit 后 ✓）

/** 造一个控件 */
function make(spec, proto, isHex) {
  const cf = cloneField(proto.field);
  // ① id
  const idLeaf = bigIds(cf.sub, [])[0];
  if (!idLeaf) { console.error('  ✗ 克隆体里找不到 #501（id）'); process.exit(2); }
  const newId = nextId++;
  idLeaf.num = newId;
  // ② 名字
  if (!renameIn(cf.sub, proto.name, spec.name)) {
    console.error('  ✗ 克隆体里找不到名字文本字段（原型名=' + proto.name + '）'); process.exit(2);
  }
  // ③ 父引用 `#504`
  const pf = cf.sub.find((x) => x.field === 504 && x.wt === 0);
  if (!pf) { console.error('  ✗ 克隆体里找不到 #504（父引用）'); process.exit(2); }
  pf.num = BigInt(root.id);
  // ④ 几何：**每个状态块都要写** ✓（只写第一块 ⇒ 其它状态还是旧值 ✗）
  const blocks = []; stateBlocks(cf.sub, blocks);
  if (!blocks.length) { console.error('  ✗ 克隆体里没有状态块'); process.exit(2); }
  const ox = spec.cx - 800, oy = spec.cy - 450;      // ★ 相对屏幕中心的偏移 ✓
  for (const b of blocks) {
    if (pairOf(b, 504)) setPair(pairOf(b, 504), ox, oy);
    if (pairOf(b, 505)) setPair(pairOf(b, 505), spec.w, spec.h);
  }
  if (isHex) {
    // ⑤ 图片 id：下钻 `/505/503/84` 再取它的 `#503` 叶子 ✓
    let wrote = 0;
    for (const nd of nodesAt(cf.sub, IMG_NODES)) {
      for (const f of (nd.sub || [])) {
        if (f.field === IMG_LEAF && f.wt === 0) { f.num = BigInt(spec.img); wrote++; }
      }
    }
    if (wrote === 0) { console.error('  ✗ ' + spec.name + '：找不到 /505/503/84#503'); process.exit(2); }
  } else {
    // ⑤' `hit.*`：**不能有子控件**（有 `bg` 就会画东西 ⇒ 不透明 ✗）
    //     原型 `home.select` 的 `#503` 是**空子列表** ⇒ 这里把它确保成空 ✓
    for (const f of cf.sub) {
      if (f.field === 503 && f.sub === null) { f.payload = Buffer.alloc(0); f.len = 0; }
    }
  }
  made.push({ name: spec.name, id: Number(newId), field: cf, vis: spec.vis });
  order.push(spec.name);
  console.log('    + ' + spec.name.padEnd(12) + ' id=' + newId
    + '  pos=(' + ox + ',' + oy + ')  size=(' + spec.w + '×' + spec.h + ')'
    + (isHex ? '  图=' + spec.img : '  （透明热区）'));
}

console.log('\n── 造 hex.*（纯图片，先建 ⇒ 在下面）──');
for (const s of ICONS) make(s, protoHex, true);
console.log('\n── 造 hit.*（透明热区，后建 ⇒ 在上面 ✓）──');
for (const s of HITS) make(s, protoHit, false);

// ── 登记进 root 的 `#503` 子列表 ＋ 插进树 ─────────────────────────────────
const cl = findChildListTop(root.field.sub);
if (cl) {
  const ids = asIdList(cl.payload, true) || [];
  for (const m of made) ids.push(m.id);
  setChildList(cl, ids);
  console.log('\n已登记进 root 的 `#503` 子列表：+' + made.length + ' ⇒ 共 ' + ids.length + ' 个');
} else {
  console.log('\n⚠️ root 没有 `#503` 子列表 —— 只插树、不登记（`root` 的兄弟顺序靠字段顺序 ✓）');
}
// ★ 插到 root 子控件的**末尾**（= 画在最上层 ✓）
for (const m of made) rootArr.splice(rootHolder.index + 1, 0, m.field);

if (DRY) { console.log('\n（--probe 模式，未写文件）'); process.exit(0); }

// ── 保存（★ 照能跑通的写法 ✓）─────────────────────────────────────────────
const buf = g.pack(encodeMsg(g.tree));
fs.writeFileSync(OUT, buf);
console.log('\n已写出：' + path.basename(OUT) + '（' + fs.statSync(OUT).size + ' 字节）');

// ── 复读核对（**从磁盘重读** ✓）───────────────────────────────────────────
const g2 = readGil(OUT);
console.log('\n── 复读核对（从磁盘重读）──');
let bad = 0;
for (const n of order) {
  const rec = g2.recs.find((r) => r.name === n);
  if (!rec) { console.log('  ❌ ' + n + ' 没写进去'); bad++; continue; }
  const isRootChild = rec.parentId === root.id;
  let idv = '—';
  for (const nd of nodesAt(rec.field.sub, IMG_NODES)) {
    for (const f of (nd.sub || [])) if (f.field === IMG_LEAF && f.wt === 0) idv = String(f.num);
  }
  const bl = []; stateBlocks(rec.field.sub, bl);
  const w = bl[0] ? pairValue(pairOf(bl[0], 505), 0) : '?';
  if (!isRootChild) bad++;
  console.log('  ' + (isRootChild ? '✅' : '❌') + ' ' + n.padEnd(12) + ' #' + rec.id
    + '  父=' + rec.parentId + (isRootChild ? '(root ✓)' : '(✗ 不是 root)')
    + '  size.w=' + w + (idv !== '—' ? '  图=' + idv : ''));
}
console.log('\n记录数：' + g.recs.length + ' → ' + g2.recs.length + '（+ ' + (g2.recs.length - g.recs.length) + '）');
console.log('\n' + (bad === 0 ? '★ 14 个全部建好、且都挂在 root 下 ✓' : '❌ 有 ' + bad + ' 个不对'));
console.log('⚠️ 交付前**必须**跑：node tools/gil/roundtrip.mjs ' + path.basename(OUT));
process.exit(bad === 0 ? 0 : 3);
