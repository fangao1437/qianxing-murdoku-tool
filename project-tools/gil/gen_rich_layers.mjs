// tools/gil/gen_rich_layers.mjs —— 528-一二关美术-容器-v11.gil（基于 526）
//   只替换 furn.chair / furn.plant / furn.statue 三个模板（源+母本两份 content）的层为"富图元版"：
//   _work/art-tools/rich_template_layers.json（134/187/138 层，含旋转 rotDeg）。
//   层记录克隆各 content 里已有的图片控件（保持编辑器可认形态），写 imageId/imageColor/尺寸/位置/#508 旋转；
//   table.1/h2/v2/shelf/rug、things 引用控件、cell 等一律不动。
// 用法: node tools/gil/gen_rich_layers.mjs --in=526-… --out=528-… [--dry]
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
const DATA = argOf('data', path.join(WORKSPACE, '_work', 'art-tools', 'rich_template_layers.json'));
const DRY = hasFlag('dry');

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const IMG_TYPE_STRETCH = 1;
const THINGS = 1073742795;
const TPL = [
  { name: 'furn.chair', src: 1073747134, mst: 1073747150, n: 134 },
  { name: 'furn.plant', src: 1073747135, mst: 1073747151, n: 187 },
  { name: 'furn.statue', src: 1073747136, mst: 1073747152, n: 138 },
];
// 不动项（回读层数与记录 id 用）
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
/** 写旋转：状态块 #508 = vec3 字段 1/2/3 = x/y/z（float 度；静态烘焙同口径），0 稀疏不写 */
function applyRotation(f, degZ) {
  const bl = stateBlocks(f.sub, []);
  if (!bl.length) fatal('层没有状态块，没法写旋转');
  for (const b of bl) {
    let x = b.sub.find((y) => y.field === 508);
    if (!x) { x = { field: 508, wt: 2, sub: [], len: 0, payload: null, isText: false }; b.sub.push(x); }
    x.sub = degZ ? [{ field: 3, wt: 5, f: degZ }] : [];
    x.len = degZ ? 5 : 0;
    x.payload = null;
  }
  return bl.length;
}
function readRot(f) { const bl = stateBlocks(f.sub, []); return bl.map((b) => { const x = b.sub.find((y) => y.field === 508); if (!x || !x.sub) return 0; const z = x.sub.find((y) => y.field === 3 && y.wt === 5); return z ? Math.round(z.f * 1000) / 1000 : 0; }); }
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
function setOrAppendChildList(f, ids) {
  const cl = findChildListTop(f.sub);
  if (cl) { setChildList(cl, ids); return cl; }
  const nf = { field: 503, wt: 2, sub: null, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false };
  f.sub.push(nf); setChildList(nf, ids); return nf;
}
function scanUsage(tree) { const used = new Set(); let max = 0; (function w(fs) { for (const f of fs) { if (f.wt === 0) { const v = Number(f.num); if (v >= ID_LO_NUM && v < ID_HI_NUM) { used.add(v); if (v > max) max = v; } } if (f.sub) w(f.sub); } })(tree); return { used, max }; }

function loadData() {
  const file = path.isAbsolute(DATA) ? DATA : path.resolve(WORKSPACE, DATA);
  if (!fs.existsSync(file)) fatal('找不到富图元数据 ' + file, 1);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const out = {};
  for (const t of TPL) {
    const d = doc.templates[t.name];
    if (!d) fatal('数据缺 ' + t.name, 2);
    if (d.layers.length !== t.n) fatal(t.name + ' 层数 ' + d.layers.length + '（预期 ' + t.n + '）', 2);
    const [cw, ch] = d.sizePx.map(Number);
    if (cw !== 108 || ch !== 108) fatal(t.name + ' 画布 ' + cw + 'x' + ch, 2);
    out[t.name] = d.layers.map((l, i) => {
      if (Number(l.order) !== i + 1) fatal(t.name + ' order 不连续', 2);
      const color = typeof l.color === 'string' ? Number(BigInt(l.color.replace(/^0X/i, '0x')) & 0xFFFFFFFFn) : Number(l.color) >>> 0;
      const yUp = Number(l.y_up), dy = Number(l.dy_down);
      if (Math.abs(yUp + dy) > 1e-6) fatal(t.name + ' 第 ' + (i + 1) + ' 层 y_up≠-dy_down', 2);
      return { order: i + 1, imageId: Number(l.imageId), color, w: Number(l.w), h: Number(l.h), dx: Number(l.dx), yUp, rot: Number(l.rotDeg) || 0 };
    });
  }
  const rotN = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.filter((x) => x.rot !== 0).length]));
  console.log('  · 数据：' + Object.entries(out).map(([k, v]) => k + '=' + v.length).join(' / ') + '；有旋转层 ' + JSON.stringify(rotN));
  return out;
}

function build(g, data) {
  const re = { added: [], deleted: [], plans: [] };
  const { used, max } = scanUsage(g.tree);
  let nextId = max + 1;
  const alloc = { take() { while (used.has(nextId)) nextId++; if (nextId >= ID_HI_NUM) fatal('号段耗尽'); const v = nextId++; used.add(v); return v; } };
  for (const t of TPL) {
    const src = recBy(g, t.src), mst = recBy(g, t.mst);
    if (!src || !mst) fatal(t.name + ' 缺源/母本', 2);
    const cs = childIds(g, src), cm = childIds(g, mst);
    if (cs.length !== 1 || cm.length !== 1) fatal(t.name + ' content 不是各 1 个', 2);
    const contentS = recBy(g, cs[0]), contentM = recBy(g, cm[0]);
    if (!contentS || !contentM) fatal(t.name + ' content 缺失', 2);
    const oldS = childIds(g, contentS), oldM = childIds(g, contentM);
    if (oldS.length === 0 || oldM.length === 0) fatal(t.name + ' content 没有可克隆的图片控件', 2);
    const proto = recBy(g, oldS[0]);
    if (!proto) fatal(t.name + ' 层原型缺失', 2);
    const layers = data[t.name];
    const mk = (content, oldIds) => {
      const ids = [];
      for (const L of layers) {
        const lf = cloneField(proto.field);
        const lid = alloc.take();
        const sc = countVarints(proto.field.sub, proto.id); const n = remapSelfIds(lf.sub, proto.id, lid);
        if (n !== sc) fatal(t.name + ' 层自身 GUID 替换 ' + n + '/' + sc);
        const p504 = lf.sub.find((x) => x.field === 504 && x.wt === 0); if (!p504) fatal('层缺 #504');
        p504.num = BigInt(content.id);
        for (const s of stateSummary(lf)) { setPair(s.pos, L.dx, L.yUp); setPair(s.size, L.w, L.h); }
        const im = imageTriple(lf); if (!im) fatal('层缺图片槽');
        setImg(im.node, 502, L.color); setImg(im.node, 503, L.imageId); setImg(im.node, 504, IMG_TYPE_STRETCH);
        applyRotation(lf, L.rot);
        setHidden(lf, false);
        g.recHolder.push(lf);
        ids.push(lid);
        re.added.push({ id: lid, parent: content.id, tpl: t.name });
      }
      setOrAppendChildList(content.field, ids);
      for (const id of oldIds) re.deleted.push({ id, tpl: t.name });
      return ids;
    };
    const idsS = mk(contentS, oldS), idsM = mk(contentM, oldM);
    re.plans.push({ ...t, contentS: contentS.id, contentM: contentM.id, idsS, idsM });
  }
  // 删除旧层记录（descending index）
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
    for (const [tag, cid, wantIds] of [['src', p.contentS, p.idsS], ['mst', p.contentM, p.idsM]]) {
      const c = recBy(g2, cid);
      if (!c) { bad.push(p.name + '/' + tag + ' content 缺'); continue; }
      const ids = childIds(g2, c);
      if (ids.length !== p.n) bad.push(p.name + '/' + tag + ' 层数 ' + ids.length + '（预期 ' + p.n + '）');
      if (ids.join(',') !== wantIds.join(',')) bad.push(p.name + '/' + tag + ' 子列表与写入不符');
      const layers = data[p.name];
      for (let i = 0; i < Math.min(ids.length, layers.length); i++) {
        const L = layers[i]; const lr = recBy(g2, ids[i]);
        if (!lr) { bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 缺'); continue; }
        const im = imageTriple(lr.field); const st = stateSummary(lr.field)[0];
        if (im.id !== L.imageId || im.color !== L.color || im.type !== IMG_TYPE_STRETCH) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 图片 ' + JSON.stringify({ id: im.id, c: im.color, t: im.type }) + ' vs ' + JSON.stringify({ id: L.imageId, c: L.color }));
        if (Math.abs(st.x - L.dx) > 0.02 || Math.abs(st.y - L.yUp) > 0.02) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 位置');
        if (Math.abs(st.w - L.w) > 0.02 || Math.abs(st.h - L.h) > 0.02) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 尺寸');
        for (const rz of readRot(lr.field)) if (Math.abs(rz - L.rot) > 0.02) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 旋转=' + rz + '（预期 ' + L.rot + '）');
        if (isHidden(lr.field)) bad.push(p.name + '/' + tag + '/L' + (i + 1) + ' 隐藏');
      }
    }
  }
  // 其余模板未动
  for (const k of KEEP) {
    const s = recBy(g2, k.src), m = recBy(g2, k.mst);
    const cs = s ? childIds(g2, s) : [], cm = m ? childIds(g2, m) : [];
    const cS = cs.length ? recBy(g2, cs[0]) : null, cM = cm.length ? recBy(g2, cm[0]) : null;
    if (!cS || !cM || childIds(g2, cS).length !== k.n || childIds(g2, cM).length !== k.n) bad.push(k.name + ' 层数被改');
  }
  const things = recBy(g2, THINGS);
  if (!things || childIds(g2, things).length !== 8) bad.push('things 子控件数变了');
  if (bad.length) return '✗ 断言失败：\n  ' + bad.slice(0, 30).join('\n  ') + (bad.length > 30 ? '\n  …共 ' + bad.length : '');
  console.log('  ✅ 断言：chair/plant/statue 的 6 份 content 层数 134/187/138 全对（imageId/色/尺寸/位置/旋转/可见），其余 5 模板与 things 未动');
  return true;
}

function runNode(t, a) { const r = spawnSync(process.execPath, [path.join(HERE, t), ...a], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); return { status: r.status, stdout: r.stdout || '' }; }
function gates(outAbs, inAbs, cnt) {
  const res = [];
  const p = runNode('probe_guid_collision.mjs', [outAbs]);
  console.log(p.stdout.split('\n').slice(0, 7).join('\n'));
  res.push(['probe_guid_collision', /① 真撞号（自身 GUID 重复）：\*\*0 处\*\*/.test(p.stdout)]);
  const rt = runNode('roundtrip.mjs', [outAbs]);
  console.log(rt.stdout.split('\n').filter((l) => /★★★|重新编码/.test(l)).join('\n'));
  res.push(['roundtrip', /★★★ 往返成功/.test(rt.stdout)]);
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]); const m = /差异：(\d+) 处/.exec(df.stdout); const got = m ? Number(m[1]) : -1;
  console.log('diff_fields：' + got + ' 处（预期 ' + cnt.expectDiffs + '）');
  res.push(['diff_fields', got === cnt.expectDiffs]);
  return res;
}

function main() {
  if (!IN || !OUT) { console.error('用法: node tools/gil/gen_rich_layers.mjs --in=526-… --out=528-… [--dry]'); process.exit(1); }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到 ' + inAbs, 1);
  console.log('══ gen_rich_layers —— 富图元版写入 furn.chair/plant/statue（含旋转）══');
  const data = loadData();
  const g = readGil(inAbs);
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  // 幂等：目标层数已满足 ⇒ 原样复制
  {
    const done = TPL.every((t) => {
      const s = recBy(g, t.src), m = recBy(g, t.mst);
      const cs = s ? childIds(g, s)[0] : null, cm = m ? childIds(g, m)[0] : null;
      return cs && cm && childIds(g, recBy(g, cs)).length === t.n && childIds(g, recBy(g, cm)).length === t.n;
    });
    if (done) { fs.copyFileSync(inAbs, outAbs); console.log('  （幂等：三模板层数已满足 → 原样复制）'); return 0; }
  }
  const re = build(g, data);
  console.log('  新增 ' + re.added.length + ' 层；删除旧层 ' + re.deleted.length + ' 条；记录数 → ' + re.expectRecs);
  if (re.expectRecs >= 1000) console.log('  ⚠️ 记录数 ' + re.expectRecs + ' ≥ 1000（lead 预估约 1518，继续）');
  const tmp = path.join(os.tmpdir(), 'gen_528_' + process.pid + '_' + Date.now() + '.gil');
  try {
    const buf = g.pack(encodeMsg(g.tree)); fs.writeFileSync(tmp, buf);
    const d = diffTrees(loadTree(g.file), loadTree(tmp), 100000);
    console.log('  · 预计算字段差异 = ' + d.total);
    if (DRY) {
      const g2 = readGil(tmp); const ok = assertAll(g2, re, data); console.log(ok === true ? '' : ok);
      console.log('[--dry] 输出 ' + buf.length + ' 字节，记录 ' + re.expectRecs);
      return ok === true ? 0 : 3;
    }
    const rep = writeGil(g, tmp, {
      label: 'gen_rich_layers 富图元层', expectRecs: re.expectRecs, expectDiffs: d.total,
      assert: (g2) => assertAll(g2, re, data),
    });
    fs.copyFileSync(tmp, outAbs);
    console.log('  写出 ' + basenameOf(outAbs) + '：' + rep.bytes + ' 字节 / ' + rep.recs + ' 条');
    const res = gates(outAbs, inAbs, { expectDiffs: d.total });
    const all = res.every(([, ok]) => ok);
    console.log('\n  三模板：');
    for (const p of re.plans) console.log('   ' + p.name.padEnd(12) + ' 源 #' + p.src + ' 母本 #' + p.mst + ' content ' + p.contentS + '/' + p.contentM + ' 新层 ' + p.n + '×2');
    console.log('  闸门：' + res.map(([n, ok]) => n + ' ' + (ok ? '✅' : '❌')).join('  '));
    return all ? 0 : 4;
  } finally { if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } } }
}
process.exit(main());
