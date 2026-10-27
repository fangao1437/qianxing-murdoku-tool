// tools/gil/gen_nest_test.mjs —— 模板嵌套测试档 `516-模板测试-v1.gil`（基于用户的 515.gil）
//
// ════════════════════════════════════════════════════════════════════════════
// 目的（lead 2026-10-22 第十二轮）：
//   用户按 "cell 实例化" 架构手改了 515.gil，想验证两件事：
//     ① 脚本能不能在**运行时改模板引用控件**的"引用模板"；
//     ② **模板里再放一个模板引用控件（嵌套）**，第二层能不能正常实例化。
//   本工具只做结构（不碰 lua）：
//     A. 新建模板 `furn.nest`（源+母本成对，画布 108×108）；**母本的 content 里放 1 个
//        模板引用控件 `inner`**，引用 `furn.plant` 的**模板源 GUID**（= 模板引用控件的既有约定）。
//     B. 把 `cell.1.1/content/furn#1073747082`（用户手加的模板引用控件）的引用改成 `furn.nest`
//        的**源 GUID**。
//     其余模板/控件/记录一律不动。
//
//   ★ 关于"引用源还是母本"：515 里用户那个引用控件（#1073747082）的引用值是 **1073747079
//     = furn.chair 的源**（母本是 1073747078）；仓内 `tpl.stage` 引用的 1073742330 也是
//     tpl-container 的**源**。⇒ 模板引用控件的引用值 = **模板源 GUID**（Instantiate 用的那个）。
//     本工具默认按此约定；若 lead 要按字面改成"母本"，加 `--ref-target=mother` 重跑。
//
//   ★ 结构（模板对，与 `cell.1.1` 同构）：
//       nest 源（无父；组件[1,2,4]；#14→母本；族号 85；108×108）
//        └ content（无名容器，108×108）           ← 用户 515 的模板 content 都无名字
//       nest 母本（父 1073741844；组件[1,2,3]；#13→源）
//        └ content（无名容器，108×108）
//            └ inner（模板引用控件：槽 66/89 + /505/503/77/#501 = furn.plant 源 1073747081）
//   （用户 515 的模板 content 只在**母本**里放了 ref 控件（cell 侧 #7082 就在母本 content 里），
//     本工具按同一习惯：inner 只放母本 content，源 content 保持空。）
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_nest_test.mjs --in=515.gil --out=516-模板测试-v1.gil [--dry]
//        [--ref-target=source|mother] [--family=85]
//   退出码：0 成功（含幂等"无需改动"）；1 用法错；2 基线结构不符；3 断言/写入失败；4 外部闸门失败
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, findChildListTop, setChildList, asIdList,
  stateBlocks, pairOf, pairValue, setPair, textsOf, writeVarint, ID_LO, ID_HI, ensureChildListTop,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

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
const REF_TARGET = argOf('ref-target', 'source');     // source（默认，按 515/tpl.stage 约定）| mother
const FAMILY = Number(argOf('family', '85'));

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const TEMPLATE_MASTER_PARENT = 1073741844;
const NEST = 'furn.nest';
const INNER = 'inner';
const CANVAS = 108;
const USER_CELL_REF = 1073747082;                    // 用户 515 里 cell.1.1/content/furn 的模板引用控件
const PLANT_SOURCE = 1073747081;                     // furn.plant 模板源
const PLANT_MOTHER = 1073747080;                     // furn.plant 母本

const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const basenameOf = (p) => path.basename(p);

// ── 字段级 helper ─────────────────────────────────────────────────────────
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
    if (v.wt === 0) { v.num = BigInt(newId); return; }
    v.payload = writeVarint(newId); v.len = v.payload.length; v.isText = false; v.sub = null;
    return;
  }
  fatal('组件 #' + compNo + ' 找不到 #11/#12/#13/#14');
}
/** 模板引用控件的引用叶子：/505(501=66,502=89)/503/77/#501 */
function refLeafOf(recField) {
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
function readRefValue(recField) {
  const l = refLeafOf(recField)[0];
  return l ? Number(l.num) : null;
}
function setRefValue(recField, newId) {
  const leaves = refLeafOf(recField);
  if (leaves.length !== 1) fatal('模板引用控件的引用叶子 ' + leaves.length + ' 个（预期 1）');
  leaves[0].num = BigInt(newId);
}
function stateSummary(recField) {
  return stateBlocks(recField.sub, []).map((b) => {
    const pos = pairOf(b, 504), size = pairOf(b, 505);
    return {
      block: b, pos, size,
      x: pairValue(pos, 0), y: pairValue(pos, 1), w: pairValue(size, 0), h: pairValue(size, 1),
      aMinX: pairValue(pairOf(b, 502), 0), aMaxX: pairValue(pairOf(b, 503), 0),
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
const nameOf = (tree, id) => { const r = recBy(tree, id); return r ? r.name : '#' + id; };

// ── 定位原型：用户 515 的 furn.chair 模板对 + 它的两个 content + 引用控件 #7082 ──
function findProtos(g) {
  const src = g.recs.find((r) => r.name === 'furn.chair' && r.parentId == null);
  const mst = g.recs.find((r) => r.name === 'furn.chair' && Number(r.parentId) === TEMPLATE_MASTER_PARENT);
  if (!src || !mst) fatal('515 里找不到 furn.chair 模板对（源/母本）', 2);
  const sKids = (asIdList(findChildListTop(src.field.sub).payload, true) || []).map(Number);
  const mKids = (asIdList(findChildListTop(mst.field.sub).payload, true) || []).map(Number);
  const sContent = sKids.length === 1 ? recBy(g, sKids[0]) : null;
  const mContent = mKids.length === 1 ? recBy(g, mKids[0]) : null;
  if (!sContent || !mContent) fatal('furn.chair 的 content 不是"各 1 个"（源 ' + sKids.length + ' / 母本 ' + mKids.length + '）', 2);
  const userRef = recBy(g, USER_CELL_REF);
  if (!userRef) fatal('515 里找不到 cell 引用控件 #' + USER_CELL_REF, 2);
  if (!refLeafOf(userRef.field).length) fatal('#' + USER_CELL_REF + ' 不是模板引用控件（没有 66/89 引用叶子）', 2);
  console.log('  · 原型：furn.chair 源 #' + src.id + ' ↔ 母本 #' + mst.id
    + '；content #' + sContent.id + ' / #' + mContent.id
    + '；用户引用控件 #' + userRef.id + '（引用 ' + readRefValue(userRef.field) + ' = furn.chair 源）');
  return { src, mst, sContent, mContent, userRef };
}
function findPlant(g) {
  const s = recBy(g, PLANT_SOURCE), m = recBy(g, PLANT_MOTHER);
  if (!s || !m) fatal('515 里找不到 furn.plant 源/母本（#' + PLANT_SOURCE + ' / #' + PLANT_MOTHER + '）', 2);
  if (s.name !== 'furn.plant' || s.parentId != null) fatal('#' + PLANT_SOURCE + ' 不是 furn.plant 源', 2);
  if (m.name !== 'furn.plant' || Number(m.parentId) !== TEMPLATE_MASTER_PARENT) fatal('#' + PLANT_MOTHER + ' 不是 furn.plant 母本', 2);
  return { s, m };
}

// ── 建 nest 对 + content + inner + 改 #7082 引用 ──────────────────────────
function build(g, pr, plant) {
  const re = { added: [], changed: [], nestSource: null, nestMother: null, inner: null, target: null, innerRefTarget: null };
  const existS = g.recs.find((r) => r.name === NEST && r.parentId == null);
  const existM = g.recs.find((r) => r.name === NEST && Number(r.parentId) === TEMPLATE_MASTER_PARENT);
  const wantInnerRef = REF_TARGET === 'mother' ? plant.m.id : plant.s.id;
  re.innerRefTarget = wantInnerRef;
  re.target = null;

  const { used, maxGuid } = scanGuidUsage(g.tree);
  // 新建子列表时借一个现成的 #503 字段当模板（field/wt 照抄）
  const clProto = findChildListTop(pr.mst.field.sub) || findChildListTop(pr.src.field.sub);
  let nextId = maxGuid + 1;
  const alloc = {
    ids: [],
    take() { while (used.has(nextId)) nextId++; if (nextId >= ID_HI_NUM) fatal('GUID 号段耗尽'); const v = nextId++; used.add(v); alloc.ids.push(v); return v; },
  };

  const mk = (proto, newName, parentId, geom, refs, forcedId) => {
    const clone = cloneField(proto.field);
    const nid = (forcedId != null) ? forcedId : alloc.take();
    if (forcedId != null) { used.add(forcedId); alloc.ids.push(forcedId); }
    const selfCnt = countVarintEqual(proto.field.sub, proto.id);
    const n = remapSelfIds(clone.sub, proto.id, nid);
    if (n !== selfCnt) fatal(NEST + ' 克隆：自身 GUID 替换 ' + n + '/' + selfCnt + ' 处（' + proto.name + '）');
    if (proto.name != null) {
      const rn = renameRecord(clone.sub, proto.name, newName);
      if (!rn.ok) fatal(newName + ' 改名命中 ' + rn.hits + ' 处');
    }
    const p504 = topVarint(clone.sub, 504);
    if (parentId == null) { if (p504) fatal(newName + ' 应无父但带 #504'); }
    else { if (!p504) fatal(newName + ' 缺 #504'); p504.num = BigInt(parentId); }
    const st = stateSummary(clone);
    if (st.length !== 4) fatal(newName + ' 状态块 ' + st.length + ' 个（预期 4）');
    for (const s of st) {
      setPair(s.pos, geom.x, geom.y); setPair(s.size, geom.w, geom.h);
      if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) fatal(newName + ' 锚点/中心不是 0.5');
    }
    if (refs) refs(clone, nid);
    g.recHolder.push(clone);
    re.added.push({ name: newName, id: nid, parent: parentId });
    return { field: clone, id: nid };
  };

  if (existS && existM) {
    console.log('  · 幂等：' + NEST + ' 已存在（源 #' + existS.id + ' / 母本 #' + existM.id + '），不重建');
    re.nestSource = existS.id; re.nestMother = existM.id;
    re.existing = true;
    // 取回 mother content 与 inner
    const mKids = (asIdList(findChildListTop(existM.field.sub).payload, true) || []).map(Number);
    const mContent = mKids.length === 1 ? recBy(g, mKids[0]) : null;
    const inner = mContent ? g.recs.find((r) => r.name === INNER && Number(r.parentId) === Number(mContent.id)) : null;
    if (!inner) fatal(NEST + ' 已存在但母本 content 里没有 ' + INNER, 2);
    re.inner = inner.id;
    re.existingInner = inner.field;
  } else if (existS || existM) {
    fatal(NEST + ' 只存在一半（源/母本）', 2);
  } else {
    // 先定 nest 源/母本 GUID（源在前）
    const nestSource = alloc.take();
    const nestMother = alloc.take();
    re.nestSource = nestSource; re.nestMother = nestMother;
    re.target = nestSource;
    const src = mk(pr.src, NEST, null, { x: 0, y: 0, w: CANVAS, h: CANVAS }, (f) => { setCompRef(f, 2, FAMILY); setCompRef(f, 4, nestMother); }, nestSource);
    const mst = mk(pr.mst, NEST, TEMPLATE_MASTER_PARENT, { x: 0, y: 0, w: CANVAS, h: CANVAS }, (f) => { setCompRef(f, 2, FAMILY); setCompRef(f, 3, nestSource); }, nestMother);
    // 两份 content（无名容器，清空子列表）
    const cS = mk(pr.sContent, 'content', nestSource, { x: 0, y: 0, w: CANVAS, h: CANVAS });
    const cM = mk(pr.mContent, 'content', nestMother, { x: 0, y: 0, w: CANVAS, h: CANVAS });
    for (const [pf, cid] of [[src.field, cS.id], [mst.field, cM.id]]) {
      const cl = findChildListTop(pf.sub);
      if (!cl) fatal(NEST + ' 缺子列表');
      setChildList(cl, [cid]);
      // content 可能原本没有子列表字段（用户 515 的模板 content 是空容器）⇒ 没有就新建
      const ccl = ensureChildListTop({ field: (cid === cS.id ? cS.field : cM.field) }, clProto);
      setChildList(ccl, []);
    }
    // inner：克隆用户 #7082（模板引用控件），父 = 母本 content，引用 = plant 目标
    const inner = mk(pr.userRef, INNER, cM.id, { x: 0, y: 0, w: CANVAS, h: CANVAS }, (f) => { setRefValue(f, wantInnerRef); });
    re.inner = inner.id; re.innerField = inner.field;
    // inner 进母本 content 子列表
    const cMcl = ensureChildListTop({ field: cM.field }, clProto);
    setChildList(cMcl, [inner.id]);
    console.log('  · 新建 ' + NEST + '：源 #' + nestSource + ' ↔ 母本 #' + nestMother
      + '（族 ' + FAMILY + '，画布 ' + CANVAS + '×' + CANVAS + '）；inner #' + inner.id
      + '（引用 ' + wantInnerRef + ' = furn.plant ' + (REF_TARGET === 'mother' ? '母本' : '源') + '）');
  }

  // 改用户引用控件 #7082 的引用 → nest 目标
  const userRef = recBy(g, USER_CELL_REF);
  if (!userRef) fatal('找不到 #' + USER_CELL_REF, 2);
  const cur = readRefValue(userRef.field);
  const wantNestRef = re.target || re.nestSource;
  if (cur !== wantNestRef) {
    setRefValue(userRef.field, wantNestRef);
    re.changed.push({ name: 'cell.1.1/content/furn', id: USER_CELL_REF, before: cur, after: wantNestRef });
    console.log('  · 改 #' + USER_CELL_REF + ' 引用：' + cur + ' → ' + wantNestRef + '（' + NEST + ' 源）');
  } else {
    console.log('  · 幂等：#' + USER_CELL_REF + ' 引用已是 ' + cur + '（= ' + NEST + ' 源），不改');
  }
  return re;
}

// ── 断言（写入前内存 + 写入后重读两次）────────────────────────────────────
function assertNest(g2, re, plant) {
  const bad = [];
  const s = recBy(g2, re.nestSource), m = recBy(g2, re.nestMother);
  if (!s || !m) return '✗ 重读后找不到 ' + NEST + ' 源/母本';
  if (s.name !== NEST || s.parentId != null) bad.push('nest 源名/父不符（' + s.name + '/' + s.parentId + '）');
  if (m.name !== NEST || Number(m.parentId) !== TEMPLATE_MASTER_PARENT) bad.push('nest 母本名/父不符（' + m.name + '/' + m.parentId + '）');
  const sRef = compRef(s.field, 4), mRef = compRef(m.field, 3);
  if (!sRef || sRef.value !== Number(re.nestMother)) bad.push('源 #14=' + (sRef && sRef.value) + '（预期 ' + re.nestMother + '）');
  if (!mRef || mRef.value !== Number(re.nestSource)) bad.push('母本 #13=' + (mRef && mRef.value) + '（预期 ' + re.nestSource + '）');
  for (const [nm, r] of [['源', s], ['母本', m]]) {
    const fam = compRef(r.field, 2);
    if (!fam || fam.value !== FAMILY) bad.push(nm + ' 族号=' + (fam && fam.value) + '（预期 ' + FAMILY + '）');
    const st = stateSummary(r.field);
    for (const x of st) if (Math.abs(x.w - CANVAS) > 0.02 || Math.abs(x.h - CANVAS) > 0.02) bad.push(nm + ' 画布 ' + x.w + 'x' + x.h);
    const cl = findChildListTop(r.field.sub);
    const kids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
    if (kids.length !== 1) bad.push(nm + ' content 数 ' + kids.length + '（预期 1）');
  }
  // 母本 content 里 1 个 inner（模板引用控件），引用 = plant 目标
  const mKids = (asIdList(findChildListTop(m.field.sub).payload, true) || []).map(Number);
  const mContent = mKids.length === 1 ? recBy(g2, mKids[0]) : null;
  if (!mContent) bad.push('母本 content 缺失');
  else {
    const cst = stateSummary(mContent.field);
    for (const x of cst) if (Math.abs(x.w - CANVAS) > 0.02 || Math.abs(x.h - CANVAS) > 0.02) bad.push('母本 content 画布 ' + x.w + 'x' + x.h);
    const ccl = findChildListTop(mContent.field.sub);
    const kids = ccl ? (asIdList(ccl.payload, true) || []).map(Number) : [];
    if (kids.length !== 1) bad.push('母本 content 子控件 ' + kids.length + '（预期 1 个 inner）');
    const inner = kids.length ? recBy(g2, kids[0]) : null;
    if (!inner) bad.push('inner 缺失');
    else {
      if (inner.name !== INNER) bad.push('inner 名=' + inner.name);
      if (Number(inner.parentId) !== Number(mContent.id)) bad.push('inner 父=' + inner.parentId);
      const rv = readRefValue(inner.field);
      if (Number(rv) !== Number(re.innerRefTarget)) bad.push('inner 引用=' + rv + '（预期 ' + re.innerRefTarget + '）');
      const ist = stateSummary(inner.field);
      for (const x of ist) if (Math.abs(x.w - CANVAS) > 0.02 || Math.abs(x.h - CANVAS) > 0.02) bad.push('inner 尺寸 ' + x.w + 'x' + x.h);
      if (isHiddenRec(inner.field)) bad.push('inner 应为 visible=true');
    }
  }
  // 源 content 应无子控件（与 515 用户的模板习惯一致）
  const sKids = (asIdList(findChildListTop(s.field.sub).payload, true) || []).map(Number);
  const sContent = sKids.length === 1 ? recBy(g2, sKids[0]) : null;
  if (sContent) {
    const scl = findChildListTop(sContent.field.sub);
    const sk = scl ? (asIdList(scl.payload, true) || []).map(Number) : [];
    if (sk.length !== 0) bad.push('源 content 应空（实际 ' + sk.length + ' 个）');
  }
  // 用户引用控件 #7082
  const ur = recBy(g2, USER_CELL_REF);
  if (!ur) bad.push('找不到 #' + USER_CELL_REF);
  else {
    const rv = readRefValue(ur.field);
    if (rv !== Number(re.target || re.nestSource)) bad.push('#' + USER_CELL_REF + ' 引用=' + rv + '（预期 ' + (re.target || re.nestSource) + '）');
  }
  if (bad.length) return '✗ nest 断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ nest 断言：源 #' + re.nestSource + ' ↔ 母本 #' + re.nestMother
    + '（族 ' + FAMILY + '、108×108、#14/#13 闭合）；母本 content 里 inner #' + re.inner
    + ' 引用 ' + re.innerRefTarget + '；#' + USER_CELL_REF + ' 引用 = ' + (re.target || re.nestSource));
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

  say('\n── ④ diff_fields.mjs（515 → 516）──');
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]);
  say(df.stdout.trim());
  const m = /差异：(\d+) 处/.exec(df.stdout);
  const got = m ? Number(m[1]) : -1;
  const want = cnt.expectedDiffs;
  results.push({ name: 'diff_fields', pass: got === want && (want === 0 ? df.status === 0 : df.status === 3) });
  say('  ⇒ ' + (got === want ? '✅ 通过：差异 ' + got + ' 处（1 记录数组条数 + ' + re.changed.length + ' 引用值变化 = ' + want + '）'
    : '❌ 未通过：差异 ' + got + '，预期 ' + want));

  say('\n── ⑤ 回读：nest 对 / inner / #7082 / 记录数 ──');
  const g3 = readGil(outAbs);
  const s = recBy(g3, re.nestSource), mm = recBy(g3, re.nestMother);
  say('  ' + NEST + ' 源 #' + s.id + '（父=' + (s.parentId == null ? 'null' : s.parentId) + '）↔ 母本 #' + mm.id + '（父=' + mm.parentId + '）');
  const mKids = (asIdList(findChildListTop(mm.field.sub).payload, true) || []).map(Number);
  const mContent = recBy(g3, mKids[0]);
  const inner = g3.recs.find((r) => r.name === INNER && Number(r.parentId) === Number(mContent.id));
  say('  母本 content #' + mContent.id + ' → inner #' + inner.id + '，引用回读 = ' + readRefValue(inner.field)
    + '（= furn.plant ' + (REF_TARGET === 'mother' ? '母本 #1073747080' : '源 #1073747081') + '）');
  const ur = recBy(g3, USER_CELL_REF);
  say('  #' + USER_CELL_REF + ' 引用回读 = ' + readRefValue(ur.field) + '（= ' + NEST + ' 源 #' + re.nestSource + '）');
  say('  记录数：515 = ' + cnt.baseRecs + ' → 516 = ' + g3.recs.length + '（+' + (g3.recs.length - cnt.baseRecs) + '）');
  const countOk = g3.recs.length === cnt.expectedRecs && (g3.recs.length - cnt.baseRecs) === cnt.added;
  results.push({ name: 'readback', pass: countOk });
  say('  ⇒ ' + (countOk ? '✅ 记录数/内容回读通过' : '❌ 记录数不符（预期 ' + cnt.expectedRecs + '）'));
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────
function main() {
  if (!IN || !OUT) {
    console.error('用法: node tools/gil/gen_nest_test.mjs --in=515.gil --out=516-模板测试-v1.gil [--dry] [--ref-target=source|mother] [--family=85]');
    process.exit(1);
  }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到输入存档：' + inAbs, 1);
  console.log('══ gen_nest_test —— 模板嵌套测试：新建 furn.nest（母本 content 里放 inner→furn.plant）+ 改 cell 引用 ──');
  console.log('  输入 ' + basenameOf(inAbs) + '（' + fs.statSync(inAbs).size + ' 字节）');
  console.log('  输出 ' + basenameOf(outAbs) + '（' + (DRY ? '--dry 只预测不写' : '写') + '）');
  console.log('  · 引用目标：' + REF_TARGET + '（默认 source = 515/tpl.stage 的实际约定；mother 仅为字面口径备选）');
  const g = readGil(inAbs);
  console.log('  基线记录 ' + g.recs.length + ' 条，maxId=' + g.maxId);
  const pr = findProtos(g);
  const plant = findPlant(g);
  const re = build(g, pr, plant);

  const added = re.added.length;
  const cnt = {
    baseRecs: g.recs.length,
    added,
    expectedRecs: g.recs.length + added,
    expectedDiffs: (added ? 1 : 0) + re.changed.length,
  };
  console.log('  · 新增 ' + added + ' 条：' + re.added.map((a) => a.name + '#' + a.id).join(', '));
  console.log('  · 预期：记录 ' + cnt.baseRecs + ' → ' + cnt.expectedRecs + '；diff_fields = ' + cnt.expectedDiffs + ' 处（数组' + (added ? ' +1' : '') + (re.changed.length ? ' + ' + re.changed.length + ' 引用值' : '') + '）');
  if (cnt.expectedRecs >= 1000) fatal('记录数 ' + cnt.expectedRecs + ' ≥ 1000，停下报数', 2);

  if (DRY) {
    const buf = g.pack(encodeMsg(g.tree));
    console.log('\n[--dry] 不写。预测字节 ' + g.src.length + ' → ' + buf.length + '（+' + (buf.length - g.src.length) + '）');
    console.log('  ' + NEST + ' 源 #' + re.nestSource + ' / 母本 #' + re.nestMother + '；inner #' + re.inner + '（引用 ' + re.innerRefTarget + '）');
    return 0;
  }

  let tmp = null;
  try {
    const noChange = (cnt.added === 0 && re.changed.length === 0);
    if (noChange) {
      // 幂等：本来就是目标状态 ⇒ 原样复制（writeGil 会拒绝"逐字节相同"的输出，因为它按编辑分类）
      fs.copyFileSync(inAbs, outAbs);
      console.log('  （幂等：无需改动，原样复制 → ' + basenameOf(outAbs) + '）');
    } else {
      tmp = path.join(os.tmpdir(), 'gen_nest_' + process.pid + '_' + Date.now() + '.gil');
      const rep = writeGil(g, tmp, {
        label: 'gen_nest_test 模板嵌套测试',
        expectRecs: cnt.expectedRecs,
        expectDiffs: cnt.expectedDiffs,
        assert: (g2) => assertNest(g2, re, plant),
      });
      fs.copyFileSync(tmp, outAbs);
      console.log('  写出 ' + basenameOf(outAbs) + '：' + rep.bytes + ' 字节 / ' + rep.recs + ' 条');
    }
    const results = runGates(outAbs, inAbs, cnt, re);
    const allPass = results.every((r) => r.pass);
    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + fs.statSync(outAbs).size + ' 字节，记录 ' + cnt.expectedRecs + ' 条）');
    console.log('  ' + NEST + '：源 GUID = ' + re.nestSource + '；母本 GUID = ' + re.nestMother);
    console.log('  furn.plant：源 GUID = ' + plant.s.id + '；母本 GUID = ' + plant.m.id);
    console.log('  inner 引用 = ' + re.innerRefTarget + '；#' + USER_CELL_REF + ' 引用 = ' + (re.target || re.nestSource));
    console.log('  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
    if (!allPass) { console.error('\n❌ 外部闸门未全过 —— 文件已写出但**不要导入**。'); return 4; }
    console.log('  ★ 全部通过。');
    return 0;
  } finally {
    if (tmp && fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

process.exit(main());
