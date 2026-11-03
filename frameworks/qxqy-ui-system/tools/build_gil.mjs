#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// tools/build_gil.mjs —— 生成 `473-教程UI系统骨架-v1.gil`（教程 UI 框架的客户端控件树）
//
// ★ 唯一写入通道：`qianxing-murdoku/tools/gil/gilwrite.mjs` 的 `writeGil()`
//   （它自己会：编码 → 落盘 → **从磁盘重读** → 往返闸门 → 记录数断言 → 字段级 diff）
//   ⇒ 本脚本**不**自己 fs.writeFileSync 一个 .gil ✗
//   ⇒ **不**用 `tools/gil/gen.mjs` / `gen_bulk.mjs`（两者头部自标 legacy / 有已知静默损坏 ✗）
//
// ★ 两个供体
//   · 骨架：`qianxing-murdoku/assets/纯2D游戏模板(客户端脚本版).gil`
//           （24 条记录、每种控件一个原型、干净关卡）
//   · 图片：`qianxing-murdoku/存档/470-遗留清理-v282.gil`
//           （模板里的图片原型**没有 assetId**，拷过来是隐形图 ⇒ 必须借一张真图）
//
// ★ 每条记录要改的地方（三处 id + 名字 + 父 + 几何），见 docs/gil-build.md
//
// 用法：
//   node tools/build_gil.mjs                 # 写 qianxing-murdoku/存档/473-教程UI系统骨架-v1.gil
//   node tools/build_gil.mjs --probe         # 只打印计划，不写文件
//   node tools/build_gil.mjs --order=spec    # 子列表按"列出顺序"写（默认 engine = 反向，见下）
//   node tools/build_gil.mjs --out=xxx.gil
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, setChildList, findChildListTop, ensureChildListTop,
  pairOf, pairValue, setPair, asIdList, stateBlocks, bigIds, writeVarint, ID_LO, ID_HI,
} from '../../../qianxing-murdoku/tools/gil/gilread.mjs';
import { writeGil } from '../../../qianxing-murdoku/tools/gil/gilwrite.mjs';

// ── 路径（★ 用 fileURLToPath，中文路径用 new URL().pathname 会坏 ✗）─────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WS = path.resolve(HERE, '..');                       // workspace/qxqy-ui-system
const REPO = path.resolve(HERE, '..', '..', '..');         // …/miHoYo Launcher
const BASE = path.join(REPO, 'qianxing-murdoku/assets/纯2D游戏模板(客户端脚本版).gil');
const DONOR = path.join(REPO, 'qianxing-murdoku/存档/470-遗留清理-v282.gil');

const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const PROBE = argv.includes('--probe');
const ORDER = argOf('order') || 'engine';

// ── 输出位置（2026-10-21 用户指定）────────────────────────────────────────────
// 测试存档统一放到 `qianxing-murdoku/存档/`，命名沿用该仓的 `NNN-描述-vN.gil` 序列
// （该目录现在是 461…470，仓库根上另有 471/472；下一个号 = 473）。
//   · 换版本时只改 SEQ / SLUG 两处；`--out=` 仍可临时覆盖。
//   · `.build.json`（机器摘要）留在本工程 export/ 下，不污染对方仓的 存档/ 目录。
const ARCHIVE_DIR = path.join(REPO, 'qianxing-murdoku/存档');
const SEQ = '475';
const SLUG = '教程UI系统骨架-v3';
const OUT = path.resolve(argOf('out') || path.join(ARCHIVE_DIR, `${SEQ}-${SLUG}.gil`));

// ── 颜色（ARGB 十进制；写进图片槽 (73,96) 的 details #84 / #502）───────────────
//   ★ 命名澄清（实测）：`#84/#502` = **imageColor**（ARGB 染色），`#84/#503` = **assetId**
//     依据：同一个 assetId 100001 在 donor 里有 7 个不同 #502 ⇒ 不可能是"图源"；
//           murdoku 文档也写 `imageId=100001 + imageColor` 调色成各种墙/门 ✓
//   ★ 2026-10-19 修正（lead 反馈 + 模拟器截图）：plate / state.* 之前用了任务书里的**十进制**，
//     而那三个十进制是把 hex 算错了的（例：0xDD35465E 应为 3711256158，任务书写 3707041886
//     = 0xDCF4F85E = 亮黄绿 ⇒ 截图里底板发黄绿、白字看不清）。
//     ⇒ 现在**一律用 hex 字面量**（十进制由 JS 现算，见 build.json 的 colors），口径只有一处，不会再错。
const COLOR = {
  plate: 0xDD35465E,      // 深蓝板（alpha DD）
  bg1: 0x8C1E2A3A,        // page.p1
  bg2: 0x8C2A1E2A,        // page.p2（紫）
  bg3: 0x8C1E2A1E,        // page.p3（绿）
  sel: 0xFFFFD050,        // state.sel 金
  off: 0xAA9AA8BF,        // state.off 灰
};
const hex = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
const dec = (n) => Number(BigInt(n));     // 0xDD35465E 这类 > 2^31 的值直接当无符号数用
// ★ 锚点是 float32 存的：0.08 读回来是 0.07999999821186066 ⇒ 用容差比
const CLOSE = (a, b) => Math.abs(a - b) < 1e-4;

// ── 目标控件树（先列出者在【视觉最上层】；写进 gil 的子列表顺序由 ORDER 决定）──
const STRETCH = { aMin: [0, 0], aMax: [1, 1], off: [0, 0], size: [0, 0] };
const point = (off, size) => ({ aMin: [0.5, 0.5], aMax: [0.5, 0.5], off, size });

const plateChild = { name: 'plate', proto: 'image', kindLabel: '图片', ...STRETCH, color: COLOR.plate };
const btnText = (t) => ({ name: 'text', proto: 'textbox', kindLabel: '文本框', ...STRETCH, text: t, fontSize: 26 });

function tab(id, off, label) {
  return {
    name: 'tab.' + id, proto: 'button', kindLabel: '预设按钮', ...point(off, [120, 56]),
    children: [
      btnText(label),
      { name: 'state.sel', proto: 'image', kindLabel: '图片', ...point([0, -48], [22, 22]), color: COLOR.sel },
      { name: 'state.off', proto: 'image', kindLabel: '图片', ...point([0, -48], [22, 22]), color: COLOR.off },
      plateChild,
    ],
  };
}
function navBtn(name, off, size, label) {
  return {
    name, proto: 'button', kindLabel: '预设按钮', ...point(off, size),
    children: [btnText(label), plateChild],
  };
}
function page(n, bgColor) {
  return {
    name: 'page.p' + n, proto: 'container', kindLabel: '容器节点',
    aMin: [0.08, 0.14], aMax: [0.92, 0.84], off: [0, 0], size: [0, 0],
    children: [
      { name: 'label', proto: 'textbox', kindLabel: '文本框', ...point([0, 0], [620, 80]), text: '第 ' + n + ' 页 · 内容留白', fontSize: 30 },
      { name: 'bg', proto: 'image', kindLabel: '图片', ...STRETCH, color: bgColor },
    ],
  };
}

const TREE = {
  // ★ app.root **复用基线的"画布默认容器节点" `1073742017`**（改名 + 补几何 + 建子列表），
  //   不再新建一条顶层容器 —— 真机参照 `470-遗留清理-v282.gil` 的形状就是：
  //   `客户端控件容器(子=0)` + `root(父=null, 子=74, 状态=4)`，**控件树全挂在那个 root 下面**。
  //   官方 `game.GetClientUIRoots()` = 「画布中的默认容器节点」= 这个父=null 的容器 ✓
  //   而 `FindClientUIRoot("app.root")` 只查根层 ⇒ 它必须叫 app.root 且**没有父**。
  name: 'app.root', proto: 'container', kindLabel: '容器节点', ...STRETCH,
  reuseId: 1073742017,
  children: [
    {
      name: 'screen.demo', proto: 'container', kindLabel: '容器节点', ...STRETCH,
      children: [
        {
          name: 'btn.close', proto: 'button', kindLabel: '预设按钮', ...point([560, 300], [80, 56]),
          children: [btnText('×'), plateChild],
        },
        { name: 'hud.title', proto: 'textbox', kindLabel: '文本框', ...point([0, 310], [820, 56]), text: '教程 UI 系统 · 翻页单击活动（架构骨架）', fontSize: 28 },
        { name: 'hud.pager', proto: 'textbox', kindLabel: '文本框', ...point([0, -300], [220, 44]), text: '1 / 3', fontSize: 22 },
        tab('p1', [-170, 250], '1'),
        tab('p2', [0, 250], '2'),
        tab('p3', [170, 250], '3'),
        navBtn('btn.prev', [-470, -250], [110, 64], '‹'),
        navBtn('btn.next', [470, -250], [110, 64], '›'),
        navBtn('btn.reset', [0, -250], [150, 60], '重置'),
        page(1, COLOR.bg1),
        page(2, COLOR.bg2),
        page(3, COLOR.bg3),
      ],
    },
  ],
};

// ── 扁平化（保持"先列出者在上层"的语义顺序）──────────────────────────────────
function flatten(node, parent, out) {
  const rec = { ...node, parentName: parent ? parent.name : null };
  out.push(rec);
  for (const c of node.children || []) flatten(c, node, out);
  return out;
}
const PLAN = flatten(TREE, null, []);

// ══════════════════════════════════════════════════════════════════════════
// 小工具
// ══════════════════════════════════════════════════════════════════════════

/**
 * 记录顶层 Data 槽：返回那个 `#505 { … }` 字段本身（按 `#501=a`/`#502=b` 定位）。
 * ⚠️ 实测：**不是每个槽都有 `#503` details**
 *   · 槽 (2,15) 名字/类型：`#505 { #12 { #501 = "…" }, #501 = 2, #502 = 15 }` ← 直接在 #505 下
 *   · 槽 (64,84) 文本 / (73,96) 图片：`#505 { … , #503 { #75/#84 … } }` ← 有 details
 *   ⇒ 两个访问器分开：`slotOf()` 拿 #505，`slotDetails()` 再往里拿 #503
 */
function slotOf(fields, a, b) {
  for (const f of fields) {
    if (f.field !== 505 || !f.sub) continue;
    const pA = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const pB = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (pA && pB && Number(pA.num) === a && Number(pB.num) === b) return f;
  }
  return null;
}
/** 槽里的 `#503` details（有就返回，没有返回 null） */
function slotDetails(slot) {
  if (!slot || !slot.sub) return null;
  return slot.sub.find((x) => x.field === 503 && x.sub) || null;
}
/** 类型名 / 实例名：槽 (2,15) → #12 → #501 字符串 */
function nameFieldOf(fields) {
  const slot = slotOf(fields, 2, 15);
  if (!slot) return null;
  const d12 = slot.sub.find((x) => x.field === 12);
  if (!d12 || !d12.sub) return null;
  return d12.sub.find((x) => x.field === 501 && x.wt === 2) || null;
}
/** 类型名（原型上住在槽 (2,15) 的 #12/#501；实例上这个位置是实例名） */
function kindOf(rec) {
  const s = nameFieldOf(rec.field.sub);
  return s ? s.payload.toString('utf8') : null;
}
/** 改名：槽 (2,15) → #12 → #501 的 UTF-8 字符串 */
function setName(cfSub, newName) {
  const s = nameFieldOf(cfSub);
  if (!s) throw new Error('改名失败：槽 (2,15)/#12 里没有字符串');
  const old = s.payload.toString('utf8');
  s.payload = Buffer.from(newName, 'utf8');
  s.len = s.payload.length;
  return old;
}
/** 文字：槽 (64,84) 或 (71,94) → details → #75(TextConfig) → #510 { #501 = "…" }；#512 = 字号 */
function textConfigOf(cfSub) {
  const slot = slotOf(cfSub, 64, 84) || slotOf(cfSub, 71, 94);
  const det = slotDetails(slot);
  return det ? det.sub.find((x) => x.field === 75) : null;
}
function setText(cfSub, text, fontSize) {
  const d75 = textConfigOf(cfSub);
  if (!d75 || !d75.sub) throw new Error('写字失败：找不到 #75 TextConfig');
  const d510 = d75.sub.find((x) => x.field === 510);
  if (!d510) throw new Error('写字失败：#75 里没有 #510 文字包装');
  const buf = Buffer.from(text, 'utf8');
  d510.sub = [{ field: 501, wt: 2, payload: buf, isText: true, sub: null, len: buf.length }];
  d510.payload = encodeMsg(d510.sub);       // 两处都填：sub 为准，payload 供只读 payload 的工具用
  d510.len = d510.payload.length;
  d510.isText = false;
  if (fontSize != null) {
    const f512 = d75.sub.find((x) => x.field === 512 && x.wt === 0);
    if (!f512) throw new Error('写字失败：TextConfig 里没有 #512 字号');
    f512.num = BigInt(fontSize);
  }
  return true;
}
/** 图片槽 (73,96) 的 details → #84 */
function imageDetailsOf(cfSub) {
  const det = slotDetails(slotOf(cfSub, 73, 96));
  return det ? det.sub.find((x) => x.field === 84) : null;
}
/** 颜色：`#84/#502` = ARGB（`#84/#503` = assetId，不动它） */
function setImageColor(cfSub, argb) {
  const d84 = imageDetailsOf(cfSub);
  if (!d84 || !d84.sub) throw new Error('染色失败：槽 (73,96) 里没有 #84');
  const c = d84.sub.find((x) => x.field === 502 && x.wt === 0);
  if (!c) throw new Error('染色失败：#84 里没有 #502');
  c.num = BigInt(argb);
  return Number(c.num);
}
function imageAssetOf(cfSub) {
  const d84 = imageDetailsOf(cfSub);
  if (!d84 || !d84.sub) return null;
  const a = d84.sub.find((x) => x.field === 503 && x.wt === 0);
  return a ? Number(a.num) : null;
}
/**
 * 4 个**几何容器**：槽 (1,12) → details → `#13` → `#12` → 四个状态包装 `#501 { [#501=状态号], #502=几何 }`
 * 返回的每一项就是"状态块"里那个 `#502` —— `pairOf(它, 502/503/504/505/506)` = 锚点min/max/位移/尺寸/中心
 *
 * ★ 为什么不用 `gilread.stateBlocks()`：它要求几何容器里的 `#505`（尺寸）有**两个浮点**，
 *   而 (0,0) 尺寸按稀疏编码是**空消息** ⇒ 会被漏判（骨架里 `1073742017` 就是这样：状态=0）。
 *   app.root / screen.demo 是整屏拉伸容器（offset/size 都是 0）⇒ 必须按**结构**找，不能按"有值"找。
 *
 * ★ 踩过的坑：状态包装 `#501` 的内存形态是 `{ #502 { 几何 } }`，
 *   把 `pairOf(包装, 502)` 当锚点会拿到**整个几何容器**，`setPair` 一写就把锚点/尺寸/中心全抹了 ✗
 */
function geomBlocks(cfSub) {
  const slot = slotOf(cfSub, 1, 12);
  const det = slotDetails(slot);
  if (!det) throw new Error('几何失败：找不到槽 (1,12) 的 details');
  const d13 = det.sub.find((f) => f.field === 13);
  if (!d13 || !d13.sub) throw new Error('几何失败：details 里没有 #13');
  const d12 = d13.sub.find((f) => f.field === 12);
  if (!d12 || !d12.sub) throw new Error('几何失败：#13 里没有 #12');
  const wrappers = d12.sub.filter((f) => f.field === 501 && f.sub);
  return wrappers.map((w) => {
    const g = w.sub.find((x) => x.field === 502 && x.sub);
    if (!g) throw new Error('几何失败：状态包装里没有 #502 几何容器');
    return g;
  });
}
/** 几何：4 个状态块各写 anchorMin(#502)/anchorMax(#503)/offset(#504)/size(#505)
 *  `explicitZero: true` 时 offset/size 写成**显式浮点 0**（而不是稀疏省略）——
 *  复用 `1073742017` 当 app.root 时用它：值仍是"尺寸差 0 = 拉满父级"，但
 *  `gilread.stateBlocks()` 要求尺寸对里有 2 个浮点才认"状态块"⇒ 显式 0 才能读回 `状态=4`。 */
function setGeom(cfSub, spec, opts = {}) {
  const blocks = geomBlocks(cfSub);
  if (blocks.length !== 4) throw new Error('几何失败：状态块 = ' + blocks.length + '，应为 4');
  const setPE = (pairField, x, y) => {
    if (!pairField) return false;
    pairField.sub = [{ field: 501, wt: 5, f: x }, { field: 502, wt: 5, f: y }];
    pairField.len = 10;
    return true;
  };
  const put = opts.explicitZero ? setPE : setPair;
  for (const b of blocks) {
    put(pairOf(b, 502), spec.aMin[0], spec.aMin[1]);
    put(pairOf(b, 503), spec.aMax[0], spec.aMax[1]);
    put(pairOf(b, 504), spec.off[0], spec.off[1]);
    put(pairOf(b, 505), spec.size[0], spec.size[1]);
  }
  return blocks.length;
}
/** 找记录顶层某个 Data 槽的数组下标（用于**原位替换**一个槽，例如换 transform 槽） */
function slotIndex(cfSub, a, b) {
  return cfSub.findIndex((f) => {
    if (f.field !== 505 || !f.sub) return false;
    const pA = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const pB = f.sub.find((x) => x.field === 502 && x.wt === 0);
    return !!(pA && pB && Number(pA.num) === a && Number(pB.num) === b);
  });
}
/**
 * 父指针（记录**顶层** `#504 = <parentId>` 变长整数）
 * 原型顶层**没有** #504 ⇒ 新建，并模仿 murdoku 记录的字段顺序：#501 #502 [#503] #504 #505…
 * ⚠️ 注意：`#504` 在记录内部（状态块回指）也出现，但那是嵌套的，不能拿来当父指针
 */
function setParent(cfSub, parentId) {
  const found = cfSub.find((f) => f.field === 504 && f.wt === 0);
  if (found) { const old = Number(found.num); found.num = BigInt(parentId); return { created: false, old }; }
  const f = { field: 504, wt: 0, num: BigInt(parentId) };
  let at = 0;
  cfSub.forEach((x, i) => { if (x.field <= 503) at = i + 1; });   // #501/#502/#503 之后
  cfSub.splice(at, 0, f);
  return { created: true, at };
}
/**
 * 把克隆体里"所有指向原型 id 的引用"改成新 id
 * 实测每条记录有 7 处指向自己：#501 + #502/#11/#501 + #505/#503/#504/#4 ×5
 * ⇒ **不是只改第一个** ✗（只改第一个 ⇒ 记录内部仍自称是原型 ✗）
 */
function retargetIds(fields, oldId, newId) {
  let n = 0;
  (function w(fs2) {
    for (const f of fs2) {
      if (f.wt === 0 && BigInt(f.num) === BigInt(oldId)) { f.num = BigInt(newId); n++; }
      else if (f.wt === 2 && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 64) {
        const ids = asIdList(f.payload, false);
        if (ids && ids.length && ids.every((v) => BigInt(v) === BigInt(oldId))) {
          f.payload = Buffer.concat(ids.map(() => writeVarint(newId)));
          f.len = f.payload.length;
          f.sub = null;                      // ★ payload 变了 ⇒ 解析期的假 sub 必须作废
          n += ids.length;
        }
      }
      if (f.sub) w(f.sub);
    }
  })(fields);
  return n;
}
/** 写"纯 id 列表"字段（payload + len + **作废假 sub**，否则 encodeMsg 会走死 sub ✗） */
function writeIdList(field, ids) {
  const buf = ids.length ? Buffer.concat(ids.map((i) => writeVarint(i))) : Buffer.alloc(0);
  field.payload = buf;
  field.len = buf.length;
  field.sub = null;
  field.isText = false;
  return buf;
}
/** 记录里所有 ID 范围内的 wt0 值（用于"没有残留指向原型"的断言） */
function idRefs(fields, out = []) {
  for (const f of fields) {
    if (f.wt === 0 && BigInt(f.num) > ID_LO && BigInt(f.num) < ID_HI) out.push(Number(f.num));
    if (f.sub) idRefs(f.sub, out);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// 0) 预检：两个供体
// ══════════════════════════════════════════════════════════════════════════
console.log('── 0) 预检 ─────────────────────────────────────────────');
const g = readGil(BASE);
console.log(`骨架 ${path.basename(BASE)}：${g.src.length}B 记录 ${g.recs.length} 条 maxId=${g.maxId}`);
console.log(`  顶层字段：${g.tree.map((f) => f.field).join(',')}`);
console.log(`  recHolder = ${g.recHolder === g.tree ? '(tree)' : '(子消息)'}（新增记录必须 push 到这里）`);

// 原型：按"类型名 + 已知 id"双保险定位
const PROTOS = {};
for (const rec of g.recs) {
  const k = kindOf(rec);
  if (k) (PROTOS[k] = PROTOS[k] || []).push(rec);
}
const needProto = { container: '容器节点', textbox: '文本框', button: '预设按钮' };
const protoOf = {};
for (const [key, kind] of Object.entries(needProto)) {
  const list = PROTOS[kind] || [];
  // 根级（parent=null）那一份才是可直接克隆的模板原型
  const pick = list.find((r) => r.parentId == null) || list[0];
  if (!pick) throw new Error('骨架里找不到「' + kind + '」原型');
  protoOf[key] = pick;
  console.log(`  原型 ${key} ← 「${kind}」#${pick.id}  状态=${pick.states.length}  父=${pick.parentId}`);
}
// 画布根容器节点：**复用**它当 app.root（真机参照的形状见 TREE 注释）
const canvasRoot = g.recs.find((r) => r.id === 1073742017);
const canvas = g.recs.find((r) => r.id === 1073742016);
if (!canvasRoot) throw new Error('骨架里找不到画布默认容器节点 1073742017');
console.log(`  画布：客户端控件容器 #${canvas ? canvas.id : '?'}（父 ${canvas ? canvas.parentId : '?'}，子列表=${
  canvas && findChildListTop(canvas.field.sub) ? (asIdList(findChildListTop(canvas.field.sub).payload, true) || []).length : 0}）`
  + ` / 画布默认容器节点 #${canvasRoot.id}（父=${canvasRoot.parentId}，名字=${JSON.stringify(canvasRoot.name)}）`
  + ` ⇒ **复用它当 app.root**`);

// `/#9/#501` = 顶层对象 id 表（含画布默认容器节点 2017；新增的 **UI 根** 必须登记进来）
const f9 = g.tree.find((f) => f.field === 9);
const rootListField = f9 && f9.sub ? f9.sub.find((f) => f.field === 501) : null;
if (!rootListField) throw new Error('找不到 /#9/#501 顶层对象表');
const rootIds0 = asIdList(rootListField.payload, true);
if (!rootIds0) throw new Error('/#9/#501 的 payload 不是纯 id 列表');
console.log(`  /#9/#501 顶层对象 ${rootIds0.length} 个：${rootIds0.join(',')}`);
console.log(`  画布默认容器节点 #${canvasRoot ? canvasRoot.id : '?'} 在其中 = ${rootIds0.includes(1073742017)}`
  + `   假 sub = ${rootListField.sub === null ? 'null ✓' : '非 null ⚠（写列表时必须作废）'}`);

// 图片供体：从 donor 里挑一条 assetId = 100001（白色正四边形，可调色）且带 4 状态块的图片
const dg = readGil(DONOR);
console.log(`图片供体 ${path.basename(DONOR)}：${dg.src.length}B 记录 ${dg.recs.length} 条`);
const ASSET_WANTED = 100001;
let donorImage = null;
for (const rec of dg.recs) {
  if (rec.states.length !== 4) continue;
  if (imageAssetOf(rec.field.sub) !== ASSET_WANTED) continue;
  const hasName = !!rec.name;
  if (!donorImage || (hasName && !donorImage.name)) donorImage = rec;
}
if (!donorImage) throw new Error('donor 里找不到 assetId=' + ASSET_WANTED + ' 的图片记录');
const donorAsset = imageAssetOf(donorImage.field.sub);
console.log(`  选用图片 #${donorImage.id} name=${JSON.stringify(donorImage.name)} 父=${donorImage.parentId}`
  + ` 状态=${donorImage.states.length} assetId=#84/#503=${donorAsset}`
  + ` 原色 #84/#502=${Number(imageDetailsOf(donorImage.field.sub).sub.find((x) => x.field === 502 && x.wt === 0).num)}`);
// donor 记录里有没有"会指向 donor 其它记录"的引用？（除自身 id 外）
const donorSelfRefs = idRefs(donorImage.field.sub, []).filter((v) => v !== donorImage.id);
console.log(`  donor 记录内 ID 引用：自身 ${idRefs(donorImage.field.sub, []).length - donorSelfRefs.length} 处`
  + `，其它 ${donorSelfRefs.length} 处 ${donorSelfRefs.length ? JSON.stringify(donorSelfRefs) : '（无 ✓ 只会被换成新 id）'}`);

// ══════════════════════════════════════════════════════════════════════════
// 1) 计划：39 条新记录（app.root 复用 1073742017）
// ══════════════════════════════════════════════════════════════════════════
const NEW_COUNT = PLAN.filter((n) => !n.reuseId).length;
const REUSED = PLAN.filter((n) => n.reuseId);
console.log('\n── 1) 构建计划 ─────────────────────────────────────────');
console.log(`  新建记录 ${NEW_COUNT} 条 + 复用 ${REUSED.length} 条（${REUSED.map((n) => n.name + ' ← #' + n.reuseId).join('、')}）`
  + `（骨架 ${g.recs.length} → ${g.recs.length + NEW_COUNT}）`);
const byProto = {};
for (const n of PLAN.filter((x) => !x.reuseId)) byProto[n.proto] = (byProto[n.proto] || 0) + 1;
console.log('  按原型：' + Object.entries(byProto).map(([k, v]) => k + '×' + v).join('  '));

// id 分配：复用的用自己的 id；其余从 `--base=`（默认 1073743800）起递增。
//
// ★ 为什么不再用 "maxId + 1"（2026-10-21 真机导入实测）：
//   第一版按 maxId+1 取到 1073742040…1073742078，导入后编辑器报
//   「界面控件里的开关控件GUID重复:1073742041」。用 tools/gil_dupid.mjs 自查：
//   本文件内部**0 个重复认领**（每条记录恰好 1 个 recordId + 1 个 infoGuid）⇒ 撞的是
//   **目标工程里编辑器自己已经在的控件**（历史同类事故见
//   qianxing-murdoku/docs/回执-GUID撞号-v257b.md：那次也是"你的工程和我的文件之间撞了"，
//   解法同样是 `renumber_ids` 把新增控件搬到**高号段** 1073743794+）。
//   ⇒ 新增控件一律取高号段，离引擎自己的计数器和目标工程已用号段都远。
const ID_BASE = Number(argOf('base') || 1073745000);
let nextId = ID_BASE;
for (const n of PLAN) n.id = n.reuseId ? n.reuseId : nextId++;
const idByName = new Map();      // 名字 → 第一个 id（同名子控件很多，所以也存 key）
for (const n of PLAN) { n.key = (n.parentName ? n.parentName + '/' : '') + n.name; idByName.set(n.key, n.id); }

// 子列表写出顺序
// ★ 实测的引擎语义：**子列表里越靠后 = 显示越靠上**（官方 `SetSiblingIndex`「数值越大…显示越靠上」；
//   murdoku 真机结论「Instantiate 追加到末尾 = 显示在最上」）
// ⇒ 若想"先列出者在上层"，子列表要**反着写**。
// —— 但 page.* 例外：框架 `70_app.lua` 用「同级顺序 = 页顺序」⇒ 页必须按 p1,p2,p3 排，且整体压在底层。
function childEmitOrder(node) {
  const kids = node.children || [];
  if (!kids.length) return [];
  if (ORDER === 'spec') return kids.slice();
  const pages = kids.filter((c) => c.name.startsWith('page.'));
  const rest = kids.filter((c) => !c.name.startsWith('page.'));
  return [...pages, ...rest.slice().reverse()];
}
for (const n of PLAN) n.emitChildren = childEmitOrder(n);

// ══════════════════════════════════════════════════════════════════════════
// 2) 克隆 + 打补丁
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── 2) 克隆 + 打补丁 ────────────────────────────────────');
const clones = new Map();     // key → { field, id, name, parentName, ... }
const rows = [];
for (const n of PLAN) {
  // ── 复用既有记录（app.root ← 1073742017）：改名 + 换 transform 槽 + 补几何，不新建 ──
  if (n.reuseId) {
    const rec = g.recs.find((r) => r.id === n.reuseId);
    if (!rec) throw new Error(n.key + '：骨架里找不到要复用的 #' + n.reuseId);
    if (rec.parentId != null) throw new Error(n.key + '：#' + n.reuseId + ' 竟然有父 ' + rec.parentId + ' ⇒ 不是画布根');
    const cfSub = rec.field.sub;
    // 快照它原本引用的 id（这条记录自带的合法引用，改动后允许保留）
    const origIds = new Set(idRefs(cfSub, []));
    const oldName = setName(cfSub, n.name);
    // 换 transform 槽 (1,12)：从「容器节点」原型整槽克隆（含 #13/#12 的 4 个平台块），把槽里的自引用 retarget 成 2017
    const protoSlot = slotOf(protoOf.container.field.sub, 1, 12);
    if (!protoSlot) throw new Error(n.key + '：容器原型没有 transform 槽 (1,12)');
    const newSlot = cloneField(protoSlot);
    retargetIds(newSlot.sub, protoOf.container.id, n.reuseId);
    const at = slotIndex(cfSub, 1, 12);
    if (at < 0) throw new Error(n.key + '：#' + n.reuseId + ' 没有 transform 槽可替换');
    cfSub[at] = newSlot;
    // 几何：双向拉伸；offset/size 写**显式 0 浮点**（值一样，但能读回 状态=4）
    setGeom(cfSub, n, { explicitZero: true });
    // 自己的子列表先清空（安全），稍后统一登记
    const own = findChildListTop(cfSub);
    if (own) writeIdList(own, []);
    clones.set(n.key, { node: n, field: rec.field, sub: cfSub });
    n.clone = rec.field;                 // ★ 已在 recHolder 里，不能再 push 一次
    n.reused = true;
    rows.push({
      node: n, id: n.id, name: n.name, parent: null, proto: 'container(复用)',
      fromId: n.reuseId, fromName: oldName, refs: 0, parentInfo: '（无父 = UI 根，复用画布默认容器节点）',
      extra: '换 transform 槽(1,12) + 显式零几何',
    });
    // 复用记录里除了"它自己"和"它原本就引用的 id"，不该多出别的引用
    const allowed = new Set([n.id, ...origIds]);
    const foreign = [...new Set(idRefs(cfSub, []).filter((v) => !allowed.has(v)))];
    if (foreign.length) throw new Error(n.key + '：复用记录里有指向外部的 id ' + JSON.stringify(foreign));
    console.log(`  #${n.id} ${n.name.padEnd(11)} ← 复用画布默认容器节点（原名字=${JSON.stringify(oldName)}）`
      + `  自带引用 ${[...origIds].join(',') || '(无)'}  几何=双向拉伸(显式零)  父=null`);
    continue;
  }

  const src = n.proto === 'image' ? donorImage : protoOf[n.proto];
  if (!src) throw new Error('没有 ' + n.proto + ' 原型');
  const cf = cloneField(src.field);                    // 整条 `#502` 记录字段
  const cfSub = cf.sub;
  const protoId = src.id;

  // ① 三处 id：顶层 #501 ＋ #502/#11/#501 ＋ 每个槽的 #504/#4 …（统一按"值 == 原型 id"全换）
  const nRef = retargetIds(cfSub, protoId, n.id);
  if (nRef === 0) throw new Error(n.key + '：克隆体里没有指向原型 id 的引用 ⇒ 结构不符');
  const stray = idRefs(cfSub, []).filter((v) => v === protoId);
  if (stray.length) throw new Error(n.key + '：还有 ' + stray.length + ' 处指向原型 ' + protoId);

  // ② 名字
  const oldName = setName(cfSub, n.name);

  // ③ 父（app.root = UI 根 ⇒ **不写** #504）
  let parentInfo = '（无父 = UI 根）';
  if (!n.root) {
    const pid = idByName.get((n.parentName ? n.parentName + '/' : '') + n.parentName);
    const parentNode = PLAN.find((x) => x.name === n.parentName);
    if (!parentNode) throw new Error(n.key + '：父 ' + n.parentName + ' 不在计划里');
    const r = setParent(cfSub, parentNode.id);
    parentInfo = `父=${parentNode.id}（${n.parentName}${r.created ? '，新建 #504' : '，改写 #504 旧值 ' + r.old}）`;
  } else {
    // 克隆自原型的记录本来没有 #504；donor 图片有 ⇒ 根记录要显式删掉
    const at = cfSub.findIndex((f) => f.field === 504 && f.wt === 0);
    if (at >= 0) { cfSub.splice(at, 1); parentInfo += '（删掉了供体自带的 #504）'; }
  }

  // ④ 几何
  setGeom(cfSub, n);

  // ⑤ 文字 / 染色
  let extra = '';
  if (n.text != null) { setText(cfSub, n.text, n.fontSize); extra = `文字="${n.text}" fs=${n.fontSize}`; }
  if (n.color != null) {
    const got = setImageColor(cfSub, n.color);
    const asset = imageAssetOf(cfSub);
    if (n.proto === 'image' && !(asset > 0)) throw new Error(n.key + '：图片 assetId 无效 ⇒ 会看不见');
    extra = `色=${n.color}(${hex(n.color)}) assetId=${asset}`;
  }

  // ⑥ 克隆体自己的子列表：清空（原型/供体若有子列表，不清会被副本认领 ✗）
  const own = findChildListTop(cfSub);
  if (own) { writeIdList(own, []); extra += ' [已清空供体自带子列表]'; }

  const holder = { field: cf };
  clones.set(n.key, { node: n, field: cf, sub: cfSub });
  n.clone = cf;

  rows.push({ node: n, id: n.id, name: n.name, parent: n.root ? null : n.parentName, proto: n.proto, fromId: protoId, fromName: oldName, refs: nRef, extra, parentInfo });

  // ⑦ 克隆体里除了"自己"和"新父"之外，不该再指向任何别的 id（否则是 donor/原型带来的悬挂引用）
  const allowed = new Set([n.id, n.root ? -1 : PLAN.find((x) => x.name === n.parentName).id]);
  const foreign = [...new Set(idRefs(cfSub, []).filter((v) => !allowed.has(v)))];
  if (foreign.length) throw new Error(n.key + '：克隆体里有指向外部的 id ' + JSON.stringify(foreign));
}
for (const r of rows) {
  console.log(`  #${r.id} ${r.name.padEnd(11)} ← ${r.proto}(${r.fromId}${r.fromName ? ' "' + r.fromName + '"' : ''})  引用改 ${r.refs} 处  ` +
    `${r.parentInfo.padEnd(38)} aMin=(${r.node.aMin}) aMax=(${r.node.aMax}) off=(${r.node.off}) size=(${r.node.size})  ${r.extra}`);
}

// ══════════════════════════════════════════════════════════════════════════
// 3) 插进 recHolder + 登记子列表 + 登记 UI 根
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── 3) 挂树 ─────────────────────────────────────────────');
for (const n of PLAN) if (!n.reused) g.recHolder.push(n.clone);   // ★ 记录必须住进 recHolder（不是 g.tree）；复用记录已在里面

for (const n of PLAN) {
  if (!n.emitChildren.length) continue;
  const self = clones.get(n.key);
  const clField = ensureChildListTop(self, null);        // 没有就新建（插在 #502 之后）
  const ids = n.emitChildren.map((c) => clones.get(n.name + '/' + c.name).node.id);
  writeIdList(clField, ids);
  console.log(`  ${n.name} → 子列表 ${ids.length} 个 [${n.emitChildren.map((c) => c.name).join(', ')}]`
    + `（引擎语义：越靠后越靠上）`);
}
// UI 根登记：app.root == 1073742017，**它本来就在 `/#9/#501` 根表里** ⇒ 不再追加，只断言
const appRoot = PLAN.find((n) => n.reuseId);
if (!rootIds0.includes(appRoot.id)) throw new Error('/#9/#501 里没有画布根 ' + appRoot.id);
writeIdList(rootListField, rootIds0);        // 原样写回（消掉可能存在的假 sub，内容不变）
console.log(`  /#9/#501 顶层对象表：保持 ${rootIds0.length} 个（画布根 #${appRoot.id} 本来就在里面 ✓，无需追加）`);

// ══════════════════════════════════════════════════════════════════════════
// 4) 写盘（唯一安全通道）+ 从磁盘重读断言
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── 4) writeGil（编码→落盘→重读→往返→记录数→字段 diff）──────');
if (PROBE) { console.log('  --probe：不写文件 ✓'); process.exit(0); }
const EXPECT_RECS = g.recs.length + NEW_COUNT;

const rep = writeGil(g, OUT, {
  label: `教程 UI 框架（新建 ${NEW_COUNT} 条 + 复用画布根 1 条）`,
  expectRecs: EXPECT_RECS,
  // ★ 不传 expectDiffs：新增记录会让"按位置比对"报大量连带差异（diff_fields.mjs 头部同款说明）
  assert: (g2) => {
    // ① 记录数
    if (g2.recs.length !== EXPECT_RECS) return '记录数 ' + g2.recs.length + ' ≠ ' + EXPECT_RECS;
    const byId = new Map(g2.recs.map((r) => [r.id, r]));
    const byName2 = new Map();
    for (const r of g2.recs) if (r.name) { (byName2.get(r.name) || byName2.set(r.name, []).get(r.name)).push(r); }
    // ② 每条记录：存在、名字、父子
    for (const n of PLAN) {
      const r = byId.get(n.id);
      if (!r) return '❌ 重读后找不到 #' + n.id + ' ' + n.name;
      if (r.name !== n.name) return n.name + ' 名字读回 = ' + JSON.stringify(r.name);
      if (n.reuseId) {
        // 复用的画布根：必须无父 + 标准读取器也认 4 个状态块（尺寸写的是显式 0 浮点）
        if (r.parentId != null) return 'app.root(#1073742017) 应为无父，实得 ' + r.parentId;
        if (r.states.length !== 4) return 'app.root 标准读取器 状态 = ' + r.states.length + '，应为 4';
      } else if (!n.parentName) {
        if (r.parentId != null) return n.name + ' 应为无父，实得 ' + r.parentId;
      } else {
        const want = PLAN.find((x) => x.name === n.parentName).id;
        if (r.parentId !== want) return n.name + ' 父 = ' + r.parentId + '，应为 ' + want;
      }
      // ③ 几何（4 个状态块全部一致；用结构定位，不能被"零值=空消息"骗）
      const blocks = geomBlocks(r.field.sub);
      if (blocks.length !== 4) return n.name + ' 状态块 = ' + blocks.length;
      for (let i = 0; i < 4; i++) {
        const b = blocks[i];
        const chk = (field, want, label) => {
          const f = pairOf(b, field);
          const x = pairValue(f, 0), y = pairValue(f, 1);
          if (!CLOSE(x, want[0]) || !CLOSE(y, want[1])) return `${n.name} 状态${i} ${label} = (${x},${y})，应为 (${want})`;
          return null;
        };
        const e = chk(502, n.aMin, 'aMin') || chk(503, n.aMax, 'aMax') || chk(504, n.off, 'off') || chk(505, n.size, 'size');
        if (e) return e;
      }
      // ④ 文字
      if (n.text != null) {
        const d75 = textConfigOf(r.field.sub);
        if (!d75 || !d75.sub) return n.name + ' 重读后找不到 TextConfig';
        const d510 = d75.sub.find((x) => x.field === 510);
        const s = d510 && d510.sub && d510.sub.find((x) => x.field === 501 && x.wt === 2);
        const got = s ? s.payload.toString('utf8') : null;
        if (got !== n.text) return n.name + ' 文字 = ' + JSON.stringify(got) + '，应为 ' + JSON.stringify(n.text);
        const f512 = d75.sub.find((x) => x.field === 512 && x.wt === 0);
        if (Number(f512.num) !== n.fontSize) return n.name + ' 字号 = ' + Number(f512.num) + '，应为 ' + n.fontSize;
      }
      // ⑤ 图片：颜色 + assetId
      if (n.proto === 'image') {
        const asset = imageAssetOf(r.field.sub);
        if (asset !== ASSET_WANTED) return n.name + ' assetId = ' + asset + '，应为 ' + ASSET_WANTED;
        const d84 = imageDetailsOf(r.field.sub);
        const c = d84.sub.find((x) => x.field === 502 && x.wt === 0);
        if (Number(c.num) !== n.color) return n.name + ' 颜色 = ' + Number(c.num) + '，应为 ' + n.color;
      }
      // ⑥ 没有残留指向原型的引用
      const stale = idRefs(r.field.sub, []).filter((v) => v === (n.proto === 'image' ? donorImage.id : protoOf[n.proto].id));
      if (stale.length) return n.name + ' 残留 ' + stale.length + ' 处指向原型';
    }
    // ⑦ 子列表顺序（从磁盘读回）
    for (const n of PLAN) {
      if (!n.emitChildren.length) continue;
      const r = byId.get(n.id);
      const cl = findChildListTop(r.field.sub);
      if (!cl) return n.name + ' 重读后没有子列表';
      const ids = asIdList(cl.payload, true) || [];
      const want = n.emitChildren.map((c) => clones.get(n.name + '/' + c.name).node.id);
      if (ids.join(',') !== want.join(',')) return n.name + ' 子列表 = [' + ids + ']，应为 [' + want + ']';
      for (const id of ids) if (!byId.has(id)) return n.name + ' 子列表里有不存在的 id ' + id;
    }
    // ⑧ 名字集合（含重名子控件的计数）
    const cnt = (arr) => { const m = new Map(); for (const s of arr) m.set(s, (m.get(s) || 0) + 1); return m; };
    const wantNames = cnt(PLAN.map((n) => n.name));
    const gotNames = cnt(PLAN.map((n) => (byId.get(n.id) || {}).name));
    if ([...wantNames].some(([k, v]) => gotNames.get(k) !== v)) return '名字计数不一致';
    // ⑨ UI 根表
    const f9b = g2.tree.find((f) => f.field === 9);
    const rl = f9b.sub.find((f) => f.field === 501);
    const rids = asIdList(rl.payload, true) || [];
    if (!rids.includes(appRoot.id)) return '/#9/#501 里没有 app.root #' + appRoot.id;
    if (rids.length !== rootIds0.length) return '/#9/#501 长度 = ' + rids.length + '，应为 ' + rootIds0.length + '（复用画布根 ⇒ 不新增根记录）';
    return true;
  },
});

// ══════════════════════════════════════════════════════════════════════════
// 5) 报告
// ══════════════════════════════════════════════════════════════════════════
const g2 = rep.g2;
const build = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  out: path.relative(REPO, OUT).replace(/\\/g, '/'),
  bytes: rep.bytes,
  base: { file: path.relative(REPO, BASE).replace(/\\/g, '/'), records: g.recs.length, maxId: g.maxId },
  donor: {
    file: path.relative(REPO, DONOR).replace(/\\/g, '/'),
    recordId: donorImage.id, name: donorImage.name,
    assetIdField: '#505(73,96)/#503/#84/#503', assetId: donorAsset,
    colorField: '#505(73,96)/#503/#84/#502',
  },
  prototypes: Object.fromEntries(Object.entries(protoOf).map(([k, r]) => [k, { id: r.id, kind: needProto[k] }])),
  counts: { newRecords: NEW_COUNT, reusedRecords: REUSED.length, namedControls: PLAN.length, totalRecords: rep.recs, baseRecords: g.recs.length },
  idRange: [Math.min(...PLAN.filter((n) => !n.reuseId).map((n) => n.id)), Math.max(...PLAN.map((n) => n.id))],
  appRoot: {
    reusedId: appRoot.id, name: appRoot.name,
    note: '复用基线画布默认容器节点 1073742017：改名 app.root + 从容器原型克隆 transform 槽(1,12) + 4 平台双向拉伸 + 显式零几何 + 建子列表',
    clientControlContainer: { id: canvas ? canvas.id : null, childListKept: 0 },
  },
  childListOrder: ORDER,
  decisions: {
    rootReuse: 'app.root **复用** 1073742017（不再新建顶层容器）；客户端控件容器 1073742016 的子列表保持 0。'
      + '真机参照 470-遗留清理-v282.gil：客户端控件容器(子=0) + root(父=null, 子=74, 状态=4)',
    rootIsParentless: 'app.root 无 #504：官方 game.GetClientUIRoots() = 「画布中的默认容器节点」，FindClientUIRoot 只查根层',
    rootListRegistered: '/#9/#501 根表**不追加**（1073742017 本来就在里面）',
    rootExplicitZero: '复用根的 offset/size 写成显式浮点 0（值仍是拉满父级）：gilread.stateBlocks() 要求尺寸对里有 2 个浮点才认状态块 ⇒ 才读得出 状态=4',
    childListOrder: ORDER === 'engine'
      ? '子列表**越靠后显示越靠上**（官方 SetSiblingIndex「数值越大…显示越靠上」+ murdoku 真机「Instantiate 追加到末尾=最上」）'
        + ' ⇒ 为了"先列出者在最上层"，写出的是列出顺序的**反向**；page.* 例外（框架按同级顺序取页序，故保持 p1,p2,p3 且整体压底）'
      : '按列出顺序原样写（--order=spec；与模拟器插件预览的观感一致，但与引擎语义相反）',
    colorField: '图片槽 (73,96) details 的 #84： #502 = imageColor(ARGB)，#503 = assetId',
    imageAsset: 'assetId=100001（白色正四边形白模），全部图片控件都用它 + 各自的 ARGB 染色',
    geometries: '四平台（KEYBOARD/TOUCHSCREEN/CONTROLLER_CONSOLE/CONTROLLER_MOBILE）各一套状态几何；零分量按引擎稀疏编码省略',
  },
  colors: Object.fromEntries(Object.entries(COLOR).map(([k, v]) => [k, { dec: v, hex: hex(v) }])),
  controls: PLAN.map((n) => ({
    id: n.id, name: n.name, parent: n.parentName || null, proto: n.proto, reused: !!n.reuseId,
    aMin: n.aMin, aMax: n.aMax, off: n.off, size: n.size,
    text: n.text == null ? undefined : n.text, fontSize: n.fontSize,
    color: n.color, children: n.emitChildren.map((c) => c.name),
  })),
  writeGil: { diffs: rep.diffs, compared: rep.compared, expectRecs: EXPECT_RECS },
  rootList: { field: '/#9/#501', count: rootIds0.length, changed: false, appRootId: appRoot.id },
};
// 机器摘要留在本工程 export/（不写进对方仓的 存档/ 目录）
const buildPath = path.join(WS, 'export', path.basename(OUT).replace(/\.gil$/, '.build.json'));
fs.writeFileSync(buildPath, JSON.stringify(build, null, 2) + '\n');
console.log('\n── 5) 成果 ─────────────────────────────────────────────');
console.log(`  ${path.relative(REPO, OUT)}  ${rep.bytes} 字节`);
console.log(`  记录 ${g2.recs.length} 条（骨架 ${g.recs.length} + 新建 ${NEW_COUNT}；app.root 复用 #${appRoot.id}）`
  + `  新 id ${build.idRange[0]}…${build.idRange[1]}`);
console.log(`  机器摘要 ${path.relative(REPO, buildPath)}`);
