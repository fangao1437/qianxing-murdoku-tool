// tools/gil/gen_art_containers.mjs —— 美术第二轮：格子模板补到 6 层家具（obj2..obj6）+ 房间名标签容器 `labels`
//
// ════════════════════════════════════════════════════════════════════════════
// 背景（2026-10-22 第二轮；lead 两次收窄后的最终口径）
// ════════════════════════════════════════════════════════════════════════════
//   用户打回：「达到参考图水准 + 跨格家具不能拆成两格」，并授权改 obj 底层架构。
//   → 家具 = 格子模板里的 **6 层 obj**（obj..obj6 从下到上），跨格家具靠"锚点格溢出"实现；
//   → 房间名标签要**独立于格子的静态层**（`root` 下新增 `labels` 容器 + 7 个文本框，运行时复用）。
//   ★ `furn` 容器（110 个图片控件）方案已被 lead 取消（2026-10-22 第三版收窄），本工具不做。
//
// 本工具做两件事（**幂等**：已存在的层/控件不重复加）：
//   ① 两份 `content`（cell.1.1 本体 #1073741888 / 模板层级根下那份 #1073741886，E6）各补
//      **obj2 / obj3 / obj4 / obj5 / obj6** 五层：从各自的 `obj` 克隆，
//      插在子控件列表 `obj` 之后、`x` 之前 ⇒
//      face → hint → obj → obj2 → obj3 → obj4 → obj5 → obj6 → x → wall.* → note → door.* → portrait。
//      ⚠️ 基线 494 里**只有 obj**（obj2/obj3 是上一轮 495/496/497 的产物，本轮从 494 起跑，不基于它们）
//      ⇒ 工具自动补齐 2/3/4/5/6 ⇒ **+5 层 ×2 份 = +10 条记录**（只加 obj4~obj6 的话层序/名字对账都对不上，
//      见回执里的算式说明）。
//      「字段与 obj 逐项一致」不靠嘴：克隆后先做**规范化字段树签名比对**（把"原型 id↔新 id""原型名↔新名"
//      折叠成同一标记再逐节点比），0 差异才继续。
//   ② `root` 下新增 `labels` 容器（排在 `stage` 之后 = 画在格子之上）+ **7 个文本框** `label.1`…`label.7`：
//      · 容器：克隆 `topbar`（普通容器母本，组件指纹与 root 同类、无模板引用/光标槽），1600×900 覆盖棋盘区，
//        锚点居中；子控件 = 7 个 label。
//      · 文本框：克隆 `hud.subtitle`（可见的文本框母本），220×44、锚点居中、`text=""`、**visible=false**、
//        active=true（不写 inactive 标记 = 默认激活）；
//        fontSize=30 / adaptiveFontSize=false / minimumFontSize=16 / fontColor=0xFFFFFFFF / bgColor=0x00000000 /
//        enableOutline=true / outlineColor=0xFF3A2A1E / horizontalAlignment=Center / verticalAlignment=Center。
//      → **+8 条记录**（1 容器 + 7 文本）。
//   ⇒ 记录数：**466 + 10 + 8 = 484**（已与 lead 对齐：lead 2026-10-22 确认 480 是漏算了
//      obj2/obj3 那 4 条；"层序含 obj2..obj6 / list_names obj=18"这两个断言都要求它们存在）。
//
// ── 关键设计（沿用上一轮 `gen_obj_art.mjs` 的写法与踩坑结论）──────────────────
//   ★ 新记录**追加到 `g.recHolder` 末尾**（E10：字段 diff 是按位置比的，插中间会让后续兄弟下标整体位移，
//     审计就失效了）。层级只由父指针 `#504` + 父记录的子列表决定；**子控件次序**才决定谁盖谁 ⇒
//     我们改的是 `content` / `root` 的子列表 ID 数组。
//   ★ 克隆必须**整条记录 remap 自身 GUID**（E1：只改顶层 `#501` 会让编辑器报「控件 GUID 重复」）。
//   ★ GUID 从 **1073746100** 起（lead 指定；先扫全档已用 id 区间 varint，保证文件内唯一）。
//     ★ 不复用上一轮 495/496 的 1073746000–1073746003 —— 两份 .gil 若同时留在工程里，同号会撞（E11）。
//   ★ **分段写盘**（两次 `writeGil`，中间文件在系统临时目录，成功即删）：
//       ① 只加 5 层 ⇒ 断言"差异恰好 = 1 处记录数组条数 + 2 处 content 子列表"；
//       ② 只加 labels（容器+7 文本）⇒ 断言"差异恰好 = 1 处记录数组条数 + 1 处 root 子列表"。
//     这样每段的 `expectDiffs` 都能逐条解释；最终 `diff_fields 494→498` = **4 处**结构差异。
//   ★ 所有写 `.gil` 只走 `writeGil()`（自带 落盘→重读磁盘→往返闸门→字段 diff 断言）。
//   ★ 写完后**原样跑仓库只读闸门**并打印：probe_guid_collision / roundtrip / diff_fields /
//     list_names（obj=18、label.=7），再回读 root 子控件顺序与两份 content 层序。
//
// ── 字段路径依据（全部来自仓内已验证工具/文档，不发明）────────────────────────
//   · 可见性：`#505`(tag 4/86) → `#503` → `#14` → `#17` → `#503=1` ⇒ 存档里存"隐藏"；叶子缺失 ⇒ 可见
//     （`check_visible.mjs` 实测判据；全部 466 条里隐藏/可见两态只有这一处差异）
//   · active：`#14` 下的 `#502` = inactive 标记（`docs/转换器-gil到模拟器存档.md` §4.1）；
//     本档 466 条**没有任何** inactive 标记 ⇒ "不写 = 默认激活"（本工具据此断言 active=true）
//   · 文本属性组：`/505/503/75` 节点（`fix_btn_label.mjs`）：
//       #504 fontColor / #505 bgColor / #507 outlineColor / #508 水平对齐(1=Center) /
//       #509 垂直对齐(1=Center) / #510.text(#501) / #512 fontSize / #513 minimumFontSize /
//       #502 adaptiveFontSize（存在=开；false ⇒ 删掉）/ #506（`docs/转换器`：enableOutline = #506 !== 1
//       ⇒ 要开就保持缺失）
//   · 图片槽：`/505/503/84` 的 `#502`=imageColor / `#503`=imageId / `#504`=imageType；
//     `imageSource` 在 `.gil` 里**没有独立字段**（= 默认 StaticReference，`gen_tutorial_teach.mjs` v291 实测结论）✓
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_art_containers.mjs --in=494-教程teach-v298.gil --out=498-一二关美术-容器-v1.gil [--dry]
//   --guid-base=  新 GUID 起点（默认 1073746100；只影响新记录，不改已有号）
//   --layers=     只加哪些层（默认 obj2,obj3,obj4,obj5,obj6；调试用，正常别动）
//   退出码：0 成功（含幂等"无需改动"）；1 用法错；2 基线结构不符；3 断言/写入失败；4 外部闸门失败
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList,
  stateBlocks, pairOf, pairValue, setPair, textsOf, writeVarint, ID_LO, ID_HI,
} from './gilread.mjs';
import { writeGil, loadTree, diffTrees } from './gilwrite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const hasFlag = (k) => argv.includes('--' + k);

const IN = argOf('in');
const OUT = argOf('out');
const DRY = hasFlag('dry');
const GUID_BASE = Number(argOf('guid-base', '1073746100'));

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const DEFAULT_LAYERS = ['obj2', 'obj3', 'obj4', 'obj5', 'obj6'];   // 从下到上；obj 基座已在
const LAYERS = (argOf('layers', DEFAULT_LAYERS.join(',')) || '').split(',').map((s) => s.trim()).filter(Boolean);
const CELL = 135;
const BASE_IMG_ID = 100001;
const WHITE = 0xFFFFFFFF;

// 容器 `labels`
const CONTAINER_NAME = 'labels';
const CONTAINER_PROTO = 'topbar';       // 普通容器母本（无模板引用/光标槽）
const BOARD_W = 700, BOARD_H = 700;     // 与棋盘同区（stage 584×584 @(100,20)）
// 文本框
const TEXT_PROTO = 'hud.subtitle';      // 可见的文本框母本（text 为空 / 无 alignment / 无 outline 标记）
const LABEL_COUNT = 7;
const LABEL_W = 220, LABEL_H = 44;
const FONT_SIZE = 30, MIN_FONT_SIZE = 16;
const FONT_COLOR = 0xFFFFFFFF;
const BG_COLOR = 0x00000000;
const OUTLINE_COLOR = 0xFF3A2A1E;
const ALIGN_MIDDLE = 1;                 // horizontalAlignment / verticalAlignment 的 Center

const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const hex32 = (v) => '0x' + (Number(v) >>> 0).toString(16).toUpperCase().padStart(8, '0');
const basenameOf = (p) => path.basename(p);

// ════════════════════════════════════════════════════════════════════════════
// 1. 字段级 helper（按【路径/类型】取值 —— 同号字段陷阱）
// ════════════════════════════════════════════════════════════════════════════
function topVarint(fields, no) {
  const f = (fields || []).find((x) => x.field === no);
  return f && f.wt === 0 ? f : null;
}
/** 按字段号逐层下钻：返回第 depth 层的节点（与 fix_btn_label.mjs 的 nodesAt 同一口径） */
function nodesAt(fields, pathArr) {
  let level = fields;
  for (let i = 0; i < pathArr.length; i++) {
    const hits = level.filter((f) => f.field === pathArr[i] && f.sub);
    if (i === pathArr.length - 1) return hits;
    level = hits.flatMap((f) => f.sub);
  }
  return [];
}
/** 顶层 `#505` 块里 (tag1, tag2) 的那一块 */
function blockOfTag(recField, tag1, tag2) {
  for (const f of (recField.sub || [])) {
    if (f.field !== 505 || !f.sub) continue;
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const b = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (a && b && Number(a.num) === tag1 && Number(b.num) === tag2) return f;
  }
  return null;
}
function imageNodes(recField) {
  let cur = [recField];
  for (const fno of [505, 503, 84]) {
    const nxt = [];
    for (const f of cur) if (f && f.sub) for (const c of f.sub) if (c.field === fno && c.sub) nxt.push(c);
    cur = nxt;
  }
  return cur;
}
function imageTriple(recField) {
  const nodes = imageNodes(recField);
  if (nodes.length !== 1) throw new Error('图片节点 `/505/503/84` 命中 ' + nodes.length + ' 个（预期 1）');
  const n = nodes[0];
  const leaf = (no) => n.sub.find((f) => f.field === no && f.wt === 0) || null;
  const idLeaf = leaf(503), colorLeaf = leaf(502), typeLeaf = leaf(504);
  if (!idLeaf || !colorLeaf) throw new Error('图片节点缺 #502(imageColor) 或 #503(imageId)');
  return {
    node: n, idLeaf, colorLeaf,
    id: Number(idLeaf.num), color: Number(colorLeaf.num),
    type: typeLeaf ? Number(typeLeaf.num) : null,
  };
}
function stateSummary(recField) {
  return stateBlocks(recField.sub, []).map((b) => {
    const pos = pairOf(b, 504), size = pairOf(b, 505);
    return {
      block: b, pos, size,
      x: pairValue(pos, 0), y: pairValue(pos, 1),
      w: pairValue(size, 0), h: pairValue(size, 1),
      aMinX: pairValue(pairOf(b, 502), 0), aMinY: pairValue(pairOf(b, 502), 1),
      aMaxX: pairValue(pairOf(b, 503), 0), aMaxY: pairValue(pairOf(b, 503), 1),
      pivX: pairValue(pairOf(b, 506), 0), pivY: pairValue(pairOf(b, 506), 1),
    };
  });
}
/** 可见性（与 check_visible.mjs 同一判据）：任一 `#505` 块内 `/503/14/17/503=1` ⇒ 存档里存"隐藏" */
function isHiddenRec(recField) {
  let hidden = false;
  for (const f of (recField.sub || [])) {
    if (f.field !== 505 || !f.sub) continue;
    (function walk(fs2, p) {
      for (const x of fs2) {
        const pp = p + '/' + x.field;
        if (x.wt === 0 && pp === '/503/14/17/503') hidden = true;
        else if (x.sub) walk(x.sub, pp);
      }
    })(f.sub, '');
  }
  return hidden;
}
/** 把存档里的"初始可见性"写成 **隐藏**（叶子 = 1；见 check_visible.mjs 的判据与极性） */
function setHiddenRec(recField) {
  const blk = blockOfTag(recField, 4, 86);
  if (!blk) throw new Error('找不到 #505(4/86) 可见性块');
  const p503 = blk.sub.find((x) => x.field === 503 && x.sub);
  const p14 = p503 && p503.sub.find((x) => x.field === 14 && x.sub);
  if (!p14) throw new Error('#505(4/86) 里找不到 #503/#14');
  let p17 = p14.sub.find((x) => x.field === 17 && x.wt === 2);
  if (!p17) { p17 = { field: 17, wt: 2, sub: null, payload: Buffer.alloc(0), len: 0, isText: false }; p14.sub.push(p17); }
  p17.sub = [{ field: 503, wt: 0, num: 1n }];
  p17.payload = encodeMsg(p17.sub);
  p17.len = p17.payload.length;
  p17.isText = false;
}
/** inactive 标记：#14 下的 #502（`docs/转换器` §4.1）。本档全档 0 条 ⇒ "不写 = 默认激活" */
function inactiveLeaves(recField) {
  const hits = [];
  (function walk(fs2) {
    for (const f of fs2) {
      if (!f.sub) continue;
      if (f.field === 14) {
        const m = f.sub.find((x) => x.field === 502 && x.wt === 0);
        if (m) hits.push(Number(m.num));
      }
      walk(f.sub);
    }
  })(recField.sub || []);
  return hits;
}
function countVarintEqual(fields, val) {
  let n = 0;
  (function walk(list) {
    for (const f of list) {
      if (f.wt === 0 && Number(f.num) === val) n++;
      if (f.sub) walk(f.sub);
    }
  })(fields);
  return n;
}
function remapSelfIds(fields, oldId, newId) {
  let n = 0;
  (function walk(list) {
    for (const f of list) {
      if (f.wt === 0 && Number(f.num) === oldId) { f.num = BigInt(newId); n++; }
      else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const ids = asIdList(f.payload, false);
        if (ids && ids.length === 1 && ids[0] === oldId) { f.payload = writeVarint(newId); f.len = f.payload.length; n++; }
      }
      if (f.sub) walk(f.sub);
    }
  })(fields);
  return n;
}
function renameRecord(fields, oldName, newName) {
  const hits = textsOf(fields, []).filter((t) => t.payload && t.payload.toString('utf8') === oldName);
  if (hits.length !== 1) return { ok: false, hits: hits.length };
  hits[0].payload = Buffer.from(newName, 'utf8');
  hits[0].len = hits[0].payload.length;
  return { ok: true, hits: 1 };
}
function sigOf(fields, { idSet = new Set(), nameSet = new Set() } = {}) {
  const enc = (f) => {
    if (f.wt === 0) return '0:' + f.field + ':' + (idSet.has(Number(f.num)) ? 'SELF' : String(f.num));
    if (f.wt === 5) return '5:' + f.field + ':' + (Object.is(f.f, -0) ? '-0' : String(f.f));
    if (f.wt === 1) return '1:' + f.field + ':' + (f.raw ? f.raw.toString('hex') : '');
    if (f.isText) { const s = f.payload.toString('utf8'); return 'T:' + f.field + ':' + (nameSet.has(s) ? 'NAME' : s); }
    if (f.sub) return 'M:' + f.field + '(' + f.sub.map(enc).join(',') + ')';
    return 'B:' + f.field + ':' + (f.payload ? f.payload.toString('hex') : '');
  };
  return fields.map(enc);
}
function assertFaithful(protoFields, cloneFields, oldName, oldId, newId, newName, label) {
  const a = sigOf(protoFields, { idSet: new Set([oldId]), nameSet: new Set([oldName]) }).join('|');
  const b = sigOf(cloneFields, { idSet: new Set([newId]), nameSet: new Set([newName]) }).join('|');
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  fatal('[' + label + '] 克隆体与原型 ' + oldName + '#' + oldId + ' 字段不一致（' + i + ' 字符起）：\n'
    + '   原型：…' + a.slice(Math.max(0, i - 70), i + 130) + '\n'
    + '   克隆：…' + b.slice(Math.max(0, i - 70), i + 130));
}
// 文本属性组 `/505/503/75`
function textConfigOf(recField) {
  const hits = nodesAt(recField.sub || [], [505, 503, 75]);
  if (hits.length !== 1) throw new Error('文本属性组 `/505/503/75` 命中 ' + hits.length + ' 个（预期 1）');
  return hits[0];
}
function textLeaf(node, no) { return (node.sub || []).find((f) => f.field === no && f.wt === 0) || null; }
function setTextLeaf(node, no, value) {
  let f = textLeaf(node, no);
  if (!f) { f = { field: no, wt: 0, num: 0n }; node.sub.push(f); }
  f.num = BigInt(value);
  return f;
}
function removeTextLeaf(node, no) {
  const i = (node.sub || []).findIndex((f) => f.field === no && f.wt === 0);
  if (i >= 0) { node.sub.splice(i, 1); return true; }
  return false;
}
function textContentOf(node) {
  const p510 = (node.sub || []).find((f) => f.field === 510 && f.sub);
  if (!p510) return null;                                  // 没有 text 子消息 ⇒ 空
  const p = (p510.sub || []).find((f) => f.field === 501 && f.wt === 2);
  if (!p) return null;
  return p.payload.toString('utf8');
}
function setEmptyText(node) {
  let p510 = (node.sub || []).find((f) => f.field === 510);
  if (!p510) { p510 = { field: 510, wt: 2, sub: null, payload: Buffer.alloc(0), len: 0, isText: false }; node.sub.push(p510); }
  p510.sub = [];
  p510.payload = Buffer.alloc(0);
  p510.len = 0;
  p510.isText = false;
}

// ════════════════════════════════════════════════════════════════════════════
// 2. GUID：扫全档已用 id 区间 varint → 从 GUID_BASE 顺序分配
// ════════════════════════════════════════════════════════════════════════════
function scanGuidUsage(tree) {
  const used = new Set();
  let maxGuid = 0;
  (function walk(fields) {
    for (const f of fields) {
      if (f.wt === 0) {
        const v = Number(f.num);
        if (v >= ID_LO_NUM && v < ID_HI_NUM) { used.add(v); if (v > maxGuid) maxGuid = v; }
      }
      if (f.sub) walk(f.sub);
    }
  })(tree);
  return { used, maxGuid };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 段①：两份 content 补 obj2..obj6
// ════════════════════════════════════════════════════════════════════════════
function buildLayers(g, alloc) {
  const re = { added: [], skipped: [], childListChanges: [], layers: [] };
  const cellRoots = g.recs.filter((r) => r.name === 'cell.1.1');
  if (cellRoots.length !== 2) fatal('cell.1.1 记录 ' + cellRoots.length + ' 个（预期 2，见 E6）', 2);
  const targets = [];
  for (const root of cellRoots) {
    const content = g.recs.find((r) => Number(r.parentId) === Number(root.id) && r.name === 'content');
    if (!content) fatal('cell.1.1 #' + root.id + ' 下找不到 content', 2);
    const obj = g.recs.find((r) => Number(r.parentId) === Number(content.id) && r.name === 'obj');
    if (!obj) fatal('content #' + content.id + ' 下找不到 obj', 2);
    targets.push({ root, content, obj });
  }
  const objProto = targets[0].obj;
  const objImg = imageTriple(objProto.field);
  console.log('  · 原型 obj#' + objProto.id + '：imageId=' + objImg.id + ' imageColor=' + hex32(objImg.color)
    + ' imageType=' + objImg.type + ' ' + stateSummary(objProto.field)[0].w + 'x' + stateSummary(objProto.field)[0].h);

  for (const t of targets) {
    const cl = findChildListTop(t.content.field.sub);
    if (!cl) fatal('content #' + t.content.id + ' 顶层没有子控件列表', 2);
    const cur = (asIdList(cl.payload, true) || []).map(Number);
    if (cur.indexOf(Number(t.obj.id)) < 0) fatal('content #' + t.content.id + ' 子列表里没有 obj#' + t.obj.id, 2);

    const layerIds = [];
    for (const layer of LAYERS) {
      const exists = g.recs.find((r) => Number(r.parentId) === Number(t.content.id) && r.name === layer);
      if (exists) { layerIds.push(exists.id); re.skipped.push('content#' + t.content.id + '/' + layer + '#' + exists.id); continue; }
      const clone = cloneField(t.obj.field);
      const nid = alloc.take();
      const selfCnt = countVarintEqual(t.obj.field.sub, t.obj.id);
      const remapped = remapSelfIds(clone.sub, t.obj.id, nid);
      if (remapped !== selfCnt) fatal('克隆 ' + layer + '：自身 GUID 替换 ' + remapped + '/' + selfCnt + ' 处');
      const rn = renameRecord(clone.sub, 'obj', layer);
      if (!rn.ok) fatal('克隆 ' + layer + '：改名命中 ' + rn.hits + ' 处（预期 1）');
      const p504 = topVarint(clone.sub, 504);
      if (!p504) fatal('克隆 ' + layer + '：顶层没有 #504');
      p504.num = BigInt(t.content.id);
      assertFaithful(t.obj.field.sub, clone.sub, 'obj', t.obj.id, nid, layer, 'content/' + layer);

      const img = imageTriple(clone);
      if (img.id !== BASE_IMG_ID) fatal(layer + ' imageId=' + img.id + '（预期 ' + BASE_IMG_ID + '）');
      if (img.color !== WHITE) fatal(layer + ' imageColor=' + hex32(img.color) + '（预期 0xFFFFFFFF）');
      if (img.type !== objImg.type) fatal(layer + ' imageType=' + img.type + ' ≠ obj 的 ' + objImg.type);
      const st = stateSummary(clone);
      if (st.length !== 4) fatal(layer + ' 状态块 ' + st.length + ' 个（预期 4）');
      for (const s of st) {
        if (s.w !== CELL || s.h !== CELL) fatal(layer + ' 尺寸 ' + s.w + 'x' + s.h + '（预期 135x135）');
        if (s.aMinX !== 0.5 || s.aMinY !== 0.5 || s.aMaxX !== 0.5 || s.aMaxY !== 0.5) fatal(layer + ' 锚点不是 (0.5,0.5)');
      }
      if (isHiddenRec(clone)) fatal(layer + ' 初始可见性=隐藏（预期可见=true）');
      g.recHolder.push(clone);
      layerIds.push(nid);
      re.added.push({ kind: 'layer', name: layer, id: nid, parent: t.content.id });
    }

    // 子列表：obj → [obj2..obj6] → 其余（幂等：先摘掉已有层 id 再按序插入）
    const kept = cur.filter((id) => !layerIds.includes(id));
    const at = kept.indexOf(Number(t.obj.id));
    if (at < 0) fatal('content #' + t.content.id + '：摘掉层后找不到 obj', 2);
    const next = [...kept.slice(0, at + 1), ...layerIds, ...kept.slice(at + 1)];
    if (next.join(',') !== cur.join(',')) {
      setChildList(cl, next);
      re.childListChanges.push({ where: 'content#' + t.content.id, before: cur, after: next });
    }
  }
  re.targets = targets;
  re.expectedRecs = g.recs.length + re.added.length;
  re.expectedDiffs = (re.added.length ? 1 : 0) + re.childListChanges.length;
  return re;
}

function assertLayers(g2, re) {
  const bad = [];
  const nameOf = (id) => (g2.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id;
  const wantHead = ['face', 'hint', 'obj', ...LAYERS, 'x'];
  for (const t of re.targets) {
    const c2 = g2.recs.find((r) => r.id === Number(t.content.id));
    if (!c2) { bad.push('重读后找不到 content#' + t.content.id); continue; }
    const cl = findChildListTop(c2.field.sub);
    const ids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
    const names = ids.map(nameOf);
    if (names.slice(0, wantHead.length).join(',') !== wantHead.join(',')) {
      bad.push('content#' + t.content.id + ' 前 ' + wantHead.length + ' 位 = ' + names.slice(0, wantHead.length).join(',')
        + '（预期 ' + wantHead.join(',') + '）');
    }
    const obj2 = g2.recs.find((r) => r.id === Number(t.obj.id));
    for (const layer of LAYERS) {
      const r = g2.recs.find((x) => Number(x.parentId) === Number(t.content.id) && x.name === layer);
      if (!r) { bad.push('content#' + t.content.id + ' 下缺 ' + layer); continue; }
      if (!ids.includes(Number(r.id))) bad.push(layer + ' 没登记进 content 子列表');
      const img = imageTriple(r.field);
      if (img.id !== BASE_IMG_ID) bad.push(layer + ' imageId=' + img.id + '（预期 100001）');
      if (img.color !== WHITE) bad.push(layer + ' imageColor=' + hex32(img.color) + '（预期 0xFFFFFFFF）');
      const protoImg = imageTriple(obj2.field);
      if (img.type !== protoImg.type) bad.push(layer + ' imageType=' + img.type + ' ≠ obj 的 ' + protoImg.type);
      const st = stateSummary(r.field);
      if (st.length !== 4) bad.push(layer + ' 状态块 ' + st.length + ' 个');
      for (const s of st) {
        if (s.w !== CELL || s.h !== CELL) bad.push(layer + ' 尺寸 ' + s.w + 'x' + s.h);
        if (s.aMinX !== 0.5 || s.aMaxX !== 0.5) bad.push(layer + ' 锚点不是 0.5');
      }
      if (isHiddenRec(r.field)) bad.push(layer + ' 可见性=隐藏（预期 true）');
    }
  }
  if (g2.recs.length !== re.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re.expectedRecs + '）');
  const tops = g2.recs.map((r) => r.id);
  if (new Set(tops).size !== tops.length) bad.push('顶层 #501 有重复');
  for (const a of re.added) {
    const r = g2.recs.find((x) => x.id === Number(a.id));
    if (!r) { bad.push('重读后缺 ' + a.name + '#' + a.id); continue; }
    if (Number(r.parentId) !== Number(a.parent)) bad.push(a.name + ' 父=' + r.parentId + '（预期 ' + a.parent + '）');
    const p502 = (r.field.sub || []).find((f) => f.field === 502 && f.sub && f.sub.some((x) => x.field === 11));
    const inner = p502 ? (p502.sub.find((x) => x.field === 11).sub || []).find((x) => x.field === 501 && x.wt === 0) : null;
    if (!inner || Number(inner.num) !== Number(a.id)) bad.push(a.name + ' 的 #502/#11/#501 ≠ 自身 GUID（E1）');
  }
  if (bad.length) return '✗ 结构断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 结构断言：两份 content 层序 = ' + wantHead.join(',') + ',…；'
    + LAYERS.length * 2 + ' 条新图层字段与 obj 一致、GUID 唯一且两处一致');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 段②：root 下 labels 容器 + 7 个文本框
// ════════════════════════════════════════════════════════════════════════════
function buildLabels(g, alloc) {
  const re = { added: [], skipped: [], rootListChanged: false, labelIds: [], containerId: null };
  const root = g.recs.find((r) => r.name === 'root');
  const stage = g.recs.find((r) => r.name === 'stage');
  if (!root) fatal('找不到 root', 2);
  if (!stage) fatal('找不到 stage（labels 要插在它之后）', 2);
  const containerProto = g.recs.find((r) => r.name === CONTAINER_PROTO);
  const textProto = g.recs.find((r) => r.name === TEXT_PROTO);
  if (!containerProto) fatal('找不到容器母本 ' + CONTAINER_PROTO, 2);
  if (!textProto) fatal('找不到文本框母本 ' + TEXT_PROTO, 2);
  console.log('  · 容器母本 ' + CONTAINER_PROTO + '#' + containerProto.id
    + '；文本框母本 ' + TEXT_PROTO + '#' + textProto.id);

  // ── ① 容器 labels ─────────────────────────────────────────────────
  const rootCl = findChildListTop(root.field.sub);
  if (!rootCl) fatal('root 没有子控件列表', 2);
  let container = g.recs.find((r) => r.name === CONTAINER_NAME);
  if (container) {
    re.skipped.push(CONTAINER_NAME + '#' + container.id);
    re.containerId = container.id;
  } else {
    const clone = cloneField(containerProto.field);
    const nid = alloc.take();
    const selfCnt = countVarintEqual(containerProto.field.sub, containerProto.id);
    const remapped = remapSelfIds(clone.sub, containerProto.id, nid);
    if (remapped !== selfCnt) fatal('labels 容器：自身 GUID 替换 ' + remapped + '/' + selfCnt + ' 处');
    const rn = renameRecord(clone.sub, CONTAINER_PROTO, CONTAINER_NAME);
    if (!rn.ok) fatal('labels 容器：改名命中 ' + rn.hits + ' 处');
    const p504 = topVarint(clone.sub, 504);
    if (!p504) fatal('labels 容器：顶层没有 #504');
    p504.num = BigInt(root.id);
    assertFaithful(containerProto.field.sub, clone.sub, CONTAINER_PROTO, containerProto.id, nid, CONTAINER_NAME, 'labels 容器');
    // 几何：覆盖棋盘区，锚点居中（母本已是 0.5/0.5）
    const st = stateSummary(clone);
    if (st.length !== 4) fatal('labels 容器状态块 ' + st.length + ' 个（预期 4）');
    for (const s of st) { setPair(s.pos, 0, 0); setPair(s.size, BOARD_W, BOARD_H); }
    // 清空母本遗留的子控件列表
    const ccl = findChildListTop(clone.sub);
    if (ccl) setChildList(ccl, []);
    g.recHolder.push(clone);
    container = { id: nid, name: CONTAINER_NAME, field: clone };
    re.containerId = nid;
    re.added.push({ kind: 'container', name: CONTAINER_NAME, id: nid, parent: root.id });
  }

  // ── ② 7 个文本框 ──────────────────────────────────────────────────
  for (let i = 1; i <= LABEL_COUNT; i++) {
    const name = 'label.' + i;
    const exists = g.recs.find((r) => Number(r.parentId) === Number(container.id) && r.name === name);
    if (exists) { re.labelIds.push(exists.id); re.skipped.push(name + '#' + exists.id); continue; }
    const clone = cloneField(textProto.field);
    const nid = alloc.take();
    const selfCnt = countVarintEqual(textProto.field.sub, textProto.id);
    const remapped = remapSelfIds(clone.sub, textProto.id, nid);
    if (remapped !== selfCnt) fatal('克隆 ' + name + '：自身 GUID 替换 ' + remapped + '/' + selfCnt + ' 处');
    const rn = renameRecord(clone.sub, TEXT_PROTO, name);
    if (!rn.ok) fatal('克隆 ' + name + '：改名命中 ' + rn.hits + ' 处');
    // ★ 先比字段（父指针此时仍是原型父=topbar，与原型一致）→ 再改父 → 再改几何，
    //   否则 #504 父指针不同会让"逐字段一致"的签名比对报假差异。
    assertFaithful(textProto.field.sub, clone.sub, TEXT_PROTO, textProto.id, nid, name, name);
    const p504 = topVarint(clone.sub, 504);
    if (!p504) fatal('克隆 ' + name + '：顶层没有 #504');
    p504.num = BigInt(container.id);

    // 几何：220×44、锚点居中（母本已是 0.5/0.5）
    const st = stateSummary(clone);
    if (st.length !== 4) fatal(name + ' 状态块 ' + st.length + ' 个（预期 4）');
    for (const s of st) {
      setPair(s.pos, 0, 0);
      setPair(s.size, LABEL_W, LABEL_H);
      if (s.aMinX !== 0.5 || s.aMaxX !== 0.5) fatal(name + ' 锚点不是 0.5/0.5');
    }
    // 文本属性
    const tn = textConfigOf(clone);
    setTextLeaf(tn, 504, FONT_COLOR);        // fontColor
    setTextLeaf(tn, 505, BG_COLOR);          // bgColor = 0x00000000（显式写 0）
    setTextLeaf(tn, 507, OUTLINE_COLOR);     // outlineColor
    setTextLeaf(tn, 508, ALIGN_MIDDLE);      // horizontalAlignment = Center
    setTextLeaf(tn, 509, ALIGN_MIDDLE);      // verticalAlignment = Center
    setTextLeaf(tn, 512, FONT_SIZE);         // fontSize
    setTextLeaf(tn, 513, MIN_FONT_SIZE);     // minimumFontSize
    removeTextLeaf(tn, 502);                 // adaptiveFontSize = false ⇒ 不写（默认 false）
    removeTextLeaf(tn, 506);                 // enableOutline = true ⇒ `#506` 必须 ≠ 1（缺失即可，见 docs/转换器）
    setEmptyText(tn);                        // text = ""
    // 初始可见性 = 隐藏；active 不写 inactive 标记 = true
    setHiddenRec(clone);
    g.recHolder.push(clone);
    re.labelIds.push(nid);
    re.added.push({ kind: 'label', name, id: nid, parent: container.id });
  }

  // ── ③ 容器子列表 = label.1..7 ─────────────────────────────────────
  {
    const cRec = g.recs.find((r) => r.id === Number(re.containerId)) || container;
    let ccl = findChildListTop(cRec.field.sub);
    if (!ccl) {
      ccl = { field: 503, wt: 2, sub: null, payload: Buffer.alloc(0), len: 0, isText: false };
      cRec.field.sub.push(ccl);
    }
    const cur = (asIdList(ccl.payload, true) || []).map(Number);
    const next = [...re.labelIds];
    if (next.join(',') !== cur.join(',')) setChildList(ccl, next);
  }

  // ── ④ root 子列表：stage 之后插 labels ────────────────────────────
  {
    const cur = (asIdList(rootCl.payload, true) || []).map(Number);
    const kept = cur.filter((id) => id !== Number(re.containerId));
    const si = kept.indexOf(Number(stage.id));
    if (si < 0) fatal('root 子列表里没有 stage', 2);
    const next = [...kept.slice(0, si + 1), Number(re.containerId), ...kept.slice(si + 1)];
    if (next.join(',') !== cur.join(',')) {
      setChildList(rootCl, next);
      re.rootListChanged = true;
    }
  }

  re.expectedRecs = g.recs.length + re.added.length;
  re.expectedDiffs = (re.added.length ? 1 : 0) + (re.rootListChanged ? 1 : 0);
  return re;
}

function assertLabels(g2, re) {
  const bad = [];
  const nameOf = (id) => (g2.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id;
  const root = g2.recs.find((r) => r.name === 'root');
  const stage = g2.recs.find((r) => r.name === 'stage');
  const c = g2.recs.find((r) => r.name === CONTAINER_NAME);
  if (!c) return '✗ 重读后找不到 labels 容器';
  if (Number(c.parentId) !== Number(root.id)) bad.push('labels 容器父不是 root');
  // root 顺序：… stage, labels …
  const rcl = findChildListTop(root.field.sub);
  const rootIds = rcl ? (asIdList(rcl.payload, true) || []).map(Number) : [];
  const si = rootIds.indexOf(Number(stage.id));
  const li = rootIds.indexOf(Number(c.id));
  if (si < 0) bad.push('root 子列表里没有 stage');
  if (li < 0) bad.push('root 子列表里没有 labels');
  if (si >= 0 && li !== si + 1) bad.push('labels 不在 stage 之后（stage=' + si + ' labels=' + li + '）');
  // 容器几何
  const cst = stateSummary(c.field);
  if (cst.length !== 4) bad.push('labels 容器状态块 ' + cst.length);
  for (const s of cst) {
    if (s.w !== BOARD_W || s.h !== BOARD_H) bad.push('labels 容器尺寸 ' + s.w + 'x' + s.h + '（预期 ' + BOARD_W + 'x' + BOARD_H + '）');
    if (s.aMinX !== 0.5 || s.aMaxX !== 0.5) bad.push('labels 容器锚点不是 0.5');
  }
  // 容器子列表 = label.1..7
  const ccl = findChildListTop(c.field.sub);
  const cids = ccl ? (asIdList(ccl.payload, true) || []).map(Number) : [];
  const cnames = cids.map(nameOf);
  const wantNames = Array.from({ length: LABEL_COUNT }, (_, i) => 'label.' + (i + 1));
  if (cnames.slice(0, LABEL_COUNT).join(',') !== wantNames.join(',')) {
    bad.push('labels 子控件 = ' + cnames.slice(0, LABEL_COUNT).join(',') + '（预期 ' + wantNames.join(',') + '）');
  }
  // 每个文本框
  for (let i = 1; i <= LABEL_COUNT; i++) {
    const name = 'label.' + i;
    const r = g2.recs.find((x) => Number(x.parentId) === Number(c.id) && x.name === name);
    if (!r) { bad.push('缺 ' + name); continue; }
    const st = stateSummary(r.field);
    if (st.length !== 4) bad.push(name + ' 状态块 ' + st.length);
    for (const s of st) {
      if (s.w !== LABEL_W || s.h !== LABEL_H) bad.push(name + ' 尺寸 ' + s.w + 'x' + s.h + '（预期 220x44）');
      if (s.aMinX !== 0.5 || s.aMinY !== 0.5 || s.aMaxX !== 0.5 || s.aMaxY !== 0.5 || s.pivX !== 0.5 || s.pivY !== 0.5) {
        bad.push(name + ' 锚点/中心不是 0.5');
      }
    }
    const tn = textConfigOf(r.field);
    const chk = (no, want, label) => {
      const f = textLeaf(tn, no);
      if (!f) { bad.push(name + ' 缺 ' + label + '（#' + no + '）'); return; }
      const got = Number(f.num);
      if (got !== want) bad.push(name + ' ' + label + '=' + (no >= 504 && no <= 509 ? hex32(got) : got) + '（预期 ' + (no >= 504 && no <= 509 ? hex32(want) : want) + '）');
    };
    chk(504, FONT_COLOR, 'fontColor');
    chk(505, BG_COLOR, 'bgColor');
    chk(507, OUTLINE_COLOR, 'outlineColor');
    chk(508, ALIGN_MIDDLE, 'horizontalAlignment');
    chk(509, ALIGN_MIDDLE, 'verticalAlignment');
    chk(512, FONT_SIZE, 'fontSize');
    chk(513, MIN_FONT_SIZE, 'minimumFontSize');
    if (textLeaf(tn, 502)) bad.push(name + ' adaptiveFontSize 应缺省（false）却写了 #502');
    const p506 = textLeaf(tn, 506);
    if (p506 && Number(p506.num) === 1) bad.push(name + ' enableOutline 应为 true，但 #506=1');
    const txt = textContentOf(tn);
    if (txt !== null && txt !== '') bad.push(name + ' text = "' + txt + '"（预期空）');
    if (!isHiddenRec(r.field)) bad.push(name + ' 存档可见性不是"隐藏"（预期 visible=false）');
    const inact = inactiveLeaves(r.field);
    if (inact.length) bad.push(name + ' 出现 inactive 标记（预期 active=true）：' + inact.join(','));
  }
  if (g2.recs.length !== re.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re.expectedRecs + '）');
  const tops = g2.recs.map((r) => r.id);
  if (new Set(tops).size !== tops.length) bad.push('顶层 #501 有重复');
  if (bad.length) return '✗ 结构断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 结构断言：root 顺序 …stage → labels；labels 下 7 个 label.N（220×44、锚点 0.5、visible=false、active=true、'
    + 'fontSize=' + FONT_SIZE + '/min=' + MIN_FONT_SIZE + '/字色=' + hex32(FONT_COLOR) + '/底=' + hex32(BG_COLOR)
    + '/描边=' + hex32(OUTLINE_COLOR) + '、对齐 Center、text 空）');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 外部只读闸门
// ════════════════════════════════════════════════════════════════════════════
function runNode(tool, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, tool), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}
function runExternalGates(outAbs, inAbs, reTotal) {
  const results = [];
  const say = (s) => console.log(s);

  say('\n── ③ probe_guid_collision.mjs（GUID 撞号分类审计）──');
  const probe = runNode('probe_guid_collision.mjs', [outAbs]);
  say(probe.stdout.trim());
  const probePass = probe.status === 0
    && /① 真撞号（自身 GUID 重复）：\*\*0 处\*\*/.test(probe.stdout)
    && /✅ ② 自身 GUID 两处一致/.test(probe.stdout);
  results.push({ name: 'probe_guid_collision', pass: probePass });
  say('  ⇒ ' + (probePass ? '✅ 通过：① 真撞号 0，② 自身 GUID 两处一致' : '❌ 未通过'));

  say('\n── ④ roundtrip.mjs（解析→重编码 逐字节往返）──');
  const rt = runNode('roundtrip.mjs', [outAbs]);
  say(rt.stdout.trim());
  const rtPass = rt.status === 0 && /★★★ 往返成功/.test(rt.stdout);
  results.push({ name: 'roundtrip', pass: rtPass });
  say('  ⇒ ' + (rtPass ? '✅ 通过：逐字节一致' : '❌ 未通过'));

  say('\n── ⑤ diff_fields.mjs（基线 vs 输出，按位置比）──');
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]);
  say(df.stdout.trim());
  const m = /差异：(\d+) 处/.exec(df.stdout);
  const got = m ? Number(m[1]) : -1;
  const want = (reTotal.added > 0 ? 1 : 0) + reTotal.contentListChanges + (reTotal.rootListChanged ? 1 : 0);
  const recA = /记录数：A (\d+) → B (\d+)/.exec(df.stdout);
  const recOk = recA ? (Number(recA[2]) === reTotal.expectedRecs && Number(recA[1]) + reTotal.added === Number(recA[2]))
    : (reTotal.added === 0);
  const dfPass = got === want && recOk && (want === 0 ? df.status === 0 : df.status === 3);
  results.push({ name: 'diff_fields', pass: dfPass });
  say('  ⇒ ' + (dfPass ? '✅ 通过：差异 ' + got + ' 处 = ' + (reTotal.added > 0 ? 1 : 0) + ' 处记录数组条数 + ' + reTotal.contentListChanges
    + ' 处 content 子列表' + (reTotal.rootListChanged ? ' + 1 处 root 子列表' : '') + '（= ' + want + '）'
    : '❌ 未通过：差异 ' + got + ' 处，预期 ' + want));
  say('     ★ ' + reTotal.added + ' 条新记录在 diff_fields 眼里是"记录数变了"的**新增**（1 处子字段个数不同），不算逐字段差异（E10）✓');

  // ⑥ list_names：obj=18、label.=7
  const g3 = readGil(outAbs);
  const objNames = g3.recs.filter((r) => (r.name || '').includes('obj')).map((r) => r.name);
  const labelNames = g3.recs.filter((r) => (r.name || '').includes('label.')).map((r) => r.name);
  say('\n── ⑥ list_names.mjs <输出> obj（预期 18 = 6 things + 2×6 内容层）──');
  const lnObj = runNode('list_names.mjs', [outAbs, 'obj']);
  say(lnObj.stdout.trim());
  const objLineCount = (lnObj.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
  say('\n── ⑥b list_names.mjs <输出> label.（预期 7）──');
  const lnLab = runNode('list_names.mjs', [outAbs, 'label.']);
  say(lnLab.stdout.trim());
  const labLineCount = (lnLab.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
  const lnPass = lnObj.status === 0 && lnLab.status === 0 && objLineCount === 18 && labLineCount === 7;
  results.push({ name: 'list_names', pass: lnPass });
  say('  ⇒ ' + (lnPass ? '✅ 通过：obj ' + objLineCount + ' 个、label. ' + labLineCount + ' 个'
    : '❌ 未通过：obj ' + objLineCount + '（预期 18）、label. ' + labLineCount + '（预期 7）'));

  // ⑦ 回读 root 顺序 + content 层序
  say('\n── ⑦ 回读：root 子控件顺序（stage → labels）与两份 content 层序 ──');
  let orderPass = true;
  {
    const root = g3.recs.find((r) => r.name === 'root');
    const cl = root ? findChildListTop(root.field.sub) : null;
    const names = cl ? (asIdList(cl.payload, true) || []).map((id) => (g3.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id) : [];
    const si = names.indexOf('stage'), li = names.indexOf(CONTAINER_NAME);
    const ok = si >= 0 && li === si + 1;
    if (!ok) orderPass = false;
    const around = names.slice(Math.max(0, si - 2), li + 2).join(' , ');
    say('  root 共 ' + names.length + ' 个子控件；stage 附近 → ' + around);
    say('    ' + (ok ? '✅' : '❌') + ' labels 紧跟 stage（stage 索引 ' + si + '，labels 索引 ' + li + '）');
  }
  for (const t of reTotal.targets) {
    const c2 = g3.recs.find((r) => r.id === Number(t.content.id));
    const cl = c2 ? findChildListTop(c2.field.sub) : null;
    const names = cl ? (asIdList(cl.payload, true) || []).map((id) => (g3.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id) : [];
    const want = ['face', 'hint', 'obj', 'obj2', 'obj3', 'obj4', 'obj5', 'obj6', 'x'];
    const ok = names.slice(0, want.length).join(',') === want.join(',');
    if (!ok) orderPass = false;
    say('  content#' + t.content.id + ' → ' + names.join(' , '));
    say('    ' + (ok ? '✅' : '❌') + ' 前 ' + want.length + ' 位 = ' + names.slice(0, want.length).join(',') + '（预期 ' + want.join(',') + '）');
  }
  results.push({ name: 'root/content-order', pass: orderPass });
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
function main() {
  if (!IN || !OUT) {
    console.error('用法: node tools/gil/gen_art_containers.mjs --in=<存档.gil> --out=<输出.gil> [--dry] [--guid-base=1073746100]');
    process.exit(1);
  }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到输入存档：' + inAbs, 1);
  const g = readGil(inAbs);

  console.log('══ gen_art_containers —— 家具 6 层（obj2..obj6）＋ labels 房间名标签层 ══');
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.src.length + ' 字节，记录 ' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  console.log('  输出 ' + basenameOf(outAbs) + '（' + (DRY ? '--dry 只预测不写' : '写') + '）');
  console.log('  要补的层：' + LAYERS.join(', ') + '（每份 content；插在原有 obj 之后）');

  // GUID 分配
  const { used, maxGuid } = scanGuidUsage(g.tree);
  if (!Number.isInteger(GUID_BASE) || GUID_BASE < 1073741824 || GUID_BASE >= ID_HI_NUM) fatal('--guid-base 不合法', 1);
  // ★ 幂等复跑时输入里已经有 6100 段（maxGuid ≥ 6100）⇒ 从 maxGuid+1 继续，不要报错
  let nextId = Math.max(GUID_BASE, maxGuid + 1);
  if (maxGuid >= GUID_BASE) console.log('  · 输入已用到 ' + maxGuid + '（含 GUID_BASE 段）⇒ 幂等复跑，新号将从 ' + nextId + ' 起（本次应无新增）');
  const alloc = {
    base: nextId,
    ids: [],
    take() {
      while (used.has(nextId)) nextId++;
      if (nextId >= ID_HI_NUM) fatal('GUID 号段耗尽');
      const v = nextId++; used.add(v); alloc.ids.push(v); return v;
    },
  };
  console.log('  · GUID 扫描：已用 id 区间 varint ' + used.size + ' 个，maxGuid=' + maxGuid + ' ⇒ 新号从 ' + alloc.base + ' 起');

  let tmp1 = null, tmp2 = null;
  try {
    // ── 段①：obj2..obj6 ─────────────────────────────────────────────
    console.log('\n── ① 两份 content 补 ' + LAYERS.join('/') + '（各克隆 obj，插在 obj 之后）──');
    const reA = buildLayers(g, alloc);
    console.log('  新增图层记录 ' + reA.added.length + ' 条：' + reA.added.map((a) => a.name + '#' + a.id).join(', '));
    if (reA.skipped.length) console.log('  （已存在、跳过 ' + reA.skipped.length + ' 条）');
    console.log('  记录数：' + g.recs.length + ' → ' + reA.expectedRecs + '；第一段预计差异 ' + reA.expectedDiffs
      + ' 处（' + (reA.added.length ? 1 : 0) + ' 记录数组条数 + ' + reA.childListChanges.length + ' content 子列表）');

    let midSrc = inAbs;
    if (reA.added.length > 0 && !DRY) {
      tmp1 = path.join(os.tmpdir(), 'gen_art_containers_A_' + process.pid + '_' + Date.now() + '.gil');
      writeGil(g, tmp1, {
        label: 'gen_art_containers ① content 补 obj2..obj6',
        expectRecs: reA.expectedRecs,
        expectDiffs: reA.expectedDiffs,
        assert: (g2) => assertLayers(g2, reA),
      });
      midSrc = tmp1;
    }

    // ── 段②：labels 容器 + 7 文本框 ──────────────────────────────────
    console.log('\n── ② root 下新增 labels 容器（stage 之后）+ 7 个文本框 label.1..7 ──');
    // ★ --dry 时第一段没有落盘 ⇒ 直接在内存树 `g` 上继续（g 已含第一段改动）；
    //   非 dry 则从第一段的中间文件重读，保证第二段断言的是"磁盘上真实的那份"。
    const gB = DRY ? g : readGil(midSrc);
    const baseRecs = g.recs.length;
    const reB = buildLabels(gB, alloc);
    const totalAdded = reA.added.length + reB.added.length;
    const expectedRecs = baseRecs + totalAdded;
    reB.expectedRecs = expectedRecs;             // 覆盖：dry 时 gB.recs 是基线快照，不能用它算
    console.log('  新增记录 ' + reB.added.length + ' 条：' + reB.added.map((a) => a.name + '#' + a.id).join(', '));
    if (reB.skipped.length) console.log('  （已存在、跳过 ' + reB.skipped.length + ' 条）');
    console.log('  记录数：' + baseRecs + ' → ' + expectedRecs + '；第二段预计差异 ' + reB.expectedDiffs
      + ' 处（' + (reB.added.length ? 1 : 0) + ' 记录数组条数 + ' + (reB.rootListChanged ? 1 : 0) + ' root 子列表）');

    if (DRY) {
      const buf = gB.pack(encodeMsg(gB.tree));
      console.log('\n[--dry] 不写任何文件。预测：');
      console.log('  记录数 ' + g.recs.length + ' → ' + expectedRecs + '（+' + totalAdded + '）');
      console.log('  输出字节 ' + g.src.length + ' → ' + buf.length + '（+' + (buf.length - g.src.length) + '）');
      console.log('  diff_fields 基线→输出 = ' + ((totalAdded ? 1 : 0) + reA.childListChanges.length + (reB.rootListChanged ? 1 : 0))
        + ' 处（' + (totalAdded ? 1 : 0) + ' 记录数组条数 + ' + reA.childListChanges.length + ' content 子列表 + ' + (reB.rootListChanged ? 1 : 0) + ' root 子列表）');
      return 0;
    }

    let finalBytes = 0, finalRecs = 0;
    if (reB.added.length > 0) {
      tmp2 = path.join(os.tmpdir(), 'gen_art_containers_B_' + process.pid + '_' + Date.now() + '.gil');
      const rep = writeGil(gB, tmp2, {
        label: 'gen_art_containers ② labels 容器 + 7 个文本框',
        expectRecs: reB.expectedRecs,
        expectDiffs: reB.expectedDiffs,
        assert: (g2) => assertLabels(g2, reB),
      });
      finalBytes = rep.bytes; finalRecs = rep.recs;
      fs.copyFileSync(tmp2, outAbs);
    } else if (path.resolve(midSrc) !== path.resolve(outAbs)) {
      fs.copyFileSync(midSrc, outAbs);
      finalBytes = fs.statSync(outAbs).size; finalRecs = expectedRecs;
    } else {
      finalBytes = fs.statSync(outAbs).size; finalRecs = expectedRecs;
    }

    // ── 外部闸门 ─────────────────────────────────────────────────────
    const reTotal = {
      added: totalAdded,
      expectedRecs,
      contentListChanges: reA.childListChanges.length,
      rootListChanged: reB.rootListChanged,
      targets: reA.targets,
    };
    const results = runExternalGates(outAbs, inAbs, reTotal);
    const allPass = results.every((r) => r.pass);

    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + finalBytes + ' 字节，记录 ' + finalRecs + ' 条）');
    const formula = g.recs.length + ' + ' + reA.added.length + '（obj 层） + ' + reB.added.length + '（labels） = ' + (g.recs.length + totalAdded);
    console.log('  记录数：' + g.recs.length + ' → ' + finalRecs + '（+' + (finalRecs - g.recs.length) + '）'
      + (finalRecs === expectedRecs ? ' ✅' : ' ❌') + '   算式：' + formula);
    console.log('  新增：' + totalAdded + ' 条（' + reA.added.length + ' 层 + ' + reB.added.length + ' labels 相关）');
    console.log('  GUID 号段：' + alloc.base + '–' + (alloc.ids.length ? alloc.ids[alloc.ids.length - 1] : alloc.base - 1)
      + '（文件内唯一，已扫全档已用集合）');
    console.log('  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
    if (!allPass) {
      console.error('\n❌ 外部闸门未全过 —— 文件已写出但**不要导入**。');
      return 4;
    }
    console.log('  ★ 全部通过。导入用：' + OUT);
    return 0;
  } finally {
    for (const t of [tmp1, tmp2]) if (t && fs.existsSync(t)) { try { fs.unlinkSync(t); } catch { /* ignore */ } }
  }
}

process.exit(main());
