// tools/gil/gen_531.mjs —— 531-一二关美术-容器-v12.gil（基于 530.gil）
//   ① chair/plant/statue 三层模板换成"只留最新一代"（art_v320_layers.json：132/184/135，含 rotDeg）
//   ② 填用户新建的多格地毯模板 furn.rug.2（源 1073748252 / 母本 1073748248 / content 8253、8249 / 首层 8254）
//   ③ root/things 加第 9 个引用控件 furn.rug.2 → 模板源 1073748252
// 用法: node tools/gil/gen_531.mjs --in=530.gil --out=531-一二关美术-容器-v12.gil [--dry]
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList,
  stateBlocks, pairOf, pairValue, setPair, writeVarint, ID_LO, ID_HI,
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
const DATA = argOf('data', path.join(WORKSPACE, '_work', 'art-tools', 'art_v320_layers.json'));
const DRY = hasFlag('dry');

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const IMG_TYPE_STRETCH = 1;
const THINGS = 1073742795;
const REF_PROTO = 1073747329;   // 现有 things 里 furn.rug 引用控件（66/89 形态）
const RUG2_SRC = 1073748252, RUG2_MST = 1073748248, RUG2_CS = 1073748253, RUG2_CM = 1073748249, RUG2_L1 = 1073748254;
const TPL = [
  { name: 'furn.chair', src: 1073747134, mst: 1073747150, cs: 1073747174, cm: 1073747183, n: 132 },
  { name: 'furn.plant', src: 1073747135, mst: 1073747151, cs: 1073747192, cm: 1073747202, n: 184 },
  { name: 'furn.statue', src: 1073747136, mst: 1073747152, cs: 1073747212, cm: 1073747222, n: 135 },
];
const KEEP = [
  { name: 'furn.table.1', src: 1073747137, mst: 1073747153, n: 10 },
  { name: 'furn.table.h2', src: 1073747138, mst: 1073747154, n: 10 },
  { name: 'furn.table.v2', src: 1073747139, mst: 1073747155, n: 10 },
  { name: 'furn.shelf', src: 1073747140, mst: 1073747156, n: 12 },
  { name: 'furn.rug', src: 1073747149, mst: 1073747157, n: 3 },
];

const fatal = (m, c = 3) => { console.error('\n❌ ' + m); process.exit(c); };
const basenameOf = (p) => path.basename(p);
const recBy = (g, id) => g.recs.find((r) => Number(r.id) === Number(id)) || null;
const childIds = (g, r) => { const cl = r ? findChildListTop(r.field.sub) : null; return cl ? (asIdList(cl.payload, true) || []).map(Number) : []; };
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
function applyRotation(f, degZ) { const bl = stateBlocks(f.sub, []); if (!bl.length) fatal('层没有状态块'); for (const b of bl) { let x = b.sub.find((y) => y.field === 508); if (!x) { x = { field: 508, wt: 2, sub: [], len: 0, payload: null, isText: false }; b.sub.push(x); } x.sub = degZ ? [{ field: 3, wt: 5, f: degZ }] : []; x.len = degZ ? 5 : 0; x.payload = null; } return bl.length; }
function readRot(f) { const b = stateBlocks(f.sub, [])[0]; if (!b) return 0; const x = b.sub.find((y) => y.field === 508); if (!x || !x.sub) return 0; const z = x.sub.find((y) => y.field === 3 && y.wt === 5); return z ? Math.round(z.f * 1000) / 1000 : 0; }
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
function setOrAppendChildList(f, ids) { const cl = findChildListTop(f.sub); if (cl) { setChildList(cl, ids); return cl; } const nf = { field: 503, wt: 2, sub: null, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false }; f.sub.push(nf); setChildList(nf, ids); return nf; }
function scanUsage(tree) { const used = new Set(); let max = 0; (function w(fs) { for (const f of fs) { if (f.wt === 0) { const v = Number(f.num); if (v >= ID_LO_NUM && v < ID_HI_NUM) { used.add(v); if (v > max) max = v; } } if (f.sub) w(f.sub); } })(tree); return { used, max }; }
function compBlock(f, compNo) { for (const x of f.sub || []) { if (x.field !== 502 || !x.sub) continue; const a = x.sub.find((y) => y.field === 501 && y.wt === 0), b = x.sub.find((y) => y.field === 502 && y.wt === 0); if (a && b && Number(a.num) === compNo) return x; } return null; }
function refSlot(f) { let blk = null; for (const x of f.sub || []) { if (x.field !== 505 || !x.sub) continue; const a = x.sub.find((y) => y.field === 501 && y.wt === 0), b = x.sub.find((y) => y.field === 502 && y.wt === 0); if (a && b && Number(a.num) === 66 && Number(b.num) === 89) blk = x; } if (!blk) return null; const p503 = blk.sub.find((y) => y.field === 503 && y.sub); if (!p503) return null; let p77 = p503.sub.find((y) => y.field === 77 && y.sub); if (!p77) { p77 = { field: 77, wt: 2, sub: [], payload: null, len: 0, isText: false }; p503.sub.push(p77); } return { p77 }; }
function readRef(f) { const s = refSlot(f); if (!s) return null; const l = s.p77.sub.find((x) => x.field === 501 && x.wt === 0); return l ? Number(l.num) : null; }
function setRef(f, id) { const s = refSlot(f); if (!s) fatal('引用槽缺失'); s.p77.sub = [{ field: 501, wt: 0, num: BigInt(id) }]; s.p77.payload = null; s.p77.len = 0; }
// textsOf 引入
import { textsOf } from './gilread.mjs';

function loadData() {
  const file = path.isAbsolute(DATA) ? DATA : path.resolve(WORKSPACE, DATA);
  if (!fs.existsSync(file)) fatal('找不到数据 ' + file, 1);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const out = {};
  for (const t of [...TPL, { name: 'furn.rug.2', n: 3, w: 216, h: 108 }]) {
    const d = doc.templates[t.name]; if (!d) fatal('数据缺 ' + t.name, 2);
    if (d.layers.length !== t.n) fatal(t.name + ' 层数 ' + d.layers.length + '（预期 ' + t.n + '）', 2);
    const [cw, ch] = d.sizePx.map(Number);
    if (t.name === 'furn.rug.2' ? (cw !== 216 || ch !== 108) : (cw !== 108 || ch !== 108)) fatal(t.name + ' 画布 ' + cw + 'x' + ch, 2);
    out[t.name] = d.layers.map((l, i) => {
      if (Number(l.order) !== i + 1) fatal(t.name + ' order 不连续', 2);
      const color = typeof l.color === 'string' ? Number(BigInt(l.color.replace(/^0X/i, '0x')) & 0xFFFFFFFFn) : Number(l.color) >>> 0;
      const yUp = Number(l.y_up), dy = Number(l.dy_down);
      if (Math.abs(yUp + dy) > 1e-6) fatal(t.name + ' 第 ' + (i + 1) + ' 层 y_up≠-dy_down', 2);
      return { imageId: Number(l.imageId), color, w: Number(l.w), h: Number(l.h), dx: Number(l.dx), yUp, rot: Number(l.rotDeg) || 0 };
    });
  }
  console.log('  · 数据：chair=132 / plant=184 / statue=135 / rug.2=3（rug.2 画布 216×108）');
  return out;
}

function build(g, data) {
  const re = { added: [], deleted: [], plans: [] };
  const { used, max } = scanUsage(g.tree);
  let nextId = max + 1;
  const alloc = { take() { while (used.has(nextId)) nextId++; if (nextId >= ID_HI_NUM) fatal('号段耗尽'); const v = nextId++; used.add(v); return v; } };
  const mkLayer = (protoField, protoId, contentId, L, contentTags) => {
    const lf = cloneField(protoField);
    const lid = alloc.take();
    const sc = countVarints(protoField.sub, protoId); const n = remapSelfIds(lf.sub, protoId, lid);
    if (n !== sc) fatal('层自身 GUID 替换 ' + n + '/' + sc);
    const p504 = lf.sub.find((x) => x.field === 504 && x.wt === 0); if (!p504) fatal('层缺 #504');
    p504.num = BigInt(contentId);
    for (const s of stateSummary(lf)) { setPair(s.pos, L.dx, L.yUp); setPair(s.size, L.w, L.h); }
    const im = imageTriple(lf); if (!im) fatal('层缺图片槽');
    setImg(im.node, 502, L.color); setImg(im.node, 503, L.imageId); setImg(im.node, 504, IMG_TYPE_STRETCH);
    applyRotation(lf, L.rot); setHidden(lf, false);
    g.recHolder.push(lf);
    re.added.push({ id: lid, parent: contentId, tpl: contentTags });
    return lid;
  };
  // ① 三模板
  for (const t of TPL) {
    const layers = data[t.name];
    const src = recBy(g, t.src), mst = recBy(g, t.mst);
    if (!src || !mst) fatal(t.name + ' 缺源/母本', 2);
    const contentS = recBy(g, t.cs), contentM = recBy(g, t.cm);
    if (!contentS || !contentM) fatal(t.name + ' content 缺失', 2);
    const oldS = childIds(g, contentS), oldM = childIds(g, contentM);
    if (!oldS.length || !oldM.length) fatal(t.name + ' 旧层缺失', 2);
    const proto = recBy(g, oldS[0]);
    const idsS = layers.map((L) => mkLayer(proto.field, proto.id, contentS.id, L, t.name));
    const idsM = layers.map((L) => mkLayer(proto.field, proto.id, contentM.id, L, t.name));
    setOrAppendChildList(contentS.field, idsS);
    setOrAppendChildList(contentM.field, idsM);
    for (const id of [...oldS, ...oldM]) re.deleted.push({ id, tpl: t.name });
    re.plans.push({ kind: 'replace', ...t, idsS, idsM });
  }
  // ② rug.2
  {
    const src = recBy(g, RUG2_SRC), mst = recBy(g, RUG2_MST);
    const cs = recBy(g, RUG2_CS), cm = recBy(g, RUG2_CM), l1 = recBy(g, RUG2_L1);
    if (!src || !mst || !cs || !cm || !l1) fatal('rug.2 结构缺（源/母本/content/首层）', 2);
    if (Number(cs.parentId) !== RUG2_SRC || Number(cm.parentId) !== RUG2_MST) fatal('rug.2 content 父指针不符', 2);
    const layers = data['furn.rug.2'];
    // content 画布 → 216×108
    for (const c of [cs, cm]) for (const s of stateSummary(c.field)) { setPair(s.pos, 0, 0); setPair(s.size, 216, 108); }
    // 首层 8254 复用为 L01（改字段）
    const setLayer = (recField, L) => {
      const p504 = recField.sub.find((x) => x.field === 504 && x.wt === 0); if (!p504) fatal('rug.2 层缺 #504');
      p504.num = BigInt(cs.id);
      for (const s of stateSummary(recField)) { setPair(s.pos, L.dx, L.yUp); setPair(s.size, L.w, L.h); }
      const im = imageTriple(recField); if (!im) fatal('rug.2 层缺图片槽');
      setImg(im.node, 502, L.color); setImg(im.node, 503, L.imageId); setImg(im.node, 504, IMG_TYPE_STRETCH);
      applyRotation(recField, 0); setHidden(recField, false);
    };
    setLayer(l1.field, layers[0]);
    const idsS = [RUG2_L1];
    for (let i = 1; i < 3; i++) idsS.push(mkLayer(l1.field, l1.id, cs.id, layers[i], 'furn.rug.2'));
    setOrAppendChildList(cs.field, idsS);
    // 母本 content：无层 ⇒ 克隆 3 份（以 8254 为原型）
    const idsM = [];
    for (let i = 0; i < 3; i++) idsM.push(mkLayer(l1.field, l1.id, cm.id, layers[i], 'furn.rug.2'));
    setOrAppendChildList(cm.field, idsM);
    re.plans.push({ kind: 'rug2', name: 'furn.rug.2', src: RUG2_SRC, mst: RUG2_MST, cs: RUG2_CS, cm: RUG2_CM, n: 3, idsS, idsM });
  }
  // ③ things 第 9 个引用控件
  {
    const proto = recBy(g, REF_PROTO); if (!proto) fatal('缺引用控件原型 #' + REF_PROTO, 2);
    const rf = cloneField(proto.field); const rid = alloc.take();
    const sc = countVarints(proto.field.sub, proto.id); const n = remapSelfIds(rf.sub, proto.id, rid);
    if (n !== sc) fatal('引用控件自身 GUID 替换 ' + n + '/' + sc);
    const ok = renameRecord(rf.sub, 'furn.rug', 'furn.rug.2'); if (!ok.ok) fatal('引用控件改名失败');
    const p504 = rf.sub.find((x) => x.field === 504 && x.wt === 0); if (!p504) fatal('ref 缺 #504'); p504.num = BigInt(THINGS);
    setRef(rf, RUG2_SRC); setHidden(rf, false);
    g.recHolder.push(rf); re.added.push({ kind: 'ref', id: rid, parent: THINGS, name: 'furn.rug.2', ref: RUG2_SRC });
    const things = recBy(g, THINGS); const kids = childIds(g, things);
    setOrAppendChildList(things.field, [...kids, rid]);
    re.refId = rid;
  }
  // 删除旧层（descending）
  const del = new Set(re.deleted.map((d) => Number(d.id)));
  const byHolder = new Map();
  for (const r of g.recs) if (del.has(Number(r.id))) { if (!byHolder.has(r.holder)) byHolder.set(r.holder, []); byHolder.get(r.holder).push(r); }
  for (const [h, rs] of byHolder) for (const r of rs.sort((a, b) => b.index - a.index)) h.splice(r.index, 1);
  re.expectRecs = g.recs.length - re.deleted.length + re.added.length;
  return re;
}

function assertAll(g2, re, data) {
  const bad = [];
  for (const p of re.plans) {
    if (p.kind === 'replace') {
      for (const [tag, cid, wantIds] of [['src', p.cs, p.idsS], ['mst', p.cm, p.idsM]]) {
        const c = recBy(g2, cid); if (!c) { bad.push(p.name + '/' + tag + ' content 缺'); continue; }
        const ids = childIds(g2, c);
        if (ids.length !== p.n) bad.push(p.name + '/' + tag + ' 层数 ' + ids.length + '（预期 ' + p.n + '）');
        if (ids.join(',') !== wantIds.join(',')) bad.push(p.name + '/' + tag + ' 子列表不符');
        const layers = data[p.name];
        for (let i = 0; i < Math.min(ids.length, layers.length); i++) {
          const L = layers[i], lr = recBy(g2, ids[i]);
          if (!lr) { bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 缺'); continue; }
          const im = imageTriple(lr.field), s = stateSummary(lr.field)[0];
          if (im.id !== L.imageId || im.color !== L.color || im.type !== IMG_TYPE_STRETCH) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 图片');
          if (Math.abs(s.x - L.dx) > 0.02 || Math.abs(s.y - L.yUp) > 0.02) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 位置');
          if (Math.abs(s.w - L.w) > 0.02 || Math.abs(s.h - L.h) > 0.02) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 尺寸');
          if (Math.abs(readRot(lr.field) - L.rot) > 0.02) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 旋转=' + readRot(lr.field) + '（预期 ' + L.rot + '）');
          if (isHidden(lr.field)) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 隐藏');
        }
      }
    } else if (p.kind === 'rug2') {
      const layers = data['furn.rug.2'];
      for (const [tag, cid, wantIds, sizeW, sizeH] of [['src', p.cs, p.idsS, 216, 108], ['mst', p.cm, p.idsM, 216, 108]]) {
        const c = recBy(g2, cid); if (!c) { bad.push('rug.2 ' + tag + ' content 缺'); continue; }
        const st = stateSummary(c.field)[0];
        if (Math.abs(st.w - sizeW) > 0.02 || Math.abs(st.h - sizeH) > 0.02) bad.push('rug.2 ' + tag + ' content 画布 ' + st.w + 'x' + st.h);
        const ids = childIds(g2, c);
        if (ids.length !== 3) { bad.push('rug.2 ' + tag + ' 层数 ' + ids.length); continue; }
        if (ids.join(',') !== wantIds.join(',')) bad.push('rug.2 ' + tag + ' 子列表不符');
        for (let i = 0; i < 3; i++) {
          const L = layers[i], lr = recBy(g2, ids[i]); if (!lr) { bad.push('rug.2/' + tag + '/L' + (i + 1) + ' 缺'); continue; }
          const im = imageTriple(lr.field), s = stateSummary(lr.field)[0];
          if (im.id !== L.imageId || im.color !== L.color || im.type !== IMG_TYPE_STRETCH) bad.push('rug.2/' + tag + '/L' + (i + 1) + ' 图片 ' + JSON.stringify(im));
          if (Math.abs(s.x - L.dx) > 0.02 || Math.abs(s.y - L.yUp) > 0.02) bad.push('rug.2/' + tag + '/L' + (i + 1) + ' 位置');
          if (Math.abs(s.w - L.w) > 0.02 || Math.abs(s.h - L.h) > 0.02) bad.push('rug.2/' + tag + '/L' + (i + 1) + ' 尺寸 ' + s.w + 'x' + s.h + '（预期 ' + L.w + 'x' + L.h + '）');
          if (isHidden(lr.field)) bad.push('rug.2/' + tag + '/L' + (i + 1) + ' 隐藏');
        }
      }
    }
  }
  for (const k of KEEP) {
    const s = recBy(g2, k.src), m = recBy(g2, k.mst);
    const cs = s ? childIds(g2, s) : [], cm = m ? childIds(g2, m) : [];
    const cS = cs.length ? recBy(g2, cs[0]) : null, cM = cm.length ? recBy(g2, cm[0]) : null;
    if (!cS || !cM || childIds(g2, cS).length !== k.n || childIds(g2, cM).length !== k.n) bad.push(k.name + ' 层数被改');
  }
  const things = recBy(g2, THINGS); const tk = childIds(g2, things);
  if (tk.length !== 9) bad.push('things 子控件 ' + tk.length + '（预期 9）');
  const r2 = g2.recs.find((x) => x.name === 'furn.rug.2' && Number(x.parentId) === THINGS);
  if (!r2) bad.push('things 缺 furn.rug.2');
  else {
    if (readRef(r2.field) !== RUG2_SRC) bad.push('furn.rug.2 ref=' + readRef(r2.field));
    if (!tk.includes(Number(r2.id))) bad.push('furn.rug.2 不在 things 子列表');
  }
  const cellS = recBy(g2, 1073741876), cellM = recBy(g2, 1073741880);
  if (!cellS || !cellM || Number(childIds(g2, cellS)[0]) !== 1073741888) bad.push('cell 模板被改');
  if (bad.length) return '✗ 断言失败：\n  ' + bad.slice(0, 30).join('\n  ') + (bad.length > 30 ? '\n  …共 ' + bad.length : '');
  console.log('  ✅ 断言：chair/plant/statue 132/184/135×2、rug.2 3×2（画布 216×108）、things 9 引用（rug.2→' + RUG2_SRC + '）、其它 5 模板未动');
  return true;
}

function runNode(t, a) { const r = spawnSync(process.execPath, [path.join(HERE, t), ...a], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { status: r.status, stdout: r.stdout || '' }; }
function gates(outAbs, inAbs, cnt) {
  const res = [];
  const p = runNode('probe_guid_collision.mjs', [outAbs]); console.log(p.stdout.split('\n').slice(0, 7).join('\n'));
  res.push(['probe_guid_collision', /① 真撞号（自身 GUID 重复）：\*\*0 处\*\*/.test(p.stdout)]);
  const rt = runNode('roundtrip.mjs', [outAbs]); console.log(rt.stdout.split('\n').filter((l) => /★★★|重新编码/.test(l)).join('\n'));
  res.push(['roundtrip', /★★★ 往返成功/.test(rt.stdout)]);
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]); const m = /差异：(\d+) 处/.exec(df.stdout); const got = m ? Number(m[1]) : -1;
  console.log('diff_fields：' + got + '（预期 ' + cnt.expectDiffs + '）'); res.push(['diff_fields', got === cnt.expectDiffs]);
  return res;
}

function main() {
  if (!IN || !OUT) { console.error('用法: node tools/gil/gen_531.mjs --in=530.gil --out=531-… [--dry]'); process.exit(1); }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到 ' + inAbs, 1);
  console.log('══ gen_531 —— 三模板换代 + furn.rug.2 填层 + things 第 9 引用 ══');
  const data = loadData();
  const g = readGil(inAbs);
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  { // 幂等
    const done = TPL.every((t) => childIds(g, recBy(g, t.cs)).length === t.n && childIds(g, recBy(g, t.cm)).length === t.n)
      && childIds(g, recBy(g, RUG2_CS)).length === 3 && childIds(g, recBy(g, RUG2_CM)).length === 3
      && g.recs.some((r) => r.name === 'furn.rug.2' && Number(r.parentId) === THINGS);
    if (done) { fs.copyFileSync(inAbs, outAbs); console.log('  （幂等：目标状态已满足 → 原样复制）'); return 0; }
  }
  const re = build(g, data);
  console.log('  新增 ' + re.added.length + '；删除旧层 ' + re.deleted.length + '；记录数 → ' + re.expectRecs);
  const tmp = path.join(os.tmpdir(), 'gen_531_' + process.pid + '_' + Date.now() + '.gil');
  try {
    const buf = g.pack(encodeMsg(g.tree)); fs.writeFileSync(tmp, buf);
    const d = diffTrees(loadTree(g.file), loadTree(tmp), 100000);
    console.log('  · 预计算字段差异 = ' + d.total);
    if (DRY) { const g2 = readGil(tmp); const ok = assertAll(g2, re, data); console.log(ok === true ? '' : ok); console.log('[--dry] 输出 ' + buf.length + ' 字节，记录 ' + re.expectRecs); return ok === true ? 0 : 3; }
    const rep = writeGil(g, tmp, { label: 'gen_531 v320 换代+rug.2', expectRecs: re.expectRecs, expectDiffs: d.total, assert: (g2) => assertAll(g2, re, data) });
    fs.copyFileSync(tmp, outAbs);
    console.log('  写出 ' + basenameOf(outAbs) + '：' + rep.bytes + ' 字节 / ' + rep.recs + ' 条');
    const res = gates(outAbs, inAbs, { expectDiffs: d.total });
    const all = res.every(([, ok]) => ok);
    console.log('\n  模板：');
    for (const p of re.plans) console.log('   ' + (p.name || 'furn.rug.2').padEnd(13) + (p.kind === 'replace' ? ' 源 #' + p.src + ' 母本 #' + p.mst + ' content ' + p.cs + '/' + p.cm + ' 新层 ' + p.n + '×2' : ' 源 #' + p.src + ' 母本 #' + p.mst + ' content ' + p.cs + '/' + p.cm + ' 层 3×2（画布 216×108）'));
    console.log('  things 第 9 引用控件 #' + re.refId + ' → ' + RUG2_SRC);
    console.log('  闸门：' + res.map(([n, ok]) => n + ' ' + (ok ? '✅' : '❌')).join('  '));
    return all ? 0 : 4;
  } finally { if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } } }
}
process.exit(main());
