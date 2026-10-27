// tools/gil/gen_editor_templates.mjs —— 521：把 520.gil 里的 7 个手写家具模板
//                                    **按用户 515.gil 里"编辑器建出来的模板"骨架重建**（同 GUID、同内容）
//
// ════════════════════════════════════════════════════════════════════════════
// 背景（lead 2026-10-23）：
//   用户反馈"你根本没把家具模板建进存档" —— 排查发现 520.gil 里我们手写的 7 对家具模板
//   （furn.chair 6900/6901 …）**形状与编辑器建的模板不同**：
//     · 520 手写对（克隆自 `cell.1.1` 格子模板）带组件块 `/505(501=70,502=93)`：
//         `#80` 空 + `#503/#81{...}` 里还残留**对 cell content 1073741888 的旧引用**
//         （cell 类模板才有的组件 ⇒ 编辑器可能因此不把它当"客户端控件模板"登记）；
//     · 用户 515 编辑器建的家具模板没有 `70/93`，而是 `/505(501=68,502=91)`（`#78` 空 + `#503/#79` 空）；
//     · 模板根尺寸：编辑器建的是 150×150，我们写的是 108×108（内容画布才应是 108/216）。
//   ⇒ 本工具：以 515 的 `furn.chair` 编辑器模板对为**骨架**，重建 520 里 7 对家具模板：
//        · 复用原 GUID（源 6900/6902/…/6912、母本 +1）⇒ cfg.furn_tpl_prefab 不用改；
//        · 保留原有 content（14 个）与 142 层**不动**（只把模板对的 childList 指回原 content）；
//        · 名字/族号（80~86）/#14↔#13 母本链照旧；模板根尺寸 = 150×150（编辑器形态）；
//        · 其它记录一律不动（cell 模板/布局/引用控件等）。
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_editor_templates.mjs --in=520.gil --out=521-一二关美术-容器-v8.gil \
//        [--skeleton=515.gil] [--dry]
//   退出码：0 成功（含幂等）；1 用法错；2 基线/骨架结构不符；3 断言/写入失败；4 外部闸门失败
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
const SKEL = argOf('skeleton', '515.gil');
const SPEC = argOf('spec', path.join(WORKSPACE, 'murdoku-project', '美术实现-一二关-2026-10-22', '家具模板层规格-v310.json'));
const DRY = hasFlag('dry');

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const TEMPLATE_MASTER_PARENT = 1073741844;
const SKEL_CHAIR_SRC = 1073747079;   // 515 编辑器建的 furn.chair 源
const SKEL_CHAIR_MST = 1073747078;   // 515 编辑器建的 furn.chair 母本
const TEMPLATE_ROOT_SIZE = 150;      // 编辑器模板根尺寸（用户 515 实测）
const USER_REF = 1073747082;         // 515 里用户手加引用控件（与本档无关，仅参考）
// 7 个模板：名字 / cfg key / 族号 / 源 GUID / 母本 GUID / 规格 key
const PLAN = [
  { name: 'furn.chair', cfg: 'chair', family: 80, src: 1073746900, mst: 1073746901, spec: 'furn.chair', layers: 9, cw: 108, ch: 108 },
  { name: 'furn.plant', cfg: 'plant', family: 81, src: 1073746902, mst: 1073746903, spec: 'furn.plant', layers: 10, cw: 108, ch: 108 },
  { name: 'furn.statue', cfg: 'statue', family: 82, src: 1073746904, mst: 1073746905, spec: 'furn.statue', layers: 10, cw: 108, ch: 108 },
  { name: 'furn.table.1', cfg: 'table', family: 83, src: 1073746906, mst: 1073746907, spec: 'furn.table.1', layers: 10, cw: 108, ch: 108 },
  { name: 'furn.table.h2', cfg: 'table_h2', family: 84, src: 1073746908, mst: 1073746909, spec: 'furn.table.h2', layers: 10, cw: 216, ch: 108 },
  { name: 'furn.table.v2', cfg: 'table_v2', family: 85, src: 1073746910, mst: 1073746911, spec: 'furn.table.v2', layers: 10, cw: 108, ch: 216 },
  { name: 'furn.shelf', cfg: 'shelf', family: 86, src: 1073746912, mst: 1073746913, spec: 'furn.shelf', layers: 12, cw: 108, ch: 108 },
];

const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const basenameOf = (p) => path.basename(p);
const recBy = (tree, id) => tree.recs.find((r) => Number(r.id) === Number(id)) || null;
const childIds = (tree, rec) => {
  const cl = rec ? findChildListTop(rec.field.sub) : null;
  return cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
};

// ── 字段 helper（沿用前几轮）────────────────────────────────────────────
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
    if (v.wt === 0) return Number(v.num);
    const pay = v.payload || Buffer.alloc(0);
    let r = 0n, s = 0n, p = 0;
    while (p < pay.length) { const x = pay[p++]; r |= BigInt(x & 0x7f) << s; if ((x & 0x80) === 0) break; s += 7n; }
    return p === pay.length ? Number(r) : null;
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
}
function stateSummary(recField) {
  return stateBlocks(recField.sub, []).map((b) => {
    const pos = pairOf(b, 504), size = pairOf(b, 505);
    return { block: b, pos, size, x: pairValue(pos, 0), y: pairValue(pos, 1), w: pairValue(size, 0), h: pairValue(size, 1), aMinX: pairValue(pairOf(b, 502), 0), aMaxX: pairValue(pairOf(b, 503), 0), pivX: pairValue(pairOf(b, 506), 0), pivY: pairValue(pairOf(b, 506), 1) };
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
/** #505 组件块签名：('501=68,502=91') 这类 → 用于比对"编辑器模板形态" */
function slotSigs(recField) {
  const out = [];
  for (const f of recField.sub || []) {
    if (f.field !== 505 || !f.sub) continue;
    const a = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const b = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (!a || !b) continue;
    out.push(Number(a.num) + '/' + Number(b.num));
  }
  return out.sort();
}
const SKEL_SLOTS = ['1/12', '2/15', '4/86', '63/83', '67/90', '68/91'];

// ── 规格校验（只要层数/画布）──────────────────────────────────────────
function loadSpec() {
  const file = path.isAbsolute(SPEC) ? SPEC : path.resolve(WORKSPACE, SPEC);
  if (!fs.existsSync(file)) fatal('找不到规格：' + file, 1);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const tpls = doc.templates || {};
  for (const p of PLAN) {
    const t = tpls[p.spec];
    if (!t) fatal('规格缺 templates["' + p.spec + '"]', 2);
    const [cw, ch] = t.sizePx.map(Number);
    if (cw !== p.cw || ch !== p.ch) fatal(p.spec + ' 规格画布 ' + cw + 'x' + ch + '（预期 ' + p.cw + 'x' + p.ch + '）', 2);
    if (!Array.isArray(t.layers) || t.layers.length !== p.layers) fatal(p.spec + ' 层数 ' + (t.layers || []).length + '（预期 ' + p.layers + '）', 2);
  }
  console.log('  · 规格校验通过：7 模板 71 层 / 画布尺寸与 PLAN 一致');
}

// ── 主流程 ───────────────────────────────────────────────────────────────
function build(g, skel) {
  const re = { changed: [], skipped: [], plans: [], idempotent: false };
  // 骨架校验
  const skelSrc = recBy(skel, SKEL_CHAIR_SRC), skelMst = recBy(skel, SKEL_CHAIR_MST);
  if (!skelSrc || !skelMst) fatal('515 骨架里找不到 furn.chair 源/母本', 2);
  const skelSlots = slotSigs(skelSrc.field);
  if (skelSlots.join(',') !== SKEL_SLOTS.join(',')) fatal('骨架源组件槽不符：' + skelSlots.join(','), 2);
  if (slotSigs(skelMst.field).join(',') !== SKEL_SLOTS.join(',')) fatal('骨架母本组件槽不符', 2);
  console.log('  · 骨架：515 furn.chair 源 #' + skelSrc.id + ' / 母本 #' + skelMst.id + '，组件槽 [' + skelSlots.join(' ') + ']');
  let fixedCount = 0;
  for (const p of PLAN) {
    const oldSrc = recBy(g, p.src), oldMst = recBy(g, p.mst);
    if (!oldSrc || !oldMst) fatal('520 里找不到 ' + p.name + ' 源/母本（#' + p.src + '/#' + p.mst + '）', 2);
    if (oldSrc.name !== p.name || oldMst.name !== p.name) fatal('#' + p.src + '/#' + p.mst + ' 名字不是 ' + p.name, 2);
    const contentS = recBy(g, childIds(g, oldSrc)[0]);
    const contentM = recBy(g, childIds(g, oldMst)[0]);
    if (!contentS || !contentM) fatal(p.name + ' 的 content 缺失', 2);
    // content 断言：尺寸/层数/层名 保持原样（本工具不动内容）
    const cst = stateSummary(contentS.field)[0];
    if (Math.abs(cst.w - p.cw) > 0.02 || Math.abs(cst.h - p.ch) > 0.02) fatal(p.name + ' content 尺寸 ' + cst.w + 'x' + cst.h + '（预期 ' + p.cw + 'x' + p.ch + '）', 2);
    const lids = childIds(g, contentS);
    if (lids.length !== p.layers) fatal(p.name + ' content 层数 ' + lids.length + '（预期 ' + p.layers + '）', 2);
    const badLayer = lids.findIndex((id, i) => (recBy(g, id) || {}).name !== 'L' + String(i + 1).padStart(2, '0'));
    if (badLayer >= 0) fatal(p.name + ' 第 ' + (badLayer + 1) + ' 层名字不符（期望 L' + String(badLayer + 1).padStart(2, '0') + '）', 2);
    // 幂等：当前对已经是编辑器形态？
    const curSlots = slotSigs(oldSrc.field);
    if (curSlots.join(',') === SKEL_SLOTS.join(',') && slotSigs(oldMst.field).join(',') === SKEL_SLOTS.join(',')) {
      re.skipped.push(p.name);
      fixedCount++;
      re.plans.push({ ...p, contentS: contentS.id, contentM: contentM.id, already: true });
      continue;
    }
    // 造新源：克隆骨架 → 换 id/名字/族号/#14/子列表/尺寸
    const newSrc = cloneField(skelSrc.field);
    const nsCnt = countVarintEqual(skelSrc.field.sub, skelSrc.id);
    const ns = remapSelfIds(newSrc.sub, skelSrc.id, p.src);
    if (ns !== nsCnt) fatal(p.name + ' 源：自身 GUID 替换 ' + ns + '/' + nsCnt + ' 处', 2);
    const rnS = renameRecord(newSrc.sub, 'furn.chair', p.name);
    if (!rnS.ok) fatal(p.name + ' 源：改名命中 ' + rnS.hits + ' 处', 2);
    setCompRef(newSrc, 2, p.family);
    setCompRef(newSrc, 4, p.mst);
    const clS = findChildListTop(newSrc.sub);
    if (!clS) fatal(p.name + ' 源：骨架无子列表', 2);
    setChildList(clS, [contentS.id]);
    for (const s of stateSummary(newSrc)) { setPair(s.pos, 0, 0); setPair(s.size, TEMPLATE_ROOT_SIZE, TEMPLATE_ROOT_SIZE); }
    // 造新母本
    const newMst = cloneField(skelMst.field);
    const nmCnt = countVarintEqual(skelMst.field.sub, skelMst.id);
    const nm = remapSelfIds(newMst.sub, skelMst.id, p.mst);
    if (nm !== nmCnt) fatal(p.name + ' 母本：自身 GUID 替换 ' + nm + '/' + nmCnt + ' 处', 2);
    const rnM = renameRecord(newMst.sub, 'furn.chair', p.name);
    if (!rnM.ok) fatal(p.name + ' 母本：改名命中 ' + rnM.hits + ' 处', 2);
    setCompRef(newMst, 2, p.family);
    setCompRef(newMst, 3, p.src);
    const clM = findChildListTop(newMst.sub);
    if (!clM) fatal(p.name + ' 母本：骨架无子列表', 2);
    setChildList(clM, [contentM.id]);
    for (const s of stateSummary(newMst)) { setPair(s.pos, 0, 0); setPair(s.size, TEMPLATE_ROOT_SIZE, TEMPLATE_ROOT_SIZE); }
    // 原位替换（同 holder / 同 index，保持记录位置稳定）
    oldSrc.holder[oldSrc.index] = newSrc;
    oldMst.holder[oldMst.index] = newMst;
    re.changed.push(p.name);
    re.plans.push({ ...p, contentS: contentS.id, contentM: contentM.id, already: false });
  }
  re.idempotent = re.changed.length === 0;
  return re;
}

// ── 结构断言（重读磁盘）：新对与骨架"归一化后逐行一致" ────────────────────
function normLines(rec, idSet, nameSet) {
  const out = [];
  (function walk(fs, p) {
    for (const f of fs) {
      const q = p + '/' + f.field;
      if (f.wt === 0) out.push(q + ' = ' + f.num);
      else if (f.wt === 5) out.push(q + ' = f' + f.f);
      else if (f.sub && f.sub.length) { out.push(q + ' [msg ' + f.sub.length + ']'); walk(f.sub, q); }
      else if (f.isText) out.push(q + ' [text]');
      else if (f.payload && f.payload.length) out.push(q + ' [pay ' + f.payload.length + ']');
      else out.push(q + ' [empty]');
    }
  })(rec.field.sub, '');
  return out.map((l) => {
    let s = l;
    for (const id of idSet) s = s.split(String(id)).join('<ID>');
    for (const nm of nameSet) s = s.split(nm).join('<NAME>');
    s = s.replace(/\/502\/12\/501 = \d+/, '/502/12/501 = <FAM>');   // 族号（骨架 78 vs 本档 80~86）
    return s;
  });
}
function assertEditor(g2, re, skel) {
  const bad = [];
  const skelSrc = recBy(skel, SKEL_CHAIR_SRC), skelMst = recBy(skel, SKEL_CHAIR_MST);
  const idSetSkel = [skelSrc.id, skelMst.id, ...childIds(skel, skelSrc), ...childIds(skel, skelMst)];
  let totalLayers = 0;
  for (const p of re.plans) {
    const s = recBy(g2, p.src), m = recBy(g2, p.mst);
    if (!s || !m) { bad.push(p.name + ' 缺源/母本'); continue; }
    if (s.name !== p.name || m.name !== p.name) bad.push(p.name + ' 名字不符');
    if (s.parentId != null) bad.push(p.name + ' 源有父=' + s.parentId);
    if (Number(m.parentId) !== TEMPLATE_MASTER_PARENT) bad.push(p.name + ' 母本父=' + m.parentId);
    const sRef = compRef(s.field, 4), mRef = compRef(m.field, 3);
    if (sRef !== Number(p.mst)) bad.push(p.name + ' 源 #14=' + sRef + '（预期 ' + p.mst + '）');
    if (mRef !== Number(p.src)) bad.push(p.name + ' 母本 #13=' + mRef + '（预期 ' + p.src + '）');
    if (compRef(s.field, 2) !== p.family || compRef(m.field, 2) !== p.family) bad.push(p.name + ' 族号不符');
    // ★ 核心：组件槽必须与骨架一致（有 68/91；没有 70/93）
    const ss = slotSigs(s.field), ms = slotSigs(m.field);
    if (ss.join(',') !== SKEL_SLOTS.join(',')) bad.push(p.name + ' 源组件槽 [' + ss.join(' ') + '] ≠ 骨架 [' + SKEL_SLOTS.join(' ') + ']');
    if (ms.join(',') !== SKEL_SLOTS.join(',')) bad.push(p.name + ' 母本组件槽 [' + ms.join(' ') + '] ≠ 骨架');
    // 归一化逐行比对（骨架形态的唯一权威）
    const ns = normLines(s, [p.src, p.mst, p.contentS, p.contentM, ...idSetSkel, s.id, m.id], ['furn.chair', p.name]);
    const nsSkel = normLines(skelSrc, [skelSrc.id, skelMst.id, ...idSetSkel], ['furn.chair']);
    const setA = new Set(ns), setB = new Set(nsSkel);
    const onlyA = ns.filter((l) => !setB.has(l)), onlyB = nsSkel.filter((l) => !setA.has(l));
    if (onlyA.length || onlyB.length) {
      bad.push(p.name + ' 源与骨架归一化不一致（仅本档 ' + onlyA.length + ' 行 / 仅骨架 ' + onlyB.length + ' 行）\n    仅本档: ' + onlyA.slice(0, 6).join(' ; ') + '\n    仅骨架: ' + onlyB.slice(0, 6).join(' ; '));
    }
    const nm = normLines(m, [p.src, p.mst, p.contentS, p.contentM, ...idSetSkel, s.id, m.id], ['furn.chair', p.name]);
    const nmSkel = normLines(skelMst, [skelSrc.id, skelMst.id, ...idSetSkel], ['furn.chair']);
    const setA2 = new Set(nm), setB2 = new Set(nmSkel);
    const onlyA2 = nm.filter((l) => !setB2.has(l)), onlyB2 = nmSkel.filter((l) => !setA2.has(l));
    if (onlyA2.length || onlyB2.length) bad.push(p.name + ' 母本与骨架归一化不一致（' + onlyA2.length + '/' + onlyB2.length + ' 行）');
    // 子列表 → 原 content；层数不变
    const cs = childIds(g2, s), cm = childIds(g2, m);
    if (cs.length !== 1 || Number(cs[0]) !== Number(p.contentS)) bad.push(p.name + ' 源子列表≠[content]');
    if (cm.length !== 1 || Number(cm[0]) !== Number(p.contentM)) bad.push(p.name + ' 母本子列表≠[content]');
    const cc = recBy(g2, p.contentS);
    if (cc) { totalLayers += childIds(g2, cc).length; }
    const st = stateSummary(s.field)[0];
    if (st && Math.abs(st.w - TEMPLATE_ROOT_SIZE) > 0.02) bad.push(p.name + ' 源根尺寸 ' + st.w);
  }
  if (totalLayers !== 71) bad.push('层记录总数 ' + totalLayers + '（预期 71，源侧计数）');
  // 其它关键记录未动
  const cellS = recBy(g2, 1073741876), cellM = recBy(g2, 1073741880);
  if (!cellS || !cellM) bad.push('cell.1.1 源/母本缺失');
  else {
    if (Number(childIds(g2, cellS)[0]) !== 1073741888) bad.push('cell.1.1 源 content 变了');
    if (Number(childIds(g2, cellM)[0]) !== 1073741886) bad.push('cell.1.1 母本 content 变了');
  }
  if (bad.length) return '✗ 编辑器形态断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 编辑器形态断言：14 个模板记录与 515 编辑器骨架**归一化后逐行一致**（组件槽 ' + SKEL_SLOTS.join(' ') + '，无 70/93），名/族/#14/#13/子列表/根尺寸全对；142 层与 cell 模板未动');
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

  say('\n── ④ diff_fields.mjs（520 → 521）──');
  const df = runNode('diff_fields.mjs', [inAbs, outAbs]);
  say(df.stdout.trim());
  const m = /差异：(\d+) 处/.exec(df.stdout);
  const got = m ? Number(m[1]) : -1;
  results.push({ name: 'diff_fields', pass: got === cnt.expectDiffs });
  say('  ⇒ ' + (got === cnt.expectDiffs ? '✅ 通过：差异 ' + got + ' 处 = 预计算（14 个模板记录被按骨架重建；其它记录未动）' : '❌ 未通过：' + got + ' ≠ 预期 ' + cnt.expectDiffs));

  say('\n── ⑤ 回读：7 模板槽位 + 记录数 ──');
  const g3 = readGil(outAbs);
  for (const p of cnt.plans) {
    const s = recBy(g3, p.src), m2 = recBy(g3, p.mst);
    say('  ' + p.name.padEnd(13) + ' 源 #' + p.src + ' 槽[' + slotSigs(s.field).join(' ') + ']  母本 #' + p.mst + ' 槽[' + slotSigs(m2.field).join(' ') + ']');
  }
  say('  记录数：520 = ' + cnt.baseRecs + ' → 521 = ' + g3.recs.length + '（' + (g3.recs.length - cnt.baseRecs) + '）');
  const ok = g3.recs.length === cnt.baseRecs;
  results.push({ name: 'readback', pass: ok });
  say('  ⇒ ' + (ok ? '✅ 记录数不变（只重建 14 个模板记录、内容/层未动）' : '❌ 记录数变了'));
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────
function main() {
  if (!IN || !OUT) {
    console.error('用法: node tools/gil/gen_editor_templates.mjs --in=520.gil --out=521-一二关美术-容器-v8.gil [--skeleton=515.gil] [--dry]');
    process.exit(1);
  }
  const inAbs = P(IN), outAbs = P(OUT), skelAbs = P(SKEL);
  if (!fs.existsSync(inAbs)) fatal('找不到输入：' + inAbs, 1);
  if (!fs.existsSync(skelAbs)) fatal('找不到骨架 515.gil：' + skelAbs, 1);
  console.log('══ gen_editor_templates —— 按 515 编辑器模板骨架重建 520 的 7 对家具模板 ══');
  loadSpec();
  const g = readGil(inAbs);
  const skel = readGil(skelAbs);
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  console.log('  骨架 ' + basenameOf(skelAbs) + '（' + skel.recs.length + ' 条）');
  console.log('  输出 ' + basenameOf(outAbs) + '（' + (DRY ? '--dry 只预测不写' : '写') + '）');

  const re = build(g, skel);
  const cnt = { baseRecs: g.recs.length, changed: re.changed.length, skipped: re.skipped.length, plans: re.plans };
  console.log('\n  待重建 ' + re.changed.length + ' 个模板对（' + re.changed.join(', ') + '）'
    + (re.skipped.length ? '；已是编辑器形态跳过 ' + re.skipped.length + ' 个：' + re.skipped.join(', ') : ''));

  if (DRY) {
    // 预演：编码→临时文件→读回断言→算 diff（不产出正式文件）
    const tmp = path.join(os.tmpdir(), 'gen_editor_dry_' + process.pid + '.gil');
    try {
      const buf = g.pack(encodeMsg(g.tree));
      fs.writeFileSync(tmp, buf);
      const g2 = readGil(tmp);
      cnt.expectDiffs = diffTrees(loadTree(g.file), loadTree(tmp), 100000).total;
      const ok = assertEditor(g2, re, skel);
      if (ok !== true) console.log(ok);
      console.log('\n[--dry] 字节 ' + g.src.length + ' → ' + buf.length + '；预计算 diff = ' + cnt.expectDiffs + ' 处');
      return ok === true ? 0 : 3;
    } finally { if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } } }
  }

  let tmp = null;
  try {
    if (re.idempotent) {
      fs.copyFileSync(inAbs, outAbs);
      console.log('  （幂等：7 对模板已是编辑器形态，原样复制 → ' + basenameOf(outAbs) + '）');
      cnt.expectDiffs = 0;
      const results = runGates(outAbs, inAbs, cnt);
      return results.every((r) => r.pass) ? 0 : 4;
    }
    // 预演算 diff 条数（writeGil 要求显式 expectDiffs）
    tmp = path.join(os.tmpdir(), 'gen_editor_' + process.pid + '_' + Date.now() + '.gil');
    fs.writeFileSync(tmp, g.pack(encodeMsg(g.tree)));
    cnt.expectDiffs = diffTrees(loadTree(g.file), loadTree(tmp), 100000).total;
    console.log('  · 预计算字段差异 = ' + cnt.expectDiffs + ' 处（14 个模板记录整体重建）');
    const rep = writeGil(g, tmp, {
      label: 'gen_editor_templates 按编辑器骨架重建 7 对家具模板',
      expectRecs: cnt.baseRecs,
      expectDiffs: cnt.expectDiffs,
      assert: (g2) => assertEditor(g2, re, skel),
    });
    fs.copyFileSync(tmp, outAbs);
    console.log('  写出 ' + basenameOf(outAbs) + '：' + rep.bytes + ' 字节 / ' + rep.recs + ' 条');
    const results = runGates(outAbs, inAbs, cnt);
    const allPass = results.every((r) => r.pass);
    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + fs.statSync(outAbs).size + ' 字节，记录 ' + cnt.baseRecs + ' 条）');
    for (const p of cnt.plans) console.log('  ' + p.name.padEnd(13) + ' 源 #' + p.src + ' / 母本 #' + p.mst + '（族 ' + p.family + '，根 150×150，content #' + p.contentS + ' 画布 ' + p.cw + '×' + p.ch + '，' + p.layers + ' 层）');
    console.log('  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
    if (!allPass) { console.error('\n❌ 外部闸门未全过 —— 文件已写出但**不要导入**。'); return 4; }
    console.log('  ★ 全部通过。');
    return 0;
  } finally {
    if (tmp && fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
}

process.exit(main());
