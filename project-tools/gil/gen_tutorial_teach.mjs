// tools/gil/gen_tutorial_teach.mjs —— 教程浮层生成器
//   v287：重建为「teach 容器 + 各套一套 + 文本区域」
//   v289：三套（home / l1 / l2）
//   v290：**视觉升级**（菱形页标 / 米白小 x / 侧边翻页箭头 / 点击继续 / 副标题）
//   v291：**箭头改用本项目选关界面那对官方折角**（用户指令；作废 v290 的"三角 + 旋转"方案）—— 本文件
//
//   ★ 用户要求（2026-10-21，照 `docs/gia教程UI-翻译规格.md` §4 逐条；箭头那条以用户指令为准）：
//     ① 页标 = 菱形小点：`teach.<t>.dot.1..3.off`（24×24）/ `.on`（30×30），图 **100004**，
//        off 暗 `#8FA3B8` / on 米白 `#F2EDE3`；
//     ② 关闭 = 米白小 x：`btn.close` 收到 **48×48 @(560,350)**，加子控件 `x`（22×22，图 **100151**，染米白）；
//     ③ 侧边翻页箭头：`btn.prev` → **180×158 @(-510,0)**、`btn.next` → **180×158 @(510,0)**，
//        各加子控件 `icon`（**52×52**，图 **照抄 `select.prev`=100104 / `select.next`=100103**，
//        染色照抄纯白 `0xFFFFFFFF`，**不旋转**、imageType 照抄"不写"）；
//     ④ 点击继续：每套加 `btn.click`（预设按钮 180×52 @(0,-330)）+ 文本区 `teach.text.<t>.btn.click`；
//     ⑤ 副标题：文本区加 `teach.text.<t>.subtitle`（820×40 @(0,268)）；
//     ⑥ 正文让位：`body.1..3` → 900×260 @(0,-110)；`.page` 几何**不动**。
//
//   ★★★ 本版**新增的写入口**（任务卡点：原来只会写「号/名字/父级/几何」）：
//     · 子控件配方从"只有 fill"升级成 **{名字, 几何, 图, 染色, 图片类型, 旋转}**（见 `KID` / `art` 字段）；
//     · 图片三件套的写入位置**照抄仓库里已验证的工具**，一个字段都没发明：
//         `/505/503/84#502` = imageColor（ARGB）   ← `set_button_bg_image.mjs` / `fix_cell_layers.mjs`
//         `/505/503/84#503` = imageId              ← `set_own_image.mjs`（控件自身的图走同一条路）
//         `/505/503/84#504` = imageType（1 = 拉伸填满盒子）← `fix_cell_layers.mjs`（真机验过）
//         状态块 `#508`      = rotation（vec3，字段 1/2/3 = x/y/z）← `docs/转换器-gil到模拟器存档.md:151`
//     · **写没写进去，只看磁盘**：`writeGil()` 落盘 → 重读 → 往返闸门 → 字段 diff →
//       再逐条断言"读回来的 imageId / 染色 / 类型 / 旋转 == 期望"（内存里的值不算证据）。
//     · v291 起，箭头的期望值**就是从 `select.prev` / `select.next` 读出来的那份**（见下面常量区实测表），
//       断言会把它和"源控件"逐字段比一遍（不一致就不写文件）。
//
//   ★ 做法沿用 v286 已验证的路线（真机导入成功的那版）：**所有控件从 472 自己的母本克隆**，
//     不并入任何外来记录（见 docs/回执-教程重建-v286.md §二）。
//     母本：容器 stage、按钮 result.next（自带 bg）、文本 hud.subtitle / gen.body、图片 clues.bg。
//
//   结构（设计稿 1600×900，坐标原点 = 父级中心）：
//     teach                             1600×900，父 = root
//     ├ teach.<t>                       每一套（home / l1 / l2）1240×780
//     │   ├ teach.<t>.bg                图片（铺满）
//     │   ├ teach.<t>.page              页面本体 1120×380（★ 几何不动）
//     │   │   └ teach.<t>.page.bg       图片（铺满）
//     │   ├ teach.<t>.btn.prev          180×158 @(-510,0)  └ icon 52×52（100104 ❮ 照抄 select.prev）
//     │   ├ teach.<t>.btn.next          180×158 @(510,0)   └ icon 52×52（100103 ❯ 照抄 select.next）
//     │   ├ teach.<t>.btn.close         48×48 @(560,350)   └ x    22×22（100151 染米白）
//     │   ├ teach.<t>.btn.click         180×52 @(0,-330)   └ bg   铺满
//     │   └ teach.<t>.dot.1..3.on/.off  30×30 / 24×24 @((i-2)*34, -230)（100004 菱形）
//     └ teach.text                      文本区域 1600×900
//         └ teach.text.<t>              title / subtitle / body.1..3 / btn.prev|next|close|click
//
//   用法：node tools/gil/gen_tutorial_teach.mjs --base=472.gil --out=tools/gil/out/487-controls.gil [--id-base=1073743900] [--dry]
//   断言（不过就不写文件）：记录数 / 自身 GUID 唯一 / 父子表 / **新记录内部只允许自己·父·子控件的号** /
//                            新号与基线零交集 / 往返一致 / **图片与旋转读回 == 期望（箭头还与源控件逐字段一致）**
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, cloneField, findChildListTop, ensureChildListTop, setChildList, asIdList,
  stateBlocks, pairOf, pairValue, setPair,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const BASE = argOf('base', '472.gil');
const OUT = argOf('out', 'tools/gil/out/486-controls.gil');
const ID_BASE = Number(argOf('id-base', '1073743900'));
const DRY = argv.includes('--dry');

// ── 素材常量（**全部是有出处的官方素材 id**；替代物在文档里点名）────────────────
const IMG_DIAMOND = 100004;   // 基础形状：菱形（参考图里 ◆ 的替身 —— 资产里只有白方块 100001）
const IMG_CROSS = 100151;     // 功能图标-单色：一个 X（alpha 实测）⇒ 关闭按钮的小 x
const COLOR_CREAM = 0xFFF2EDE3;   // 米白（小 x / 当前页菱形）
const COLOR_DIM = 0xFF8FA3B8;     // 未选中的页标：灰蓝（比米白暗一档）
const IMG_TYPE_STRETCH = 1;   // imageType：1 = 拉伸填满盒子（`fix_cell_layers.mjs` 真机验过）

// ★★★ v291（用户指令 2026-10-21）**箭头不再自产** ✗✓
//   用户原话：「箭头就用选关界面的左右箭头，这是本项目自己的内容，直接读就可以」
//   ⇒ 箭头图**不写死常量**，而是从**本档自己的** `select.prev` / `select.next` 读出来（见下方 `ARROW_SRC`）：
//
//     | 控件 | guid | imageId | imageColor | imageType | 尺寸 | rotation | anchor/pivot |
//     |------|------|---------|-----------|-----------|------|----------|--------------|
//     | select.prev | #1073742728 | 100104（官方左折角 ❮）| 0xFFFFFFFF（纯白=不染色）| 未写(=Basic) | 52×52 | (0,0,0) | (0.5,0.5) / (0.5,0.5) |
//     | select.next | #1073742729 | 100103（官方右折角 ❯）| 0xFFFFFFFF | 未写(=Basic) | 52×52 | (0,0,0) | 同上 |
//
//   ⇒ 它们是**一对镜像成对的官方折角箭头**（两张不同的图），**不是**"同一张 + 旋转"
//     （`docs/选关屏控件重建-交付记录-v232.md:54` 也记着 100104/100103 是"唯一的镜像成对箭头"）。
//   ⇒ 所以教程这两个 icon **没有 rotation**（照抄 0），尺寸也**照抄 52×52**（不改 40：52 才是项目里它自己的框）。
//   ⚠️ `imageSource` 在 `.gil` 里**没有独立字段**（图片槽只有 502 染色 / 503 imageId / 504 类型；
//      模拟器存档那边统一 `imageSource:"StaticReference"`）⇒ 两端天然一致，无需写。
//   ★ 下面 `ARROW_DOC` 只是"期望值"，用来在基线换了的时候**当场报错**（不许悄悄换素材）；
//     真正写进图标的是 `ARROW_SRC`（从档里读的）。
const ARROW_DOC = {
  prev: { name: 'select.prev', imageId: 100104, color: 0xFFFFFFFF },
  next: { name: 'select.next', imageId: 100103, color: 0xFFFFFFFF },
};

const g = readGil(P(BASE));
const byName = new Map();
for (const r of g.recs) if (r.name && !byName.has(r.name)) byName.set(r.name, r);

const PROTO = { container: 'stage', button: 'result.next', text: 'hud.subtitle', body: 'gen.body', image: 'clues.bg' };
const protoRec = {};
for (const [k, n] of Object.entries(PROTO)) {
  const r = byName.get(n);
  if (!r) { console.error('✗ 基线里找不到母本 ' + n); process.exit(2); }
  protoRec[k] = r;
}

// ── v291：**从本档读出**选关界面那对箭头（用户指令：直接读就可以）────────────────
//   ★ 读出来的 imageId / 染色 / imageType / 尺寸 / 旋转**直接当配方用**，不是"抄个常量"。
//   ★ `readArt` / `readRots` / `imageBlockOf` 是 `function` 声明（提升）⇒ 这里先调用没问题。
//   ★ 顺带和 `ARROW_DOC` 对一遍：基线被换过就**当场报错**，不许悄悄换素材。
function readArrowSource(doc) {
  const r = byName.get(doc.name);
  if (!r) { console.error('✗ 基线里找不到选关箭头 ' + doc.name + '（v291 的箭头素材要从它读）'); process.exit(2); }
  const art = readArt(r.field.sub);
  if (art == null || art.image == null) { console.error('✗ ' + doc.name + ' 读不到图片槽（/505/503/84）'); process.exit(2); }
  const b = r.states[0];
  const size = { w: pairValue(pairOf(b, 505), 0), h: pairValue(pairOf(b, 505), 1) };
  const rots = readRots(r.field.sub);
  const pivot = { x: pairValue(pairOf(b, 506), 0), y: pairValue(pairOf(b, 506), 1) };
  if (art.image !== doc.imageId || (art.color >>> 0) !== (doc.color >>> 0)) {
    console.error('✗ ' + doc.name + ' 的实测值（imageId=' + art.image + ' 染色=' + (art.color >>> 0)
      + '）与文档常量（' + doc.imageId + ' / ' + (doc.color >>> 0) + '）不一致 ⇒ 基线换过，先更新 ARROW_DOC 再生成');
    process.exit(2);
  }
  return { name: doc.name, id: Number(r.id), imageId: art.image, color: art.color, imageType: art.imageType, size, pivot, rots };
}
const ARROW_SRC = { prev: readArrowSource(ARROW_DOC.prev), next: readArrowSource(ARROW_DOC.next) };
console.log('箭头素材（从本档 ' + ARROW_SRC.prev.name + ' / ' + ARROW_SRC.next.name + ' 读出）：');
for (const k of ['prev', 'next']) {
  const a = ARROW_SRC[k];
  console.log('  ' + a.name.padEnd(12) + '#' + a.id + '  imageId=' + a.imageId + '  染色=0x'
    + (a.color >>> 0).toString(16).toUpperCase().padStart(8, '0')
    + '  imageType=' + (a.imageType == null ? '未写(=Basic)' : a.imageType)
    + '  尺寸=' + a.size.w + '×' + a.size.h + '  pivot=(' + a.pivot.x + ',' + a.pivot.y + ')'
    + '  rot=' + JSON.stringify(a.rots));
}

// ── 结构表 ─────────────────────────────────────────────────────────────────
const PAGES = 3;
const LEVELS = ['home', 'l1', 'l2'];   // 首页一套 + 第一关 + 第二关，各自独立
const SPEC = [];
const add = (s) => { SPEC.push(s); return s; };

// 子控件配方：名字固定（脚本用 sub(父名, 子名) 或 find(全名) 取）
//   · `fit:'fill'` ⇒ 几何跟着父控件铺满（老的 bg 用法）
//   · 其余用显式 x/y/w/h；`image` / `color` / `imageType` / `rotZ` 见文件头"新增的写入口"
//   ★ v290 的两个图元（`icon` / `x`）**名字写成全名**（`teach.<t>.btn.prev.icon`）：
//     适配层 `Adapter:find(name)` 是**按控件名精确 DFS**（engine_adapter_qianxing.lua:436）
//     ⇒ 短名 `icon` 三套共六条会变成"同名多条"，脚本/自检都没法按名定位。
//     老的 `bg` 子控件保留短名（v287 起就这样，脚本从不用名字取它）。
const KID = {
  fill: { proto: 'image', name: 'bg', fit: 'fill' },
  bbg: { proto: 'image', name: 'bg', fit: 'fill' },
};
// v291：箭头 icon 的**每一项都从 `select.prev` / `select.next` 读来的那份照抄**：
//   尺寸、染色、imageId、imageType（源没写就不写）、旋转（源是 0 就不写 rotation）。
const iconRecipe = (full, src) => ({
  proto: 'image', name: full, x: 0, y: 0,
  w: src.size.w, h: src.size.h,
  image: src.imageId, color: src.color,
  ...(src.imageType == null ? {} : { imageType: src.imageType }),
  ...(src.rots.some((v) => v !== 0) ? { rotZ: src.rots[0] } : {}),
  arrow: src,           // ← 断言用：写出来之后要和源控件逐字段比
});
const closeXRecipe = (full) => ({
  proto: 'image', name: full, x: 0, y: 0, w: 22, h: 22,
  image: IMG_CROSS, color: COLOR_CREAM, imageType: IMG_TYPE_STRETCH,
});
/** 配方键：字符串走 `KID`，对象自己就是配方（key 用 name，父级内唯一） */
const kidKey = (k) => (typeof k === 'string' ? k : k.name);
const kidRec = (k) => (typeof k === 'string' ? KID[k] : k);

add({ name: 'teach', kind: 'container', parent: '@root', x: 0, y: 0, w: 1600, h: 900, kids: [] });

for (const t of LEVELS) {
  const base = 'teach.' + t;
  add({ name: base, kind: 'container', parent: 'teach', x: 0, y: 0, w: 1240, h: 780, kids: ['fill'] });
  add({ name: base + '.page', kind: 'container', parent: base, x: 0, y: 10, w: 1120, h: 380, kids: ['fill'] });
  // ② / ③ 按钮几何：贴边居中 + 右上角小 x + 底部"点击继续"
  //   ★ v291：左右箭头用**选关界面那对官方折角**（100104 ❮ / 100103 ❯，两张不同的图，不旋转）
  add({ name: base + '.btn.prev', kind: 'button', parent: base, x: -510, y: 0, w: 180, h: 158,
    kids: ['bbg', iconRecipe(base + '.btn.prev.icon', ARROW_SRC.prev)] });
  add({ name: base + '.btn.next', kind: 'button', parent: base, x: 510, y: 0, w: 180, h: 158,
    kids: ['bbg', iconRecipe(base + '.btn.next.icon', ARROW_SRC.next)] });
  add({ name: base + '.btn.close', kind: 'button', parent: base, x: 560, y: 350, w: 48, h: 48,
    kids: ['bbg', closeXRecipe(base + '.btn.close.x')] });
  add({ name: base + '.btn.click', kind: 'button', parent: base, x: 0, y: -330, w: 180, h: 52, kids: ['bbg'] });
  // ① 菱形页标：**直接挂在 teach.<t> 下、名字自带 dot.i.on/off**（脚本 `sub()` 只吃一级子名）
  for (let i = 1; i <= PAGES; i++) {
    const dx = (i - 2) * 34;
    add({
      name: base + '.dot.' + i + '.off', kind: 'image', parent: base, x: dx, y: -230, w: 24, h: 24, kids: [],
      image: IMG_DIAMOND, color: COLOR_DIM, imageType: IMG_TYPE_STRETCH,
    });
    add({
      name: base + '.dot.' + i + '.on', kind: 'image', parent: base, x: dx, y: -230, w: 30, h: 30, kids: [],
      image: IMG_DIAMOND, color: COLOR_CREAM, imageType: IMG_TYPE_STRETCH,
    });
  }
}

add({ name: 'teach.text', kind: 'container', parent: 'teach', x: 0, y: 0, w: 1600, h: 900, kids: [] });
for (const t of LEVELS) {
  const base = 'teach.text.' + t;
  add({ name: base, kind: 'container', parent: 'teach.text', x: 0, y: 0, w: 1600, h: 900, kids: [] });
  add({ name: base + '.title', kind: 'text', parent: base, x: 0, y: 300, w: 820, h: 56, kids: [] });
  add({ name: base + '.subtitle', kind: 'text', parent: base, x: 0, y: 268, w: 820, h: 40, kids: [] });   // ⑤
  for (let i = 1; i <= PAGES; i++) {
    add({ name: base + '.body.' + i, kind: 'body', parent: base, x: 0, y: -110, w: 900, h: 260, kids: [] });  // ⑥
  }
  // 按钮字：**跟按钮走**（文字要和按钮同心，否则编辑器里填完字会脱层）
  add({ name: base + '.btn.prev', kind: 'text', parent: base, x: -510, y: 0, w: 160, h: 40, kids: [] });
  add({ name: base + '.btn.next', kind: 'text', parent: base, x: 510, y: 0, w: 160, h: 40, kids: [] });
  add({ name: base + '.btn.close', kind: 'text', parent: base, x: 560, y: 350, w: 48, h: 40, kids: [] });
  add({ name: base + '.btn.click', kind: 'text', parent: base, x: 0, y: -330, w: 160, h: 40, kids: [] });   // ④
}

// ── 号 ─────────────────────────────────────────────────────────────────────
let nextId = ID_BASE;
const alloc = () => nextId++;
for (const s of SPEC) s.id = alloc();
for (const s of SPEC) { s.kidIds = {}; for (const k of s.kids) s.kidIds[kidKey(k)] = alloc(); }
const newIds = [...SPEC.map((s) => s.id), ...SPEC.flatMap((s) => Object.values(s.kidIds))];
if (new Set(newIds).size !== newIds.length) { console.error('✗ 号段自撞'); process.exit(2); }

const baseUsed = new Set();
(function walk(fs_) {
  for (const f of fs_) {
    if (f.wt === 0) { const v = Number(f.num); if (v >= 1073000000 && v < 1074200000) baseUsed.add(v); }
    if (f.sub) walk(f.sub);
  }
})(g.tree);
const clash = newIds.filter((i) => baseUsed.has(i));
if (clash.length) { console.error('✗ 新号与基线撞：' + clash.join(',') + '；请改 --id-base'); process.exit(2); }

// ── 改名（组件 #501=2 → #12 → #501 的文本）──────────────────────────────────
function setNameText(fieldSub, newName) {
  for (const blk of fieldSub) {
    if (blk.field !== 505 || !blk.sub) continue;
    const t = blk.sub.find((x) => x.field === 501 && x.wt === 0);
    if (!t || Number(t.num) !== 2) continue;
    const b12 = blk.sub.find((x) => x.field === 12 && x.sub);
    if (!b12) continue;
    const txt = b12.sub.find((x) => x.field === 501 && x.wt === 2 && x.isText);
    if (!txt) continue;
    txt.payload = Buffer.from(newName, 'utf8');
    txt.len = txt.payload.length;
    return true;
  }
  return false;
}

// ── 图片块 / 旋转：写入 + 读回 ───────────────────────────────────────────────
/** 记录里的**图片槽**（`Details.84`）—— 判据与 `fix_cell_layers.mjs` 的 `imageBlock()` 完全一致 */
function imageBlockOf(fieldSub) {
  let hit = null;
  (function walk(fs_) {
    for (const f of fs_ || []) {
      if (hit) return;
      if (f.field === 84 && f.sub) { hit = f; return; }
      if (f.sub) walk(f.sub);
    }
  })(fieldSub);
  return hit;
}
/** 图片槽里的 varint：502 = imageColor / 503 = imageId / 504 = imageType */
function numIn(blk, no) {
  const f = blk && blk.sub.find((x) => x.field === no && x.wt === 0);
  return f ? Number(f.num) : null;
}
function putNum(blk, no, v) {
  let f = blk.sub.find((x) => x.field === no && x.wt === 0);
  if (!f) {
    f = { field: no, wt: 0, num: 0n };
    const at = blk.sub.findIndex((x) => x.field > no);   // 按字段号升序插（引擎自己写的顺序就是 502<503<504）
    if (at < 0) blk.sub.push(f); else blk.sub.splice(at, 0, f);
  }
  f.num = BigInt(v >>> 0);
}
/**
 * 写**图片三件套**。`{image, color, imageType}` 任意子集。
 * ★ 路径与含义（仓库里三条已验证的写法，见文件头）：`/505/503/84` 底下的 502 / 503 / 504。
 */
function applyArt(fieldSub, spec) {
  if (spec.image == null && spec.color == null && spec.imageType == null) return null;
  const blk = imageBlockOf(fieldSub);
  if (!blk) throw new Error('没有图片块（/505/503/84）：' + spec.name);
  if (spec.color != null) putNum(blk, 502, spec.color);
  if (spec.image != null) putNum(blk, 503, spec.image);
  if (spec.imageType != null) putNum(blk, 504, spec.imageType);
  return blk;
}
/**
 * 写**旋转**：状态块（每个平台一份）里的 `#508`，vec3 用字段 1/2/3 = x/y/z（float，缺省 = 0）。
 * ★ 依据：`docs/转换器-gil到模拟器存档.md:151`（`transform.#508 → rotation.z`）、
 *   `tools/sim/gil_to_save.mjs` 的 `vec3()`（字段号 1/2/3）。
 */
function applyRotation(fieldSub, degZ) {
  const bl = [];
  stateBlocks(fieldSub, bl);
  if (!bl.length) throw new Error('没有状态块，没法写旋转');
  for (const b of bl) {
    let f = b.sub.find((x) => x.field === 508);
    if (!f) {
      f = { field: 508, wt: 2, sub: [], len: 0, payload: null, isText: false };
      b.sub.push(f);
    }
    f.sub = degZ ? [{ field: 3, wt: 5, f: degZ }] : [];   // 稀疏编码：0 分量不写
    f.len = degZ ? 5 : 0;
    f.payload = null;                                     // ★ sub 是权威（encodeMsg 有 sub 就递归）
  }
  return bl.length;
}
/** 读回图片三件套（用**重读磁盘**的 g2 记录） */
function readArt(fieldSub) {
  const blk = imageBlockOf(fieldSub);
  if (!blk) return null;
  return { color: numIn(blk, 502), image: numIn(blk, 503), imageType: numIn(blk, 504) };
}
/** 读回旋转（每个状态块一个值） */
function readRots(fieldSub) {
  const bl = [];
  stateBlocks(fieldSub, bl);
  return bl.map((b) => {
    const f = b.sub.find((x) => x.field === 508);
    if (!f || !f.sub) return 0;
    const z = f.sub.find((x) => x.field === 3 && x.wt === 5);
    return z ? Math.round(z.f * 1000) / 1000 : 0;
  });
}

function cloneRec(proto, newId, parentId, newName, geom) {
  const protoId = Number(proto.id);
  const protoParent = Number(proto.parentId);
  const f = cloneField(proto.field);
  (function rew(fs_) {
    for (const x of fs_) {
      if (x.wt === 0) {
        const v = Number(x.num);
        if (v === protoId) x.num = BigInt(newId);
        else if (protoParent && v === protoParent) x.num = BigInt(parentId);
      }
      if (x.sub) rew(x.sub);
    }
  })(f.sub);
  if (!setNameText(f.sub, newName)) throw new Error('改名失败：' + newName);
  const bl = [];
  stateBlocks(f.sub, bl);
  if (!bl.length) throw new Error('母本没有状态块：' + proto.name);
  for (const b of bl) {
    const p = pairOf(b, 504); if (p) setPair(p, geom.x, geom.y);
    const s = pairOf(b, 505); if (s) setPair(s, geom.w, geom.h);
  }
  const cl = findChildListTop(f.sub);
  if (cl) setChildList(cl, []);
  return f;
}

// ── 造记录 ─────────────────────────────────────────────────────────────────
const recArr = g.recHolder;
const added = [];
const allowedById = new Map();
const idOfSpec = new Map(SPEC.map((s) => [s.name, s.id]));
const rootId = Number(byName.get('root').id);
const parentIdOf = (n) => (n === '@root' ? rootId : idOfSpec.get(n));
const artTargets = [];        // 落盘后要逐条复读的目标（图片 / 旋转）
const labelById = new Map();  // id → 人看的标签（断言失败时好定位）

for (const s of SPEC) {
  const pid = parentIdOf(s.parent);
  const f = cloneRec(protoRec[s.kind] || protoRec.container, s.id, pid, s.name, s);
  if (applyArt(f.sub, s)) artTargets.push({ id: s.id, name: s.name, spec: s });
  if (s.rotZ != null) { applyRotation(f.sub, s.rotZ); if (!artTargets.some((a) => a.id === s.id)) artTargets.push({ id: s.id, name: s.name, spec: s }); }
  recArr.push(f);
  labelById.set(s.id, s.name);
  added.push({ name: s.name, id: s.id, field: f, parentId: pid, kidIds: [] });
}

for (const s of SPEC) {
  const entry = added.find((a) => a.id === s.id);
  const kids = [];
  for (const k of s.kids) {
    const recipe = kidRec(k);
    // ★ 子控件母本一律是 `clues.bg`（图片记录）：按钮/面板的底图与图标在本工程里都是**图片控件**，
    //   所以不再需要"按钮自带 bg 子控件"那条路（v289 那版 `protoBtnKids` 已无用，删掉免得悬空）。
    const kidProto = protoRec[recipe.proto];
    if (!kidProto) { console.error('✗ 找不到子控件母本 ' + recipe.proto + '（' + recipe.name + '）'); process.exit(2); }
    const kidId = s.kidIds[kidKey(k)];
    let gx = recipe.x || 0, gy = recipe.y || 0, gw = recipe.w || 0, gh = recipe.h || 0;
    if (recipe.fit === 'fill') { gx = 0; gy = 0; gw = s.w; gh = s.h; }
    const kf = cloneRec(kidProto, kidId, s.id, recipe.name, { x: gx, y: gy, w: gw, h: gh });
    if (applyArt(kf.sub, recipe)) artTargets.push({ id: kidId, name: recipe.name, spec: recipe });
    if (recipe.rotZ != null) { applyRotation(kf.sub, recipe.rotZ); if (!artTargets.some((a) => a.id === kidId)) artTargets.push({ id: kidId, name: recipe.name, spec: recipe }); }
    recArr.push(kf);
    labelById.set(kidId, recipe.name);
    added.push({ name: recipe.name, id: kidId, field: kf, parentId: s.id, kidIds: [] });
    kids.push({ id: kidId, name: recipe.name });
  }
  entry.kidIds = kids.map((x) => x.id);
  if (kids.length) {
    let cl = findChildListTop(entry.field.sub);
    if (!cl) cl = ensureChildListTop({ field: entry.field }, null);
    setChildList(cl, kids.map((x) => x.id));
  }
}
// 把每个教程控件登记进【它父控件】的子列表（teach 本身挂主档 root，另行登记）
for (const s of SPEC) {
  if (s.parent === '@root') continue;
  const parentEntry = added.find((a) => a.id === idOfSpec.get(s.parent));
  if (!parentEntry) { console.error('✗ 找不到父 ' + s.parent); process.exit(3); }
  const cl = findChildListTop(parentEntry.field.sub) || ensureChildListTop({ field: parentEntry.field }, null);
  const list = (asIdList(cl.payload, true) || []).map(Number);
  if (!list.includes(s.id)) list.push(s.id);
  setChildList(cl, list);
}

// 允许集合：**在子列表登记完成之后**从实际子列表反推 —— 父记录里允许出现：自己的号、父的号、自己子控件的号
//   （子控件既包括配方子控件 bg/icon/x，也包括嵌套的教程子容器，例如 teach.text → teach.text.l1）
for (const a of added) {
  const cl = findChildListTop(a.field.sub);
  const kids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
  allowedById.set(a.id, new Set([a.id, a.parentId, ...kids]));
}

// 登记 teach 进主档 root 的子列表（追加到末尾）
const baseRoot = byName.get('root');
const rootCl = findChildListTop(baseRoot.field.sub);
if (!rootCl) { console.error('✗ 主档 root 没有子列表'); process.exit(3); }
const rootKids = (asIdList(rootCl.payload, true) || []).map(Number);
rootKids.push(SPEC[0].id);
setChildList(rootCl, rootKids);

const hex8 = (v) => (v == null ? '—' : '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0'));
console.log('基线 ' + path.basename(BASE) + '：记录 ' + g.recs.length + '，新增 ' + added.length + ' 条');
console.log('号段 ' + ID_BASE + ' … ' + (nextId - 1) + '（与基线全档零交集 ✓）');
for (const s of SPEC) {
  const art = (s.image != null || s.color != null) ? '  图' + s.image + ' 染' + hex8(s.color) + ' 类型' + s.imageType : '';
  const rot = s.rotZ != null ? '  旋转' + s.rotZ + '°' : '';
  console.log('  ' + s.name.padEnd(26) + '#' + s.id + '  ' + String(s.x) + ',' + String(s.y) + ' ' + s.w + '×' + s.h
    + art + rot + (s.kids.length ? '  子:' + s.kids.map((k) => kidRec(k).name).join(' ') : ''));
}
console.log('带图/带旋转的记录 ' + artTargets.length + ' 条（落盘后逐条复读）');

if (DRY) { console.log('\n[--dry] 不写文件'); process.exit(0); }

const expectRecs = g.recs.length + added.length;
writeGil(g, P(OUT), {
  label: 'gen_tutorial_teach v291',
  expectRecs,
  assert: (g2) => {
    const bad = [];
    const seen = new Set();
    for (const r of g2.recs) { const id = Number(r.id); if (seen.has(id)) bad.push('自身 GUID 重复：' + id); seen.add(id); }
    const recById = new Map(g2.recs.map((r) => [Number(r.id), r]));
    for (const a of added) {
      const r = recById.get(a.id);
      if (!r) { bad.push('重读后找不到 ' + a.name); continue; }
      if (a.parentId != null) {
        const parent = recById.get(a.parentId);
        if (!parent) bad.push(a.name + ' 的父不存在');
        else {
          const pcl = findChildListTop(parent.field.sub);
          const list = pcl ? (asIdList(pcl.payload, true) || []).map(Number) : [];
          if (!list.includes(a.id)) bad.push(a.name + ' 没被登记进父的子列表');
        }
        if (Number(r.parentId) !== a.parentId) bad.push(a.name + ' 的父指针不对');
      }
      const allowed = allowedById.get(a.id) || new Set([a.id]);
      (function walk(fs_) {
        for (const f of fs_) {
          if (f.wt === 0) {
            const v = Number(f.num);
            if (v >= 1073000000 && v < 1074200000 && !allowed.has(v)) bad.push(a.name + ' 内部出现外来 id ' + v);
          }
          if (f.sub) walk(f.sub);
        }
      })(r.field.sub);
    }
    for (const s of SPEC) {
      const n = g2.recs.filter((r) => r.name === s.name).length;
      if (n !== 1) bad.push('名字 ' + s.name + ' 出现 ' + n + ' 次（应为 1）');
    }
    // ★★★ 图片 / 旋转：**只认从磁盘重读出来的那份**（内存里的值不算证据）
    const artLines = [];
    for (const t of artTargets) {
      const r = recById.get(t.id);
      if (!r) { bad.push('复读：找不到 ' + t.name); continue; }
      const got = readArt(r.field.sub);
      if (t.spec.image != null || t.spec.color != null) {
        if (!got) { bad.push('复读：' + t.name + ' 没有图片块'); continue; }
        if (t.spec.image != null && got.image !== t.spec.image) bad.push('复读：' + t.name + ' imageId=' + got.image + '，应为 ' + t.spec.image);
        if (t.spec.color != null && (got.color >>> 0) !== (t.spec.color >>> 0)) bad.push('复读：' + t.name + ' 染色=' + hex8(got.color) + '，应为 ' + hex8(t.spec.color));
        if (t.spec.imageType != null && got.imageType !== t.spec.imageType) bad.push('复读：' + t.name + ' 图片类型=' + got.imageType + '，应为 ' + t.spec.imageType);
        artLines.push('    ' + t.name.padEnd(30) + ' #' + t.id + '  图 ' + got.image + '  染 ' + hex8(got.color) + '  类型 ' + got.imageType);
      }
      if (t.spec.rotZ != null) {
        const rots = readRots(r.field.sub);
        const want = Math.round(t.spec.rotZ * 1000) / 1000;
        if (rots.length === 0) bad.push('复读：' + t.name + ' 没有状态块');
        for (const v of rots) if (v !== want) bad.push('复读：' + t.name + ' 某平台旋转=' + v + '，应为 ' + want);
        artLines.push('    ' + t.name.padEnd(30) + ' #' + t.id + '  旋转 ' + JSON.stringify(rots));
      }
      // ★ v291：箭头 icon 与**源控件**（select.prev / select.next）逐字段比 —— "照抄"的证据
      if (t.spec.arrow) {
        const a = t.spec.arrow;
        const rots = readRots(r.field.sub);
        const b = r.states[0];
        const size = { w: pairValue(pairOf(b, 505), 0), h: pairValue(pairOf(b, 505), 1) };
        const srcRot = a.rots.length ? a.rots[0] : 0;
        if (got.image !== a.imageId) bad.push('照抄：' + t.name + ' imageId=' + got.image + '，源 ' + a.imageId);
        if ((got.color >>> 0) !== (a.color >>> 0)) bad.push('照抄：' + t.name + ' 染色=' + hex8(got.color) + '，源 ' + hex8(a.color));
        if ((got.imageType ?? null) !== (a.imageType ?? null)) bad.push('照抄：' + t.name + ' imageType=' + got.imageType + '，源 ' + a.imageType);
        if (size.w !== a.size.w || size.h !== a.size.h) bad.push('照抄：' + t.name + ' 尺寸=' + size.w + '×' + size.h + '，源 ' + a.size.w + '×' + a.size.h);
        for (const v of rots) if (v !== srcRot) bad.push('照抄：' + t.name + ' 旋转=' + v + '，源 ' + srcRot);
        artLines.push('    ' + t.name.padEnd(30) + ' #' + t.id + '  ↔ 照抄 ' + a.name + '#' + a.id
          + '：imageId ' + got.image + '=' + a.imageId + '  染色 ' + hex8(got.color) + '  类型 '
          + (got.imageType ?? '未写') + '  尺寸 ' + size.w + '×' + size.h + '  旋转 ' + JSON.stringify(rots));
      }
    }
    if (bad.length) throw new Error('✗ 断言失败（' + bad.length + ' 条）：\n  ' + bad.slice(0, 20).join('\n  '));
    console.log('  ✅ 断言：记录 ' + expectRecs + ' 条、自身 GUID 唯一、父子表一致、新记录零外来 id、每个教程名各 1 次');
    console.log('  ✅ 断言：' + artTargets.length + ' 条图/旋转**从磁盘复读**正确：');
    for (const l of artLines) console.log(l);
  },
});
console.log('\n已写出：' + path.basename(P(OUT)) + '（' + fs.statSync(P(OUT)).size + ' 字节，记录 ' + expectRecs + '）');
