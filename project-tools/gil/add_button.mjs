// tools/gil/add_button.mjs —— **把一个现成的「预设按钮」连同它的子控件一起克隆**成一个新按钮
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么需要它（2026-10-15）：
//   用户要求 ✓：「**把原来四个方块删掉，然后在首页和选关界面左下角也加一个结算按钮，
//     不接存档线，只接结算**」✓
//   ★ 前一半在脚本里（`cfg.widgets = false` ✓）；★ 后一半**要在存档里有个按钮** ✗ ——
//     脚本只会写它的位置/文字/事件 ✓，**控件本身必须在存档里** ✓
//
// ★★ 为什么必须"**连子控件一起**克隆" ✗（`place_select.mjs` 是清空子列表的 ✗）：
//   ★ 官方硬规则 ✓：★ **预设按钮的外观来自它状态节点引用的子控件** ✓
//     （★ 本项目为此白测过一整天 ✓ 见 `docs/工作约定-优先直改控件.md` ✓）
//   ⇒ ★ 只克隆按钮本体、把 `bg` / `label` 清掉 ⇒ ★ **按钮看不见、也没字** ✓
//   ⇒ ★ 而 `home.select` 这类**玩家天天在点**的按钮 ✓ 正是"能显示能点"的现成样板 ✓
//
// ★★ 为什么事件走"预设按钮原生"那条路 ✗（不用命中层 ✓）：
//   ★ `hex.*` 那类是**图标（纯图片）** ⇒ 收不到光标事件 ✓ 所以要补 `hit.*` ✓
//   ★ 而**预设按钮本身就 `AddCursorEventListener`** ✓
//     ⇒ ★ 玩家在主页点了这么多天的「选关」就是同类克隆 ✓ **已验证能点** ✓
//
// 用法：
//   node tools/gil/add_button.mjs --in=<存档> --out=<输出> \
//        --proto=home.select --name=settle.btn --parent=root \
//        --rect=60,960,260,72        # 设计空间（1920×1080、左上原点 ✓ 与计划同一套 ✓）
//        [--text=结算] [--dry]
//
// ⚠️ `--text` 只写进一份**说明**（文字不落存档 ✓ 官方规则 ✓ 见适配器 `key == "text"` 那段 ✓）
//    ⇒ ★ 真机上那句「结算」是**脚本运行时填**的 ✓（`ui_controller` 的 push 里那个 `text` ✓）
//
// ★ 写盘走 `writeGil()`（唯一安全通道 ✓）：落盘 → 重读 → 往返闸门 → 字段 diff → 断言 ✓

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, stateBlocks, pairOf, setPair, findChildListTop, ensureChildListTop,
  setChildList, asIdList, bigIdTop, textsOf, KNOWN_TYPES,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const DRY = argv.includes('--dry');

const IN = argOf('in'), OUT = argOf('out');
const PROTO = argOf('proto'), NAME = argOf('name'), PARENT = argOf('parent') || 'root';
const RECT = argOf('rect'), TEXT = argOf('text');
if (!IN || !OUT || !PROTO || !NAME || !RECT) {
  console.error('用法: node tools/gil/add_button.mjs --in=<存档> --out=<输出> --proto=<原型名> --name=<新名> [--parent=root] --rect=x,y,w,h [--text=…] [--dry]');
  process.exit(1);
}
const [rx, ry, rw, rh] = RECT.split(',').map((s) => Number(s.trim()));
if ([rx, ry, rw, rh].some((v) => !isFinite(v))) { console.error('❌ --rect 要写成 x,y,w,h'); process.exit(1); }

// ── 设计空间 → 存档里的那对数（**与适配器逐式相同** ✓ 见 place_select.mjs 的说明 ✓）──
const DESIGN_W = 1920, DESIGN_H = 1080, CANVAS_W = 1600, CANVAS_H = 900;
const SC = CANVAS_W / DESIGN_W;                     // 5/6
const R = (v) => Math.floor(v + 0.5);
const posX = R((rx + rw / 2) * SC) - R(CANVAS_W / 2);
const posY = (CANVAS_H - R((ry + rh / 2) * SC)) - R(CANVAS_H / 2);
const sizeW = R(rw * SC), sizeH = R(rh * SC);

const g = readGil(IN);
const proto = g.byName.get(PROTO);
if (!proto) { console.error('❌ 找不到原型 ' + PROTO); process.exit(2); }
const parent = g.byName.get(PARENT);
if (!parent) { console.error('❌ 找不到父控件 ' + PARENT); process.exit(2); }
if (g.byName.has(NAME)) { console.error('✗ 已存在同名控件 ' + NAME + '（本工具不覆盖 ✓）'); process.exit(2); }

console.log('存档 ' + path.basename(IN) + '　记录 ' + g.recs.length + '　maxId=' + g.maxId);
console.log('原型 ' + PROTO + ' #' + proto.id + '　父 ' + PARENT + ' #' + parent.id + '　新名 ' + NAME);
console.log('设计矩形 ' + rx + ',' + ry + ' ' + rw + '×' + rh
  + '　⇒ 存档几何 pos=[' + posX + ',' + posY + '] size=[' + sizeW + '×' + sizeH + ']');

// ── 收集原型子树（原型自己 ＋ 它的子控件、孙控件…）────────────────────────
const byId = new Map(g.recs.map((r) => [r.id, r]));
function childIdsOf(rec) {
  const cl = findChildListTop(rec.field.sub);
  if (!cl) return [];
  return asIdList(cl.payload, true) || [];
}
const subtree = [];
(function collect(id, depth) {
  const r = byId.get(id);
  if (!r || depth > 4) return;
  subtree.push(r);
  for (const k of childIdsOf(r)) collect(k, depth + 1);
})(proto.id, 0);
console.log('子树 ' + subtree.length + ' 条：' + subtree.map((r) => r.name).join(' → '));

// ── 深拷贝 ＋ 重新发号 ─────────────────────────────────────────────────────
function deepField(f) {
  const c = { field: f.field, wt: f.wt, sub: null, num: f.num, len: f.len, isText: f.isText,
              payload: f.payload ? Buffer.from(f.payload) : Buffer.alloc(0) };
  if (f.sub) c.sub = f.sub.map(deepField);
  return c;
}
function walkFields(fs, fn) { for (const f of fs) { fn(f); if (f.sub) walkFields(f.sub, fn); } }

let nextId = g.maxId + 1;
const idMap = new Map();
for (const r of subtree) idMap.set(r.id, nextId++);
const newRootId = idMap.get(proto.id);

const clones = subtree.map((r) => {
  const newId = idMap.get(r.id);
  const field = deepField(r.field);
  // ① 自己那条顶层 `#501`
  const top = field.sub.find((f) => f.wt === 0 && f.field === 501 && Number(f.num) === r.id);
  if (top) top.num = BigInt(newId);
  // ② 其它指向"本子树里某条记录"的引用（`#501`/`#4`/`#504`）一起换号
  walkFields(field.sub, (f) => {
    if (f.wt !== 0) return;
    if (f.field !== 501 && f.field !== 4 && f.field !== 504) return;
    const mapped = idMap.get(Number(f.num));
    if (mapped !== undefined) f.num = BigInt(mapped);
  });
  // ③ 子树**根**的父级 ⇒ 新父
  if (r.id === proto.id) {
    const p504 = field.sub.find((f) => f.wt === 0 && f.field === 504);
    if (!p504) { console.error('❌ 原型顶层没有 #504'); process.exit(4); }
    p504.num = BigInt(parent.id);
  }
  // ④ 子列表：换成新号（顺序原样 ✓）
  const cl = findChildListTop(field.sub);
  if (cl) {
    const kids = childIdsOf(r).map((k) => idMap.get(k)).filter((v) => v !== undefined);
    setChildList(cl, kids);
  }
  return { src: r, newId, field };
});

// ── 改名（只改子树根 ✓ 子控件名字保持 `bg`/`label` ✓ —— 引擎是按父级作用域找子控件的 ✓）──
function renameFrom(fields, oldName, newName) {
  const buf = Buffer.from(newName, 'utf8');
  let done = false;
  walkFields(fields, (f) => {
    if (done) return;
    if (f.wt === 2 && f.isText && f.field === 501 && f.payload && f.payload.toString('utf8') === oldName) {
      f.payload = buf; f.len = buf.length; done = true;
    }
  });
  return done;
}
const rootClone = clones.find((c) => c.newId === newRootId);
if (!renameFrom(rootClone.field.sub, proto.name, NAME)) { console.error('❌ 改不动名字（原型名 ' + proto.name + '）'); process.exit(4); }

// ── 几何：只给子树根写（子控件保持原型里的相对几何 ✓）──────────────────────
let pairs = 0;
for (const b of stateBlocks(rootClone.field.sub, [])) {
  const p5 = pairOf(b, 505); if (p5) { setPair(p5, sizeW, sizeH); pairs++; }
  const p4 = pairOf(b, 504); if (p4) { setPair(p4, posX, posY); pairs++; }
}

// ── 落盘前的清单打印 ───────────────────────────────────────────────────────
for (const c of clones) {
  const isRoot = c.newId === newRootId;
  console.log('  ' + (isRoot ? '＋' : '  ') + ' ' + (isRoot ? NAME : c.src.name).padEnd(20)
    + ' #' + c.newId + (isRoot ? ('  父=' + PARENT + '  pos/尺寸对 ' + pairs + ' 个') : '  （原型的子控件 ✓）'));
}
if (TEXT != null) console.log('  ⚠️ 文字「' + TEXT + '」**不写进存档** ✓（官方规则：控件文字不落盘 ✓）'
  + ' ⇒ 由脚本运行时填 ✓（`ui_controller` 的 push 里那个 `text` ✓）');

if (DRY) { console.log('\n--dry：不写文件 ✓'); process.exit(0); }

// ── 挂进父级 ＋ 写进记录容器 ───────────────────────────────────────────────
for (const c of clones) g.recHolder.push({ field: proto.field.field, wt: 2, sub: c.field.sub, num: 0n,
                                          payload: Buffer.alloc(0), len: 0, isText: false });
const pl = ensureChildListTop(parent, findChildListTop(proto.field.sub));
const pids = asIdList(pl.payload, true) || [];
pids.push(newRootId);
setChildList(pl, pids);

try {
  const rep = writeGil(g, OUT, {
    label: '新增按钮 ' + NAME,
    expectRecs: g.recs.length + clones.length,
    assert: (g2) => {
      const bad = [];
      const r2 = g2.byName.get(NAME);
      if (!r2) return '新建的 ' + NAME + ' 回读不到';
      if (r2.parentId !== parent.id) bad.push(NAME + ' 的父不是 ' + PARENT);
      const cl2 = findChildListTop(r2.field.sub);
      const kids = cl2 ? (asIdList(cl2.payload, true) || []) : [];
      const kidNames = kids.map((i) => (g2.recs.find((x) => x.id === i) || {}).name);
      if (!kidNames.includes('label')) bad.push(NAME + ' 缺 `label` 子控件（★ 按钮就没字了 ✗）');
      if (!kidNames.includes('bg')) bad.push(NAME + ' 缺 `bg` 子控件（★ 按钮就没底图了 ✗）');
      const b = stateBlocks(r2.field.sub, [])[0];
      const px = pairOf(b, 504), sx = pairOf(b, 505);
      const gx = px ? Number(px.sub.find((f) => f.field === 501).f) : 0;
      const gy = px ? Number(px.sub.find((f) => f.field === 502).f) : 0;
      const gw = sx ? Number(sx.sub.find((f) => f.field === 501).f) : 0;
      const gh = sx ? Number(sx.sub.find((f) => f.field === 502).f) : 0;
      if (gx !== posX || gy !== posY || gw !== sizeW || gh !== sizeH) {
        bad.push(NAME + ' 几何 = [' + gx + ',' + gy + ' ' + gw + '×' + gh + ']，期望 [' + posX + ',' + posY + ' ' + sizeW + '×' + sizeH + ']');
      }
      const p2 = g2.byName.get(PARENT);
      const pl2 = findChildListTop(p2.field.sub);
      const ids2 = asIdList(pl2.payload, true) || [];
      if (ids2.indexOf(newRootId) !== ids2.length - 1) bad.push(NAME + ' 不是 ' + PARENT + ' 的最后一个子控件（z 序 ✗）');
      return bad.length ? bad.join('；') : true;
    },
  });
  console.log('\n输出：' + path.basename(OUT) + '（' + rep.bytes + ' 字节，记录 ' + rep.recs + ' 条，字段差异 ' + rep.diffs + ' 处）');
  console.log('★ 独立复核：node tools/gil/roundtrip.mjs ' + path.basename(OUT));
} catch (e) {
  console.error('\n❌ ' + e.message);
  process.exit(5);
}
