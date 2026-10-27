// tools/gil/gen_plant_fill.mjs —— `517-模板测试-v2.gil`：给 516 里的 `furn.plant` 模板
//                              两份 content 各填 10 层（规格 JSON 的 furn.plant），供嵌套探针看到"层展开"
//
// ════════════════════════════════════════════════════════════════════════════
// 背景（lead 2026-10-22 第十三轮补测）：
//   516 里 furn.plant 模板是**空的**（515 用户建的模板没填层）⇒ 嵌套第二层即使展开成功也看不到层。
//   本工具只给 `furn.plant`（源 1073747081 / 母本 1073747080）的**两份 content** 填 10 层：
//     · 层数据 = `家具模板层规格-v310.json` 的 `templates["furn.plant"]`（10 层 / 108×108）
//     · 层名 `L01…L10`；imageId/色/尺寸/位置（dx, y_up=-dy_down）照规格；无旋转；visible=true
//     · plant 原本没有 content ⇒ 各建一个**无名容器**（克隆自用户 chair 模板的 content，108×108）
//   其余模板/控件/记录一律不动。
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_plant_fill.mjs --in=516-模板测试-v1.gil --out=517-模板测试-v2.gil
//        [--dry] [--spec=<家具模板层规格-v310.json>]
//   退出码：0 成功（含幂等）；1 用法错；2 基线结构不符；3 断言/写入失败；4 外部闸门失败
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readGil, cloneField, findChildListTop, setChildList, asIdList, ensureChildListTop, encodeMsg,
  stateBlocks, pairOf, pairValue, setPair, textsOf, writeVarint, ID_LO, ID_HI,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WORKSPACE = path.resolve(ROOT, '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const hasFlag = (k) => argv.includes(k);

const IN = argOf('in');
const OUT = argOf('out');
const DRY = hasFlag('dry');
const SPEC = argOf('spec', path.join(WORKSPACE, 'murdoku-project', '美术实现-一二关-2026-10-22', '家具模板层规格-v310.json'));

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const TEMPLATE_MASTER_PARENT = 1073741844;
const PLANT_SRC = 1073747081;
const PLANT_MST = 1073747080;
const CANVAS = 108;
const LAYER_NAME = (i) => 'L' + String(i).padStart(2, '0');
const IMG_TYPE_STRETCH = 1;
const USER_TEMPLATES = ['furn.chair', 'furn.plant', 'furn.statue', 'furn.table.1', 'furn.shelf'];

const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const basenameOf = (p) => path.basename(p);

// ── helper ────────────────────────────────────────────────────────────────
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
  if (nodes.length !== 1) throw new Error('图片节点命中 ' + nodes.length + ' 个');
  const n = nodes[0];
  const leaf = (no) => n.sub.find((f) => f.field === no && f.wt === 0) || null;
  return { node: n, id: leaf(503) ? Number(leaf(503).num) : null, color: leaf(502) ? Number(leaf(502).num) : null, type: leaf(504) ? Number(leaf(504).num) : null };
}
function setImgLeaf(node, no, value) {
  let f = node.sub.find((x) => x.field === no && x.wt === 0);
  if (!f) { f = { field: no, wt: 0, num: 0n }; node.sub.push(f); }
  f.num = BigInt(value >>> 0);
}
function stateSummary(recField) {
  return stateBlocks(recField.sub, []).map((b) => {
    const pos = pairOf(b, 504), size = pairOf(b, 505);
    return { block: b, pos, size, x: pairValue(pos, 0), y: pairValue(pos, 1), w: pairValue(size, 0), h: pairValue(size, 1), pivX: pairValue(pairOf(b, 506), 0), pivY: pairValue(pairOf(b, 506), 1), aMinX: pairValue(pairOf(b, 502), 0), aMaxX: pairValue(pairOf(b, 503), 0) };
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
function setHiddenRec(recField, hidden) {
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
    p17.sub = hidden ? [{ field: 503, wt: 0, num: 1n }] : [];
    p17.payload = encodeMsg(p17.sub); p17.len = p17.payload.length; p17.isText = false;
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
const recBy = (tree, id) => tree.recs.find((r) => Number(r.id) === Number(id)) || null;
function childIds(tree, rec) {
  const cl = rec ? findChildListTop(rec.field.sub) : null;
  return cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
}
/** 给**已存在**的记录挂子列表：有 #503 就改 payload；没有就**追加在记录字段末尾**
 *  （.gil 按字段号解析、顺序无关；插到 #502 之后会让 diff_fields 报大量位移噪声） */
function setOrAppendChildList(recField, ids) {
  const cl = findChildListTop(recField.sub);
  if (cl) { setChildList(cl, ids); return cl; }
  const f = { field: 503, wt: 2, sub: null, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false };
  recField.sub.push(f);
  setChildList(f, ids);
  return f;
}

// ── 规格 ─────────────────────────────────────────────────────────────────
function loadSpec() {
  const file = path.isAbsolute(SPEC) ? SPEC : path.resolve(WORKSPACE, SPEC);
  if (!fs.existsSync(file)) fatal('找不到模板规格：' + file, 1);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const t = doc.templates && doc.templates['furn.plant'];
  if (!t) fatal('规格里没有 templates["furn.plant"]', 2);
  const [cw, ch] = t.sizePx.map(Number);
  if (cw !== CANVAS || ch !== CANVAS) fatal('furn.plant 规格画布 ' + cw + 'x' + ch + '（预期 108x108）', 2);
  if (!Array.isArray(t.layers) || t.layers.length !== 10) fatal('furn.plant 层数 ' + (t.layers || []).length + '（预期 10）', 2);
  const layers = t.layers.map((l, i) => {
    if (Number(l.order) !== i + 1) fatal('furn.plant 层 order 必须 1..10 连续', 2);
    const color = typeof l.color === 'string' ? Number(BigInt(l.color.replace(/^0X/i, '0x')) & 0xFFFFFFFFn) : Number(l.color) >>> 0;
    const yUp = Number(l.y_up), dyDown = Number(l.dy_down);
    if (Math.abs(yUp + dyDown) > 1e-6) fatal('第 ' + (i + 1) + ' 层 y_up ≠ -dy_down', 2);
    return { order: i + 1, imageId: Number(l.imageId), color, w: Number(l.w), h: Number(l.h), dx: Number(l.dx), yUp };
  });
  return layers;
}

// ── 只读：用户 5 个模板的 content 子控件数 ────────────────────────────────
function reportUserTemplates(g) {
  const rows = [];
  for (const nm of USER_TEMPLATES) {
    const s = g.recs.find((r) => r.name === nm && r.parentId == null);
    const m = g.recs.find((r) => r.name === nm && Number(r.parentId) === TEMPLATE_MASTER_PARENT);
    const cell = (r) => {
      if (!r) return '(缺)';
      const kids = childIds(g, r);
      if (kids.length === 0) return '无 content 子控件';
      if (kids.length === 1) {
        const c = recBy(g, kids[0]);
        if (!c) return '1 个（读不出）';
        const st = stateSummary(c.field)[0];
        return '1 个 content#' + c.id + '（' + (st ? st.w + 'x' + st.h : '?') + '）内 ' + childIds(g, c).length + ' 个孩子';
      }
      return kids.length + ' 个直接子控件 [' + kids.map((k) => (recBy(g, k) || {}).name).join(',') + ']';
    };
    rows.push({ nm, src: cell(s), mst: cell(m) });
  }
  return rows;
}

// ── 填层 ─────────────────────────────────────────────────────────────────
function fill(g, layers) {
  const src = recBy(g, PLANT_SRC), mst = recBy(g, PLANT_MST);
  if (!src || !mst) fatal('516 里找不到 furn.plant 源/母本', 2);
  if (src.name !== 'furn.plant' || src.parentId != null) fatal('#' + PLANT_SRC + ' 不是 furn.plant 源', 2);
  if (mst.name !== 'furn.plant' || Number(mst.parentId) !== TEMPLATE_MASTER_PARENT) fatal('#' + PLANT_MST + ' 不是 furn.plant 母本', 2);
  // ★ 幂等：两份 content 已各 10 层、名字 L01..L10 ⇒ 直接认定"无需改动"
  const alreadyFilled = [src, mst].every((r) => {
    const kids = childIds(g, r);
    if (kids.length !== 1) return false;
    const c = recBy(g, kids[0]);
    if (!c) return false;
    const lids = childIds(g, c);
    if (lids.length !== 10) return false;
    return lids.every((id, i) => { const lr = recBy(g, id); return lr && lr.name === LAYER_NAME(i + 1); });
  });
  if (alreadyFilled) {
    console.log('  · 幂等：furn.plant 两份 content 已各 10 层（L01…L10），不重建');
    const targets = [src, mst].map((r) => {
      const c = recBy(g, childIds(g, r)[0]);
      return { parent: r.id, content: c.id, tag: r.id === PLANT_SRC ? 'src' : 'mst', layerIds: childIds(g, c), reused: true };
    });
    return { added: [], targetRecs: targets, expectDiffs: 0, idempotent: true };
  }
  // content 原型：优先用用户 chair 模板的 content（无名容器），否则任意模板 content
  const chairS = g.recs.find((r) => r.name === 'furn.chair' && r.parentId == null);
  const chairM = g.recs.find((r) => r.name === 'furn.chair' && Number(r.parentId) === TEMPLATE_MASTER_PARENT);
  const contentProtoS = chairS ? (childIds(g, chairS).map((id) => recBy(g, id)).find((r) => r && r.name == null) || null) : null;
  const contentProtoM = chairM ? (childIds(g, chairM).map((id) => recBy(g, id)).find((r) => r && r.name == null) || null) : null;
  const contentProto = contentProtoS || contentProtoM || g.recs.find((r) => r.name === 'content' && Number(r.parentId) === 1073741888);
  if (!contentProto) fatal('找不到 content 容器原型', 2);
  // 层原型：任意图片控件
  const layerProto = g.recs.find((r) => r.name === 'obj' && Number(r.parentId) === 1073741888)
    || g.recs.find((r) => r.name === 'obj.plant')
    || g.recs.find((r) => r.name === 'obj.table');
  if (!layerProto) fatal('找不到层图片控件原型', 2);
  console.log('  · 原型：content ' + (contentProto.name == null ? '(无名容器)' : contentProto.name) + '#' + contentProto.id
    + '；层图片控件 ' + layerProto.name + '#' + layerProto.id);

  const { used, maxGuid } = scanGuidUsage(g.tree);
  let nextId = maxGuid + 1;
  const alloc = {
    ids: [],
    take() { while (used.has(nextId)) nextId++; if (nextId >= ID_HI_NUM) fatal('GUID 号段耗尽'); const v = nextId++; used.add(v); alloc.ids.push(v); return v; },
  };
  const re = { added: [], targetRecs: [], expectDiffs: 0, existing: false };

  const mkContent = (parentRec, proto) => {
    const clone = cloneField(proto.field);
    const cid = alloc.take();
    const selfCnt = countVarintEqual(proto.field.sub, proto.id);
    const n = remapSelfIds(clone.sub, proto.id, cid);
    if (n !== selfCnt) fatal('content 克隆：自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
    const p504 = clone.sub.find((f) => f.field === 504 && f.wt === 0);
    if (!p504) fatal('content 缺 #504');
    p504.num = BigInt(parentRec.id);
    const st = stateSummary(clone);
    if (st.length !== 4) fatal('content 状态块 ' + st.length);
    for (const s of st) {
      setPair(s.pos, 0, 0); setPair(s.size, CANVAS, CANVAS);
      if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) fatal('content 锚点/中心不是 0.5');
    }
    const cl = ensureChildListTop({ field: clone }, findChildListTop(parentRec.field.sub));
    setChildList(cl, []);
    setHiddenRec(clone, false);
    g.recHolder.push(clone);
    re.added.push({ name: '(content)', id: cid, parent: parentRec.id });
    return { field: clone, id: cid };
  };

  // 幂等/重建：若 plant 已有 content 就复用（清空后重填）；没有就建
  const resolveContent = (parentRec, proto) => {
    const kids = childIds(g, parentRec);
    const existing = kids.map((id) => recBy(g, id)).find((r) => r && r.name == null);
    if (existing) {
      const cl = ensureChildListTop({ field: existing.field }, findChildListTop(parentRec.field.sub));
      setChildList(cl, []);
      return { field: existing.field, id: existing.id, reused: true };
    }
    const c = mkContent(parentRec, proto);
    setOrAppendChildList(parentRec.field, [c.id]);
    return c;
  };
  if (childIds(g, src).length > 0 || childIds(g, mst).length > 0) re.existing = true;

  for (const [parentRec, proto, tag] of [[src, contentProtoS || contentProto, 'src'], [mst, contentProtoM || contentProto, 'mst']]) {
    const c = resolveContent(parentRec, proto);
    const ids = [];
    for (const L of layers) {
      const clone = cloneField(layerProto.field);
      const nid = alloc.take();
      const selfCnt = countVarintEqual(layerProto.field.sub, layerProto.id);
      const n = remapSelfIds(clone.sub, layerProto.id, nid);
      if (n !== selfCnt) fatal('层克隆：自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
      const rn = renameRecord(clone.sub, layerProto.name, LAYER_NAME(L.order));
      if (!rn.ok) fatal('层改名命中 ' + rn.hits + ' 处');
      const p504 = clone.sub.find((f) => f.field === 504 && f.wt === 0);
      if (!p504) fatal('层缺 #504');
      p504.num = BigInt(c.id);
      const st = stateSummary(clone);
      if (st.length !== 4) fatal('层状态块 ' + st.length);
      for (const s of st) {
        setPair(s.pos, L.dx, L.yUp); setPair(s.size, L.w, L.h);
        if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) fatal('层锚点/中心不是 0.5');
      }
      const img = imageTriple(clone);
      setImgLeaf(img.node, 502, L.color);
      setImgLeaf(img.node, 503, L.imageId);
      setImgLeaf(img.node, 504, IMG_TYPE_STRETCH);
      setHiddenRec(clone, false);
      g.recHolder.push(clone);
      ids.push(nid);
      re.added.push({ name: LAYER_NAME(L.order), id: nid, parent: c.id, tpl: 'furn.plant', copy: tag, layer: L.order });
    }
    const cl = ensureChildListTop({ field: c.field }, findChildListTop(parentRec.field.sub));
    setChildList(cl, ids);
    setOrAppendChildList(parentRec.field, [c.id]);
    re.targetRecs.push({ parent: parentRec.id, content: c.id, tag, layerIds: ids, reused: !!c.reused });
    console.log('  · furn.plant ' + tag + '：content #' + c.id + (c.reused ? '（复用）' : '（新建）') + ' → ' + ids.length + ' 层');
  }
  // diff：数组（新增 20 层；若 content 复用则不加 content）+ 源/母本两个 childlist
  re.expectDiffs = 1 + 2;
  return re;
}

// ── 断言 ─────────────────────────────────────────────────────────────────
function assertFill(g2, re, layers) {
  const bad = [];
  const src = recBy(g2, PLANT_SRC), mst = recBy(g2, PLANT_MST);
  if (!src || !mst) return '✗ 找不到 furn.plant 源/母本';
  for (const [nm, r] of [['源', src], ['母本', mst]]) {
    const kids = childIds(g2, r);
    if (kids.length !== 1) { bad.push(nm + ' content 数 ' + kids.length + '（预期 1）'); continue; }
    const c = recBy(g2, kids[0]);
    if (!c) { bad.push(nm + ' content 读不出'); continue; }
    const st = stateSummary(c.field);
    for (const x of st) if (Math.abs(x.w - CANVAS) > 0.02 || Math.abs(x.h - CANVAS) > 0.02) bad.push(nm + ' content 画布 ' + x.w + 'x' + x.h);
    const ids = childIds(g2, c);
    if (ids.length !== 10) bad.push(nm + ' content 层数 ' + ids.length + '（预期 10）');
    for (let i = 0; i < Math.min(ids.length, 10); i++) {
      const L = layers[i];
      const lr = recBy(g2, ids[i]);
      if (!lr) { bad.push(nm + ' 第 ' + (i + 1) + ' 层读不出'); continue; }
      if (lr.name !== LAYER_NAME(i + 1)) bad.push(nm + ' 第 ' + (i + 1) + ' 层名=' + lr.name + '（预期 ' + LAYER_NAME(i + 1) + '，顺序必须从下到上）');
      if (Number(lr.parentId) !== Number(c.id)) bad.push(nm + ' ' + LAYER_NAME(i + 1) + ' 父指针不符');
      const im = imageTriple(lr.field);
      if (im.id !== L.imageId) bad.push(nm + ' ' + LAYER_NAME(i + 1) + ' imageId=' + im.id + '（预期 ' + L.imageId + '）');
      if (im.color !== L.color) bad.push(nm + ' ' + LAYER_NAME(i + 1) + ' color=' + im.color + '（预期 ' + L.color + '）');
      if (im.type !== IMG_TYPE_STRETCH) bad.push(nm + ' ' + LAYER_NAME(i + 1) + ' type=' + im.type);
      const s = stateSummary(lr.field);
      for (const x of s) {
        if (Math.abs(x.x - L.dx) > 0.02 || Math.abs(x.y - L.yUp) > 0.02) bad.push(nm + ' ' + LAYER_NAME(i + 1) + ' 位置 (' + x.x + ',' + x.y + ')（预期 ' + L.dx + ',' + L.yUp + '）');
        if (Math.abs(x.w - L.w) > 0.02 || Math.abs(x.h - L.h) > 0.02) bad.push(nm + ' ' + LAYER_NAME(i + 1) + ' 尺寸 ' + x.w + 'x' + x.h + '（预期 ' + L.w + 'x' + L.h + '）');
      }
      if (isHiddenRec(lr.field)) bad.push(nm + ' ' + LAYER_NAME(i + 1) + ' 应为 visible=true');
    }
  }
  if (bad.length) return '✗ 填层断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 填层断言：furn.plant 源/母本两份 content 各 10 层（L01…L10，顺序/字段/可见性全对）');
  return true;
}

// ── 外部闸门 ─────────────────────────────────────────────────────────────
function runNode(tool, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, tool), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}
function runGates(outAbs, inAbs, cnt, re) {
  const results = [];
  const say = (s) => console.log(s);
  say('\n── ② probe_guid_collision.mjs ──');
  const probe = runNode('probe_guid_collision.mjs', [outAbs]);
  say(probe.stdout.trim());
  const probePass = probe.status === 0 && /① 真撞号（自身 GUID 重复）：\*\*0 处\*\*/.test(probe.stdout) && /✅ ② 自身 GUID 两处一致/.test(probe.stdout);
  results.push({ name: 'probe_guid_collision', pass: probePass });
  say('  ⇒ ' + (probePass ? '✅ 通过：① 真撞号 0，② 自身 GUID 两处一致' : '❌ 未通过'));

  say('\n── ③ roundtrip.mjs ──');
  const rt = runNode('roundtrip.mjs', [outAbs]);
  say(rt.stdout.trim());
  const rtPass = rt.status === 0 && /★★★ 往返成功/.test(rt.stdout);
  results.push({ name: 'roundtrip', pass: rtPass });
  say('  ⇒ ' + (rtPass ? '✅ 通过：逐字节一致' : '❌ 未通过'));

  say('\n── ④ diff_fields.mjs（516 → 517）──');
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]);
  say(df.stdout.trim());
  const m = /差异：(\d+) 处/.exec(df.stdout);
  const got = m ? Number(m[1]) : -1;
  const want = cnt.expectedDiffs;
  results.push({ name: 'diff_fields', pass: got === want && (want === 0 ? df.status === 0 : df.status === 3) });
  say('  ⇒ ' + (got === want ? '✅ 通过：差异 ' + got + ' 处（1 记录数组 + 2 个 plant 子列表）' : '❌ 未通过：差异 ' + got + '，预期 ' + want));

  say('\n── ⑤ 回读 ──');
  const g3 = readGil(outAbs);
  const src = recBy(g3, PLANT_SRC), mst = recBy(g3, PLANT_MST);
  for (const [nm, r] of [['源', src], ['母本', mst]]) {
    const kids = childIds(g3, r);
    const c = recBy(g3, kids[0]);
    say('  furn.plant ' + nm + ' #' + r.id + ' → content #' + c.id + '：' + childIds(g3, c).length + ' 层 [' + childIds(g3, c).map((id) => (recBy(g3, id) || {}).name).join(',') + ']');
  }
  say('  记录数：516 = ' + cnt.baseRecs + ' → 517 = ' + g3.recs.length + '（+' + (g3.recs.length - cnt.baseRecs) + '）');
  const ok = g3.recs.length === cnt.expectedRecs && (g3.recs.length - cnt.baseRecs) === cnt.added;
  results.push({ name: 'readback', pass: ok });
  say('  ⇒ ' + (ok ? '✅ 记录数/层数回读通过' : '❌ 不符（预期 ' + cnt.expectedRecs + '）'));
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────
function main() {
  if (!IN || !OUT) {
    console.error('用法: node tools/gil/gen_plant_fill.mjs --in=516-模板测试-v1.gil --out=517-模板测试-v2.gil [--dry] [--spec=…]');
    process.exit(1);
  }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到输入存档：' + inAbs, 1);
  console.log('══ gen_plant_fill —— 给 furn.plant 模板两份 content 各填 10 层 ──');
  const layers = loadSpec();
  console.log('  · 规格：furn.plant 10 层 / 108×108（规格 JSON 原样）');
  const g = readGil(inAbs);
  console.log('  输入 ' + basenameOf(inAbs) + '（' + fs.statSync(inAbs).size + ' 字节，' + g.recs.length + ' 条，maxId=' + g.maxId + '）');

  // 只读报告：用户 5 个模板的 content 情况
  console.log('\n── 只读报告：516 里用户 5 个模板的 content 情况 ──');
  for (const row of reportUserTemplates(g)) {
    console.log('  ' + row.nm.padEnd(13) + ' 源：' + row.src + '   ｜ 母本：' + row.mst);
  }

  const re = fill(g, layers);
  const contentAdded = re.added.filter((a) => a.layer == null).length;
  const added = re.added.length;
  const cnt = { baseRecs: g.recs.length, added, expectedRecs: g.recs.length + added, expectedDiffs: re.expectDiffs };
  console.log('\n  · 新增 ' + added + ' 条（' + contentAdded + ' 个 content + ' + (added - contentAdded) + ' 层）'); 
  console.log('  · 预期：记录 ' + cnt.baseRecs + ' → ' + cnt.expectedRecs + '；diff_fields = ' + cnt.expectedDiffs + ' 处（数组 + 源/母本子列表）');
  if (cnt.expectedRecs >= 1000) fatal('记录数 ' + cnt.expectedRecs + ' ≥ 1000，停下报数', 2);

  if (DRY) {
    const tmp = path.join(os.tmpdir(), 'gen_plant_dry_' + process.pid + '.gil');
    try {
      writeGil(g, tmp, { label: 'gen_plant_fill dry', expectRecs: cnt.expectedRecs, expectDiffs: cnt.expectedDiffs, assert: (g2) => assertFill(g2, re, layers) });
      console.log('\n[--dry] 可写；输出字节 ' + fs.statSync(tmp).size + '（输入 ' + g.src.length + '）');
    } finally { if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } } }
    return 0;
  }

  let tmp = null;
  try {
    if (re.idempotent) {
      // 幂等：已是目标状态 ⇒ 原样复制（writeGil 会拒绝"逐字节相同"的输出）
      fs.copyFileSync(inAbs, outAbs);
      console.log('  （幂等：无需改动，原样复制 → ' + basenameOf(outAbs) + '）');
      const results = runGates(outAbs, inAbs, cnt, re);
      console.log('\n  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
      return results.every((r) => r.pass) ? 0 : 4;
    }
    tmp = path.join(os.tmpdir(), 'gen_plant_' + process.pid + '_' + Date.now() + '.gil');
    const rep = writeGil(g, tmp, {
      label: 'gen_plant_fill furn.plant 10 层 ×2',
      expectRecs: cnt.expectedRecs,
      expectDiffs: cnt.expectedDiffs,
      assert: (g2) => assertFill(g2, re, layers),
    });
    fs.copyFileSync(tmp, outAbs);
    console.log('  写出 ' + basenameOf(outAbs) + '：' + rep.bytes + ' 字节 / ' + rep.recs + ' 条');
    const results = runGates(outAbs, inAbs, cnt, re);
    const allPass = results.every((r) => r.pass);
    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + fs.statSync(outAbs).size + ' 字节，记录 ' + cnt.expectedRecs + ' 条）');
    console.log('  furn.plant：源 #' + PLANT_SRC + ' / 母本 #' + PLANT_MST + '，两份 content 各 10 层');
    for (const t of re.targetRecs) console.log('    ' + t.tag + ' content #' + t.content + ' → ' + t.layerIds.length + ' 层');
    console.log('  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
    if (!allPass) { console.error('\n❌ 外部闸门未全过 —— 文件已写出但**不要导入**。'); return 4; }
    console.log('  ★ 全部通过。');
    return 0;
  } finally {
    if (tmp && fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

process.exit(main());
