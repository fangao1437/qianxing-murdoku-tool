// tools/gil/gen_art_runtime.mjs —— 运行时图元绘制的两块地基：content 下的 `furn` 容器 ＋
//                                root 外的 `tpl.prim` 客户端图片模板（含母本记录）
//
// ════════════════════════════════════════════════════════════════════════════
// 背景（2026-10-22 第四轮；用户要求"按外部图片网站的结果逐图元画"）
// ════════════════════════════════════════════════════════════════════════════
//   每件家具 160~200 个图元（椭圆/矩形 + 旋转 + 每图元 RGBA）⇒ 格子模板的 12 层装不下，
//   改用**运行时实例化**：`game.InstantiateClientUIControl(prefabIndex, parent)`。
//   本工具只做结构（不写 palette、不碰 lua）：
//
//   ① `content` 下新增容器 `furn`（两份 content 各一个）：
//      插在最后一个 objN（= obj12）之后、`x` 之前；135×135、锚点/中心 0.5、visible=true、
//      **无遮罩/裁切**（运行时生成的图元挂它下面 → 它是"父级容器"，不自己画东西）。
//   ② `tpl.prim`：客户端**图片控件模板**，1×1、visible=false、imageId=100001、
//      imageColor=0xFFFFFFFF、imageType=Stretch(1)。
//
// ── ★ 模板在 `.gil` 里是【两条记录】（这是本轮最关键的发现，别按"一条"理解）──────
//   仓内实测（`docs/钻取-开关控件GUID重复-2026-10-21.md` §2.4 / `probe_ui_registry.mjs`）：
//
//     模板源 / 实例（★ 它的 GUID 才是 lua 的 `prefabIndex`）
//       · 无父（没有顶层 #504）、不在任何子列表里 —— 这就是"仅存为模板"在 .gil 里的样子
//       · 组件号 [1,2,4]：`#502[2]/#12` = 模板族号；`#502[4]/#14/#501` = 指向**母本** GUID
//       · 实例：`cell.1.1#1073741876`（lua cfg.cells.prefab 用的就是它，真机实测可用）、
//               `tpl-container#1073742330`（lua stage.prefab = 2330，真机可用）
//     母本（master）
//       · 父 = `ClientUIPrototypeHierarchyRoot`（#1073741844，非记录节点）
//       · 组件号 [1,2,3]：`#502[3]/#13/#501` = 指回**模板源** GUID
//       · 例：`cell.1.1#1073741880`、`tpl-container#1073742355`、`hex#1073742356`
//
//   ⇒ 只加"一条 root 下的图片控件"**不能**被 `InstantiateClientUIControl` 用（官方：仅存为模板的
//     客户端控件才能动态创建；画布里的普通控件不行 —— `docs/API-四方对照.md` §17 用户真机实测）。
//     所以本工具按**本档已有的 `hex` 模板对**克隆出 `tpl.prim` 的 **模板源 + 母本** 两条（+2），
//     并把 **模板源 GUID** 作为 `prefabIndex` 报给 lead。
//   ★ 模板源**必须保持"孤儿"**（无父、不在 root 子列表里）：放进 root 会变成场景控件，
//     且现有两个真机可用的模板源（1876 / 2330）都不在 root 子列表里 —— 所以本工具**不动 root**。
//
// ── 其它设计（沿用前几轮的工具写法）────────────────────────────────────────
//   ★ 新记录 append 到 `g.recHolder` 末尾（E10：字段 diff 按位置比，插中间会制造假差异）。
//   ★ 克隆必须整条 remap 自身 GUID（E1：自身 id 出现在 7 处：`#501`、`#502[1]/#11/#501`、
//     5 处 `#505[*]/#503/#504/#4`）。母本链的交叉引用（源的 `#14`→母本、母本的 `#13`→源）
//     在 remap 之后单独改写，**不要**被 remap 抄错。
//   ★ 模板族号 `#502[2]/#12` 取**全档未用过的新号**（当前最大 77 ⇒ 78），不污染任何现有族。
//   ★ GUID 从 **1073746300** 起（先扫全档已用 id 区间 varint；6100–6117 / 6200–6211 /
//     6000–6003 都已被前几轮占用，不复用）。
//   ★ 写盘只走 `writeGil()`（落盘→重读磁盘→往返闸门→字段 diff 断言），分两段：
//       ① 只加 furn（+2）⇒ 差异恰好 = 1 记录数组条数 + 2 content 子列表；
//       ② 只加 tpl.prim 两条（+2）⇒ 差异恰好 = 1 记录数组条数（不打任何子列表）。
//     最终 `diff_fields 501→502` = **3 处**，且 root 子列表逐字节不变。
//   ★ 写完后原样跑 probe_guid_collision / roundtrip / diff_fields / list_names，
//     并跑 `probe_ui_registry.mjs` 验证母本链闭合（③ 悬空 0），再回读层序与两条 tpl.prim。
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_art_runtime.mjs --in=501-一二关美术-v301.gil \
//        --out=502-一二关美术-容器-v3.gil [--dry]
//   --guid-base=1073746300   新 GUID 起点
//   --family=78              新模板族号（默认自动取全档最大族号 +1，且 ≥78）
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
const GUID_BASE = Number(argOf('guid-base', '1073746300'));
const FAMILY_ARG = argOf('family', null);

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const FURN_NAME = 'furn';
const CELL = 135;
// tpl.prim（客户端图片模板）
const TPL_NAME = 'tpl.prim';
const TPL_SIZE = 1;
const TPL_IMG_ID = 100001;
const TPL_COLOR = 0xFFFFFFFF;
const TPL_IMG_TYPE = 1;                    // Stretch（fix_cell_layers 真机验过）
const TEMPLATE_MASTER_PARENT = 1073741844; // ClientUIPrototypeHierarchyRoot（非记录节点）
const PROTO_SOURCE = 'hex';                // 本档已有的「模板源」母本（无父、组件 [1,2,4]）
const MASTER_SUFFIX = '';                  // 母本与源同名（仓内惯例：cell.1.1 / tpl-container / hex 都同名）

const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const hex32 = (v) => '0x' + (Number(v) >>> 0).toString(16).toUpperCase().padStart(8, '0');
const basenameOf = (p) => path.basename(p);

// ════════════════════════════════════════════════════════════════════════════
// 字段级 helper（与上一轮工具同一套判据）
// ════════════════════════════════════════════════════════════════════════════
function topVarint(fields, no) {
  const f = (fields || []).find((x) => x.field === no);
  return f && f.wt === 0 ? f : null;
}
/** 记录顶层的组件块：`#502` 里 direct #501 == compNo 的那一块 */
function compBlock(recField, compNo) {
  for (const f of (recField.sub || [])) {
    if (f.field !== 502 || !f.sub) continue;
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const b = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (a && b && Number(a.num) === compNo) return f;
  }
  return null;
}
/** 组件块里 `#11/#12/#13/#14` 那个子消息里 `#501` 的值（wt0 或紧凑 varint payload 两种写法都认） */
function compRef(recField, compNo) {
  const blk = compBlock(recField, compNo);
  if (!blk) return null;
  for (const g of blk.sub) {
    if (g.field !== 11 && g.field !== 12 && g.field !== 13 && g.field !== 14) continue;
    if (!g.sub) continue;
    const v = (g.sub.find((x) => x.field === 501) || null);
    if (!v) return null;
    if (v.wt === 0) return { leaf: v, value: Number(v.num), kind: 'num' };
    const pay = v.payload || Buffer.alloc(0);
    // 紧凑 varint（单值）
    let r = 0n, s = 0n, p = 0;
    while (p < pay.length) { const x = pay[p++]; r |= BigInt(x & 0x7f) << s; if ((x & 0x80) === 0) break; s += 7n; }
    return { leaf: v, value: p === pay.length ? Number(r) : null, kind: 'payload' };
  }
  return null;
}
function setCompRef(recField, compNo, newId) {
  const blk = compBlock(recField, compNo);
  if (!blk) fatal('找不到组件 #' + compNo + '（记录里没有对应 #502 块）');
  for (const g of blk.sub) {
    if (g.field !== 11 && g.field !== 12 && g.field !== 13 && g.field !== 14) continue;
    if (!g.sub) continue;
    const v = g.sub.find((x) => x.field === 501);
    if (!v) fatal('组件 #' + compNo + ' 的 #' + g.field + ' 里找不到 #501');
    if (v.wt === 0) { v.num = BigInt(newId); return 'num'; }
    v.payload = writeVarint(newId); v.len = v.payload.length; v.isText = false; v.sub = null;
    return 'payload';
  }
  fatal('组件 #' + compNo + ' 里找不到 #11/#12/#13/#14');
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
  return {
    node: n,
    idLeaf: leaf(503), colorLeaf: leaf(502), typeLeaf: leaf(504),
    id: leaf(503) ? Number(leaf(503).num) : null,
    color: leaf(502) ? Number(leaf(502).num) : null,
    type: leaf(504) ? Number(leaf(504).num) : null,
  };
}
function setImgLeaf(node, no, value) {
  let f = node.sub.find((x) => x.field === no && x.wt === 0);
  if (!f) { f = { field: no, wt: 0, num: 0n }; node.sub.push(f); }
  f.num = BigInt(value >>> 0);
}
/** `/505` 图片块里有没有遮罩/羽化相关叶子（#508+#516 = 一套；#509~#515 = enableMask/softEdge 那一族） */
function imageMaskLeaves(recField) {
  const out = [];
  const nodes = imageNodes(recField);
  for (const n of nodes) for (const f of n.sub) if (f.wt === 0 && [508, 509, 510, 511, 512, 513, 514, 515, 516].includes(f.field)) out.push('#' + f.field + '=' + f.num);
  return out;
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
function setHiddenRec(recField) {
  let found = false;
  for (const f of (recField.sub || [])) {
    if (f.field !== 505 || !f.sub) continue;
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const b = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (!a || !b || Number(a.num) !== 4 || Number(b.num) !== 86) continue;
    const p503 = f.sub.find((x) => x.field === 503 && x.sub);
    const p14 = p503 && p503.sub.find((x) => x.field === 14 && x.sub);
    if (!p14) fatal('可见性块里找不到 #503/#14');
    let p17 = p14.sub.find((x) => x.field === 17 && x.wt === 2);
    if (!p17) { p17 = { field: 17, wt: 2, sub: null, payload: Buffer.alloc(0), len: 0, isText: false }; p14.sub.push(p17); }
    p17.sub = [{ field: 503, wt: 0, num: 1n }];
    p17.payload = encodeMsg(p17.sub);
    p17.len = p17.payload.length;
    p17.isText = false;
    found = true;
  }
  if (!found) fatal('找不到 #505(4/86) 可见性块');
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
function maxFamily(g) {
  let mx = 0;
  for (const r of g.recs) {
    const ref = compRef(r.field, 2);
    if (ref && ref.value != null) mx = Math.max(mx, ref.value);
  }
  return mx;
}
const isLayerName = (n) => /^obj\d*$/.test(n || '');

// ════════════════════════════════════════════════════════════════════════════
// 段①：两份 content 各加一个 `furn` 容器（最后一个 objN 之后、x 之前）
// ════════════════════════════════════════════════════════════════════════════
function buildFurn(g, alloc) {
  const re = { added: [], skipped: [], childListChanges: [], targets: [] };
  const cellRoots = g.recs.filter((r) => r.name === 'cell.1.1');
  if (cellRoots.length !== 2) fatal('cell.1.1 记录 ' + cellRoots.length + ' 个（预期 2，见 E6）', 2);
  for (const root of cellRoots) {
    const content = g.recs.find((r) => Number(r.parentId) === Number(root.id) && r.name === 'content');
    if (!content) fatal('cell.1.1 #' + root.id + ' 下找不到 content', 2);
    const cl = findChildListTop(content.field.sub);
    if (!cl) fatal('content #' + content.id + ' 没有子控件列表', 2);
    const cur = (asIdList(cl.payload, true) || []).map(Number);
    const nameOf = (id) => (g.recs.find((r) => Number(r.id) === Number(id)) || {}).name || '';

    const exists = g.recs.find((r) => Number(r.parentId) === Number(content.id) && r.name === FURN_NAME);
    let furnId;
    if (exists) {
      furnId = exists.id;
      re.skipped.push('content#' + content.id + '/' + FURN_NAME + '#' + furnId);
    } else {
      // 克隆该 content 自己（普通容器节点，组件 68/91；无遮罩/无图槽）
      const clone = cloneField(content.field);
      furnId = alloc.take();
      const selfCnt = countVarintEqual(content.field.sub, content.id);
      const n = remapSelfIds(clone.sub, content.id, furnId);
      if (n !== selfCnt) fatal('furn 克隆：自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
      const rn = renameRecord(clone.sub, 'content', FURN_NAME);
      if (!rn.ok) fatal('furn 克隆：改名命中 ' + rn.hits + ' 处');
      const p504 = topVarint(clone.sub, 504);
      if (!p504) fatal('furn 克隆：顶层没有 #504');
      p504.num = BigInt(content.id);
      // 清空原型遗留的 25 个子控件（E：克隆必须清子列表，否则副本认领原型的子控件）
      const ccl = findChildListTop(clone.sub);
      if (ccl) setChildList(ccl, []);
      // 几何：135×135 @(0,0)，锚点/中心 0.5（继承自 content，做核对）
      const st = stateSummary(clone);
      if (st.length !== 4) fatal('furn 状态块 ' + st.length + ' 个（预期 4）');
      for (const s of st) {
        setPair(s.pos, 0, 0);
        setPair(s.size, CELL, CELL);
        if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) fatal('furn 锚点/中心不是 0.5');
      }
      if (imageNodes(clone).length) fatal('furn 不应有图片槽（容器）');
      if (imageMaskLeaves(clone).length) fatal('furn 不应带遮罩/羽化字段');
      if (isHiddenRec(clone)) fatal('furn 初始可见性应为 true');
      g.recHolder.push(clone);
      re.added.push({ kind: 'furn', name: FURN_NAME, id: furnId, parent: content.id });
    }
    // 子列表：插在最后一个 objN 之后
    const kept = cur.filter((id) => id !== Number(furnId));
    let at = -1;
    for (let i = kept.length - 1; i >= 0; i--) if (isLayerName(nameOf(kept[i]))) { at = i; break; }
    if (at < 0) fatal('content #' + content.id + ' 子列表里找不到任何 objN 层', 2);
    const next = [...kept.slice(0, at + 1), Number(furnId), ...kept.slice(at + 1)];
    if (next.join(',') !== cur.join(',')) {
      setChildList(cl, next);
      re.childListChanges.push({ where: 'content#' + content.id, before: cur, after: next });
    }
    re.targets.push({ root, content, furnId });
  }
  re.expectedRecs = g.recs.length + re.added.length;
  re.expectedDiffs = (re.added.length ? 1 : 0) + re.childListChanges.length;
  return re;
}

function assertFurn(g2, re) {
  const bad = [];
  const nameOf = (id) => (g2.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id;
  for (const t of re.targets) {
    const c2 = g2.recs.find((r) => r.id === Number(t.content.id));
    const cl = c2 ? findChildListTop(c2.field.sub) : null;
    const ids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
    const names = ids.map(nameOf);
    const fi = names.indexOf(FURN_NAME);
    const xi = names.indexOf('x');
    const lastObj = names.slice(0, fi).filter((n) => isLayerName(n)).pop();
    if (fi < 0) bad.push('content#' + t.content.id + ' 子列表里没有 furn');
    if (!(fi >= 0 && xi === fi + 1 && lastObj === 'obj12')) {
      bad.push('furn 位置不对：furn@' + fi + ' x@' + xi + ' 前一个 objN=' + lastObj + '（预期 obj12, furn, x）');
    }
    const r = g2.recs.find((x) => x.id === Number(t.furnId));
    if (!r) { bad.push('重读后缺 furn#' + t.furnId); continue; }
    if (Number(r.parentId) !== Number(t.content.id)) bad.push('furn 父=' + r.parentId + '（预期 content#' + t.content.id + '）');
    const st = stateSummary(r.field);
    if (st.length !== 4) bad.push('furn 状态块 ' + st.length);
    for (const s of st) {
      if (s.w !== CELL || s.h !== CELL) bad.push('furn 尺寸 ' + s.w + 'x' + s.h);
      if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) bad.push('furn 锚点/中心不是 0.5');
    }
    if (imageNodes(r.field).length) bad.push('furn 不应有图片槽');
    if (imageMaskLeaves(r.field).length) bad.push('furn 带遮罩/羽化字段：' + imageMaskLeaves(r.field).join(','));
    if (isHiddenRec(r.field)) bad.push('furn 可见性=隐藏（预期 true）');
  }
  if (g2.recs.length !== re.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re.expectedRecs + '）');
  const tops = g2.recs.map((r) => r.id);
  if (new Set(tops).size !== tops.length) bad.push('顶层 #501 有重复');
  if (bad.length) return '✗ furn 断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ furnishings 断言：两份 content 层序 = …obj12 → furn → x；furn 135×135/锚点0.5/可见/无图片槽/无遮罩字段');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 段②：tpl.prim（模板源 + 母本；克隆本档已有的 hex 模板对）
// ════════════════════════════════════════════════════════════════════════════
function buildTplPrim(g, alloc, family) {
  const re = { added: [], skipped: [], sourceId: null, masterId: null, family, proto: {} };
  const sources = g.recs.filter((r) => r.name === PROTO_SOURCE && r.parentId == null);
  const masters = g.recs.filter((r) => r.name === PROTO_SOURCE && Number(r.parentId) === TEMPLATE_MASTER_PARENT);
  if (sources.length !== 1) fatal('本档应有 1 条无父的模板源 ' + PROTO_SOURCE + '（找到 ' + sources.length + '）', 2);
  if (masters.length !== 1) fatal('本档应有 1 条父=' + TEMPLATE_MASTER_PARENT + ' 的母本 ' + PROTO_SOURCE + '（找到 ' + masters.length + '）', 2);
  const srcProto = sources[0];
  const mstProto = masters[0];
  re.proto = { source: srcProto.id, master: mstProto.id, family: compRef(srcProto.field, 2).value };
  if (compRef(srcProto.field, 4) === null || compRef(srcProto.field, 4).value !== mstProto.id) {
    fatal('模板源 #' + srcProto.id + ' 的 #502[4]/#14 不指向母本 #' + mstProto.id + '（基线不是预期形态）', 2);
  }
  if (compRef(mstProto.field, 3) === null || compRef(mstProto.field, 3).value !== srcProto.id) {
    fatal('母本 #' + mstProto.id + ' 的 #502[3]/#13 不指向源 #' + srcProto.id + '（基线不是预期形态）', 2);
  }
  console.log('  · 模板对原型：源 ' + PROTO_SOURCE + '#' + srcProto.id + '（无父）↔ 母本 #' + mstProto.id
    + '（父=' + TEMPLATE_MASTER_PARENT + '）族号=' + re.proto.family + '；新族号=' + family);

  const mk = (proto, layer, over) => {
    const exists = g.recs.find((r) => r.name === TPL_NAME && (layer === 'source' ? r.parentId == null : Number(r.parentId) === TEMPLATE_MASTER_PARENT));
    if (exists) { re.skipped.push(TPL_NAME + '/' + layer + '#' + exists.id); return exists.id; }
    const clone = cloneField(proto.field);
    const nid = alloc.take();
    const selfCnt = countVarintEqual(proto.field.sub, proto.id);
    const n = remapSelfIds(clone.sub, proto.id, nid);
    if (n !== selfCnt) fatal(TPL_NAME + '/' + layer + '：自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
    const rn = renameRecord(clone.sub, PROTO_SOURCE, TPL_NAME);
    if (!rn.ok) fatal(TPL_NAME + '/' + layer + '：改名命中 ' + rn.hits + ' 处');
    // 族号 → 新族
    setCompRef(clone, 2, family);
    // 几何：1×1 @(0,0)
    const st = stateSummary(clone);
    if (st.length !== 4) fatal(TPL_NAME + '/' + layer + ' 状态块 ' + st.length + ' 个（预期 4）');
    for (const s of st) { setPair(s.pos, 0, 0); setPair(s.size, TPL_SIZE, TPL_SIZE); }
    // 图片槽：imageId=100001 / imageColor=0xFFFFFFFF / imageType=Stretch(1)
    const img = imageTriple(clone);
    setImgLeaf(img.node, 502, TPL_COLOR);
    setImgLeaf(img.node, 503, TPL_IMG_ID);
    setImgLeaf(img.node, 504, TPL_IMG_TYPE);
    // visible=false
    setHiddenRec(clone);
    // 母本链交叉引用（在 remap 之后单独改，别被 remap 抄错）
    if (layer === 'mother') {
      setCompRef(clone, 3, over.sourceId);
      const p504 = topVarint(clone.sub, 504);
      if (!p504) fatal('tpl.prim 母本：顶层没有 #504');
      p504.num = BigInt(TEMPLATE_MASTER_PARENT);
    }
    g.recHolder.push(clone);
    re.added.push({ kind: 'tpl.' + layer, name: TPL_NAME, id: nid, parent: layer === 'source' ? null : TEMPLATE_MASTER_PARENT });
    return nid;
  };

  // 先建源（拿 id）→ 再建母本（#13→源）→ 最后回填源的 #14→母本
  re.sourceId = mk(srcProto, 'source', {});
  re.masterId = mk(mstProto, 'mother', { sourceId: re.sourceId });
  if (re.added.some((a) => a.kind === 'tpl.source')) {
    const srcRec = re.added.find((a) => a.kind === 'tpl.source');
    const srcField = g.recs.find((r) => r.id === srcRec.id) || null;
    // 新源记录还没进 g.recs（recHolder 已 append 但 recs 是快照）⇒ 直接找 recHolder 里 field #501==id
    const holderField = g.recHolder.find((f) => f.sub && Number((f.sub.find((x) => x.field === 501 && x.wt === 0) || {}).num) === srcRec.id);
    if (!holderField) fatal('找不到刚追加的模板源记录');
    setCompRef(holderField, 4, re.masterId);
  }
  console.log('  · 新建模板源 ' + TPL_NAME + '#' + re.sourceId + '（无父/不进任何子列表）↔ 母本 #' + re.masterId
    + '（父=' + TEMPLATE_MASTER_PARENT + '）');
  return re;
}

function assertTplPrim(g2, re) {
  const bad = [];
  const src = g2.recs.find((r) => r.id === Number(re.sourceId));
  const mst = g2.recs.find((r) => r.id === Number(re.masterId));
  if (!src) return '✗ 重读后找不到模板源 tpl.prim#' + re.sourceId;
  if (!mst) return '✗ 重读后找不到母本 tpl.prim#' + re.masterId;
  if (src.parentId != null) bad.push('模板源必须无父（实际父=' + src.parentId + '）');
  if (src.names.join(',') !== TPL_NAME && src.name !== TPL_NAME) bad.push('模板源名字=' + JSON.stringify(src.names));
  if (Number(mst.parentId) !== TEMPLATE_MASTER_PARENT) bad.push('母本父=' + mst.parentId + '（预期 ' + TEMPLATE_MASTER_PARENT + '）');
  if (mst.name !== TPL_NAME) bad.push('母本名字=' + mst.name);
  const sRef = compRef(src.field, 4);
  if (!sRef || sRef.value !== Number(re.masterId)) bad.push('模板源 #502[4]/#14=' + (sRef && sRef.value) + '（预期母本 ' + re.masterId + '）');
  const mRef = compRef(mst.field, 3);
  if (!mRef || mRef.value !== Number(re.sourceId)) bad.push('母本 #502[3]/#13=' + (mRef && mRef.value) + '（预期源 ' + re.sourceId + '）');
  const famS = compRef(src.field, 2), famM = compRef(mst.field, 2);
  if (!famS || famS.value !== re.family) bad.push('源族号=' + (famS && famS.value) + '（预期 ' + re.family + '）');
  if (!famM || famM.value !== re.family) bad.push('母本族号=' + (famM && famM.value) + '（预期 ' + re.family + '）');
  for (const [nm, r] of [['源', src], ['母本', mst]]) {
    const st = stateSummary(r.field);
    if (st.length !== 4) bad.push(nm + ' 状态块 ' + st.length);
    for (const s of st) {
      if (s.w !== TPL_SIZE || s.h !== TPL_SIZE) bad.push(nm + ' 尺寸 ' + s.w + 'x' + s.h + '（预期 1x1）');
      if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) bad.push(nm + ' 锚点/中心不是 0.5');
    }
    const img = imageTriple(r.field);
    if (img.id !== TPL_IMG_ID) bad.push(nm + ' imageId=' + img.id + '（预期 ' + TPL_IMG_ID + '）');
    if (img.color !== TPL_COLOR) bad.push(nm + ' imageColor=' + hex32(img.color) + '（预期 0xFFFFFFFF）');
    if (img.type !== TPL_IMG_TYPE) bad.push(nm + ' imageType=' + img.type + '（预期 Stretch=1）');
    if (!isHiddenRec(r.field)) bad.push(nm + ' 可见性不是"隐藏"（预期 visible=false）');
    if (imageMaskLeaves(r.field).length) bad.push(nm + ' 带遮罩/羽化字段：' + imageMaskLeaves(r.field).join(','));
  }
  // 模板源必须是孤儿：不在任何记录的子列表里
  for (const r of g2.recs) {
    const cl = findChildListTop(r.field.sub);
    if (cl && (asIdList(cl.payload, true) || []).map(Number).includes(Number(re.sourceId))) {
      bad.push('模板源 #' + re.sourceId + ' 被 ' + r.name + '#' + r.id + ' 的子列表收录（必须保持孤儿）');
    }
  }
  if (bad.length) return '✗ tpl.prim 断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ tpl.prim 断言：源 #' + re.sourceId + '（无父/孤儿）↔ 母本 #' + re.masterId
    + '（父=' + TEMPLATE_MASTER_PARENT + '）；#14/#13 双向闭合；族号 ' + re.family
    + '；1×1、visible=false、imageId=' + TPL_IMG_ID + '/' + hex32(TPL_COLOR) + '/Stretch；无遮罩字段');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 外部闸门
// ════════════════════════════════════════════════════════════════════════════
function runNode(tool, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, tool), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}
function runExternalGates(outAbs, inAbs, re) {
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
  const want = re.expectedFinalDiffs;
  const recA = /记录数：A (\d+) → B (\d+)/.exec(df.stdout);
  const recOk = recA ? (Number(recA[2]) === re.expectedFinalRecs && Number(recA[1]) + re.totalAdded === Number(recA[2]))
    : (re.totalAdded === 0);
  const dfPass = got === want && recOk && (want === 0 ? df.status === 0 : df.status === 3);
  results.push({ name: 'diff_fields', pass: dfPass });
  say('  ⇒ ' + (dfPass ? '✅ 通过：差异 ' + got + ' 处 = ' + (re.totalAdded ? 1 : 0) + ' 记录数组条数 + '
    + re.contentListChanges + ' content 子列表（= ' + want + '）'
    : '❌ 未通过：差异 ' + got + ' 处，预期 ' + want));
  say('     ★ ' + re.totalAdded + ' 条新记录在 diff_fields 眼里是"新增"（1 处子字段个数不同），不算逐字段差异（E10）✓');

  say('\n── ⑥ probe_ui_registry.mjs（模板登记关系：母本链/族号/父子表）──');
  const reg = runNode('probe_ui_registry.mjs', [outAbs]);
  const regTail = reg.stdout.split('\n').filter((l) => /^③|^④|^⑤|^★ 结论/.test(l.trim()) || /悬空/.test(l)).slice(0, 12).join('\n');
  say(regTail);
  const regPass = reg.status === 0 && /悬空 0/.test(reg.stdout) && /★ 结论：登记关系自洽/.test(reg.stdout);
  results.push({ name: 'probe_ui_registry', pass: regPass });
  say('  ⇒ ' + (regPass ? '✅ 通过：母本链闭合（悬空 0）、登记关系自洽' : '❌ 未通过（见上）'));

  // ⑦ list_names + 回读
  const g3 = readGil(outAbs);
  const furnRecs = g3.recs.filter((r) => Number(r.parentId) != null && r.name === FURN_NAME);
  const tplRecs = g3.recs.filter((r) => r.name === TPL_NAME);
  say('\n── ⑦ list_names / 回读 ──');
  const lnFurn = runNode('list_names.mjs', [outAbs, 'furn']);
  const lnFurnCount = (lnFurn.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
  const lnTpl = runNode('list_names.mjs', [outAbs, 'tpl.prim']);
  const lnTplCount = (lnTpl.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
  say('  list_names furn 命中 ' + lnFurnCount + ' 个：');
  say(lnFurn.stdout.trim());
  say('  list_names tpl.prim 命中 ' + lnTplCount + ' 个（模板源 + 母本，同名）：');
  say(lnTpl.stdout.trim());
  const lnPass = lnFurnCount === 2 && lnTplCount === 2;
  results.push({ name: 'list_names', pass: lnPass });
  say('  ⇒ ' + (lnPass ? '✅ 通过：furn=2、tpl.prim=2（源+母本）' : '❌ 未通过'));

  // 层序
  let orderPass = true;
  const wantHead = ['face', 'hint', 'obj', ...Array.from({ length: 11 }, (_, i) => 'obj' + (i + 2)), FURN_NAME, 'x'];
  for (const t of re.furnTargets) {
    const c2 = g3.recs.find((r) => r.id === Number(t.content.id));
    const cl = c2 ? findChildListTop(c2.field.sub) : null;
    const names = cl ? (asIdList(cl.payload, true) || []).map((id) => (g3.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id) : [];
    const ok = names.slice(0, wantHead.length).join(',') === wantHead.join(',');
    if (!ok) orderPass = false;
    say('  content#' + t.content.id + ' → ' + names.join(' , '));
    say('    ' + (ok ? '✅' : '❌') + ' 前 ' + wantHead.length + ' 位 = ' + names.slice(0, wantHead.length).join(','));
  }
  // root 子列表逐字节未变
  const rootChild = (gx) => { const r = gx.recs.find((x) => x.name === 'root'); return r ? findChildListTop(r.field.sub).payload : null; };
  const rootSame = rootChild(readGil(inAbs)).equals(rootChild(g3));
  if (!rootSame) orderPass = false;
  say('  root 子列表逐字节未变: ' + (rootSame ? '✅（模板源保持孤儿，不进 root）' : '❌ 被改了'));
  results.push({ name: 'content/root-order', pass: orderPass });

  // prefab 汇总
  say('\n── ⑧ tpl.prim 关键号（★ 给 lead 接线用）──');
  say('  ★ prefabIndex（= 模板源记录 GUID，InstantiateClientUIControl 第 1 参）= ' + re.tpl.sourceId);
  say('    模板源：父=null（无 #504，孤儿）、组件 [1,2,4]、#14→母本 #' + re.tpl.masterId + '、族号 ' + re.tpl.family);
  say('  · 母本记录 GUID（父=' + TEMPLATE_MASTER_PARENT + ' ClientUIPrototypeHierarchyRoot 下）= ' + re.tpl.masterId);
  say('    母本：组件 [1,2,3]、#13→源 #' + re.tpl.sourceId);
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
function main() {
  if (!IN || !OUT) {
    console.error('用法: node tools/gil/gen_art_runtime.mjs --in=<存档.gil> --out=<输出.gil> [--dry] [--guid-base=1073746300] [--family=78]');
    process.exit(1);
  }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到输入存档：' + inAbs, 1);
  const g = readGil(inAbs);
  console.log('══ gen_art_runtime —— furn 容器（×2）＋ tpl.prim 图片模板（模板源+母本）══');
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.src.length + ' 字节，记录 ' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  console.log('  输出 ' + basenameOf(outAbs) + '（' + (DRY ? '--dry 只预测不写' : '写') + '）');

  const { used, maxGuid } = scanGuidUsage(g.tree);
  if (!Number.isInteger(GUID_BASE) || GUID_BASE < 1073741824 || GUID_BASE >= ID_HI_NUM) fatal('--guid-base 不合法', 1);
  let nextId = Math.max(GUID_BASE, maxGuid + 1);
  if (maxGuid >= GUID_BASE) console.log('  · 输入已用到 ' + maxGuid + '（含 GUID_BASE 段）⇒ 幂等复跑，新号将从 ' + nextId + ' 起');
  const alloc = {
    base: nextId, ids: [],
    take() { while (used.has(nextId)) nextId++; if (nextId >= ID_HI_NUM) fatal('GUID 号段耗尽'); const v = nextId++; used.add(v); alloc.ids.push(v); return v; },
  };
  console.log('  · GUID 扫描：已用 id 区间 varint ' + used.size + ' 个，maxGuid=' + maxGuid + ' ⇒ 新号从 ' + alloc.base + ' 起（6100–6117 / 6200–6211 已占，不复用）');

  const famMax = maxFamily(g);
  const family = FAMILY_ARG != null ? Number(FAMILY_ARG) : Math.max(78, famMax + 1);
  if (!Number.isInteger(family) || family <= famMax) fatal('--family=' + family + ' 不是全档未用过的号（当前最大 ' + famMax + '）', 1);

  const rootRec = g.recs.find((r) => r.name === 'root');
  const rootCl = rootRec ? findChildListTop(rootRec.field.sub) : null;
  const rootIdsBefore = rootCl ? (asIdList(rootCl.payload, true) || []).map(Number) : [];

  let tmp1 = null, tmp2 = null;
  try {
    // ── 段①：furn ─────────────────────────────────────────────────────
    console.log('\n── ① 两份 content 各加一个 `furn` 容器（obj12 之后、x 之前；135×135/锚点0.5/可见/无遮罩）──');
    const reA = buildFurn(g, alloc);
    console.log('  新增记录 ' + reA.added.length + ' 条：' + reA.added.map((a) => a.name + '#' + a.id).join(', '));
    if (reA.skipped.length) console.log('  （已存在、跳过 ' + reA.skipped.length + ' 条）');
    console.log('  记录数：' + g.recs.length + ' → ' + reA.expectedRecs + '；第一段预计差异 ' + reA.expectedDiffs
      + ' 处（' + (reA.added.length ? 1 : 0) + ' 记录数组条数 + ' + reA.childListChanges.length + ' content 子列表）');

    let midSrc = inAbs;
    if (reA.added.length > 0 && !DRY) {
      tmp1 = path.join(os.tmpdir(), 'gen_art_runtime_A_' + process.pid + '_' + Date.now() + '.gil');
      writeGil(g, tmp1, {
        label: 'gen_art_runtime ① content 加 furn 容器',
        expectRecs: reA.expectedRecs,
        expectDiffs: reA.expectedDiffs,
        assert: (g2) => assertFurn(g2, reA),
      });
      midSrc = tmp1;
    }

    // ── 段②：tpl.prim ─────────────────────────────────────────────────
    console.log('\n── ② tpl.prim 客户端图片模板（模板源 + 母本；克隆本档 hex 模板对）──');
    const gB = DRY ? g : readGil(midSrc);
    const baseRecs = g.recs.length;
    const reB = buildTplPrim(gB, alloc, family);
    const totalAdded = reA.added.length + reB.added.length;
    const expectedRecs = baseRecs + totalAdded;
    reB.expectedRecs = expectedRecs;
    console.log('  新增记录 ' + reB.added.length + ' 条：' + reB.added.map((a) => a.name + '（' + a.kind + '）#' + a.id).join(', '));
    if (reB.skipped.length) console.log('  （已存在、跳过 ' + reB.skipped.length + ' 条）');
    console.log('  记录数：' + baseRecs + ' → ' + expectedRecs + '；第二段预计差异 ' + (reB.added.length ? 1 : 0) + ' 处（只增记录数组条数）');

    // 汇总
    const reTotal = {
      totalAdded, expectedFinalRecs: expectedRecs,
      contentListChanges: reA.childListChanges.length,
      expectedFinalDiffs: (totalAdded ? 1 : 0) + reA.childListChanges.length,
      furnTargets: reA.targets,
      tpl: { sourceId: reB.sourceId, masterId: reB.masterId, family },
      rootUnchanged: true,
    };

    if (DRY) {
      const buf = gB.pack(encodeMsg(gB.tree));
      console.log('\n[--dry] 不写任何文件。预测：');
      console.log('  记录数 ' + baseRecs + ' → ' + expectedRecs + '（+' + totalAdded + '）');
      console.log('  输出字节 ' + g.src.length + ' → ' + buf.length + '（+' + (buf.length - g.src.length) + '）');
      console.log('  diff_fields 基线→输出 = ' + reTotal.expectedFinalDiffs + ' 处（1 记录数组条数 + ' + reTotal.contentListChanges + ' content 子列表）');
      console.log('  tpl.prim：prefabIndex（模板源）= ' + reB.sourceId + '；母本 = ' + reB.masterId + '；族号 = ' + family);
      return 0;
    }

    let finalBytes = 0, finalRecs = 0;
    if (reB.added.length > 0) {
      tmp2 = path.join(os.tmpdir(), 'gen_art_runtime_B_' + process.pid + '_' + Date.now() + '.gil');
      const rep = writeGil(gB, tmp2, {
        label: 'gen_art_runtime ② tpl.prim 模板源+母本',
        expectRecs: expectedRecs,
        expectDiffs: reB.expectedDiffs,
        assert: (g2) => assertTplPrim(g2, reB),
      });
      finalBytes = rep.bytes; finalRecs = rep.recs;
      fs.copyFileSync(tmp2, outAbs);
    } else if (path.resolve(midSrc) !== path.resolve(outAbs)) {
      fs.copyFileSync(midSrc, outAbs);
      finalBytes = fs.statSync(outAbs).size; finalRecs = expectedRecs;
    } else { finalBytes = fs.statSync(outAbs).size; finalRecs = expectedRecs; }

    const results = runExternalGates(outAbs, inAbs, reTotal);
    const allPass = results.every((r) => r.pass);

    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + finalBytes + ' 字节，记录 ' + finalRecs + ' 条）');
    console.log('  记录数：' + baseRecs + ' → ' + finalRecs + '（+' + (finalRecs - baseRecs) + '）'
      + (finalRecs === expectedRecs ? ' ✅' : ' ❌') + '   算式：' + baseRecs + ' + 2(furn) + 2(tpl.prim 源+母本) = ' + expectedRecs);
    console.log('  GUID 号段：' + alloc.base + '–' + (alloc.ids.length ? alloc.ids[alloc.ids.length - 1] : alloc.base - 1));
    console.log('  ★ prefabIndex（模板源 GUID）= ' + reTotal.tpl.sourceId + '；母本 GUID = ' + reTotal.tpl.masterId + '；模板族号 = ' + reTotal.tpl.family);
    console.log('  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
    if (!allPass) { console.error('\n❌ 外部闸门未全过 —— 文件已写出但**不要导入**。'); return 4; }
    console.log('  ★ 全部通过。导入用：' + OUT);
    return 0;
  } finally {
    for (const t of [tmp1, tmp2]) if (t && fs.existsSync(t)) { try { fs.unlinkSync(t); } catch { /* ignore */ } }
  }
}

process.exit(main());
