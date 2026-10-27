// tools/gil/gen_furn_templates.mjs —— 家具「模板化手搭」：7 个客户端控件模板（源+母本，各带一份
//                                   多层内容拷贝）＋ 7 个模板引用控件 ＋ 隐藏容器 `fart.tpl`
//
// ════════════════════════════════════════════════════════════════════════════
// 背景（2026-10-22 第十二轮；用户定的方向）
// ════════════════════════════════════════════════════════════════════════════
//   用户：「采用模板来手搭构建，模板里放多少层都可以，就没有层数限制了，因为一个模板引用控件只算
//          一层，这还方便素材复用，然后像 cell 一样把模板创建出来就好了」
//   ⇒ 每件家具 = 1 个**客户端控件模板**（9~12 层图片控件），脚本用
//     `game.InstantiateClientUIControl(模板源 GUID, 锚点格的 content/furn)` 逐件实例化。
//
//   .gil 里的"客户端控件模板"是**两条记录 + 两份内容拷贝**（`cell.1.1` 实测）：
//     · 模板源：无父、组件 [1,2,4]：`#502[2]/#12`=族号、`#502[4]/#14`→母本 GUID；子控件 = content 容器
//     · 母本：父 = `ClientUIPrototypeHierarchyRoot #1073741844`、组件 [1,2,3]：`#502[3]/#13`→源；
//              **也带一份同构的 content 子树**（编辑器模板快照，必须一起写）
//     · content：容器节点（`#502[2]`=17），尺寸 = 模板画布（108×108 / 216×108 / 108×216），
//                子控件 = 层（图片控件），顺序 = 规格 `order`（从下到上）
//   ⇒ 一个模板的写入量：2（对）+ 2（content）+ 2×层数。
//
//   模板引用控件（可选兜底）：克隆 `tpl.stage`——槽 `/505(501=66,502=89)`，其中
//     `/505/503/77/#501` = 被引用模板源 GUID（tpl.stage 引的是 tpl-container#1073742330）。
//     脚本不读它也能实例化（cell 路径直接用模板源 GUID）；写它只为"编辑器可读/兜底候选"。
//
//   ★ 本工具**不**建 `fart.furn` 容器：lead 脚本把实例直接挂到锚点格的 `content/furn` 下。
//   ★ 7 个模板源 GUID 按 lead 表固定：1073746900/6902/…/6912（母本 = +1），扫档确认未占用。
//   ★ 记录量：500 + 1(容器 fart.tpl) + 14(源+母本) + 14(两份 content) + 142(71 层×2)
//            + 7(引用控件) = **678**（< 1000 ✓；lead 算的 677 少了 fart.tpl 这一条）。
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_furn_templates.mjs --in=502-一二关美术-容器-v3.gil \
//        --out=514-一二关美术-容器-v7.gil [--dry] [--guid-base=1073746900] \
//        [--spec=<家具模板层规格-v310.json>]
//   退出码：0 成功（含幂等"无需改动"）；1 用法错；2 数据/基线不符；3 断言/写入失败；4 外部闸门失败
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
const hasFlag = (k) => argv.includes('--' + k);

const IN = argOf('in');
const OUT = argOf('out');
const DRY = hasFlag('dry');
const GUID_BASE = Number(argOf('guid-base', '1073746900'));
const SPEC = argOf('spec', path.join(WORKSPACE, 'murdoku-project', '美术实现-一二关-2026-10-22', '家具模板层规格-v310.json'));

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const TEMPLATE_MASTER_PARENT = 1073741844;
const TPL_CONTAINER_NAME = 'fart.tpl';
const REF_PREFIX = 'tpl.furn.';
const LAYER_NAME = (i) => 'L' + String(i).padStart(2, '0');
const IMG_TYPE_STRETCH = 1;
// 7 个模板：名字（= 规格 JSON 的 key）、cfg key、模板画布（px）、源 GUID（lead 表）
const PLAN = [
  { spec: 'furn.chair', cfg: 'chair', family: 80, source: 1073746900, mother: 1073746901 },
  { spec: 'furn.plant', cfg: 'plant', family: 81, source: 1073746902, mother: 1073746903 },
  { spec: 'furn.statue', cfg: 'statue', family: 82, source: 1073746904, mother: 1073746905 },
  { spec: 'furn.table.1', cfg: 'table', family: 83, source: 1073746906, mother: 1073746907 },
  { spec: 'furn.table.h2', cfg: 'table_h2', family: 84, source: 1073746908, mother: 1073746909 },
  { spec: 'furn.table.v2', cfg: 'table_v2', family: 85, source: 1073746910, mother: 1073746911 },
  { spec: 'furn.shelf', cfg: 'shelf', family: 86, source: 1073746912, mother: 1073746913 },
];
const EXPECT_LAYERS = 71;

const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const hex32 = (v) => '0x' + (Number(v) >>> 0).toString(16).toUpperCase().padStart(8, '0');
const basenameOf = (p) => path.basename(p);

// ════════════════════════════════════════════════════════════════════════════
// 字段级 helper
// ════════════════════════════════════════════════════════════════════════════
function topVarint(fields, no) { const f = (fields || []).find((x) => x.field === no); return f && f.wt === 0 ? f : null; }
function compBlock(recField, compNo) {
  for (const f of (recField.sub || [])) {
    if (f.field !== 502 || !f.sub) continue;
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const b = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (a && b && Number(a.num) === compNo) return f;
  }
  return null;
}
function compRef(recField, compNo) {
  const blk = compBlock(recField, compNo);
  if (!blk) return null;
  for (const g of blk.sub) {
    if (![11, 12, 13, 14].includes(g.field) || !g.sub) continue;
    const v = g.sub.find((x) => x.field === 501);
    if (!v) return null;
    if (v.wt === 0) return { leaf: v, value: Number(v.num), kind: 'num' };
    const pay = v.payload || Buffer.alloc(0);
    let r = 0n, s = 0n, p = 0;
    while (p < pay.length) { const x = pay[p++]; r |= BigInt(x & 0x7f) << s; if ((x & 0x80) === 0) break; s += 7n; }
    return { leaf: v, value: p === pay.length ? Number(r) : null, kind: 'payload' };
  }
  return null;
}
function setCompRef(recField, compNo, newId) {
  const blk = compBlock(recField, compNo);
  if (!blk) fatal('找不到组件 #' + compNo);
  for (const g of blk.sub) {
    if (![11, 12, 13, 14].includes(g.field) || !g.sub) continue;
    const v = g.sub.find((x) => x.field === 501);
    if (!v) fatal('组件 #' + compNo + ' 找不到 #501');
    if (v.wt === 0) { v.num = BigInt(newId); return 'num'; }
    v.payload = writeVarint(newId); v.len = v.payload.length; v.isText = false; v.sub = null;
    return 'payload';
  }
  fatal('组件 #' + compNo + ' 找不到 #11/#12/#13/#14');
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
  if (nodes.length !== 1) throw new Error('图片节点命中 ' + nodes.length + ' 个（预期 1）');
  const n = nodes[0];
  const leaf = (no) => n.sub.find((f) => f.field === no && f.wt === 0) || null;
  return { node: n, id: leaf(503) ? Number(leaf(503).num) : null, color: leaf(502) ? Number(leaf(502).num) : null, type: leaf(504) ? Number(leaf(504).num) : null };
}
function setImgLeaf(node, no, value) {
  let f = node.sub.find((x) => x.field === no && x.wt === 0);
  if (!f) { f = { field: no, wt: 0, num: 0n }; node.sub.push(f); }
  f.num = BigInt(value >>> 0);
}
function imageMaskLeaves(recField) {
  const out = [];
  for (const n of imageNodes(recField)) for (const f of n.sub) if (f.wt === 0 && [508, 509, 510, 511, 512, 513, 514, 515, 516].includes(f.field)) out.push('#' + f.field);
  return out;
}
function stateSummary(recField) {
  return stateBlocks(recField.sub, []).map((b) => {
    const pos = pairOf(b, 504), size = pairOf(b, 505);
    return {
      block: b, pos, size,
      x: pairValue(pos, 0), y: pairValue(pos, 1), w: pairValue(size, 0), h: pairValue(size, 1),
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
/** 找 `/505(66/89)/503/77` 里的 `#501` 叶子（模板引用控件的"引用模板 id"） */
function refLeaf(recField) {
  const out = [];
  for (const f of recField.sub || []) {
    if (f.field !== 505 || !f.sub) continue;
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const b = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (!a || !b || Number(a.num) !== 66 || Number(b.num) !== 89) continue;
    const p503 = f.sub.find((x) => x.field === 503 && x.sub);
    const p77 = p503 && p503.sub.find((x) => x.field === 77 && x.sub);
    const leaf = p77 && p77.sub.find((x) => x.field === 501 && x.wt === 0);
    if (leaf) out.push(leaf);
  }
  return out;
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
function recBy(tree, id) { return tree.recs.find((r) => Number(r.id) === Number(id)) || null; }
function nameOf(tree, id) { const r = recBy(tree, id); return r ? r.name : '#' + id; }

// ════════════════════════════════════════════════════════════════════════════
// 规格 JSON
// ════════════════════════════════════════════════════════════════════════════
function loadSpec() {
  const file = path.isAbsolute(SPEC) ? SPEC : path.resolve(WORKSPACE, SPEC);
  if (!fs.existsSync(file)) fatal('找不到模板规格：' + file, 1);
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { fatal('规格 JSON 解析失败：' + e.message, 1); }
  const tpls = doc.templates;
  if (!tpls || typeof tpls !== 'object') fatal('规格缺 templates', 2);
  const got = Object.keys(tpls);
  const want = PLAN.map((p) => p.spec);
  if (got.length !== want.length || want.some((n) => !tpls[n])) fatal('规格模板名不符：' + JSON.stringify(got), 2);
  const out = [];
  let totalLayers = 0;
  for (const plan of PLAN) {
    const t = tpls[plan.spec];
    if (!Array.isArray(t.sizePx) || t.sizePx.length !== 2) fatal(plan.spec + ' sizePx 非 [w,h]', 2);
    const [cw, ch] = t.sizePx.map(Number);
    if (!(cw > 0 && ch > 0)) fatal(plan.spec + ' 画布尺寸非法', 2);
    if (!Array.isArray(t.layers) || !t.layers.length) fatal(plan.spec + ' 缺 layers', 2);
    if (Number(t.layerCount) !== t.layers.length) fatal(plan.spec + ' layerCount=' + t.layerCount + ' 与 layers=' + t.layers.length + ' 不符', 2);
    const layers = t.layers.map((l, i) => {
      const order = Number(l.order);
      if (order !== i + 1) fatal(plan.spec + ' 层 order 必须 1..N 连续（第 ' + (i + 1) + ' 条是 ' + l.order + '）', 2);
      const color = typeof l.color === 'string' ? Number(BigInt(l.color.replace(/^0X/i, '0x')) & 0xFFFFFFFFn) : Number(l.color) >>> 0;
      const w = Number(l.w), h = Number(l.h), dx = Number(l.dx), dyDown = Number(l.dy_down), yUp = Number(l.y_up);
      for (const [k, v] of Object.entries({ w, h, dx, dyDown, yUp })) if (!Number.isFinite(v)) fatal(plan.spec + ' 层字段 ' + k + ' 非有限数', 2);
      if (Math.abs(yUp + dyDown) > 1e-6) fatal(plan.spec + ' 层 ' + order + ' y_up ≠ -dy_down', 2);
      if (w <= 0 || h <= 0) fatal(plan.spec + ' 层 ' + order + ' 尺寸非正', 2);
      return { order, imageId: Number(l.imageId), color, w, h, dx, yUp };
    });
    totalLayers += layers.length;
    out.push({ ...plan, canvasW: cw, canvasH: ch, layers });
  }
  if (totalLayers !== EXPECT_LAYERS) fatal('总层数 ' + totalLayers + '（预期 ' + EXPECT_LAYERS + '）', 2);
  console.log('  · 规格 ' + basenameOf(file) + '：' + out.map((t) => t.spec + '=' + t.layers.length + '层/' + t.canvasW + 'x' + t.canvasH).join('，') + '；共 ' + totalLayers + ' 层');
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// 段①：隐藏容器 `fart.tpl`（root 下、labels 之后 home 之前）
// ════════════════════════════════════════════════════════════════════════════
function buildContainer(g, alloc) {
  const re = { added: [], skipped: [], rootChanged: false, id: null };
  const root = g.recs.find((r) => r.name === 'root');
  const labels = g.recs.find((r) => r.name === 'labels');
  const home = g.recs.find((r) => r.name === 'home');
  if (!root || !labels || !home) fatal('找不到 root/labels/home', 2);
  const rootCl = findChildListTop(root.field.sub);
  if (!rootCl) fatal('root 没有子控件列表', 2);
  const cur = (asIdList(rootCl.payload, true) || []).map(Number);
  const exists = g.recs.find((r) => r.name === TPL_CONTAINER_NAME);
  if (exists) {
    re.id = exists.id; re.skipped.push(TPL_CONTAINER_NAME + '#' + exists.id);
  } else {
    const clone = cloneField(labels.field);
    re.id = alloc.take();
    const selfCnt = countVarintEqual(labels.field.sub, labels.id);
    const n = remapSelfIds(clone.sub, labels.id, re.id);
    if (n !== selfCnt) fatal('fart.tpl 克隆：自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
    const rn = renameRecord(clone.sub, 'labels', TPL_CONTAINER_NAME);
    if (!rn.ok) fatal('fart.tpl 克隆：改名命中 ' + rn.hits + ' 处');
    const p504 = topVarint(clone.sub, 504);
    if (!p504) fatal('fart.tpl 克隆：顶层无 #504');
    p504.num = BigInt(root.id);
    const st = stateSummary(clone);
    if (st.length !== 4) fatal('fart.tpl 状态块 ' + st.length + ' 个（预期 4）');
    for (const s of st) {
      setPair(s.pos, 0, 0); setPair(s.size, 1600, 900);
      if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) fatal('fart.tpl 锚点/中心不是 0.5');
    }
    const ccl = findChildListTop(clone.sub);
    if (ccl) setChildList(ccl, []);
    if (imageNodes(clone).length) fatal('fart.tpl 不应有图片槽');
    if (imageMaskLeaves(clone).length) fatal('fart.tpl 不应带遮罩字段');
    setHiddenRec(clone, true);
    g.recHolder.push(clone);
    re.added.push({ name: TPL_CONTAINER_NAME, id: re.id, parent: root.id });
  }
  // root 子列表：labels 之后插入（fart.tpl 隐藏，位置只影响遍历顺序）
  const kept = cur.filter((id) => id !== re.id);
  const li = kept.indexOf(Number(labels.id));
  const hi = kept.indexOf(Number(home.id));
  if (li < 0 || hi < 0) fatal('root 子列表里找不到 labels/home', 2);
  const next = [...kept.slice(0, li + 1), re.id, ...kept.slice(li + 1)];
  if (next.join(',') !== cur.join(',')) { setChildList(rootCl, next); re.rootChanged = true; }
  re.expectedRecs = g.recs.length + re.added.length;
  re.expectedDiffs = (re.added.length ? 1 : 0) + (re.rootChanged ? 1 : 0);
  return re;
}
function assertContainer(g2, re) {
  const bad = [];
  const r = recBy(g2, re.id);
  if (!r) return '✗ 重读后找不到 ' + TPL_CONTAINER_NAME;
  const root = recBy(g2, 1073741846) || g2.recs.find((x) => x.name === 'root');
  const rootCl = root && findChildListTop(root.field.sub);
  const names = rootCl ? (asIdList(rootCl.payload, true) || []).map((id) => nameOf(g2, id)) : [];
  const li = names.indexOf('labels');
  if (names[li + 1] !== TPL_CONTAINER_NAME) bad.push('root 顺序 labels 之后 = ' + names[li + 1] + '（预期 fart.tpl）');
  if (Number(r.parentId) !== Number(root.id)) bad.push('fart.tpl 父=' + r.parentId);
  const st = stateSummary(r.field);
  for (const s of st) {
    if (s.w !== 1600 || s.h !== 900) bad.push('fart.tpl 尺寸 ' + s.w + 'x' + s.h);
    if (Math.abs(s.x) > 0.02 || Math.abs(s.y) > 0.02) bad.push('fart.tpl 位置 ' + s.x + ',' + s.y);
    if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) bad.push('fart.tpl 锚点/中心不是 0.5');
  }
  if (imageNodes(r.field).length) bad.push('fart.tpl 不应有图片槽');
  if (!isHiddenRec(r.field)) bad.push('fart.tpl 可见性应为 false');
  if (g2.recs.length !== re.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re.expectedRecs + '）');
  if (bad.length) return '✗ 容器断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 容器断言：root 顺序 labels → fart.tpl → …；1600×900 @(0,0)/锚点0.5/visible=false/无图片槽/无遮罩');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 段②：7 对模板（源+母本）+ 14 个 content
// ════════════════════════════════════════════════════════════════════════════
function buildPairs(g, alloc, tpls) {
  const srcProto = g.recs.find((r) => r.name === 'cell.1.1' && r.parentId == null);
  const mstProto = g.recs.find((r) => r.name === 'cell.1.1' && Number(r.parentId) === TEMPLATE_MASTER_PARENT);
  if (!srcProto || !mstProto) fatal('找不到 cell.1.1 模板对原型', 2);
  const contentProto = g.recs.find((r) => r.name === 'content' && Number(r.parentId) === Number(srcProto.id));
  const contentMstProto = g.recs.find((r) => r.name === 'content' && Number(r.parentId) === Number(mstProto.id));
  if (!contentProto || !contentMstProto) fatal('找不到模板 content 原型', 2);
  console.log('  · 原型：' + srcProto.name + '#' + srcProto.id + '（无父）↔ 母本 #' + mstProto.id
    + '；content #' + contentProto.id + ' / #' + contentMstProto.id);

  const re = { added: [], skipped: [], containerId: null, tpl: [] };
  const mk = (proto, id, parentId, newName, geom, extra) => {
    const clone = cloneField(proto.field);
    const selfCnt = countVarintEqual(proto.field.sub, proto.id);
    const n = remapSelfIds(clone.sub, proto.id, id);
    if (n !== selfCnt) fatal(TPL_CONTAINER_NAME + ' 克隆：自身 GUID 替换 ' + n + '/' + selfCnt + ' 处（' + newName + '）');
    const rn = renameRecord(clone.sub, proto.name, newName);
    if (!rn.ok) fatal(newName + ' 改名命中 ' + rn.hits + ' 处');
    const p504 = topVarint(clone.sub, 504);
    if (parentId == null) { if (p504) fatal(newName + ' 应无父但带 #504'); }
    else { if (!p504) fatal(newName + ' 缺 #504'); p504.num = BigInt(parentId); }
    const st = stateSummary(clone);
    if (st.length !== 4) fatal(newName + ' 状态块 ' + st.length + ' 个（预期 4）');
    for (const s of st) {
      setPair(s.pos, geom.x, geom.y); setPair(s.size, geom.w, geom.h);
      if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) fatal(newName + ' 锚点/中心不是 0.5');
    }
    if (extra) extra(clone);
    g.recHolder.push(clone);
    return clone;
  };

  for (const t of tpls) {
    const existS = g.recs.find((r) => r.name === t.spec && r.parentId == null);
    const existM = g.recs.find((r) => r.name === t.spec && Number(r.parentId) === TEMPLATE_MASTER_PARENT);
    if (existS && existM) {
      // 幂等：已存在的一对——从档里取回两份 content 的记录/字段引用，供后续层阶段使用
      re.skipped.push(t.spec);
      const sCl = findChildListTop(existS.field.sub);
      const mCl = findChildListTop(existM.field.sub);
      const sKids = sCl ? (asIdList(sCl.payload, true) || []).map(Number) : [];
      const mKids = mCl ? (asIdList(mCl.payload, true) || []).map(Number) : [];
      const sContent = sKids.length === 1 ? recBy(g, sKids[0]) : null;
      const mContent = mKids.length === 1 ? recBy(g, mKids[0]) : null;
      if (!sContent || !mContent) fatal(t.spec + ' 已存在但 content 缺失', 2);
      re.tpl.push({
        ...t, sourceId: existS.id, motherId: existM.id,
        contentSourceId: sContent.id, contentMotherId: mContent.id,
        contentSourceField: sContent.field, contentMotherField: mContent.field,
      });
      continue;
    }
    re.newPairCount = (re.newPairCount || 0) + 1;
    if (existS || existM) fatal(t.spec + ' 只存在一半（源/母本）', 2);
    // 源
    const srcField = mk(srcProto, t.source, null, t.spec, { x: 0, y: 0, w: t.canvasW, h: t.canvasH }, (f) => {
      const ccl = findChildListTop(f.sub);
      if (!ccl) fatal(t.spec + ' 源缺子列表');
      const cid = alloc.take();
      setCompRef(f, 2, t.family);
      setCompRef(f, 4, t.mother);
      f.__contentId = cid;   // 临时记账（clone 后挂在对象上）
    });
    // 母本
    const mstField = mk(mstProto, t.mother, TEMPLATE_MASTER_PARENT, t.spec, { x: 0, y: 0, w: t.canvasW, h: t.canvasH }, (f) => {
      const cid = alloc.take();
      setCompRef(f, 2, t.family);
      setCompRef(f, 3, t.source);
      f.__contentId = cid;
    });
    // 两份 content
    for (const [parentField, parentId, proto, key] of [
      [srcField, t.source, contentProto, 'source'],
      [mstField, t.mother, contentMstProto, 'mother'],
    ]) {
      const cf = cloneField(proto.field);
      const cid = parentField.__contentId;
      const selfCnt = countVarintEqual(proto.field.sub, proto.id);
      const n = remapSelfIds(cf.sub, proto.id, cid);
      if (n !== selfCnt) fatal(t.spec + '/' + key + ' content 自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
      const rn = renameRecord(cf.sub, 'content', 'content');
      if (!rn.ok) fatal(t.spec + '/' + key + ' content 改名命中 ' + rn.hits + ' 处');
      const p504 = topVarint(cf.sub, 504);
      if (!p504) fatal('content 缺 #504');
      p504.num = BigInt(parentId);
      const st = stateSummary(cf);
      if (st.length !== 4) fatal('content 状态块 ' + st.length);
      for (const s of st) {
        setPair(s.pos, 0, 0); setPair(s.size, t.canvasW, t.canvasH);
        if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) fatal('content 锚点/中心不是 0.5');
      }
      const ccl = findChildListTop(cf.sub);
      if (ccl) setChildList(ccl, []);
      setHiddenRec(cf, false);
      g.recHolder.push(cf);
      const pcl = findChildListTop(parentField.sub);
      if (pcl) setChildList(pcl, [cid]);
      parentField[key === 'source' ? '__contentField' : '__contentFieldM'] = cf;
      re.added.push({ name: t.spec + ' content(' + key + ')', id: cid, parent: parentId });
    }
    re.tpl.push({
      ...t, sourceId: t.source, motherId: t.mother,
      sourceField: srcField, motherField: mstField,
      contentSourceId: srcField.__contentId, contentMotherId: mstField.__contentId,
      contentSourceField: srcField.__contentField, contentMotherField: mstField.__contentFieldM,
    });
  }
  re.expectedRecs = g.recs.length + re.added.length + tpls.length * 2;
  re.expectedDiffs = (re.added.length + tpls.length * 2 > 0) ? 1 : 0;
  return re;
}
function assertPairs(g2, re, tpls) {
  const bad = [];
  for (const t of re.tpl) {
    const s = recBy(g2, t.sourceId), m = recBy(g2, t.motherId);
    if (!s || !m) { bad.push(t.spec + ' 缺源或母本'); continue; }
    if (s.parentId != null) bad.push(t.spec + ' 源有父=' + s.parentId);
    if (Number(m.parentId) !== TEMPLATE_MASTER_PARENT) bad.push(t.spec + ' 母本父=' + m.parentId);
    if (s.name !== t.spec) bad.push(t.spec + ' 源名=' + s.name);
    if (m.name !== t.spec) bad.push(t.spec + ' 母本名=' + m.name);
    const sRef = compRef(s.field, 4), mRef = compRef(m.field, 3);
    if (!sRef || sRef.value !== Number(t.motherId)) bad.push(t.spec + ' 源 #14=' + (sRef && sRef.value) + '（预期 ' + t.motherId + '）');
    if (!mRef || mRef.value !== Number(t.sourceId)) bad.push(t.spec + ' 母本 #13=' + (mRef && mRef.value) + '（预期 ' + t.sourceId + '）');
    for (const [nm, r] of [['源', s], ['母本', m]]) {
      const fam = compRef(r.field, 2);
      if (!fam || fam.value !== t.family) bad.push(t.spec + ' ' + nm + ' 族号=' + (fam && fam.value) + '（预期 ' + t.family + '）');
      const st = stateSummary(r.field);
      for (const x of st) {
        if (x.w !== t.canvasW || x.h !== t.canvasH) bad.push(t.spec + ' ' + nm + ' 画布 ' + x.w + 'x' + x.h + '（预期 ' + t.canvasW + 'x' + t.canvasH + '）');
        if (x.aMinX !== 0.5 || x.aMaxX !== 0.5 || x.pivX !== 0.5) bad.push(t.spec + ' ' + nm + ' 锚点/中心不是 0.5');
      }
      const cl = findChildListTop(r.field.sub);
      const kids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
      if (kids.length !== 1) bad.push(t.spec + ' ' + nm + ' 子控件 ' + kids.length + ' 个（预期 1 个 content）');
      else {
        const c = recBy(g2, kids[0]);
        if (!c || c.name !== 'content') bad.push(t.spec + ' ' + nm + ' 子控件不是 content');
        if (c && Number(c.parentId) !== Number(r.id)) bad.push(t.spec + ' ' + nm + ' content 父指针不符');
        if (c) {
          const cst = stateSummary(c.field);
          for (const x of cst) if (x.w !== t.canvasW || x.h !== t.canvasH) bad.push(t.spec + ' ' + nm + ' content 尺寸 ' + x.w + 'x' + x.h);
        }
      }
    }
  }
  if (g2.recs.length !== re.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re.expectedRecs + '）');
  const fams = re.tpl.map((t) => t.family);
  if (new Set(fams).size !== fams.length) bad.push('模板族号重复');
  const allFams = new Set();
  for (const r of g2.recs) { const f = compRef(r.field, 2); if (f && f.value != null) allFams.add(f.value); }
  // 原有族与新增族不能撞（除本工具自己的 80~86）
  for (const t of re.tpl) if (tpls.filter((x) => x.family === t.family).length > 1) bad.push('族号 ' + t.family + ' 重复');
  if (bad.length) return '✗ 模板对断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 模板对断言：7 对（源无父/母本挂 1073741844、#14↔#13 双向闭合、族号 80~86、画布尺寸对、两份 content 齐全）');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 段③：142 层（71×2 份拷贝）
// ════════════════════════════════════════════════════════════════════════════
function buildLayers(g, alloc, re, tpls) {
  const layerProto = g.recs.find((r) => r.name === 'obj' && Number(r.parentId) === Number(g.recs.find((x) => x.name === 'content' && Number(x.parentId) === Number(g.recs.find((y) => y.name === 'cell.1.1' && y.parentId == null).id)).id));
  const fallback = g.recs.find((r) => r.name === 'obj.table');
  const proto = layerProto || fallback;
  if (!proto) fatal('找不到层图片控件原型（obj / obj.table）', 2);
  const protoImg = imageTriple(proto.field);
  console.log('  · 层原型 ' + proto.name + '#' + proto.id + '（imageId=' + protoImg.id + ' color=' + hex32(protoImg.color)
    + ' type=' + protoImg.type + '，' + (isHiddenRec(proto.field) ? '隐藏' : '可见') + '）');
  const re2 = { added: [], skipped: [], expectDiffs: 0 };
  for (const t of re.tpl) {
    for (const [containerId, tag] of [[t.contentSourceId, 'src'], [t.contentMotherId, 'mst']]) {
      // ★ 必须用**本段树**（g）里的 content 字段：段② 写盘后重读的是新树，旧引用改不到它
      const container = recBy(g, containerId) || null;
      const cf = container ? container.field : (tag === 'src' ? t.contentSourceField : t.contentMotherField);
      if (!cf) fatal(t.spec + ' content 字段引用丢失');
      const cl = findChildListTop(cf.sub);
      if (!cl) fatal(t.spec + ' content 缺子列表');
      const cur = (asIdList(cl.payload, true) || []).map(Number);
      const ids = [];
      for (let i = 0; i < t.layers.length; i++) {
        const L = t.layers[i];
        const name = LAYER_NAME(i + 1);
        const exists = cur.find((id) => (g.recs.find((r) => Number(r.id) === Number(id)) || {}).name === name);
        if (container && exists) { ids.push(exists); re2.skipped.push(t.spec + '/' + tag + '/' + name); continue; }
        const clone = cloneField(proto.field);
        const nid = alloc.take();
        const selfCnt = countVarintEqual(proto.field.sub, proto.id);
        const n = remapSelfIds(clone.sub, proto.id, nid);
        if (n !== selfCnt) fatal(t.spec + '/' + tag + '/' + name + ' 自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
        const rn = renameRecord(clone.sub, proto.name, name);
        if (!rn.ok) fatal(t.spec + '/' + tag + '/' + name + ' 改名命中 ' + rn.hits + ' 处');
        const p504 = topVarint(clone.sub, 504);
        if (!p504) fatal('层缺 #504');
        p504.num = BigInt(containerId);
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
        re2.added.push({ name, id: nid, parent: containerId, tpl: t.spec, copy: tag, layer: i + 1 });
      }
      const kept = cur.filter((id) => !ids.includes(id));
      const next = [...kept, ...ids];
      if (next.join(',') !== cur.join(',')) setChildList(cl, next);
    }
  }
  re2.expectedRecs = g.recs.length + re2.added.length;
  re2.expectedDiffs = (re2.added.length ? 1 : 0) + (re2.added.length ? 14 : 0);   // 14 个 content 子列表
  return re2;
}
function assertLayers(g2, re, re2) {
  const bad = [];
  let total = 0;
  for (const t of re.tpl) {
    for (const [containerId, tag] of [[t.contentSourceId, 'src'], [t.contentMotherId, 'mst']]) {
      const c = recBy(g2, containerId);
      if (!c) { bad.push(t.spec + '/' + tag + ' 找不到 content'); continue; }
      const cl = findChildListTop(c.field.sub);
      const ids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
      if (ids.length !== t.layers.length) bad.push(t.spec + '/' + tag + ' 层数 ' + ids.length + '（预期 ' + t.layers.length + '）');
      for (let i = 0; i < t.layers.length; i++) {
        const L = t.layers[i];
        const name = LAYER_NAME(i + 1);
        const r = recBy(g2, ids[i]);
        if (!r) { bad.push(t.spec + '/' + tag + '/' + name + ' 缺记录'); continue; }
        total++;
        if (r.name !== name) bad.push(t.spec + '/' + tag + ' 第 ' + (i + 1) + ' 层名=' + r.name + '（预期 ' + name + '，顺序必须从下到上）');
        const img = imageTriple(r.field);
        if (img.id !== L.imageId) bad.push(name + ' imageId=' + img.id + '（预期 ' + L.imageId + '）');
        if (img.color !== L.color) bad.push(name + ' imageColor=' + hex32(img.color) + '（预期 ' + hex32(L.color) + '）');
        if (img.type !== IMG_TYPE_STRETCH) bad.push(name + ' imageType=' + img.type);
        const st = stateSummary(r.field);
        for (const x of st) {
          if (Math.abs(x.x - L.dx) > 0.02 || Math.abs(x.y - L.yUp) > 0.02) bad.push(name + ' 位置 (' + x.x + ',' + x.y + ')（预期 ' + L.dx + ',' + L.yUp + '）');
          if (Math.abs(x.w - L.w) > 0.02 || Math.abs(x.h - L.h) > 0.02) bad.push(name + ' 尺寸 ' + x.w + 'x' + x.h + '（预期 ' + L.w + 'x' + L.h + '）');
        }
        if (isHiddenRec(r.field)) bad.push(name + ' 层应为 visible=true');
      }
    }
  }
  if (g2.recs.length !== re2.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re2.expectedRecs + '）');
  if (total !== 142) bad.push('层记录总数 ' + total + '（预期 142 = 71×2）');
  if (bad.length) return '✗ 层断言失败：\n  ' + bad.slice(0, 20).join('\n  ') + (bad.length > 20 ? '\n  …共 ' + bad.length + ' 条' : '');
  console.log('  ✅ 层断言：142 层（71×2）全部回读一致，顺序=规格 order（从下到上），imageId/色/尺寸/位置/visible 全对');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 段④：7 个模板引用控件 `tpl.furn.*`（父 fart.tpl）
// ════════════════════════════════════════════════════════════════════════════
function buildRefs(g, alloc, re, containerId) {
  const proto = g.recs.find((r) => r.name === 'tpl.stage' && refLeaf(r.field).length === 1);
  if (!proto) fatal('找不到模板引用控件原型 tpl.stage（带 /505 66/89 + 77 引用）', 2);
  console.log('  · 引用控件原型 tpl.stage#' + proto.id + ' → 引用 ' + refLeaf(proto.field)[0].num + '（tpl-container）');
  const re3 = { added: [], skipped: [], expectDiffs: 0, ids: [] };
  for (const t of re.tpl) {
    const name = REF_PREFIX + t.cfg;
    const exists = g.recs.find((r) => r.name === name);
    if (exists) { re3.skipped.push(name + '#' + exists.id); re3.ids.push(exists.id); continue; }
    const clone = cloneField(proto.field);
    const nid = alloc.take();
    const selfCnt = countVarintEqual(proto.field.sub, proto.id);
    const n = remapSelfIds(clone.sub, proto.id, nid);
    if (n !== selfCnt) fatal(name + ' 自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
    const rn = renameRecord(clone.sub, 'tpl.stage', name);
    if (!rn.ok) fatal(name + ' 改名命中 ' + rn.hits + ' 处');
    const p504 = topVarint(clone.sub, 504);
    if (!p504) fatal(name + ' 缺 #504');
    p504.num = BigInt(containerId);
    const st = stateSummary(clone);
    for (const s of st) { setPair(s.pos, 0, 200000); setPair(s.size, 1, 1); }
    const leaves = refLeaf(clone);
    if (leaves.length !== 1) fatal(name + ' 引用叶子 ' + leaves.length + ' 个（预期 1）');
    leaves[0].num = BigInt(t.sourceId);
    setHiddenRec(clone, true);
    g.recHolder.push(clone);
    re3.added.push({ name, id: nid, parent: containerId, ref: t.sourceId });
    re3.ids.push(nid);
  }
  // fart.tpl 子列表
  const c = recBy(g, containerId) || null;
  const cfield = c ? c.field : (g.recHolder.find((f) => f.sub && Number((f.sub.find((x) => x.field === 501 && x.wt === 0) || {}).num) === Number(containerId)) || null);
  if (!cfield) fatal('找不到 fart.tpl 记录字段');
  const cl = findChildListTop(cfield.sub);
  if (!cl) fatal('fart.tpl 无子列表');
  const cur = (asIdList(cl.payload, true) || []).map(Number);
  const kept = cur.filter((id) => !re3.ids.includes(id));
  const next = [...kept, ...re3.ids];
  const changed = next.join(',') !== cur.join(',');
  if (changed) setChildList(cl, next);
  re3.expectedRecs = g.recs.length + re3.added.length;
  re3.expectedDiffs = (re3.added.length ? 1 : 0) + (changed ? 1 : 0);   // 数组 + fart.tpl 子列表
  return re3;
}
function assertRefs(g2, re3, re) {
  const bad = [];
  const c = recBy(g2, re3.added.length ? re3.added[0].parent : (re3.ids.length ? (g2.recs.find((r) => r.name === REF_PREFIX + re.tpl[0].cfg) || {}).parentId : null));
  if (!c) return '✗ 找不到 fart.tpl（重读）';
  const cl = findChildListTop(c.field.sub);
  const ids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
  if (ids.length !== 7) bad.push('fart.tpl 子控件 ' + ids.length + '（预期 7）');
  for (const t of re.tpl) {
    const name = REF_PREFIX + t.cfg;
    const r = g2.recs.find((x) => x.name === name);
    if (!r) { bad.push('缺 ' + name); continue; }
    const leaves = refLeaf(r.field);
    if (leaves.length !== 1) bad.push(name + ' 引用叶子 ' + leaves.length + ' 个');
    else if (Number(leaves[0].num) !== Number(t.sourceId)) bad.push(name + ' 引用 ' + leaves[0].num + '（预期 ' + t.sourceId + '）');
    if (Number(r.parentId) !== Number(c.id)) bad.push(name + ' 父=' + r.parentId + '（预期 fart.tpl#' + c.id + '）');
    if (!isHiddenRec(r.field)) bad.push(name + ' 可见性应为 false');
    if (!ids.includes(Number(r.id))) bad.push(name + ' 不在 fart.tpl 子列表');
  }
  if (g2.recs.length !== re3.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re3.expectedRecs + '）');
  if (bad.length) return '✗ 引用控件断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 引用控件断言：7 个 tpl.furn.* 父=fart.tpl、引用值=对应模板源 GUID、隐藏、在子列表中');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 外部闸门
// ════════════════════════════════════════════════════════════════════════════
function runNode(tool, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, tool), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}
function runExternalGates(outAbs, inAbs, total) {
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

  say('\n── ④ diff_fields.mjs（基线 vs 输出）──');
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]);
  say(df.stdout.trim());
  const m = /差异：(\d+) 处/.exec(df.stdout);
  const got = m ? Number(m[1]) : -1;
  const want = (total.added ? 1 : 0) + (total.rootChanged ? 1 : 0);
  const recA = /记录数：A (\d+) → B (\d+)/.exec(df.stdout);
  const recOk = recA ? Number(recA[2]) === total.finalRecs : total.added === 0;
  const dfPass = got === want && recOk && (want === 0 ? df.status === 0 : df.status === 3);
  results.push({ name: 'diff_fields', pass: dfPass });
  say('  ⇒ ' + (dfPass ? '✅ 通过：差异 ' + got + ' 处 = 1 记录数组条数 + ' + (total.rootChanged ? 1 : 0) + ' root 子列表（新建容器内部不算）'
    : '❌ 未通过：差异 ' + got + '，预期 ' + want));

  say('\n── ⑤ probe_ui_registry.mjs（模板登记关系）──');
  const reg = runNode('probe_ui_registry.mjs', [outAbs]);
  const tail = reg.stdout.split('\n').filter((l) => /^③|^⑤|^★ 结论/.test(l.trim())).join('\n');
  say(tail);
  const regPass = reg.status === 0 && /悬空 0/.test(reg.stdout) && /★ 结论：登记关系自洽/.test(reg.stdout);
  results.push({ name: 'probe_ui_registry', pass: regPass });
  say('  ⇒ ' + (regPass ? '✅ 通过：母本链闭合（悬空 0）、登记关系自洽' : '❌ 未通过'));

  say('\n── ⑥ list_names ──');
  const names = ['furn.', REF_PREFIX, 'fart.tpl'];
  let lnPass = true;
  for (const nm of names) {
    const ln = runNode('list_names.mjs', [outAbs, nm]);
    const cnt = (ln.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
    say('  ' + nm + ' 命中 ' + cnt + ' 个');
    if (nm === 'furn.') { if (cnt !== 21) lnPass = false; }   // 14 模板同名对 + 7 个 tpl.furn.* 也含子串 'furn.'
    else if (nm === REF_PREFIX) { if (cnt !== 7) lnPass = false; }
    else { if (cnt !== 1) lnPass = false; }
  }
  results.push({ name: 'list_names', pass: lnPass });
  say('  ⇒ ' + (lnPass ? '✅ 通过：furn.=21（14 模板同名对 + 7 个 tpl.furn.* 子串命中）、tpl.furn.=7、fart.tpl=1' : '❌ 未通过'));
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
function main() {
  if (!IN || !OUT) {
    console.error('用法: node tools/gil/gen_furn_templates.mjs --in=<存档.gil> --out=<输出.gil> [--dry] [--spec=…] [--guid-base=1073746900]');
    process.exit(1);
  }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到输入存档：' + inAbs, 1);
  console.log('══ gen_furn_templates —— 7 个客户端控件模板（源+母本+两份多层 content）+ 7 个模板引用控件 ══');
  const tpls = loadSpec();
  const g = readGil(inAbs);
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.src.length + ' 字节，记录 ' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  console.log('  输出 ' + basenameOf(outAbs) + '（' + (DRY ? '--dry 只预测不写' : '写') + '）');

  const { used, maxGuid } = scanGuidUsage(g.tree);
  // 固定分配 7 个模板源/母本 GUID（lead 表：6900/6902/…/6912 源，+1 母本）
  // ★ 幂等：若该 GUID 已被"本工具自己的模板对"占用（源=同名无父 / 母本=同名挂 1073741844），放行。
  let idemPairs = 0;
  for (const t of tpls) {
    for (const [id, role] of [[t.source, 'source'], [t.mother, 'mother']]) {
      if (id < ID_LO_NUM || id >= ID_HI_NUM) fatal('GUID ' + id + ' 越界', 1);
      if (!used.has(id)) continue;
      const r = recBy(g, id);
      const okSource = role === 'source' && r && r.name === t.spec && r.parentId == null;
      const okMother = role === 'mother' && r && r.name === t.spec && Number(r.parentId) === TEMPLATE_MASTER_PARENT;
      if (okSource || okMother) { idemPairs++; continue; }
      fatal('GUID ' + id + ' 已被本档占用（换 --guid-base 或调整 PLAN）', 2);
    }
  }
  if (idemPairs > 0) console.log('  · 幂等：' + idemPairs + ' 个模板源/母本 GUID 已是本工具输出，将跳过重建');
  let nextId = Math.max(GUID_BASE + 14, maxGuid + 1, GUID_BASE);
  const alloc = {
    base: nextId, ids: [],
    take() { while (used.has(nextId)) nextId++; if (nextId >= ID_HI_NUM) fatal('GUID 号段耗尽'); const v = nextId++; used.add(v); alloc.ids.push(v); return v; },
  };
  // 预留模板源/母本
  const reserve = (id) => { used.add(id); };
  for (const t of tpls) { reserve(t.source); reserve(t.mother); }
  console.log('  · GUID：模板源 ' + tpls.map((t) => t.source).join('/') + '；母本 ' + tpls.map((t) => t.mother).join('/')
    + '；其余从 ' + nextId + ' 起（扫档 maxGuid=' + maxGuid + '）');

  const PLANNED = 1 + 14 + 14 + 142 + 7;
  const expectFinal = idemPairs === 14 ? g.recs.length : g.recs.length + PLANNED;
  console.log('  · 记录预算：' + g.recs.length + (idemPairs === 14 ? '（已含 7 对模板，幂等复跑不加记录）' :
    ' + 1（fart.tpl）+ 14（源+母本）+ 14（两份 content）+ 142（71 层×2）+ 7（引用控件）') + ' = '
    + expectFinal + (expectFinal < 1000 ? '（< 1000 ✓）' : '（≥ 1000 ✗ 停下报数）'));
  if (expectFinal >= 1000) fatal('记录数 ' + expectFinal + ' ≥ 1000，按 lead 要求停下报数', 2);

  let tmp1 = null, tmp2 = null, tmp3 = null, tmp4 = null;
  try {
    // 段① 容器
    console.log('\n── ① 隐藏容器 fart.tpl（root：labels 之后、home 之前；1600×900 @(0,0)；visible=false）──');
    const reA = buildContainer(g, alloc);
    console.log('  新增容器 ' + reA.added.length + ' 条：' + reA.added.map((a) => a.name + '#' + a.id).join(', '));
    console.log('  记录数：' + g.recs.length + ' → ' + reA.expectedRecs + '；预计差异 ' + reA.expectedDiffs + ' 处（数组 + root 子列表）');
    let mid = inAbs;
    if (reA.added.length && !DRY) {
      tmp1 = path.join(os.tmpdir(), 'gen_tpl_A_' + process.pid + '_' + Date.now() + '.gil');
      writeGil(g, tmp1, { label: 'gen_furn_templates ① fart.tpl 容器', expectRecs: reA.expectedRecs, expectDiffs: reA.expectedDiffs, assert: (g2) => assertContainer(g2, reA) });
      mid = tmp1;
    }

    // 段② 模板对
    console.log('\n── ② 7 对模板（源+母本）＋ 14 个 content（108/216 画布）──');
    const gB = DRY ? g : readGil(mid);
    const baseRecs = g.recs.length;
    const reB = buildPairs(gB, alloc, tpls);
    const newPairRecs = (reB.newPairCount || 0) * 2;   // 每对 = 源+母本
    reB.expectedRecs = baseRecs + reA.added.length + newPairRecs + reB.added.length;
    reB.expectedDiffs = (newPairRecs + reB.added.length) ? 1 : 0;
    console.log('  新增 ' + (newPairRecs + reB.added.length) + ' 条（' + (reB.newPairCount || 0) + ' 源 + ' + (reB.newPairCount || 0) + ' 母本 + ' + reB.added.length + ' content）');
    if (reB.skipped.length) console.log('  （已存在、跳过 ' + reB.skipped.length + ' 对）');
    let mid2 = mid;
    if (!DRY && (newPairRecs + reB.added.length) > 0) {
      tmp2 = path.join(os.tmpdir(), 'gen_tpl_B_' + process.pid + '_' + Date.now() + '.gil');
      writeGil(gB, tmp2, { label: 'gen_furn_templates ② 7 对模板 + 14 content', expectRecs: reB.expectedRecs, expectDiffs: reB.expectedDiffs, assert: (g2) => assertPairs(g2, reB, tpls) });
      mid2 = tmp2;
    }

    // 段③ 层
    console.log('\n── ③ 142 层（71 层 × 源/母本两份拷贝；顺序 = 规格 order）──');
    const gC = DRY ? gB : readGil(mid2);
    const reC = buildLayers(gC, alloc, reB, tpls);
    reC.expectedRecs = reB.expectedRecs + reC.added.length;
    reC.expectedDiffs = (reC.added.length ? 1 : 0) + (reC.added.length ? 14 : 0);
    console.log('  新增层 ' + reC.added.length + ' 条；记录数 → ' + reC.expectedRecs + '；预计差异 ' + reC.expectedDiffs + ' 处（数组 + 14 content 子列表）');
    if (reC.skipped.length) console.log('  （已存在、跳过 ' + reC.skipped.length + ' 层）');
    let mid3 = mid2;
    if (!DRY && reC.added.length) {
      tmp3 = path.join(os.tmpdir(), 'gen_tpl_C_' + process.pid + '_' + Date.now() + '.gil');
      writeGil(gC, tmp3, { label: 'gen_furn_templates ③ 142 层', expectRecs: reC.expectedRecs, expectDiffs: reC.expectedDiffs, assert: (g2) => assertLayers(g2, reB, reC) });
      mid3 = tmp3;
    }

    // 段④ 引用控件
    console.log('\n── ④ 7 个模板引用控件 tpl.furn.*（父 fart.tpl；引用 = 模板源 GUID）──');
    const gD = DRY ? gC : readGil(mid3);
    const containerId = reA.id;
    const reD = buildRefs(gD, alloc, reB, containerId);
    reD.expectedRecs = reC.expectedRecs + reD.added.length;
    console.log('  新增引用控件 ' + reD.added.length + ' 条；记录数 → ' + reD.expectedRecs + '；预计差异 ' + reD.expectedDiffs + ' 处（数组 + fart.tpl 子列表）');
    if (reD.skipped.length) console.log('  （已存在、跳过 ' + reD.skipped.length + ' 条）');

    const total = {
      added: reA.added.length + (reB.newPairCount || 0) * 2 + reB.added.length + reC.added.length + reD.added.length,
      rootChanged: reA.rootChanged,
      finalRecs: reC.expectedRecs + reD.added.length,
    };
    if (DRY) {
      console.log('\n[--dry] 不写任何文件。预测：');
      console.log('  记录数 ' + g.recs.length + ' → ' + total.finalRecs + '（+' + total.added + '）');
      console.log('  diff_fields 基线→输出 = ' + ((total.added ? 1 : 0) + (total.rootChanged ? 1 : 0)) + ' 处（数组 + root 子列表）');
      console.log('  模板源 GUID：' + tpls.map((t) => t.spec + '=' + t.source).join(' / '));
      return 0;
    }

    let tmp4p = null;
    if (reD.added.length) {
      tmp4p = path.join(os.tmpdir(), 'gen_tpl_D_' + process.pid + '_' + Date.now() + '.gil');
      const rep = writeGil(gD, tmp4p, { label: 'gen_furn_templates ④ 7 个引用控件', expectRecs: reD.expectedRecs, expectDiffs: reD.expectedDiffs, assert: (g2) => assertRefs(g2, reD, reB) });
      tmp4 = tmp4p;
      fs.copyFileSync(tmp4p, outAbs);
      console.log('  写出 ' + basenameOf(outAbs) + '：' + rep.bytes + ' 字节 / ' + rep.recs + ' 条');
    } else if (path.resolve(mid3) !== path.resolve(outAbs)) {
      fs.copyFileSync(mid3, outAbs);
    }

    const gF = readGil(outAbs);
    const results = runExternalGates(outAbs, inAbs, total);
    // 附加断言：模板对 + 层 + 引用（重读最终档）
    const bad = [];
    const pairs = assertPairs(gF, { tpl: reB.tpl, added: reB.added, skipped: [], expectedRecs: gF.recs.length }, tpls);
    if (pairs !== true) bad.push(pairs);
    const layersOk = assertLayers(gF, reB, { added: reC.added, skipped: [], expectedRecs: gF.recs.length });
    if (layersOk !== true) bad.push(layersOk);
    const refsOk = assertRefs(gF, reD, reB);
    if (refsOk !== true) bad.push(refsOk);
    const allPass = results.every((r) => r.pass) && bad.length === 0;

    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + fs.statSync(outAbs).size + ' 字节，记录 ' + gF.recs.length + ' 条）');
    console.log('  记录数：' + baseRecs + ' → ' + gF.recs.length + '（+' + (gF.recs.length - baseRecs) + '）'
      + (gF.recs.length === total.finalRecs ? ' ✅' : ' ❌')
      + '   算式：' + baseRecs + ' + 1 容器 + 14 源/母本 + 14 content + 142 层 + 7 引用 = ' + total.finalRecs);
    console.log('  模板源 GUID（Instantiate 第 1 参）：' + tpls.map((t) => t.cfg + '=' + t.source).join('  '));
    console.log('  母本 GUID：' + tpls.map((t) => t.cfg + '=' + t.mother).join('  '));
    console.log('  层数：' + tpls.map((t) => t.spec + '=' + t.layers.length).join(' / ') + '（合计 71 ×2 份拷贝 = 142）');
    console.log('  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
    if (bad.length) { console.error('\n❌ 结构断言未过：\n' + bad.join('\n')); return 3; }
    if (!allPass) { console.error('\n❌ 外部闸门未全过 —— 文件已写出但**不要导入**。'); return 4; }
    console.log('  ★ 全部通过。导入用：' + OUT);
    return 0;
  } finally {
    for (const t of [tmp1, tmp2, tmp3, tmp4]) if (t && fs.existsSync(t)) { try { fs.unlinkSync(t); } catch { /* ignore */ } }
  }
}

process.exit(main());
