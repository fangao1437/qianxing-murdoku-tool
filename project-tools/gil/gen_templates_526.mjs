// tools/gil/gen_templates_526.mjs —— 526-一二关美术-容器-v10.gil（基于 520.2）
//
// 520.2 实测（与 lead 描述不同处已在回执写明）：
//   · 8 对模板（源 7134-7140 + rug 7149；母本 7150-7157，族 85~92）都在；
//   · 每个模板（源/母本）下只有 **1 个直接"图片子控件"记录**（无名，comp 类型 96；rug 是 103；
//     槽含 73/96 + 74/97 = 图片控件），**没有 content 容器**；
//   · things 下 8 个子控件仍是"模板样"记录（槽 68/91），**没有任何引用值**（无 66/89 槽）。
// 本工具：给每个模板建 content 容器（克隆 cell 已验证的 content #1888，类型 17）→ 把用户那个图片子控件
//   收进 content 作为 L01 → 再克隆 N-1 份图片子控件填满 N 层（源/母本两份）→ things 改为 66/89 形态引用
//   控件（引用=模板源 GUID）→ 清 fart.tpl 悬空 tpl.furn.*。
//
// 用法: node tools/gil/gen_templates_526.mjs --in=520.2.gil --out=526-一二关美术-容器-v10.gil [--dry]
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
const IN = argOf('in'), OUT = argOf('out');
const SPEC = argOf('spec', path.join(WORKSPACE, 'murdoku-project', '美术实现-一二关-2026-10-22', '家具模板层规格-v310.json'));
const DRY = hasFlag('dry');

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const TEMPLATE_MASTER_PARENT = 1073741844;
const THINGS = 1073742795;
const FART_TPL = 1073746914;
const CONTENT_PROTO = 1073741888;   // cell content（容器，类型 17）
const REF_PROTO = 1073747146;       // tpl.cell.face（66/89 引用控件样本）
const IMG_TYPE_STRETCH = 1;
const ROOT_SIZE = 150;
// 8 个模板：源 / 母本 / 族 / 规格 key / 画布
const PLAN = [
  { src: 1073747134, mst: 1073747150, family: 85, name: 'furn.chair', spec: 'furn.chair', cw: 108, ch: 108 },
  { src: 1073747135, mst: 1073747151, family: 86, name: 'furn.plant', spec: 'furn.plant', cw: 108, ch: 108 },
  { src: 1073747136, mst: 1073747152, family: 87, name: 'furn.statue', spec: 'furn.statue', cw: 108, ch: 108 },
  { src: 1073747137, mst: 1073747153, family: 88, name: 'furn.table.1', spec: 'furn.table.1', cw: 108, ch: 108 },
  { src: 1073747138, mst: 1073747154, family: 89, name: 'furn.table.h2', spec: 'furn.table.h2', cw: 216, ch: 108 },
  { src: 1073747139, mst: 1073747155, family: 90, name: 'furn.table.v2', spec: 'furn.table.v2', cw: 108, ch: 216 },
  { src: 1073747140, mst: 1073747156, family: 91, name: 'furn.shelf', spec: 'furn.shelf', cw: 108, ch: 108 },
  { src: 1073747149, mst: 1073747157, family: 92, name: 'furn.rug', spec: 'furn.rug', cw: 108, ch: 108 },
];
const RUG_LAYERS = [
  { imageId: 100001, color: 0xFFB89A62, w: 108, h: 108, dx: 0, yUp: 0 },
  { imageId: 100001, color: 0xFFDCC684, w: 82.1, h: 82.1, dx: 0, yUp: 0 },
  { imageId: 100001, color: 0xFFC9B072, w: 64.8, h: 64.8, dx: 0, yUp: 0 },
];
const LAYER_N = { 'furn.chair': 9, 'furn.plant': 10, 'furn.statue': 10, 'furn.table.1': 10, 'furn.table.h2': 10, 'furn.table.v2': 10, 'furn.shelf': 12, 'furn.rug': 3 };

const fatal = (m, c = 3) => { console.error('\n❌ ' + m); process.exit(c); };
const basenameOf = (p) => path.basename(p);
const recBy = (g, id) => g.recs.find((r) => Number(r.id) === Number(id)) || null;
const childIds = (g, r) => { const cl = r ? findChildListTop(r.field.sub) : null; return cl ? (asIdList(cl.payload, true) || []).map(Number) : []; };

function compBlock(f, compNo) { for (const x of f.sub || []) { if (x.field !== 502 || !x.sub) continue; const a = x.sub.find((y) => y.field === 501 && y.wt === 0), b = x.sub.find((y) => y.field === 502 && y.wt === 0); if (a && b && Number(a.num) === compNo) return x; } return null; }
function compType(f) { const blk = compBlock(f, 2); if (!blk) return null; for (const c of blk.sub) { if (![12].includes(c.field) || !c.sub) continue; const l = c.sub.find((x) => x.field === 501); if (l) return l.wt === 0 ? Number(l.num) : null; } return null; }
function stateSummary(f) { return stateBlocks(f.sub, []).map((b) => { const pos = pairOf(b, 504), size = pairOf(b, 505); return { block: b, pos, size, x: pairValue(pos, 0), y: pairValue(pos, 1), w: pairValue(size, 0), h: pairValue(size, 1), aMinX: pairValue(pairOf(b, 502), 0), aMaxX: pairValue(pairOf(b, 503), 0), pivX: pairValue(pairOf(b, 506), 0) }; }); }
function imageNodes(f) { let cur = [f]; for (const no of [505, 503, 84]) { const nx = []; for (const x of cur) if (x && x.sub) for (const c of x.sub) if (c.field === no && c.sub) nx.push(c); cur = nx; } return cur; }
function imageTriple(f) { const n = imageNodes(f)[0]; if (!n) return null; const leaf = (x) => { const q = n.sub.find((z) => z.field === x && z.wt === 0); return q ? Number(q.num) : null; }; return { node: n, id: leaf(503), color: (leaf(502) >>> 0), type: leaf(504) }; }
function setImg(node, no, val) { let x = node.sub.find((z) => z.field === no && z.wt === 0); if (!x) { x = { field: no, wt: 0, num: 0n }; node.sub.push(x); } x.num = BigInt(val >>> 0); }
function isHidden(f) { let h = false; for (const x of f.sub || []) { if (x.field !== 505 || !x.sub) continue; (function w(fs, p) { for (const y of fs) { const q = p + '/' + y.field; if (y.wt === 0 && q === '/503/14/17/503') h = true; else if (y.sub) w(y.sub, q); } })(x.sub, ''); } return h; }
function setHidden(f, hidden) {
  let found = false;
  for (const x of f.sub || []) {
    if (x.field !== 505 || !x.sub) continue;
    const a = x.sub.find((y) => y.field === 501 && y.wt === 0), b = x.sub.find((y) => y.field === 502 && y.wt === 0);
    if (!a || !b || Number(a.num) !== 4 || Number(b.num) !== 86) continue;
    const p503 = x.sub.find((y) => y.field === 503 && y.sub);
    const p14 = p503 && p503.sub.find((y) => y.field === 14 && y.sub);
    if (!p14) fatal('可见性块缺 #503/#14');
    let p17 = p14.sub.find((y) => y.field === 17 && y.wt === 2);
    if (!p17) { p17 = { field: 17, wt: 2, sub: null, payload: Buffer.alloc(0), len: 0, isText: false }; p14.sub.push(p17); }
    p17.sub = hidden ? [{ field: 503, wt: 0, num: 1n }] : [];
    p17.payload = encodeMsg(p17.sub); p17.len = p17.payload.length; p17.isText = false;
    found = true;
  }
  if (!found) fatal('找不到 #505(4/86) 可见性块');
}
function refSlot(f) {
  let blk = null;
  for (const x of f.sub || []) { if (x.field !== 505 || !x.sub) continue; const a = x.sub.find((y) => y.field === 501 && y.wt === 0), b = x.sub.find((y) => y.field === 502 && y.wt === 0); if (a && b && Number(a.num) === 66 && Number(b.num) === 89) blk = x; }
  if (!blk) return null;
  const p503 = blk.sub.find((y) => y.field === 503 && y.sub);
  if (!p503) return null;
  let p77 = p503.sub.find((y) => y.field === 77 && y.sub);
  if (!p77) { p77 = { field: 77, wt: 2, sub: [], payload: null, len: 0, isText: false }; p503.sub.push(p77); }
  return { p77 };
}
function readRef(f) { const s = refSlot(f); if (!s) return null; const l = s.p77.sub.find((x) => x.field === 501 && x.wt === 0); return l ? Number(l.num) : null; }
function setRef(f, id) { const s = refSlot(f); if (!s) fatal('引用槽缺失'); s.p77.sub = [{ field: 501, wt: 0, num: BigInt(id) }]; s.p77.payload = null; s.p77.len = 0; }
function countVarints(fields, val) { let n = 0; (function w(l) { for (const f of l) { if (f.wt === 0 && Number(f.num) === val) n++; if (f.sub) w(f.sub); } })(fields); return n; }
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
function renameRecord(fields, oldName, newName) { const hits = textsOf(fields, []).filter((t) => t.payload && t.payload.toString('utf8') === oldName); if (hits.length !== 1) return { ok: false, hits: hits.length }; hits[0].payload = Buffer.from(newName, 'utf8'); hits[0].len = hits[0].payload.length; return { ok: true, hits: 1 }; }
function setOrAppendChildList(f, ids) {
  const cl = findChildListTop(f.sub);
  if (cl) { setChildList(cl, ids); return cl; }
  const nf = { field: 503, wt: 2, sub: null, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false };
  f.sub.push(nf); setChildList(nf, ids); return nf;
}
function scanUsage(tree) { const used = new Set(); let max = 0; (function w(fs) { for (const f of fs) { if (f.wt === 0) { const v = Number(f.num); if (v >= ID_LO_NUM && v < ID_HI_NUM) { used.add(v); if (v > max) max = v; } } if (f.sub) w(f.sub); } })(tree); return { used, max }; }

// ── 规格 ─────────────────────────────────────────────────────────────────
function loadSpec() {
  const file = path.isAbsolute(SPEC) ? SPEC : path.resolve(WORKSPACE, SPEC);
  if (!fs.existsSync(file)) fatal('找不到规格 ' + file, 1);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const out = {};
  for (const p of PLAN) {
    if (p.name === 'furn.rug') { out[p.name] = RUG_LAYERS; continue; }
    const t = doc.templates[p.spec]; if (!t) fatal('规格缺 ' + p.spec, 2);
    const [cw, ch] = t.sizePx.map(Number);
    if (cw !== p.cw || ch !== p.ch) fatal(p.spec + ' 画布 ' + cw + 'x' + ch, 2);
    out[p.spec] = t.layers.map((l, i) => {
      const color = typeof l.color === 'string' ? Number(BigInt(l.color.replace(/^0X/i, '0x')) & 0xFFFFFFFFn) : Number(l.color) >>> 0;
      return { imageId: Number(l.imageId), color, w: Number(l.w), h: Number(l.h), dx: Number(l.dx), yUp: -Number(l.dy_down) };
    });
    if (out[p.spec].length !== LAYER_N[p.name]) fatal(p.spec + ' 层数不符', 2);
  }
  console.log('  · 规格：8 模板（7×规格 + rug 3 层）');
  return out;
}

// ── 主流程 ───────────────────────────────────────────────────────────────
function build(g, specLayers) {
  const re = { added: [], deleted: [], plans: [], replaced: [] };
  const { used, max } = scanUsage(g.tree);
  let nextId = max + 1;
  const alloc = { take() { while (used.has(nextId)) nextId++; if (nextId >= ID_HI_NUM) fatal('号段耗尽'); const v = nextId++; used.add(v); return v; } };
  const cProto = recBy(g, CONTENT_PROTO), refProto = recBy(g, REF_PROTO);
  if (!cProto || !refProto) fatal('缺原型 content#1888 / ref#7146', 2);
  const things = recBy(g, THINGS); if (!things) fatal('缺 things', 2);
  console.log('  · 原型：content#' + cProto.id + '（类型 ' + compType(cProto.field) + '）、ref#' + refProto.id);

  const mkContent = (parentId, cw, ch) => {
    const cf = cloneField(cProto.field); const cid = alloc.take();
    const sc = countVarints(cProto.field.sub, cProto.id); const n = remapSelfIds(cf.sub, cProto.id, cid);
    if (n !== sc) fatal('content 自身 GUID 替换 ' + n + '/' + sc);
    renameRecord(cf.sub, 'content', 'content');
    const p = cf.sub.find((x) => x.field === 504 && x.wt === 0); if (!p) fatal('content 缺 #504');
    p.num = BigInt(parentId);
    for (const s of stateSummary(cf)) { setPair(s.pos, 0, 0); setPair(s.size, cw, ch); }
    setOrAppendChildList(cf, []); setHidden(cf, false);
    g.recHolder.push(cf); re.added.push({ kind: 'content', id: cid, parent: parentId });
    return { field: cf, id: cid };
  };

  for (const p of PLAN) {
    const src = recBy(g, p.src), mst = recBy(g, p.mst);
    if (!src || !mst) fatal(p.name + ' 缺源/母本', 2);
    if (src.name !== p.name) { const ok = renameRecord(src.field.sub, src.name, p.name); if (!ok.ok) fatal(p.name + ' 源改名失败'); re.replaced.push({ id: src.id, what: 'name' }); }
    if (mst.name !== p.name) { const ok = renameRecord(mst.field.sub, mst.name, p.name); if (!ok.ok) fatal(p.name + ' 母本改名失败'); re.replaced.push({ id: mst.id, what: 'name' }); }
    const layers = specLayers[p.spec];
    const plans = [];
    for (const [tag, tmplRec] of [['src', src], ['mst', mst]]) {
      const oldKids = childIds(g, tmplRec);
      if (oldKids.length !== 1) fatal(p.name + '/' + tag + ' 子控件 ' + oldKids.length + ' 个（预期 1 个用户图片子控件）', 2);
      const userImg = recBy(g, oldKids[0]);
      if (!userImg) fatal(p.name + '/' + tag + ' 图片子控件缺失', 2);
      if (!imageTriple(userImg.field)) fatal(p.name + '/' + tag + ' 子控件不是图片控件（无 /505/503/84）', 2);
      const content = mkContent(tmplRec.id, p.cw, p.ch);
      const ids = [];
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        let recField, rid;
        if (i === 0) { recField = userImg.field; rid = userImg.id; }   // ★ 复用用户那个图片子控件作 L01
        else {
          recField = cloneField(userImg.field);
          rid = alloc.take();
          const sc = countVarints(userImg.field.sub, userImg.id); const n = remapSelfIds(recField.sub, userImg.id, rid);
          if (n !== sc) fatal(p.name + '/' + tag + '/L' + (i + 1) + ' 自身 GUID 替换 ' + n + '/' + sc);
          g.recHolder.push(recField);
          re.added.push({ kind: 'layer', id: rid, parent: content.id, tpl: p.name });
        }
        const p504 = recField.sub.find((x) => x.field === 504 && x.wt === 0); if (!p504) fatal('层缺 #504');
        p504.num = BigInt(content.id);
        for (const s of stateSummary(recField)) { setPair(s.pos, L.dx, L.yUp); setPair(s.size, L.w, L.h); }
        const im = imageTriple(recField); if (!im) fatal('层缺图片槽');
        setImg(im.node, 502, L.color); setImg(im.node, 503, L.imageId); setImg(im.node, 504, IMG_TYPE_STRETCH);
        setHidden(recField, false);
        ids.push(rid);
      }
      setOrAppendChildList(content.field, ids);
      setOrAppendChildList(tmplRec.field, [content.id]);
      plans.push({ tag, content: content.id, ids });
    }
    re.plans.push({ ...p, contentS: plans[0].content, contentM: plans[1].content, layerIdsS: plans[0].ids, layerIdsM: plans[1].ids, layers: layers.length });
  }

  // things：替换 8 个旧子控件为 66/89 引用控件
  const old = childIds(g, things);
  const refIds = [];
  for (const p of PLAN) {
    const rf = cloneField(refProto.field); const rid = alloc.take();
    const sc = countVarints(refProto.field.sub, refProto.id); const n = remapSelfIds(rf.sub, refProto.id, rid);
    if (n !== sc) fatal('引用控件自身 GUID 替换 ' + n + '/' + sc);
    renameRecord(rf.sub, 'tpl.cell.face', p.name);
    const p504 = rf.sub.find((x) => x.field === 504 && x.wt === 0); if (!p504) fatal('ref 缺 #504');
    p504.num = BigInt(THINGS);
    setRef(rf, p.src); setHidden(rf, false);
    g.recHolder.push(rf);
    re.added.push({ kind: 'ref', id: rid, parent: THINGS, name: p.name, ref: p.src });
    refIds.push(rid);
  }
  {
    const del = new Set(old);
    const byHolder = new Map();
    for (const r of g.recs) if (del.has(Number(r.id))) { if (!byHolder.has(r.holder)) byHolder.set(r.holder, []); byHolder.get(r.holder).push(r); re.deleted.push({ id: r.id, name: r.name, kind: 'old-thing' }); }
    for (const [h, rs] of byHolder) for (const r of rs.sort((a, b) => b.index - a.index)) h.splice(r.index, 1);
  }
  setOrAppendChildList(things.field, refIds);

  // 清 fart.tpl 悬空 tpl.furn.*
  const fart = recBy(g, FART_TPL);
  if (fart) {
    const kids = childIds(g, fart); const del = new Set();
    for (const k of kids) { const r = recBy(g, k); if (r && (r.name || '').startsWith('tpl.furn.')) del.add(Number(k)); }
    const byHolder = new Map();
    for (const r of g.recs) if (del.has(Number(r.id))) { if (!byHolder.has(r.holder)) byHolder.set(r.holder, []); byHolder.get(r.holder).push(r); re.deleted.push({ id: r.id, kind: 'dangling-ref' }); }
    for (const [h, rs] of byHolder) for (const r of rs.sort((a, b) => b.index - a.index)) h.splice(r.index, 1);
    setOrAppendChildList(fart.field, kids.filter((k) => !del.has(Number(k))));
  }
  re.expectRecs = g.recs.length - re.deleted.length + re.added.length;
  return re;
}

// ── 断言 ─────────────────────────────────────────────────────────────────
function assertAll(g2, re) {
  const bad = [];
  for (const p of re.plans) {
    const s = recBy(g2, p.src), m = recBy(g2, p.mst);
    if (!s || !m) { bad.push(p.name + ' 缺对'); continue; }
    if (s.name !== p.name || m.name !== p.name) bad.push(p.name + ' 名字');
    if (s.parentId != null) bad.push(p.name + ' 源有父');
    if (Number(m.parentId) !== TEMPLATE_MASTER_PARENT) bad.push(p.name + ' 母本父');
    for (const [tag, tmplRec, contentId] of [['src', s, p.contentS], ['mst', m, p.contentM]]) {
      const c = recBy(g2, contentId);
      if (!c) { bad.push(p.name + '/' + tag + ' content 缺'); continue; }
      if (Number(c.parentId) !== Number(tmplRec.id)) bad.push(p.name + '/' + tag + ' content 父指针');
      const st = stateSummary(c.field)[0];
      if (Math.abs(st.w - p.cw) > 0.02 || Math.abs(st.h - p.ch) > 0.02) bad.push(p.name + '/' + tag + ' content 画布 ' + st.w + 'x' + st.h);
      const ids = childIds(g2, c);
      if (ids.length !== p.layers) { bad.push(p.name + '/' + tag + ' 层数 ' + ids.length + '（预期 ' + p.layers + '）'); continue; }
      const spec = g2._spec[p.spec];
      for (let i = 0; i < ids.length; i++) {
        const lr = recBy(g2, ids[i]); const L = spec[i];
        if (!lr) { bad.push(p.name + '/' + tag + '/' + (i + 1) + ' 缺'); continue; }
        const im = imageTriple(lr.field); const ls = stateSummary(lr.field)[0];
        if (im.id !== L.imageId || im.color !== L.color || im.type !== IMG_TYPE_STRETCH) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 图片 ' + JSON.stringify(im));
        if (Math.abs(ls.x - L.dx) > 0.02 || Math.abs(ls.y - L.yUp) > 0.02) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 位置');
        if (Math.abs(ls.w - L.w) > 0.02 || Math.abs(ls.h - L.h) > 0.02) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 尺寸');
        if (isHidden(lr.field)) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 隐藏');
      }
      if (childIds(g2, tmplRec).length !== 1 || childIds(g2, tmplRec)[0] !== Number(contentId)) bad.push(p.name + '/' + tag + ' 模板子列表');
    }
  }
  const things = recBy(g2, THINGS); const tk = childIds(g2, things);
  if (tk.length !== 8) bad.push('things 子控件 ' + tk.length);
  for (const p of re.plans) {
    const r = g2.recs.find((x) => x.name === p.name && Number(x.parentId) === THINGS);
    if (!r) { bad.push('things 缺 ' + p.name); continue; }
    if (readRef(r.field) !== Number(p.src)) bad.push(p.name + ' ref=' + readRef(r.field) + '（预期 ' + p.src + '）');
    if (!tk.includes(Number(r.id))) bad.push(p.name + ' 不在 things 子列表');
  }
  const fart = recBy(g2, FART_TPL);
  if (fart) { const left = childIds(g2, fart).filter((k) => ((recBy(g2, k) || {}).name || '').startsWith('tpl.furn.')); if (left.length) bad.push('fart.tpl 残留 ' + left.length); }
  const cellS = recBy(g2, 1073741876), cellM = recBy(g2, 1073741880);
  if (!cellS || !cellM || Number(childIds(g2, cellS)[0]) !== 1073741888 || Number(childIds(g2, cellM)[0]) !== 1073741886) bad.push('cell 模板被改');
  if (bad.length) return '✗ 断言失败：\n  ' + bad.slice(0, 40).join('\n  ') + (bad.length > 40 ? '\n  …共 ' + bad.length : '');
  console.log('  ✅ 断言：8 模板（源/母本/content 画布/层 L01…/字段/可见）、things 8 引用值、fart 清空、cell 未动');
  return true;
}

// ── 闸门 ─────────────────────────────────────────────────────────────────
function runNode(t, a) { const r = spawnSync(process.execPath, [path.join(HERE, t), ...a], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { status: r.status, stdout: r.stdout || '' }; }
function gates(outAbs, inAbs, cnt) {
  const res = [];
  const p = runNode('probe_guid_collision.mjs', [outAbs]); console.log(p.stdout.trim().split('\n').slice(0, 8).join('\n'));
  const probePass = /① 真撞号（自身 GUID 重复）：\*\*0 处\*\*/.test(p.stdout);
  res.push(['probe_guid_collision', probePass]);
  const rt = runNode('roundtrip.mjs', [outAbs]); const lines = rt.stdout.split('\n'); console.log(lines.filter((l) => /★★★|重新编码/.test(l)).join('\n'));
  const rtPass = /★★★ 往返成功/.test(rt.stdout);
  res.push(['roundtrip', rtPass]);
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]); const m = /差异：(\d+) 处/.exec(df.stdout);
  const got = m ? Number(m[1]) : -1;
  console.log('diff_fields：' + got + ' 处（预期 ' + cnt.expectDiffs + '）');
  res.push(['diff_fields', got === cnt.expectDiffs]);
  const ln = runNode('list_names.mjs', [outAbs, 'furn.']);
  const c2 = (ln.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
  console.log('list_names furn. = ' + c2);
  res.push(['list_names', c2 === 24]);
  return res;
}

function main() {
  if (!IN || !OUT) { console.error('用法: node tools/gil/gen_templates_526.mjs --in=520.2.gil --out=526-… [--dry]'); process.exit(1); }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到 ' + inAbs, 1);
  console.log('══ gen_templates_526 —— 给 520.2 的 8 个模板补 content + 层 + things 引用 ══');
  const spec = loadSpec();
  const g = readGil(inAbs);
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  // ★ 幂等：8 模板都已有 content（层数对）+ things 8 引用值已写 ⇒ 原样复制
  {
    const okAll = PLAN.every((p) => {
      const s = recBy(g, p.src), m = recBy(g, p.mst);
      if (!s || !m) return false;
      const cs = childIds(g, s)[0], cm = childIds(g, m)[0];
      if (!cs || !cm) return false;
      return childIds(g, recBy(g, cs)).length === LAYER_N[p.name] && childIds(g, recBy(g, cm)).length === LAYER_N[p.name];
    });
    const th = recBy(g, THINGS);
    const refsOk = th && childIds(g, th).filter((k) => { const r = recBy(g, k); return r && PLAN.some((p) => p.name === r.name) && readRef(r.field); }).length === 8;
    if (okAll && refsOk) {
      fs.copyFileSync(inAbs, outAbs);
      console.log('  （幂等：8 模板已填 content/层、things 引用齐全 → 原样复制）');
      console.log('  闸门：无需改动（diff 0）');
      return 0;
    }
  }
  const re = build(g, spec);
  console.log('  新增 ' + re.added.length + ' 条；删除 ' + re.deleted.length + ' 条；记录数 → ' + re.expectRecs);
  if (re.expectRecs >= 1000) fatal('记录数 ' + re.expectRecs + ' ≥ 1000', 2);
  const tmp = path.join(os.tmpdir(), 'gen_526_' + process.pid + '_' + Date.now() + '.gil');
  try {
    const buf = g.pack(encodeMsg(g.tree)); fs.writeFileSync(tmp, buf);
    const d = diffTrees(loadTree(g.file), loadTree(tmp), 100000);
    console.log('  · 预计算字段差异 = ' + d.total);
    if (DRY) {
      const g2 = readGil(tmp); g2._spec = spec;
      const ok = assertAll(g2, re); console.log(ok === true ? '' : ok);
      console.log('[--dry] 输出 ' + buf.length + ' 字节，记录 ' + re.expectRecs);
      return ok === true ? 0 : 3;
    }
    const rep = writeGil(g, tmp, {
      label: 'gen_templates_526 模板 content+层+things 引用',
      expectRecs: re.expectRecs, expectDiffs: d.total,
      assert: (g2) => { g2._spec = spec; return assertAll(g2, re); },
    });
    fs.copyFileSync(tmp, outAbs);
    console.log('  写出 ' + basenameOf(outAbs) + '：' + rep.bytes + ' 字节 / ' + rep.recs + ' 条');
    const res = gates(outAbs, inAbs, { expectDiffs: d.total });
    const all = res.every(([, ok]) => ok);
    console.log('\n  8 模板：');
    for (const p of re.plans) console.log('   ' + p.name.padEnd(13) + ' 源 #' + p.src + ' 母本 #' + p.mst + ' content ' + p.contentS + '/' + p.contentM + ' 画布 ' + p.cw + '×' + p.ch + ' 层 ' + p.layers + '×2');
    console.log('  闸门：' + res.map(([n, ok]) => n + ' ' + (ok ? '✅' : '❌')).join('  '));
    return all ? 0 : 4;
  } finally { if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } } }
}
process.exit(main());
