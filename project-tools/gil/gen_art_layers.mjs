// tools/gil/gen_art_layers.mjs —— 家具图层扩容：在已有层之后按序追加新层（本轮 6 层 → 12 层）
//
// ════════════════════════════════════════════════════════════════════════════
// 背景（2026-10-22 第三轮，用户授权"图层任意添加"）
// ════════════════════════════════════════════════════════════════════════════
//   用户原话：「图层3是肯定不够了，你可以任意添加」⇒ 这轮把每格家具层上限一次给到 **12 层**
//   （对照原作：桌 12 部件、椅 8、书架 7+书脊、植物 10 叶）。
//   运行时每格 content 子控件 19 → 25，36 格 ≈ +216 个运行时控件，仍远低于「单屏可见 10000」。
//
//   基线 `498-一二关美术-容器-v1.gil`（484 条）已含 obj..obj6 六层；
//   本工具给**两份 content** 各追加 **obj7..obj12** 六层 ⇒ **+12 条 ⇒ 496 条**。
//
//   目标层序（每份 content，从下到上）：
//     face, hint, obj, obj2, obj3, obj4, obj5, obj6, obj7, obj8, obj9, obj10, obj11, obj12,
//     x, wall.*, note, door.*, portrait
//
// ── 与 `gen_art_containers.mjs`（上一轮工具）的关系 ──────────────────────────
//   ★ **不改上一轮的工具**（它要能继续从 494 复现 498）；本工具是"在任意已有层之后继续加层"的
//     专用增量工具，参数化层名，插在**当前最后一个 objN 之后**（本轮即 obj6 之后）。
//   ★ 新层克隆自**各 content 自己的 `obj6`**（lead：克隆 obj6 或 obj 都行，只要字段逐项一致），
//     并**断言与 `obj` 的规范化字段树签名 0 差异**（断言⑧）；若基线换了而 obj6 与 obj 不同构，
//     工具会**当场报错**，不许悄悄抄错。
//   ★ 新记录**追加到 `g.recHolder` 末尾**（E10：字段 diff 按位置比，插中间会让后续兄弟下标整体位移）。
//     层级/次序只由父指针 `#504` + 父记录的子列表决定 ⇒ 我们改的是 `content` 的子列表 ID 数组。
//   ★ 克隆必须**整条记录 remap 自身 GUID**（E1：obj 记录里自身 id 出现 8 处）。
//   ★ GUID 从 **1073746200** 起（lead 指定；避开 6100–6117 与更早的 6000 段）。
//     先扫全档 id 区间 varint 取已用集合，保证文件内唯一；不复用任何旧号（两份存档同号会撞，E11）。
//   ★ 写盘只走 `writeGil()`（落盘 → 重读磁盘 → 往返闸门 → 字段 diff 断言）。
//   ★ 写完后**原样跑仓库只读闸门**并打印：probe_guid_collision / roundtrip / diff_fields / list_names，
//     再回读两份 content 层序 + root 子列表（断言⑨：root 未变）。
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_art_layers.mjs --in=498-一二关美术-容器-v1.gil \
//        --out=500-一二关美术-容器-v2.gil [--dry]
//   --layers=obj7,obj8,obj9,obj10,obj11,obj12   要追加的层名（默认就是这 6 个）
//   --guid-base=1073746200                      新 GUID 起点（只影响新记录）
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
const GUID_BASE = Number(argOf('guid-base', '1073746200'));
const NEW_LAYERS = (argOf('layers', 'obj7,obj8,obj9,obj10,obj11,obj12') || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const CELL = 135;
const BASE_IMG_ID = 100001;
const WHITE = 0xFFFFFFFF;

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const hex32 = (v) => '0x' + (Number(v) >>> 0).toString(16).toUpperCase().padStart(8, '0');
const basenameOf = (p) => path.basename(p);

// ════════════════════════════════════════════════════════════════════════════
// 字段级 helper（与上一轮工具同一套判据；按【路径/类型】取值）
// ════════════════════════════════════════════════════════════════════════════
function topVarint(fields, no) {
  const f = (fields || []).find((x) => x.field === no);
  return f && f.wt === 0 ? f : null;
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
/** 可见性（check_visible.mjs 判据）：任一 `#505` 块内 `/503/14/17/503=1` ⇒ 存档里存"隐藏" */
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
/** 规范化字段树签名：把"原型 id↔新 id""原型名↔新名"折叠成同一标记后逐节点比 */
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
/** 断言"克隆体 == 参考记录（除 name / 自身 GUID 外逐字段一致）"——不一致就打印第一处差异并停 */
function assertSameAs(protoFields, cloneFields, oldName, oldId, newId, newName, label) {
  const a = sigOf(protoFields, { idSet: new Set([oldId]), nameSet: new Set([oldName]) }).join('|');
  const b = sigOf(cloneFields, { idSet: new Set([newId]), nameSet: new Set([newName]) }).join('|');
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  fatal('[' + label + '] 与参考记录 ' + oldName + '#' + oldId + ' 字段不一致（' + i + ' 字符起）：\n'
    + '   参考：…' + a.slice(Math.max(0, i - 70), i + 130) + '\n'
    + '   新层：…' + b.slice(Math.max(0, i - 70), i + 130));
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
const isLayerName = (n) => /^obj\d*$/.test(n || '');          // obj / obj2 / … / obj12

// ════════════════════════════════════════════════════════════════════════════
// 结构：两份 content 在"当前最后一个层"之后追加新层
// ════════════════════════════════════════════════════════════════════════════
function buildLayers(g, alloc) {
  const re = { added: [], skipped: [], childListChanges: [], targets: [], anchorNames: [] };
  const cellRoots = g.recs.filter((r) => r.name === 'cell.1.1');
  if (cellRoots.length !== 2) fatal('cell.1.1 记录 ' + cellRoots.length + ' 个（预期 2，见 E6）', 2);

  for (const root of cellRoots) {
    const content = g.recs.find((r) => Number(r.parentId) === Number(root.id) && r.name === 'content');
    if (!content) fatal('cell.1.1 #' + root.id + ' 下找不到 content', 2);
    const obj = g.recs.find((r) => Number(r.parentId) === Number(content.id) && r.name === 'obj');
    if (!obj) fatal('content #' + content.id + ' 下找不到 obj', 2);
    const cl = findChildListTop(content.field.sub);
    if (!cl) fatal('content #' + content.id + ' 顶层没有子控件列表', 2);
    const cur = (asIdList(cl.payload, true) || []).map(Number);
    const nameOf = (id) => (g.recs.find((r) => Number(r.id) === Number(id)) || {}).name || '#' + id;

    // 当前最后一个家具层（objN）—— 新层插在它之后
    let anchorIdx = -1;
    for (let i = cur.length - 1; i >= 0; i--) if (isLayerName(nameOf(cur[i]))) { anchorIdx = i; break; }
    if (anchorIdx < 0) fatal('content #' + content.id + ' 子列表里找不到任何 objN 层', 2);
    const anchorName = nameOf(cur[anchorIdx]);
    // 克隆母本 = 该 content 自己的"最后一个层"（本轮 = obj6，lead 指定；obj 亦可，字段本就同构）
    const cloneProto = g.recs.find((r) => Number(r.id) === Number(cur[anchorIdx]));
    if (!cloneProto) fatal('content #' + content.id + ' 的锚点层 #' + cur[anchorIdx] + ' 不存在', 2);
    const objImg = imageTriple(obj.field);
    re.anchorNames.push({ contentId: content.id, anchorName, cloneProto: cloneProto.name + '#' + cloneProto.id });
    console.log('  · content#' + content.id + ' 当前 ' + cur.length + ' 个子控件；最后一个层 = '
      + anchorName + '#' + cloneProto.id + '；原型 obj#' + obj.id + '（imageId=' + objImg.id
      + ' color=' + hex32(objImg.color) + ' type=' + objImg.type + '）');

    const layerIds = [];
    for (const layer of NEW_LAYERS) {
      const exists = g.recs.find((r) => Number(r.parentId) === Number(content.id) && r.name === layer);
      if (exists) { layerIds.push(exists.id); re.skipped.push('content#' + content.id + '/' + layer + '#' + exists.id); continue; }
      const clone = cloneField(cloneProto.field);
      const nid = alloc.take();
      const selfCnt = countVarintEqual(cloneProto.field.sub, cloneProto.id);
      const remapped = remapSelfIds(clone.sub, cloneProto.id, nid);
      if (remapped !== selfCnt) fatal('克隆 ' + layer + '：自身 GUID 替换 ' + remapped + '/' + selfCnt + ' 处');
      const rn = renameRecord(clone.sub, cloneProto.name, layer);
      if (!rn.ok) fatal('克隆 ' + layer + '：改名命中 ' + rn.hits + ' 处（预期 1）');
      const p504 = topVarint(clone.sub, 504);
      if (!p504) fatal('克隆 ' + layer + '：顶层没有 #504');
      p504.num = BigInt(content.id);

      // ★ 断言⑧：与 `obj` 逐字段一致（规范化签名，0 差异）
      assertSameAs(obj.field.sub, clone.sub, obj.name, obj.id, nid, layer, layer);

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
      re.added.push({ name: layer, id: nid, parent: content.id });
    }

    // 子列表：锚点层之后插入新层（幂等：先摘掉新层 id 再按序插回锚点后）
    const kept = cur.filter((id) => !layerIds.includes(id));
    // 重新找锚点（摘完之后下标可能变）
    let at = -1;
    for (let i = kept.length - 1; i >= 0; i--) if (isLayerName(nameOf(kept[i]))) { at = i; break; }
    if (at < 0) fatal('content #' + content.id + '：摘掉新层后找不到锚点层', 2);
    const next = [...kept.slice(0, at + 1), ...layerIds, ...kept.slice(at + 1)];
    if (next.join(',') !== cur.join(',')) {
      setChildList(cl, next);
      re.childListChanges.push({ where: 'content#' + content.id, before: cur, after: next });
    }
    re.targets.push({ root, content, obj, layerIds });
  }
  re.expectedRecs = g.recs.length + re.added.length;
  re.expectedDiffs = (re.added.length ? 1 : 0) + re.childListChanges.length;
  return re;
}

function assertStructure(g2, re) {
  const bad = [];
  const nameOf = (id) => (g2.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id;
  const wantHead = ['face', 'hint', 'obj',
    ...Array.from({ length: 11 }, (_, i) => 'obj' + (i + 2)),          // obj2..obj12
    'x'];
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
    for (const layer of NEW_LAYERS) {
      const r = g2.recs.find((x) => Number(x.parentId) === Number(t.content.id) && x.name === layer);
      if (!r) { bad.push('content#' + t.content.id + ' 下缺 ' + layer); continue; }
      if (!ids.includes(Number(r.id))) bad.push(layer + ' 没登记进 content 子列表');
      // 与 obj 逐字段一致（断言⑧）
      try { assertSameAs(obj2.field.sub, r.field.sub, 'obj', obj2.id, r.id, layer, '重读/' + layer); }
      catch (e) { bad.push(e.message); }
      const img = imageTriple(r.field);
      if (img.id !== BASE_IMG_ID) bad.push(layer + ' imageId=' + img.id);
      if (img.color !== WHITE) bad.push(layer + ' imageColor=' + hex32(img.color));
      const protoImg = imageTriple(obj2.field);
      if (img.type !== protoImg.type) bad.push(layer + ' imageType=' + img.type + ' ≠ obj 的 ' + protoImg.type);
      const st = stateSummary(r.field);
      if (st.length !== 4) bad.push(layer + ' 状态块 ' + st.length);
      for (const s of st) {
        if (s.w !== CELL || s.h !== CELL) bad.push(layer + ' 尺寸 ' + s.w + 'x' + s.h);
        if (s.aMinX !== 0.5 || s.aMaxX !== 0.5) bad.push(layer + ' 锚点不是 0.5');
      }
      if (isHiddenRec(r.field)) bad.push(layer + ' 可见性=隐藏（预期 true）');
    }
  }
  // 记录数 / GUID 唯一 / 自身 GUID 两处一致（E1）
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
  // 断言⑨：root 子列表原样（labels 仍在 stage 之后）
  const r2 = g2.recs.find((r) => r.name === 'root');
  const rcl = r2 ? findChildListTop(r2.field.sub) : null;
  const rids = rcl ? (asIdList(rcl.payload, true) || []).map(Number) : [];
  if (rids.join(',') !== (re.rootIdsBefore || []).join(',')) {
    bad.push('root 子列表变了（断言⑨）—— 本工具不该动 root');
  }
  if (bad.length) return '✗ 结构断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 结构断言：两份 content 前 ' + wantHead.length + ' 位 = ' + wantHead.join(',')
    + '；' + NEW_LAYERS.length * 2 + ' 条新层与 obj 签名 0 差异；root 子列表未变（labels 仍在 stage 之后）');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 外部只读闸门
// ════════════════════════════════════════════════════════════════════════════
function runNode(tool, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, tool), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}
function runExternalGates(outAbs, inAbs, re) {
  const results = [];
  const say = (s) => console.log(s);
  const g3 = readGil(outAbs);
  const expectedLayerCount = 6 + 2 * 12;   // things 6 + 两份 content 各 12 层 = 30
  const objHits = g3.recs.filter((r) => (r.name || '').includes('obj')).length;

  say('\n── ② probe_guid_collision.mjs（GUID 撞号分类审计）──');
  const probe = runNode('probe_guid_collision.mjs', [outAbs]);
  say(probe.stdout.trim());
  const probePass = probe.status === 0
    && /① 真撞号（自身 GUID 重复）：\*\*0 处\*\*/.test(probe.stdout)
    && /✅ ② 自身 GUID 两处一致/.test(probe.stdout);
  results.push({ name: 'probe_guid_collision', pass: probePass });
  say('  ⇒ ' + (probePass ? '✅ 通过：① 真撞号 0，② 自身 GUID 两处一致' : '❌ 未通过'));

  say('\n── ③ roundtrip.mjs（解析→重编码 逐字节往返）──');
  const rt = runNode('roundtrip.mjs', [outAbs]);
  say(rt.stdout.trim());
  const rtPass = rt.status === 0 && /★★★ 往返成功/.test(rt.stdout);
  results.push({ name: 'roundtrip', pass: rtPass });
  say('  ⇒ ' + (rtPass ? '✅ 通过：逐字节一致' : '❌ 未通过'));

  say('\n── ④ diff_fields.mjs（基线 vs 输出，按位置比）──');
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]);
  say(df.stdout.trim());
  const m = /差异：(\d+) 处/.exec(df.stdout);
  const got = m ? Number(m[1]) : -1;
  const want = (re.added.length > 0 ? 1 : 0) + re.childListChanges.length;
  const recA = /记录数：A (\d+) → B (\d+)/.exec(df.stdout);
  const recOk = recA ? (Number(recA[2]) === re.expectedRecs && Number(recA[1]) + re.added.length === Number(recA[2]))
    : (re.added.length === 0);
  const dfPass = got === want && recOk && (want === 0 ? df.status === 0 : df.status === 3);
  results.push({ name: 'diff_fields', pass: dfPass });
  say('  ⇒ ' + (dfPass ? '✅ 通过：差异 ' + got + ' 处 = ' + (re.added.length > 0 ? 1 : 0)
    + ' 处记录数组条数 + ' + re.childListChanges.length + ' 处 content 子列表（= ' + want + '）'
    : '❌ 未通过：差异 ' + got + ' 处，预期 ' + want));
  say('     ★ ' + re.added.length + ' 条新层在 diff_fields 眼里是"记录数变了"的**新增**（1 处子字段个数不同），不算逐字段差异（E10）✓');

  say('\n── ⑤ list_names.mjs <输出> obj（预期 ' + expectedLayerCount + ' = 6 things + 2×12 内容层）──');
  const ln = runNode('list_names.mjs', [outAbs, 'obj']);
  say(ln.stdout.trim());
  const lineCount = (ln.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
  const lnPass = ln.status === 0 && lineCount === expectedLayerCount && objHits === expectedLayerCount;
  results.push({ name: 'list_names', pass: lnPass });
  say('  ⇒ ' + (lnPass ? '✅ 通过：obj 名字 ' + lineCount + ' 个（6 things + 2×12 内容层）'
    : '❌ 未通过：list_names 行数 ' + lineCount + '，全档名字含 obj 的记录 ' + objHits + '（预期 ' + expectedLayerCount + '）'));

  say('\n── ⑥ 回读两份 content 层序（前 15 位）与 ⑨ root 未变 ──');
  let orderPass = true;
  const wantHead = ['face', 'hint', 'obj', ...Array.from({ length: 11 }, (_, i) => 'obj' + (i + 2)), 'x'];
  for (const t of re.targets) {
    const c2 = g3.recs.find((r) => r.id === Number(t.content.id));
    const cl = c2 ? findChildListTop(c2.field.sub) : null;
    const names = cl ? (asIdList(cl.payload, true) || []).map((id) => (g3.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id) : [];
    const ok = names.slice(0, wantHead.length).join(',') === wantHead.join(',');
    if (!ok) orderPass = false;
    say('  content#' + t.content.id + ' → ' + names.join(' , '));
    say('    ' + (ok ? '✅' : '❌') + ' 前 ' + wantHead.length + ' 位 = ' + names.slice(0, wantHead.length).join(','));
  }
  {
    const root = g3.recs.find((r) => r.name === 'root');
    const cl = root ? findChildListTop(root.field.sub) : null;
    const names = cl ? (asIdList(cl.payload, true) || []).map((id) => (g3.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id) : [];
    const si = names.indexOf('stage'), li = names.indexOf('labels');
    const ok = si >= 0 && li === si + 1;
    if (!ok) orderPass = false;
    say('  root 共 ' + names.length + ' 个子控件；stage 附近 → ' + names.slice(Math.max(0, si - 1), li + 2).join(' , '));
    say('    ' + (ok ? '✅' : '❌') + ' labels 仍在 stage 之后（断言⑨：root 子列表未变）');
  }
  results.push({ name: 'content/root-order', pass: orderPass });
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
function main() {
  if (!IN || !OUT) {
    console.error('用法: node tools/gil/gen_art_layers.mjs --in=<存档.gil> --out=<输出.gil> [--dry] [--layers=obj7,...] [--guid-base=1073746200]');
    process.exit(1);
  }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到输入存档：' + inAbs, 1);
  const g = readGil(inAbs);

  console.log('══ gen_art_layers —— 家具图层扩容（按序追加新层）══');
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.src.length + ' 字节，记录 ' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  console.log('  输出 ' + basenameOf(outAbs) + '（' + (DRY ? '--dry 只预测不写' : '写') + '）');
  console.log('  要追加的层：' + NEW_LAYERS.join(', '));

  // GUID
  const { used, maxGuid } = scanGuidUsage(g.tree);
  if (!Number.isInteger(GUID_BASE) || GUID_BASE < 1073741824 || GUID_BASE >= ID_HI_NUM) fatal('--guid-base 不合法', 1);
  let nextId = Math.max(GUID_BASE, maxGuid + 1);
  if (maxGuid >= GUID_BASE) console.log('  · 输入已用到 ' + maxGuid + '（含 GUID_BASE 段）⇒ 幂等复跑，新号将从 ' + nextId + ' 起（本次应无新增）');
  const alloc = {
    base: nextId, ids: [],
    take() {
      while (used.has(nextId)) nextId++;
      if (nextId >= ID_HI_NUM) fatal('GUID 号段耗尽');
      const v = nextId++; used.add(v); alloc.ids.push(v); return v;
    },
  };
  console.log('  · GUID 扫描：已用 id 区间 varint ' + used.size + ' 个，maxGuid=' + maxGuid + ' ⇒ 新号从 ' + alloc.base + ' 起');

  // 断言⑨用：记下 root 子列表原值
  const rootRec = g.recs.find((r) => r.name === 'root');
  const rootCl = rootRec ? findChildListTop(rootRec.field.sub) : null;
  const rootIdsBefore = rootCl ? (asIdList(rootCl.payload, true) || []).map(Number) : [];

  let tmp = null;
  try {
    console.log('\n── ① 两份 content 在最后一个 objN 层之后追加 ' + NEW_LAYERS.join('/') + ' ──');
    const re = buildLayers(g, alloc);
    re.rootIdsBefore = rootIdsBefore;
    console.log('  新增记录 ' + re.added.length + ' 条：' + re.added.map((a) => a.name + '#' + a.id).join(', '));
    if (re.skipped.length) console.log('  （已存在、跳过 ' + re.skipped.length + ' 条）');
    console.log('  记录数：' + g.recs.length + ' → ' + re.expectedRecs + '（+' + re.added.length + '）');
    console.log('  子列表改动 ' + re.childListChanges.length + ' 处；预计字段差异 ' + re.expectedDiffs
      + ' 处（' + (re.added.length ? 1 : 0) + ' 记录数组条数 + ' + re.childListChanges.length + ' content 子列表）');

    if (DRY) {
      const buf = g.pack(encodeMsg(g.tree));
      console.log('\n[--dry] 不写任何文件。预测：');
      console.log('  记录数 ' + g.recs.length + ' → ' + re.expectedRecs + '（+' + re.added.length + '）');
      console.log('  输出字节 ' + g.src.length + ' → ' + buf.length + '（+' + (buf.length - g.src.length) + '）');
      console.log('  diff_fields 基线→输出 = ' + re.expectedDiffs + ' 处');
      return 0;
    }

    let finalBytes = 0, finalRecs = 0;
    if (re.added.length > 0) {
      tmp = path.join(os.tmpdir(), 'gen_art_layers_' + process.pid + '_' + Date.now() + '.gil');
      const rep = writeGil(g, tmp, {
        label: 'gen_art_layers ① 两份 content 追加 ' + NEW_LAYERS.join('/'),
        expectRecs: re.expectedRecs,
        expectDiffs: re.expectedDiffs,
        assert: (g2) => assertStructure(g2, re),
      });
      finalBytes = rep.bytes; finalRecs = rep.recs;
      fs.copyFileSync(tmp, outAbs);
    } else {
      finalBytes = fs.statSync(inAbs).size; finalRecs = g.recs.length;
      if (path.resolve(inAbs) !== path.resolve(outAbs)) fs.copyFileSync(inAbs, outAbs);
      console.log('\n  （所有层都已存在 ⇒ 幂等复跑，未写任何字段；输出 = 输入）');
    }

    const results = runExternalGates(outAbs, inAbs, re);
    const allPass = results.every((r) => r.pass);

    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + finalBytes + ' 字节，记录 ' + finalRecs + ' 条）');
    console.log('  记录数：' + g.recs.length + ' → ' + finalRecs + '（+' + (finalRecs - g.recs.length) + '）'
      + (finalRecs === re.expectedRecs ? ' ✅' : ' ❌')
      + '   算式：' + g.recs.length + ' + ' + re.added.length + ' = ' + (g.recs.length + re.added.length));
    console.log('  新增：' + re.added.length + ' 条（' + (re.added.length ? re.added.map((a) => a.name + '#' + a.id).join(', ') : '无') + '）');
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
    if (tmp && fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

process.exit(main());
