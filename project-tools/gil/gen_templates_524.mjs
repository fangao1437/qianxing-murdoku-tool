// tools/gil/gen_templates_524.mjs —— 524-一二关美术-容器-v9.gil（V1：在 520.1 的"编辑器建的空模板"上填内容）
//
// ════════════════════════════════════════════════════════════════════════════
// 背景（lead 2026-10-23 裁决 = 方案 A 变体 1）：
//   520.1.gil 是用户编辑器重存的档，里面有：
//     · 7 个**编辑器建的空模板**（无父、族 85~91、`#14` 空母本、无 content）：
//         furn,chair#7134 / furn.plant#7135 / furn.statue#7136 / furn.table.1#7137 /
//         furn.table.h2#7138 / furn.table.v2#7139 / furn.shelf#7140
//     · `things` 容器 #1073742795 下 7 条同名记录（形态是"模板样" 68/91，**无引用值**）
//     · 真实样本 `tpl.cell.face`#7146（引用控件形态 66/89，引用槽 `/505/503/#77` **空**）
//     · 真实样本 `cell.face` 模板对：#7145（源，族 18，#14→#1882）+ #1882（母本，#13→#7145）
//   ⇒ 本工具做 V1：
//     a. 给 7 个空模板补**完整模板对**（新建母本，`#14↔#13` 闭合）+ 两份 content + 规格层
//        （content 画布 108×108 / h2 216×108 / v2 108×216；层名 L01…，字段照规格）；
//     b. 把 `things` 下 7 条改成 `tpl.cell.face` 形态的**模板引用控件**（名字 furn.*，引用值=源 GUID），
//        并新增第 8 个 `furn.rug`（新模板对 + 3 层 + 引用控件）；
//     c. 清掉 `fart.tpl` 下 7 个**悬空** `tpl.furn.*`（引用已删除的 6900…6912）。
//   ⇒ 用户只需：编辑器打开 524 → 保存 → 导出。导出后 diff：层还在 = V1 成立；层被删 = 转方案 A 变体 2。
//
//   ★ 手写内容（编辑器可能删，回执里逐项列出）：7 个母本、16 个 content、148 层、8 个引用控件、
//     以及"改现有记录"的部分（源 #14、名字、子列表；things 子控件替换）。
//     编辑器原样保留的：7 个空模板源、things 容器、cell 模板等全部原记录。
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_templates_524.mjs --in=520.1.gil --out=524-一二关美术-容器-v9.gil [--dry]
//   退出码：0 成功；1 用法错；2 基线不符；3 断言/写入失败；4 外部闸门失败
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList, ensureChildListTop,
  stateBlocks, pairOf, pairValue, setPair, textsOf, writeVarint, ID_LO, ID_HI,
} from './gilread.mjs';
import { writeGil, loadTree, diffTrees } from './gilwrite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WORKSPACE = path.resolve(ROOT, '..');
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const argv = process.argv.slice(2);
const argOf = (k, d) => { const h = argv.find((s) => s.startsWith('--' + k + '=')); return h ? h.slice(k.length + 3).replace(/^"|"$/g, '') : d; };
const hasFlag = (k) => argv.includes('--' + k);

const IN = argOf('in');
const OUT = argOf('out');
const SPEC = argOf('spec', path.join(WORKSPACE, 'murdoku-project', '美术实现-一二关-2026-10-22', '家具模板层规格-v310.json'));
const DRY = hasFlag('dry');

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const TEMPLATE_MASTER_PARENT = 1073741844;
const THINGS = 1073742795;
// ROOT_GUID 未使用（保留备查）
const FART_TPL = 1073746914;
const REF_PROTO = 1073747146;      // tpl.cell.face（编辑器新建的引用控件样本）
const MOTHER_PROTO = 1073741882;   // cell.face 母本（编辑器新建）
const CONTENT_PROTO = 1073741888;  // cell content（编辑器建）
const LAYER_PROTO = 1073742785;    // hint（图片控件 100001/Stretch）
const ROOT_SIZE = 150;
const EVERY = 'L';
const IMG_TYPE_STRETCH = 1;
// 7 个已有空模板（源 GUID / 族号 / 名字 / 规格 key / 画布）——名字修正 comma typo
const EXISTING = [
  { src: 1073747134, family: 85, name: 'furn.chair', spec: 'furn.chair', cw: 108, ch: 108, layers: 9 },
  { src: 1073747135, family: 86, name: 'furn.plant', spec: 'furn.plant', cw: 108, ch: 108, layers: 10 },
  { src: 1073747136, family: 87, name: 'furn.statue', spec: 'furn.statue', cw: 108, ch: 108, layers: 10 },
  { src: 1073747137, family: 88, name: 'furn.table.1', spec: 'furn.table.1', cw: 108, ch: 108, layers: 10 },
  { src: 1073747138, family: 89, name: 'furn.table.h2', spec: 'furn.table.h2', cw: 216, ch: 108, layers: 10 },
  { src: 1073747139, family: 90, name: 'furn.table.v2', spec: 'furn.table.v2', cw: 108, ch: 216, layers: 10 },
  { src: 1073747140, family: 91, name: 'furn.shelf', spec: 'furn.shelf', cw: 108, ch: 108, layers: 12 },
];
// 新增 rug（族 92）
const RUG = {
  family: 92, name: 'furn.rug', cw: 108, ch: 108, layers: 3,
  layerData: [
    { imageId: 100001, color: 0xFFB89A62, w: 108, h: 108, dx: 0, yUp: 0 },
    { imageId: 100001, color: 0xFFDCC684, w: 82.1, h: 82.1, dx: 0, yUp: 0 },
    { imageId: 100001, color: 0xFFC9B072, w: 64.8, h: 64.8, dx: 0, yUp: 0 },
  ],
};
const REF_NAMES = ['furn.chair', 'furn.plant', 'furn.statue', 'furn.table.1', 'furn.table.h2', 'furn.table.v2', 'furn.shelf', 'furn.rug'];

const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const basenameOf = (p) => path.basename(p);
const recBy = (g, id) => g.recs.find((r) => Number(r.id) === Number(id)) || null;
const childIds = (g, rec) => { const cl = rec ? findChildListTop(rec.field.sub) : null; return cl ? (asIdList(cl.payload, true) || []).map(Number) : []; };
const hex32 = (v) => '0x' + (Number(v) >>> 0).toString(16).toUpperCase().padStart(8, '0');

// ── helper ────────────────────────────────────────────────────────────────
function compBlock(recField, compNo) {
  for (const f of recField.sub || []) {
    if (f.field !== 502 || !f.sub) continue;
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0), b = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (a && b && Number(a.num) === compNo) return f;
  }
  return null;
}
function compRef(recField, compNo) {
  const blk = compBlock(recField, compNo); if (!blk) return null;
  for (const g of blk.sub) {
    if (![11, 12, 13, 14].includes(g.field) || !g.sub) continue;
    const v = g.sub.find((x) => x.field === 501); if (!v) return null;
    if (v.wt === 0) return Number(v.num);
    const pay = v.payload || Buffer.alloc(0); let r = 0n, s = 0n, p = 0;
    while (p < pay.length) { const x = pay[p++]; r |= BigInt(x & 0x7f) << s; if ((x & 0x80) === 0) break; s += 7n; }
    return p === pay.length ? Number(r) : null;
  }
  return null;
}
function setCompRef(recField, compNo, id) {
  const blk = compBlock(recField, compNo); if (!blk) fatal('找不到组件 #' + compNo);
  for (const g of blk.sub) {
    if (![11, 12, 13, 14].includes(g.field)) continue;
    if (!g.sub) g.sub = [];
    let v = g.sub.find((x) => x.field === 501);
    if (!v) { v = { field: 501, wt: 0, num: 0n }; g.sub.push(v); }
    if (v.wt === 0) { v.num = BigInt(id); return; }
    v.payload = writeVarint(id); v.len = v.payload.length; v.isText = false; v.sub = null; return;
  }
  fatal('组件缺 #11/#12/#13/#14');
}
function stateSummary(recField) {
  return stateBlocks(recField.sub, []).map((b) => {
    const pos = pairOf(b, 504), size = pairOf(b, 505);
    return { block: b, pos, size, x: pairValue(pos, 0), y: pairValue(pos, 1), w: pairValue(size, 0), h: pairValue(size, 1), aMinX: pairValue(pairOf(b, 502), 0), aMaxX: pairValue(pairOf(b, 503), 0), pivX: pairValue(pairOf(b, 506), 0) };
  });
}
function imageNodes(recField) {
  let cur = [recField];
  for (const no of [505, 503, 84]) { const nx = []; for (const f of cur) if (f && f.sub) for (const c of f.sub) if (c.field === no && c.sub) nx.push(c); cur = nx; }
  return cur;
}
function imageTriple(recField) {
  const n = imageNodes(recField)[0]; if (!n) return null;
  const leaf = (x) => { const f = n.sub.find((q) => q.field === x && q.wt === 0); return f ? Number(f.num) : null; };
  return { node: n, id: leaf(503), color: (leaf(502) >>> 0), type: leaf(504) };
}
function setImg(node, no, val) { let f = node.sub.find((x) => x.field === no && x.wt === 0); if (!f) { f = { field: no, wt: 0, num: 0n }; node.sub.push(f); } f.num = BigInt(val >>> 0); }
function isHiddenRec(recField) {
  let h = false;
  for (const f of recField.sub || []) { if (f.field !== 505 || !f.sub) continue; (function w(fs, p) { for (const x of fs) { const q = p + '/' + x.field; if (x.wt === 0 && q === '/503/14/17/503') h = true; else if (x.sub) w(x.sub, q); } })(f.sub, ''); }
  return h;
}
function setHidden(recField, hidden) {
  let found = false;
  for (const f of recField.sub || []) {
    if (f.field !== 505 || !f.sub) continue;
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0), b = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (!a || !b || Number(a.num) !== 4 || Number(b.num) !== 86) continue;
    const p503 = f.sub.find((x) => x.field === 503 && x.sub);
    const p14 = p503 && p503.sub.find((x) => x.field === 14 && x.sub);
    if (!p14) fatal('可见性块缺 #503/#14');
    let p17 = p14.sub.find((x) => x.field === 17 && x.wt === 2);
    if (!p17) { p17 = { field: 17, wt: 2, sub: null, payload: Buffer.alloc(0), len: 0, isText: false }; p14.sub.push(p17); }
    p17.sub = hidden ? [{ field: 503, wt: 0, num: 1n }] : [];
    p17.payload = encodeMsg(p17.sub); p17.len = p17.payload.length; p17.isText = false;
    found = true;
  }
  if (!found) fatal('找不到 #505(4/86) 可见性块');
}
/** 引用控件槽：/505(66/89) → #503 → #77 → (#501=模板源 id) */
function refSlot(recField) {
  let blk = null;
  for (const f of recField.sub || []) {
    if (f.field !== 505 || !f.sub) continue;
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0), b = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (a && b && Number(a.num) === 66 && Number(b.num) === 89) blk = f;
  }
  if (!blk) return null;
  const p503 = blk.sub.find((x) => x.field === 503 && x.sub);
  if (!p503) return null;
  let p77 = p503.sub.find((x) => x.field === 77 && x.sub);
  if (!p77) { p77 = { field: 77, wt: 2, sub: [], payload: null, len: 0, isText: false }; p503.sub.push(p77); }
  return { blk, p77 };
}
function readRef(recField) {
  const s = refSlot(recField); if (!s) return null;
  const l = s.p77.sub.find((x) => x.field === 501 && x.wt === 0);
  return l ? Number(l.num) : null;
}
function setRef(recField, id) {
  const s = refSlot(recField); if (!s) fatal('引用槽缺失');
  s.p77.sub = [{ field: 501, wt: 0, num: BigInt(id) }];
  s.p77.payload = null; s.p77.len = 0;
}
function countVarintEqual(fields, val) {
  let n = 0; (function w(l) { for (const f of l) { if (f.wt === 0 && Number(f.num) === val) n++; if (f.sub) w(f.sub); } })(fields); return n;
}
function remapSelfIds(fields, oldId, newId) {
  let n = 0;
  (function w(l) {
    for (const f of l) {
      if (f.wt === 0 && Number(f.num) === oldId) { f.num = BigInt(newId); n++; }
      else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const ids = asIdList(f.payload, false);
        if (ids && ids.length === 1 && ids[0] === oldId) { f.payload = writeVarint(newId); f.len = f.payload.length; n++; }
      }
      if (f.sub) w(f.sub);
    }
  })(fields);
  return n;
}
function renameRecord(fields, oldName, newName) {
  const hits = textsOf(fields, []).filter((t) => t.payload && t.payload.toString('utf8') === oldName);
  if (hits.length !== 1) return { ok: false, hits: hits.length };
  hits[0].payload = Buffer.from(newName, 'utf8'); hits[0].len = hits[0].payload.length;
  return { ok: true, hits: 1 };
}
function setOrAppendChildList(recField, ids) {
  const cl = findChildListTop(recField.sub);
  if (cl) { setChildList(cl, ids); return cl; }
  const f = { field: 503, wt: 2, sub: null, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false };
  recField.sub.push(f); setChildList(f, ids); return f;
}
function scanGuidUsage(tree) {
  const used = new Set(); let max = 0;
  (function w(fs) { for (const f of fs) { if (f.wt === 0) { const v = Number(f.num); if (v >= ID_LO_NUM && v < ID_HI_NUM) { used.add(v); if (v > max) max = v; } } if (f.sub) w(f.sub); } })(tree);
  return { used, max };
}

// ── 规格 ─────────────────────────────────────────────────────────────────
function loadSpec() {
  const file = path.isAbsolute(SPEC) ? SPEC : path.resolve(WORKSPACE, SPEC);
  if (!fs.existsSync(file)) fatal('找不到规格：' + file, 1);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const out = {};
  for (const t of EXISTING) {
    const specT = doc.templates && doc.templates[t.spec];
    if (!specT) fatal('规格缺 ' + t.spec, 2);
    const [cw, ch] = specT.sizePx.map(Number);
    if (cw !== t.cw || ch !== t.ch) fatal(t.spec + ' 画布 ' + cw + 'x' + ch + '（预期 ' + t.cw + 'x' + t.ch + '）', 2);
    if (specT.layers.length !== t.layers) fatal(t.spec + ' 层数 ' + specT.layers.length + '（预期 ' + t.layers + '）', 2);
    out[t.name] = specT.layers.map((l, i) => {
      if (Number(l.order) !== i + 1) fatal(t.spec + ' order 不连续', 2);
      const color = typeof l.color === 'string' ? Number(BigInt(l.color.replace(/^0X/i, '0x')) & 0xFFFFFFFFn) : Number(l.color) >>> 0;
      const yUp = Number(l.y_up), dyDown = Number(l.dy_down);
      if (Math.abs(yUp + dyDown) > 1e-6) fatal(t.spec + ' 第 ' + (i + 1) + ' 层 y_up≠-dy_down', 2);
      return { imageId: Number(l.imageId), color, w: Number(l.w), h: Number(l.h), dx: Number(l.dx), yUp };
    });
  }
  out['furn.rug'] = RUG.layerData;
  console.log('  · 规格校验通过：7 模板 71 层 + rug 3 层');
  return out;
}

// ── 主流程 ───────────────────────────────────────────────────────────────
function build(g, specLayers) {
  const re = { added: [], deleted: [], replaced: [], plans: [], things: null };
  const used = scanGuidUsage(g.tree);
  let nextId = used.max + 1;
  const alloc = { ids: [], take() { while (used.used.has(nextId)) nextId++; if (nextId >= ID_HI_NUM) fatal('号段耗尽'); const v = nextId++; used.used.add(v); alloc.ids.push(v); return v; } };
  re.nextId = nextId;

  const refProto = recBy(g, REF_PROTO), mProto = recBy(g, MOTHER_PROTO);
  const cProto = recBy(g, CONTENT_PROTO), lProto = recBy(g, LAYER_PROTO);
  if (!refProto || !mProto || !cProto || !lProto) fatal('520.1 缺原型记录（ref/mother/content/layer）', 2);
  const mstRef = compRef(mProto.field, 3);   // cell.face 源 #7145
  const things = recBy(g, THINGS);
  if (!things) fatal('找不到 things 容器', 2);
  // ★ 幂等：8 个引用控件 + 7 个源已有 content + rug 已存在 + fart 无悬空 ⇒ 已完工，原样复制
  {
    const refs = childIds(g, things).map((k) => recBy(g, k)).filter((r) => r && REF_NAMES.includes(r.name) && readRef(r.field));
    const srcsReady = EXISTING.every((t) => { const s = recBy(g, t.src); return s && s.name === t.name && childIds(g, s).length === 1; });
    const rugSrcRec = g.recs.find((r) => r.name === 'furn.rug' && r.parentId == null);
    const fartRec = recBy(g, FART_TPL);
    const fartLeft = fartRec ? childIds(g, fartRec).filter((k) => ((recBy(g, k) || {}).name || '').startsWith('tpl.furn.')) : [];
    if (refs.length === 8 && srcsReady && rugSrcRec && fartLeft.length === 0) {
      re.idempotent = true;
      for (const t of [...EXISTING, { ...RUG, src: rugSrcRec.id }]) {
        const s = recBy(g, t.src);
        const mst = compRef(s.field, 4);
        const cS = childIds(g, s)[0];
        const cs = recBy(g, cS);
        const cM = childIds(g, recBy(g, mst))[0];
        re.plans.push({ name: t.name, src: s.id, mst, family: compRef(s.field, 2), contentS: cS, contentM: cM, layers: cs ? childIds(g, cs).length : 0, cw: RUG.cw, ch: RUG.ch });
      }
      re.added = []; re.deleted = []; re.expectRecs = g.recs.length;
      console.log('  · 幂等：8 个模板已填好、things 引用齐全、fart.tpl 无悬空 ⇒ 无需改动');
      return re;
    }
  }
  console.log('  · 原型：ref tpl.cell.face#' + refProto.id + ' / 母本 cell.face#' + mProto.id + ' / content#' + cProto.id + ' / 层 ' + lProto.name + '#' + lProto.id);

  const mkContent = (parentId, cw, ch) => {
    const cf = cloneField(cProto.field);
    const cid = alloc.take();
    const selfCnt = countVarintEqual(cProto.field.sub, cProto.id);
    const n = remapSelfIds(cf.sub, cProto.id, cid);
    if (n !== selfCnt) fatal('content 自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
    renameRecord(cf.sub, 'content', 'content');
    const p504 = cf.sub.find((f) => f.field === 504 && f.wt === 0); if (!p504) fatal('content 缺 #504');
    p504.num = BigInt(parentId);
    for (const s of stateSummary(cf)) { setPair(s.pos, 0, 0); setPair(s.size, cw, ch); setHidden(cf, false); if (s.aMinX !== 0.5 || s.aMaxX !== 0.5) fatal('content 锚点非 0.5'); }
    setOrAppendChildList(cf, []);
    g.recHolder.push(cf);
    re.added.push({ kind: 'content', id: cid, parent: parentId });
    return { field: cf, id: cid };
  };
  const mkLayers = (content, list) => {
    const ids = [];
    list.forEach((L, i) => {
      const lf = cloneField(lProto.field);
      const lid = alloc.take();
      const selfCnt = countVarintEqual(lProto.field.sub, lProto.id);
      const n = remapSelfIds(lf.sub, lProto.id, lid);
      if (n !== selfCnt) fatal('层自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
      const nm = EVERY + String(i + 1).padStart(2, '0');
      const rn = renameRecord(lf.sub, lProto.name, nm); if (!rn.ok) fatal('层改名命中 ' + rn.hits + ' 处');
      const p504 = lf.sub.find((f) => f.field === 504 && f.wt === 0); if (!p504) fatal('层缺 #504');
      p504.num = BigInt(content.id);
      for (const s of stateSummary(lf)) { setPair(s.pos, L.dx, L.yUp); setPair(s.size, L.w, L.h); }
      const im = imageTriple(lf); if (!im) fatal('层缺图片槽');
      setImg(im.node, 502, L.color); setImg(im.node, 503, L.imageId); setImg(im.node, 504, IMG_TYPE_STRETCH);
      setHidden(lf, false);
      g.recHolder.push(lf);
      ids.push(lid);
      re.added.push({ kind: 'layer', id: lid, parent: content.id, name: nm, tpl: content.tpl });
    });
    setOrAppendChildList(content.field, ids);
    content.layerIds = ids;
  };
  const mkMother = (p) => {
    const mf = cloneField(mProto.field);
    const mid = alloc.take();
    const selfCnt = countVarintEqual(mProto.field.sub, mProto.id);
    const n = remapSelfIds(mf.sub, mProto.id, mid);
    if (n !== selfCnt) fatal('母本自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
    renameRecord(mf.sub, 'cell.face', p.name);
    setCompRef(mf, 2, p.family);
    setCompRef(mf, 3, p.src);
    const p504 = mf.sub.find((f) => f.field === 504 && f.wt === 0); if (!p504) fatal('母本缺 #504');
    p504.num = BigInt(TEMPLATE_MASTER_PARENT);
    for (const s of stateSummary(mf)) { setPair(s.pos, 0, 0); setPair(s.size, ROOT_SIZE, ROOT_SIZE); }
    g.recHolder.push(mf);
    re.added.push({ kind: 'mother', id: mid, parent: TEMPLATE_MASTER_PARENT });
    return mid;
  };
  const mkRef = (name, srcId) => {
    const rf = cloneField(refProto.field);
    const rid = alloc.take();
    const selfCnt = countVarintEqual(refProto.field.sub, refProto.id);
    const n = remapSelfIds(rf.sub, refProto.id, rid);
    if (n !== selfCnt) fatal('引用控件自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
    renameRecord(rf.sub, 'tpl.cell.face', name);
    const p504 = rf.sub.find((f) => f.field === 504 && f.wt === 0); if (!p504) fatal('引用控件缺 #504');
    p504.num = BigInt(THINGS);
    setRef(rf, srcId);
    setHidden(rf, false);
    g.recHolder.push(rf);
    re.added.push({ kind: 'ref', id: rid, parent: THINGS, name, ref: srcId });
    return rid;
  };

  // ── 7 个已有模板：补母本 + 双 content + 层 ───────────────────────────
  for (const t of EXISTING) {
    const src = recBy(g, t.src);
    if (!src) fatal('找不到模板源 #' + t.src, 2);
    if (src.name !== t.name && !(t.name === 'furn.chair' && src.name === 'furn,chair')) fatal('#' + t.src + ' 名字 ' + src.name + ' 非预期');
    // 修名字（furn,chair → furn.chair）
    if (src.name !== t.name) { const rn = renameRecord(src.field.sub, src.name, t.name); if (!rn.ok) fatal('修名字失败'); }
    const mid = mkMother(t);
    setCompRef(src.field, 4, mid);
    const cS = mkContent(t.src, t.cw, t.ch); cS.field.tpl = t.name;
    const cM = mkContent(mid, t.cw, t.ch); cM.field.tpl = t.name;
    mkLayers(cS, specLayers[t.name]);
    mkLayers(cM, specLayers[t.name]);
    setOrAppendChildList(src.field, [cS.id]);
    const motherField = g.recHolder.find((f) => f.sub && Number((f.sub.find((x) => x.field === 501 && x.wt === 0) || {}).num) === mid);
    if (!motherField) fatal('找不到新母本字段');
    setOrAppendChildList(motherField, [cM.id]);
    re.plans.push({ kind: 'existing', name: t.name, src: t.src, mst: mid, family: t.family, contentS: cS.id, contentM: cM.id, layers: t.layers, cw: t.cw, ch: t.ch });
  }

  // ── rug：新建模板对 + 双 content + 3 层 ──────────────────────────────
  const rugSrc = recBy(g, 1073747145) || null;   // 用 cell.face 源作骨架（编辑器新建的完整源形态）
  if (!rugSrc) fatal('找不到 cell.face 源 #7145 作骨架', 2);
  const rsf = cloneField(rugSrc.field);
  const rugSrcId = alloc.take();
  {
    const selfCnt = countVarintEqual(rugSrc.field.sub, rugSrc.id);
    const n = remapSelfIds(rsf.sub, rugSrc.id, rugSrcId);
    if (n !== selfCnt) fatal('rug 源自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
    renameRecord(rsf.sub, 'cell.face', RUG.name);
    setCompRef(rsf, 2, RUG.family);
    const rugPlan = { family: RUG.family, name: RUG.name, src: rugSrcId };
    const mid = mkMother(rugPlan);
    setCompRef(rsf, 4, mid);
    const p504 = rsf.sub.find((f) => f.field === 504 && f.wt === 0);
    if (p504) fatal('rug 源不应有 #504');
    for (const s of stateSummary(rsf)) { setPair(s.pos, 0, 0); setPair(s.size, ROOT_SIZE, ROOT_SIZE); }
    setHidden(rsf, false);
    g.recHolder.push(rsf);
    re.added.push({ kind: 'source', id: rugSrcId, parent: null });
    const cS = mkContent(rugSrcId, RUG.cw, RUG.ch); cS.field.tpl = RUG.name;
    const cM = mkContent(mid, RUG.cw, RUG.ch); cM.field.tpl = RUG.name;
    mkLayers(cS, specLayers[RUG.name]);
    mkLayers(cM, specLayers[RUG.name]);
    setOrAppendChildList(rsf, [cS.id]);
    const motherField = g.recHolder.find((f) => f.sub && Number((f.sub.find((x) => x.field === 501 && x.wt === 0) || {}).num) === mid);
    setOrAppendChildList(motherField, [cM.id]);
    re.plans.push({ kind: 'new', name: RUG.name, src: rugSrcId, mst: mid, family: RUG.family, contentS: cS.id, contentM: cM.id, layers: RUG.layers, cw: RUG.cw, ch: RUG.ch });
  }

  // ── things：替换 7 条旧子控件 + 新增 8 条引用控件 ──────────────────
  const oldThingKids = childIds(g, things);
  for (const k of oldThingKids) { const r = recBy(g, k); if (r) re.deleted.push({ kind: 'old-thing', id: k, name: r.name }); }
  const refIds = [];
  for (const p of re.plans) refIds.push(mkRef(p.name, p.src));
  // 删除 old things 子控件记录（descending index）
  {
    const del = new Set(oldThingKids);
    const byHolder = new Map();
    for (const r of g.recs) if (del.has(Number(r.id))) { if (!byHolder.has(r.holder)) byHolder.set(r.holder, []); byHolder.get(r.holder).push(r); }
    for (const [holder, rs] of byHolder) { for (const r of rs.sort((a, b) => b.index - a.index)) holder.splice(r.index, 1); }
  }
  setOrAppendChildList(things.field, refIds);

  // ── 清掉 fart.tpl 下 7 个悬空 tpl.furn.* ─────────────────────────────
  const fart = recBy(g, FART_TPL);
  if (fart) {
    const kids = childIds(g, fart);
    const del = new Set();
    for (const k of kids) { const r = recBy(g, k); if (r && (r.name || '').startsWith('tpl.furn.')) del.add(Number(k)); }
    const byHolder = new Map();
    for (const r of g.recs) if (del.has(Number(r.id))) { if (!byHolder.has(r.holder)) byHolder.set(r.holder, []); byHolder.get(r.holder).push(r); }
    for (const [holder, rs] of byHolder) { for (const r of rs.sort((a, b) => b.index - a.index)) holder.splice(r.index, 1); }
    setOrAppendChildList(fart.field, kids.filter((k) => !del.has(Number(k))));
    for (const id of del) re.deleted.push({ kind: 'dangling-ref', id });
  }
  re.expectRecs = g.recs.length - re.deleted.length + re.added.length;
  return re;
}

// ── 断言（重读磁盘）─────────────────────────────────────────────────────
function assertAll(g2, re) {
  const bad = [];
  const specNames = re.plans.map((p) => p.name);
  for (const p of re.plans) {
    const s = recBy(g2, p.src), m = recBy(g2, p.mst);
    if (!s || !m) { bad.push(p.name + ' 缺源/母本'); continue; }
    if (s.parentId != null) bad.push(p.name + ' 源有父');
    if (Number(m.parentId) !== TEMPLATE_MASTER_PARENT) bad.push(p.name + ' 母本父=' + m.parentId);
    if (s.name !== p.name || m.name !== p.name) bad.push(p.name + ' 名字 ' + s.name + '/' + m.name);
    if (compRef(s.field, 4) !== Number(p.mst)) bad.push(p.name + ' 源 #14 不闭合');
    if (compRef(m.field, 3) !== Number(p.src)) bad.push(p.name + ' 母本 #13 不闭合');
    if (compRef(s.field, 2) !== p.family || compRef(m.field, 2) !== p.family) bad.push(p.name + ' 族号不符');
    const sst = stateSummary(s.field)[0], mst = stateSummary(m.field)[0];
    if (Math.abs(sst.w - ROOT_SIZE) > 0.02 || Math.abs(mst.w - ROOT_SIZE) > 0.02) bad.push(p.name + ' 根尺寸');
    for (const [tag, cid, parent] of [['src', p.contentS, p.src], ['mst', p.contentM, p.mst]]) {
      const c = recBy(g2, cid);
      if (!c) { bad.push(p.name + '/' + tag + ' content 缺失'); continue; }
      if (Number(c.parentId) !== Number(parent)) bad.push(p.name + '/' + tag + ' content 父指针');
      const cst = stateSummary(c.field)[0];
      if (Math.abs(cst.w - p.cw) > 0.02 || Math.abs(cst.h - p.ch) > 0.02) bad.push(p.name + '/' + tag + ' content 画布 ' + cst.w + 'x' + cst.h);
      const ids = childIds(g2, c);
      if (ids.length !== p.layers) { bad.push(p.name + '/' + tag + ' 层数 ' + ids.length + '（预期 ' + p.layers + '）'); continue; }
      const specL = g2._spec[p.name];
      for (let i = 0; i < ids.length; i++) {
        const lr = recBy(g2, ids[i]); const L = specL[i];
        if (!lr) { bad.push(p.name + '/' + tag + ' 层 ' + (i + 1) + ' 缺失'); continue; }
        if (lr.name !== 'L' + String(i + 1).padStart(2, '0')) bad.push(p.name + '/' + tag + ' 层名 ' + lr.name);
        const im = imageTriple(lr.field); const st = stateSummary(lr.field)[0];
        if (im.id !== L.imageId || im.color !== L.color || im.type !== IMG_TYPE_STRETCH) bad.push(p.name + '/' + tag + '/' + lr.name + ' 图片三件套');
        if (Math.abs(st.x - L.dx) > 0.02 || Math.abs(st.y - L.yUp) > 0.02) bad.push(p.name + '/' + tag + '/' + lr.name + ' 位置');
        if (Math.abs(st.w - L.w) > 0.02 || Math.abs(st.h - L.h) > 0.02) bad.push(p.name + '/' + tag + '/' + lr.name + ' 尺寸');
        if (isHiddenRec(lr.field)) bad.push(p.name + '/' + tag + '/' + lr.name + ' 隐藏');
      }
    }
    if (childIds(g2, s).length !== 1 || childIds(g2, s)[0] !== Number(p.contentS)) bad.push(p.name + ' 源子列表');
    if (childIds(g2, m).length !== 1 || childIds(g2, m)[0] !== Number(p.contentM)) bad.push(p.name + ' 母本子列表');
  }
  // things：8 个子控件，名/引用值/父 全对
  const things = recBy(g2, THINGS);
  const tk = childIds(g2, things);
  if (tk.length !== 8) bad.push('things 子控件 ' + tk.length + '（预期 8）');
  for (const p of re.plans) {
    const r = g2.recs.find((x) => x.name === p.name && Number(x.parentId) === THINGS);
    if (!r) { bad.push('things 缺引用控件 ' + p.name); continue; }
    if (readRef(r.field) !== Number(p.src)) bad.push(p.name + ' 引用值=' + readRef(r.field) + '（预期 ' + p.src + '）');
    if (isHiddenRec(r.field)) bad.push(p.name + ' 引用控件可见性=隐藏');
    if (!tk.includes(Number(r.id))) bad.push(p.name + ' 不在 things 子列表');
  }
  // 清理结果
  const fart = recBy(g2, FART_TPL);
  if (fart) {
    const left = childIds(g2, fart).filter((k) => ((recBy(g2, k) || {}).name || '').startsWith('tpl.furn.'));
    if (left.length) bad.push('fart.tpl 仍有悬空 tpl.furn.* ' + left.length);
  }
  // 其它关键记录未动
  const cellS = recBy(g2, 1073741876), cellM = recBy(g2, 1073741880);
  if (!cellS || !cellM) bad.push('cell.1.1 缺失');
  else {
    if (Number(childIds(g2, cellS)[0]) !== 1073741888) bad.push('cell 源 content 变了');
    if (Number(childIds(g2, cellM)[0]) !== 1073741886) bad.push('cell 母本 content 变了');
  }
  if (bad.length) return '✗ 断言失败：\n  ' + bad.slice(0, 40).join('\n  ') + (bad.length > 40 ? '\n  …共 ' + bad.length + ' 条' : '');
  console.log('  ✅ 断言：8 个模板（源/母本/#14/#13/族号/根 150）、16 个 content（画布正确）、148 层（L01…/字段/可见）、things 8 个引用控件（名/引用值/父）、fart.tpl 悬空清空、cell 模板未动');
  return true;
}

// ── 外部闸门 ─────────────────────────────────────────────────────────────
function runNode(tool, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, tool), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}
function runGates(outAbs, inAbs, cnt) {
  const results = [];
  const say = (s) => console.log(s);
  say('\n── ② probe_guid_collision.mjs ──');
  const probe = runNode('probe_guid_collision.mjs', [outAbs]); say(probe.stdout.trim());
  const probePass = probe.status === 0 && /① 真撞号（自身 GUID 重复）：\*\*0 处\*\*/.test(probe.stdout) && /✅ ② 自身 GUID 两处一致/.test(probe.stdout);
  results.push({ name: 'probe_guid_collision', pass: probePass }); say('  ⇒ ' + (probePass ? '✅ 真撞号 0' : '❌'));
  say('\n── ③ roundtrip.mjs ──');
  const rt = runNode('roundtrip.mjs', [outAbs]); say(rt.stdout.trim());
  const rtPass = rt.status === 0 && /★★★ 往返成功/.test(rt.stdout);
  results.push({ name: 'roundtrip', pass: rtPass }); say('  ⇒ ' + (rtPass ? '✅ 逐字节一致' : '❌'));
  say('\n── ④ diff_fields.mjs（520.1 → 524）──');
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]); say(df.stdout.trim());
  const m = /差异：(\d+) 处/.exec(df.stdout); const got = m ? Number(m[1]) : -1;
  results.push({ name: 'diff_fields', pass: got === cnt.expectDiffs });
  say('  ⇒ ' + (got === cnt.expectDiffs ? '✅ 差异 ' + got + ' 处（预计算一致）' : '❌ 差异 ' + got + ' ≠ ' + cnt.expectDiffs));
  say('\n── ⑤ list_names ──');
  const ln = runNode('list_names.mjs', [outAbs, 'furn.']);
  const cnt2 = (ln.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
  say('  furn. 命中 ' + cnt2 + ' 个（8 模板源 + 8 母本 + 8 引用控件 = 24）');
  const th = runNode('list_names.mjs', [outAbs, 'things']);
  say('  things 命中 ' + ((th.stdout.match(/^\s+\d+\s+\S+/gm) || []).length) + ' 个');
  const ok = cnt2 === 24;
  results.push({ name: 'list_names', pass: ok });
  say('\n── ⑥ 回读 things 引用值 ──');
  const g3 = readGil(outAbs);
  for (const p of cnt.plans) {
    const r = g3.recs.find((x) => x.name === p.name && Number(x.parentId) === THINGS);
    say('  ' + p.name.padEnd(13) + ' → 引用 ' + (r ? readRef(r.field) : '缺失') + '（预期 ' + p.src + '）');
  }
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────
function main() {
  if (!IN || !OUT) { console.error('用法: node tools/gil/gen_templates_524.mjs --in=520.1.gil --out=524-… [--dry]'); process.exit(1); }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到输入：' + inAbs, 1);
  console.log('══ gen_templates_524 —— V1：填 7 个编辑器空模板 + things 引用控件 + furn.rug ══');
  const specLayers = loadSpec();
  const g = readGil(inAbs);
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  const re = build(g, specLayers);
  console.log('\n  计划：改现有模板 ' + EXISTING.length + ' 个（补母本/content/层）+ 新建 rug 模板对；things 8 个引用控件');
  console.log('  删除 ' + re.deleted.length + ' 条（7 个旧 things 子控件 + 7 个悬空 tpl.furn.*）');
  console.log('  新增 ' + re.added.length + ' 条（母本 8 + rug 源 1 + content 16 + 层 148 + 引用控件 8 = 181）');
  console.log('  记录数：' + g.recs.length + ' - ' + re.deleted.length + ' + ' + re.added.length + ' = ' + re.expectRecs);
  if (re.expectRecs >= 1000) fatal('记录数 ' + re.expectRecs + ' ≥ 1000，停下报数', 2);

  if (re.idempotent) {
    fs.copyFileSync(inAbs, outAbs);
    console.log('  （幂等：原样复制 → ' + basenameOf(outAbs) + '）');
    const g2 = readGil(outAbs); g2._spec = specLayers;
    const ok = assertAll(g2, re);
    if (ok !== true) { console.log(ok); return 3; }
    const results = runGates(outAbs, inAbs, { expectDiffs: 0, plans: re.plans });
    return results.every((r) => r.pass) ? 0 : 4;
  }

  const tmp = path.join(os.tmpdir(), 'gen_524_' + process.pid + '_' + Date.now() + '.gil');
  try {
    g._spec = specLayers;
    const buf = g.pack(encodeMsg(g.tree));
    fs.writeFileSync(tmp, buf);
    const d = diffTrees(loadTree(g.file), loadTree(tmp), 100000);
    const cnt = { expectDiffs: d.total, plans: re.plans };
    console.log('  · 预计算字段差异 = ' + d.total + ' 处');
    if (DRY) {
      const g2 = readGil(tmp);
      g2._spec = specLayers;
      const ok = assertAll(g2, re);
      if (ok !== true) console.log(ok);
      console.log('\n[--dry] 输出字节 ' + buf.length + '（输入 ' + g.src.length + '）；记录数 ' + re.expectRecs);
      return ok === true ? 0 : 3;
    }
    const rep = writeGil(g, tmp, {
      label: 'gen_templates_524 V1 填模板+引用控件',
      expectRecs: re.expectRecs,
      expectDiffs: cnt.expectDiffs,
      assert: (g2) => { g2._spec = specLayers; return assertAll(g2, re); },
    });
    fs.copyFileSync(tmp, outAbs);
    console.log('  写出 ' + basenameOf(outAbs) + '：' + rep.bytes + ' 字节 / ' + rep.recs + ' 条');
    const results = runGates(outAbs, inAbs, cnt);
    const allPass = results.every((r) => r.pass);
    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + fs.statSync(outAbs).size + ' 字节，记录 ' + re.expectRecs + ' 条）');
    for (const p of re.plans) console.log('  ' + p.name.padEnd(13) + ' 源 #' + p.src + ' 母本 #' + p.mst + ' 族 ' + p.family + ' content ' + p.contentS + '/' + p.contentM + ' 画布 ' + p.cw + '×' + p.ch + ' 层 ' + p.layers + '×2');
    console.log('  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
    if (!allPass) { console.error('\n❌ 外部闸门未全过 —— 不要导入。'); return 4; }
    console.log('  ★ 全部通过。');
    return 0;
  } finally {
    if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

process.exit(main());
