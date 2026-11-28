// 749_v8：从 748_全核查修复与自闭环验证.gil 派生，为调查商城（econ.shop736）与调查背包（econ.bag741）
// 右侧介绍区域实现「基尔霍夫薄板方程双模态解析解 + 不可伸长薄壳积分 + 铁壁双层遮挡 + 逐叶子显隐闭环」自然覆纸动画（零半透明产物，购买不触发）：
//   1. 根治 v4 真机隐身与穿帮的底层引擎根因：
//      - 千星真机中容器 SetVisible(false) 不级联隐藏子控件，且 Adapter:_enforce_hidden_subtrees 在离开商城/背包页时
//        会沿父链递归 2 层把 anim.bend 与 anim.under 的全部叶子节点逐个关灯；
//      - 全面采用「逐叶子显式点亮 / 逐叶子显式熄灭」：动画开始时显式点亮旧纸全部底纸/边框/图框/说明框/角钉/文本/图标，
//        并显式点亮新纸弯曲链全部边框带/纸面带/内框带；动画结束与离页复位时逐个熄灭全部弯曲带与旧纸叶子，彻底消除隐身与重影；
//   2. 基尔霍夫薄板方程（Kirchhoff-Love Thin Plate Equation）物理重构（v8 根治右上角撞标题与阶梯感）：
//      - 控制方程：D·d^4w/ds^4 + ρh·d^2w/dt^2 + c·dw/dt = q(s,t)，沿纸长无量纲弧长 ξ = s/L ∈ [0,1]；
//      - 采用两组精确解析边界条件模态叠加：
//        (a) 悬臂-自由端主落置模态（w(0)=w'(0)=0，自由尾端零弯矩 M(1)=0、零剪力 V(1)=0）：
//            P_kl(ξ) = (6ξ^2 - 4ξ^3 + ξ^4)/3，斜率 P_kl'(ξ) = (4/3)(3ξ - 3ξ^2 + ξ^3)；
//        (b) 简支气垫穹拱模态（两端零弯矩 M(0)=M(1)=0）：
//            P_air(ξ) = (16/5)(ξ - 2ξ^3 + ξ^4)，斜率 P_air'(ξ) = (16/5)(1 - 6ξ^2 + 4ξ^3)；
//      - 右手轻拿上右角顺放（thetaHead > 0）：左上角贴底落平（绝不撞上方标题铭牌），右上角轻扬柔和回落；
//      - 移除人为局部 topPinch，横向宽度完全由 3D 离面高程 w(ξ) 经真实焦距 perspF=4200 透视给出，
//        相邻条带半宽跳变 < 0.55px、夹角差 < 0.35°（消除右上角条带阶梯感），左右边弧长严格 <= 静止纸高（0px 拉伸，左下角绝不戳出）；
//      - 纸张外边框（16 段）、实心纸面（16 段）与内部浅棕说明/标题框（商店 s66 拆 10 段，背包 label 3 段 + body 11 段）
//        全部按同一条基尔霍夫薄板积分链同步弯曲，100% alpha=0xFF 实色渲染，严严实实遮挡下方旧纸；
//      - 四颗角钉/图钉拆入 anim.ptop / anim.pbot 跟随说明框上下缘弯曲点；图文内容分 anim.top / anim.bot 紧贴对应切线；
//   3. 商店区域严格精分与层序遮挡：
//      - 外木框 s8、米色底板 s9（#ECE2CC）、顶部虚线标题铭牌（s37..s64/name）、底部取消/购买按钮及热区全部原位静止，
//        且顶部标题铭牌、底部按钮与确认弹窗层级严格压在动画纸卡之上，绝不遮挡；
//      - 中间变化区单独框为 468×530 独立档案纸卡（2px 实心暖棕边框 #B89872 + 温润象牙纸面 #F7F0DF）；
//   4. 购买商品全流程绝不触发动画：触发键仅绑定选中道具标识 pick，点购买/余额不足/弹确认/确认购买静默刷新；
//   5. 全部新控件登记 STATIC_PATH_655 O(1) 静态路由，零新增全局读/写，连点无缝打断，离页瞬时复位无残影无闪烁。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadTree, findScriptLeaf, writeGil } from './gil/gilwrite.mjs';
import {
  encodeMsg, cloneField, asIdList, setChildList,
  pairOf, pairValue, setPair, textsOf, writeVarint,
} from './gil/gilread.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const runTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'murdoku-749v8-'));
const keepTmp = process.argv.includes('--keep-tmp');
const overwrite = process.argv.includes('--overwrite');

const base = path.join(repo, '748_全核查修复与自闭环验证/748_全核查修复与自闭环验证.gil');
const out = path.resolve(
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : path.join(repo, '749_背包商店右侧纸张切换动画/749_背包商店右侧纸张切换动画_v8.gil')
);

if (!overwrite) assert(!fs.existsSync(out), '输出已存在，拒绝覆盖（如需覆盖请传 --overwrite）：' + out);

const sha = (b) => createHash('sha256').update(b).digest('hex');
const g = loadTree(base);
assert.equal(
  sha(g.src),
  '312c06738ae049b27f318f7dafb4e844773249821b7ea4d9ff65f6f339741ef3',
  '基准 748 SHA256 不匹配'
);

const leaf = findScriptLeaf(g);
const original = leaf.buf.toString('utf8');
const origRecCount = g.recs.length;
const origRecordBytes = new Map(g.recs.map((r) => [r.id, encodeMsg([r.field])]));

// ── Protobuf 工具函数 ────────────────────────────────────────────────────────
const F = (p, n) => p?.sub?.find((f) => f.field === n);
const comp = (r, n) => r.sub.filter((f) => f.field === 505).map((f) => F(F(f, 503), n)).find(Boolean);
const statesOf = (r) => F(comp(r, 13), 12).sub.filter((f) => f.field === 501).map((f) => F(f, 502));
function walkFields(arr, fn) {
  for (const f of arr) {
    fn(f);
    if (f.sub) walkFields(f.sub, fn);
  }
}

const usedIds = new Set();
walkFields(g.tree, (f) => { if (f.wt === 0) usedIds.add(Number(f.num)); });
let nextId = 1073790000;
function allocId() {
  while (usedIds.has(nextId)) nextId++;
  const id = nextId++;
  usedIds.add(id);
  return id;
}

function setHiddenFlag(field, hidden) {
  const c14 = comp(field, 14);
  assert(c14, '缺少 comp 14');
  let h = F(c14, 17);
  if (!h) {
    h = { field: 17, wt: 2, sub: [], payload: null, len: 0 };
    c14.sub.push(h);
  }
  h.sub = hidden ? [{ field: 503, wt: 0, num: 1n }] : [];
  h.payload = null;
  h.len = 0;
}

function replaceIdAndName(cloned, srcId, newId, srcName, newName) {
  const oldBytes = writeVarint(srcId);
  const newBytes = writeVarint(newId);
  walkFields(cloned.sub, (f) => {
    if (f.wt === 0 && Number(f.num) === srcId) {
      f.num = BigInt(newId);
    } else if (!f.sub && f.wt === 2 && f.payload?.equals(oldBytes)) {
      f.payload = newBytes;
      f.len = newBytes.length;
    }
  });
  const nf = textsOf(cloned.sub, []).filter((f) => f.payload.toString('utf8') === srcName);
  assert.equal(nf.length, 1, `克隆改名未唯一命中: ${srcName} -> ${newName} (n=${nf.length})`);
  nf[0].payload = Buffer.from(newName, 'utf8');
  nf[0].len = nf[0].payload.length;
}

function setTransformAll(field, cx, cy, w, h, rotZ = 0) {
  const sts = statesOf(field);
  assert.equal(sts.length, 4, '平台变换槽数不为 4');
  for (const s of sts) {
    for (const k of [502, 503, 506]) assert(setPair(pairOf(s, k), 0.5, 0.5));
    assert(setPair(pairOf(s, 504), cx, cy));
    assert(setPair(pairOf(s, 505), w, h));
    const rot = F(s, 508);
    if (rot) {
      rot.sub = rotZ ? [{ field: 3, wt: 5, f: rotZ }] : [];
      rot.payload = null;
      rot.len = rotZ ? 5 : 0;
    }
  }
}

function shiftPosAll(field, dx, dy) {
  const sts = statesOf(field);
  assert.equal(sts.length, 4);
  for (const s of sts) {
    const p = pairOf(s, 504);
    const x = pairValue(p, 0);
    const y = pairValue(p, 1);
    assert(setPair(p, x + dx, y + dy));
  }
}

function readPosSize0(field) {
  const s = statesOf(field)[0];
  const p = pairOf(s, 504);
  const sz = pairOf(s, 505);
  return {
    cx: pairValue(p, 0),
    cy: pairValue(p, 1),
    w: pairValue(sz, 0),
    h: pairValue(sz, 1),
  };
}

// ── 确定商城与背包右侧需纳入纸张切换层的完整控件集合 ─────────────────────────
const econRoot = g.byName.get('econ.ui742');
assert(econRoot && econRoot.childList, '缺少 econ.ui742 容器');
const groupProto = g.byName.get('art641.home');
assert(groupProto && groupProto.childList, '缺少容器原型 art641.home');

const N_STRIPS = 16;

// 商店：只迁移中间变化区域；保留 s8 外框、s9 大底板、s37..s64/name 顶部标题铭牌、s71..s74/cancel/purchase 底部按钮全部静止不动！
// 静止底面层（挂在 anim.sheet，动画期隐藏交由 anim.bend 同步弯曲）：card.border, card.face, s66
// 角钉容器（贴合弯曲后说明框四角）：anim.ptop (s67, s69) 与 anim.pbot (s68, s70)
// 内容容器：anim.top (s65 + 双套图标 + price + owned) 与 anim.bot (desc + status)
const SHOP_POS_ICON_KEYS = [
  's110', 's111', 's112', 's113', 's114', 's115', 's116', 's117', 's118',
  's119.edge', 's119', 's120', 's121', 's122.edge', 's122',
];
const SHOP_CLUE_ICON_KEYS = [
  's125', 's126', 's127', 's128', 's129', 's130',
  's131', 's131.top', 's131.bottom', 's132',
];
const SHOP_SHEET_FACE_KEYS = ['s66'];
const SHOP_PTOP_KEYS = ['s67', 's69'];
const SHOP_PBOT_KEYS = ['s68', 's70'];
const SHOP_TOP_KEYS = ['s65', ...SHOP_POS_ICON_KEYS, ...SHOP_CLUE_ICON_KEYS, 'price', 'owned'];
const SHOP_BOT_KEYS = ['desc', 'status'];
const SHOP_STATIC_KEYS = ['s65', 's66', 's67', 's68', 's69', 's70'];
const SHOP_ALL_KEYS = [
  ...SHOP_SHEET_FACE_KEYS, ...SHOP_PTOP_KEYS, ...SHOP_PBOT_KEYS,
  ...SHOP_TOP_KEYS, ...SHOP_BOT_KEYS,
];

// 背包：paper.top / paper.label / paper.body 挂在 anim.sheet 静止层（动画期隐藏交由 anim.bend 同步弯曲）；
// 四颗图钉分 anim.ptop (pin0, pin1) 与 anim.pbot (pin2, pin3)；
// 内容分 anim.top (title, meta) 与 anim.bot (desc, usage, history)。
const BAG_SHEET_FACE_KEYS = ['paper.top', 'paper.label', 'paper.body'];
const BAG_PTOP_KEYS = ['paper.pin0', 'paper.pin1'];
const BAG_PBOT_KEYS = ['paper.pin2', 'paper.pin3'];
const BAG_TOP_KEYS = ['title', 'meta'];
const BAG_BOT_KEYS = ['desc', 'usage', 'history'];
const BAG_STATIC_KEYS = [
  'paper.top', 'paper.label', 'paper.body',
  'paper.pin0', 'paper.pin1', 'paper.pin2', 'paper.pin3',
];
const BAG_ALL_KEYS = [
  ...BAG_SHEET_FACE_KEYS, ...BAG_PTOP_KEYS, ...BAG_PBOT_KEYS,
  ...BAG_TOP_KEYS, ...BAG_BOT_KEYS,
];

const origWorldPos = new Map();
function snapshotOrigPos(fullName) {
  const r = g.byName.get(fullName);
  assert(r, '基准 748 缺少控件: ' + fullName);
  assert.equal(r.parentId, econRoot.id, '控件原父级不是 econ.ui742: ' + fullName);
  origWorldPos.set(
    fullName,
    statesOf(r.field).map((s) => {
      const p = pairOf(s, 504);
      return [pairValue(p, 0), pairValue(p, 1)];
    })
  );
  return r;
}

// 精确读取 748 原件几何
const shopS66Geom = readPosSize0(g.byName.get('econ.shop736.s66').field);
const shopBase = { cx: 444.0, cy: -19.0, w: 468.0, h: 530.0 };
const shopTopAnchor = { cx: 444.0, cy: 149.0, w: 440.0, h: 170.0 };
const shopBotAnchor = { cx: 444.0, cy: -115.0, w: 430.0, h: 280.0 };
const shopPTopAnchor = { cx: 444.0, cy: 24.2, w: 400.0, h: 16.0 };
const shopPBotAnchor = { cx: 444.0, cy: -255.0, w: 400.0, h: 16.0 };

const bagBase = readPosSize0(g.byName.get('econ.bag741.paper.top').field);
const bagLabelGeom = readPosSize0(g.byName.get('econ.bag741.paper.label').field);
const bagBodyGeom = readPosSize0(g.byName.get('econ.bag741.paper.body').field);
const bagTopAnchor = { cx: bagBase.cx, cy: 148.0, w: 380.0, h: 185.0 };
const bagBotAnchor = { cx: bagBase.cx, cy: -142.5, w: 340.0, h: 330.0 };
const bagPTopAnchor = { cx: bagBase.cx, cy: 23.3, w: 320.0, h: 16.0 };
const bagPBotAnchor = { cx: bagBase.cx, cy: -307.5, w: 320.0, h: 16.0 };

function toLayoutRect(a) {
  const sx = 1.2;
  const x = +((800 + a.cx - a.w / 2) * sx).toFixed(1);
  const y = +((450 - a.cy - a.h / 2) * sx).toFixed(1);
  return `{x=${x},y=${y},w=${+(a.w * sx).toFixed(1)},h=${+(a.h * sx).toFixed(1)}}`;
}

const touchedIds = new Set([econRoot.id]);
const newRecsInfo = [];

function makeContainer(name, parentRec, cx, cy, w, h, childIds, hidden) {
  const cf = cloneField(groupProto.field);
  const id = allocId();
  replaceIdAndName(cf, groupProto.id, id, groupProto.name, name);
  const parentField = F(cf, 504);
  assert(parentField);
  parentField.num = BigInt(parentRec.id);
  const childField = F(cf, 503);
  assert(childField);
  setChildList(childField, childIds);
  setTransformAll(cf, cx, cy, w, h, 0);
  setHiddenFlag(cf, hidden);
  groupProto.holder.push(cf);
  newRecsInfo.push({ id, name, parentId: parentRec.id, cx, cy, w, h, childIds: [...childIds], kind: 'container' });
  return { id, name, field: cf, childList: childField, holder: groupProto.holder };
}

function cloneDecorShape(srcRec, newName, parentId, cx, cy, w, h, colorHex, hidden, imgId = 100001, rotZ = 0) {
  const cf = cloneField(srcRec.field);
  const id = allocId();
  replaceIdAndName(cf, srcRec.id, id, srcRec.name, newName);
  F(cf, 504).num = BigInt(parentId);
  setTransformAll(cf, cx, cy, w, h, rotZ);
  const img = comp(cf, 84);
  assert(img, '装饰图元缺少 comp 84: ' + srcRec.name);
  F(img, 502).num = BigInt('0x' + colorHex);
  F(img, 503).num = BigInt(imgId);
  setHiddenFlag(cf, hidden);
  srcRec.holder.push(cf);
  newRecsInfo.push({ id, name: newName, parentId, kind: 'image', imgId, colorHex });
  return { id, name: newName, field: cf };
}

function buildFlexiblePaper({
  prefix, baseRect, topAnchor, botAnchor, ptopAnchor, pbotAnchor,
  allKeys, sheetFaceKeys, ptopKeys, pbotKeys, topKeys, botKeys, staticSet, faceProtoKey,
  borderColor, faceColor,
  innerBoxes = [], // [{ geom, segs, colorHex, r, g, b }]
  ownCard = null,
}) {
  const sheetName = prefix + 'anim.sheet';
  const underName = prefix + 'anim.under';
  const bendName  = prefix + 'anim.bend';
  const ptopName  = prefix + 'anim.ptop';
  const pbotName  = prefix + 'anim.pbot';
  const topName   = prefix + 'anim.top';
  const botName   = prefix + 'anim.bot';

  const sheetFaceSet = new Set(sheetFaceKeys);
  const ptopSet = new Set(ptopKeys);
  const pbotSet = new Set(pbotKeys);
  const topSet  = new Set(topKeys);
  const botSet  = new Set(botKeys);

  const sheetRecs = allKeys.map((k) => snapshotOrigPos(prefix + k));
  const faceProto = g.byName.get(prefix + faceProtoKey);
  assert(faceProto);

  const underCont = makeContainer(underName, econRoot, baseRect.cx, baseRect.cy, baseRect.w, baseRect.h, [], true);
  const sheetCont = makeContainer(sheetName, econRoot, baseRect.cx, baseRect.cy, baseRect.w, baseRect.h, [], true);
  const bendCont  = makeContainer(bendName, sheetCont, 0, 0, baseRect.w, baseRect.h, [], true);

  const ptopRelX = ptopAnchor.cx - baseRect.cx;
  const ptopRelY = ptopAnchor.cy - baseRect.cy;
  const pbotRelX = pbotAnchor.cx - baseRect.cx;
  const pbotRelY = pbotAnchor.cy - baseRect.cy;
  const topRelX  = topAnchor.cx - baseRect.cx;
  const topRelY  = topAnchor.cy - baseRect.cy;
  const botRelX  = botAnchor.cx - baseRect.cx;
  const botRelY  = botAnchor.cy - baseRect.cy;

  const ptopCont = makeContainer(ptopName, sheetCont, ptopRelX, ptopRelY, ptopAnchor.w, ptopAnchor.h, [], false);
  const pbotCont = makeContainer(pbotName, sheetCont, pbotRelX, pbotRelY, pbotAnchor.w, pbotAnchor.h, [], false);
  const topCont  = makeContainer(topName, sheetCont, topRelX, topRelY, topAnchor.w, topAnchor.h, [], false);
  const botCont  = makeContainer(botName, sheetCont, botRelX, botRelY, botAnchor.w, botAnchor.h, [], false);

  const underChildIds = [], underChildNames = [];
  const bendChildIds  = [], bendChildNames  = [];
  const ptopChildIds  = [], ptopChildNames  = [];
  const pbotChildIds  = [], pbotChildNames  = [];
  const topChildIds   = [], topChildNames   = [];
  const botChildIds   = [], botChildNames   = [];
  const sheetChildIds = [], sheetChildNames = [];

  // 1. 构造 anim.bend 内的实心弯曲纸带（从底到顶：16 边框带 -> 16 纸面带 -> M 内部浅棕框带，100% alpha=0xFF）
  const stripH = baseRect.h / N_STRIPS;
  for (let i = 0; i < N_STRIPS; i++) {
    const cy = (0.5 - (i + 0.5) / N_STRIPS) * baseRect.h;
    const hb = (i === 0 || i === N_STRIPS - 1) ? (stripH + 10.0) : (stripH + 12.0);
    const off = (i === 0) ? -3.0 : (i === N_STRIPS - 1 ? 3.0 : 0.0);
    const bName = `${prefix}anim.b.br${i + 1}`;
    const br = cloneDecorShape(
      faceProto, bName, bendCont.id,
      0, cy + off, baseRect.w + 4.0, hb, borderColor, true, 100001, 0
    );
    bendChildIds.push(br.id);
    bendChildNames.push(bName);
  }
  for (let i = 0; i < N_STRIPS; i++) {
    const cy = (0.5 - (i + 0.5) / N_STRIPS) * baseRect.h;
    const hf = (i === 0 || i === N_STRIPS - 1) ? (stripH + 8.0) : (stripH + 12.0);
    const off = (i === 0) ? -4.0 : (i === N_STRIPS - 1 ? 4.0 : 0.0);
    const fName = `${prefix}anim.b.fc${i + 1}`;
    const fc = cloneDecorShape(
      faceProto, fName, bendCont.id,
      0, cy + off, baseRect.w, hf, faceColor, true, 100001, 0
    );
    bendChildIds.push(fc.id);
    bendChildNames.push(fName);
  }

  // 内部同步弯曲说明框 / 标题框条带（消除刚体大框破边与分裂感！）
  const inBoxSpecs = [];
  let inIdx = 0;
  for (const box of innerBoxes) {
    const gBox = box.geom;
    const yTop = gBox.cy + gBox.h * 0.5;
    const segH = gBox.h / box.segs;
    const dx = +(gBox.cx - baseRect.cx).toFixed(3);
    for (let j = 0; j < box.segs; j++) {
      inIdx++;
      const yMid = yTop - (j + 0.5) * segH;
      const v = +(0.5 - (yMid - baseRect.cy) / baseRect.h).toFixed(6);
      const isFirst = (j === 0);
      const isLast = (j === box.segs - 1);
      const hh = (isFirst || isLast) ? (segH + 4.0) : (segH + 8.0);
      const off = isFirst ? -2.0 : (isLast ? 2.0 : 0.0);
      const iName = `${prefix}anim.b.in${inIdx}`;
      const strip = cloneDecorShape(
        faceProto, iName, bendCont.id,
        dx, (yMid - baseRect.cy) + off, gBox.w, hh, box.colorHex, true, 100001, 0
      );
      bendChildIds.push(strip.id);
      bendChildNames.push(iName);
      inBoxSpecs.push({ name: iName, v, dx, off, r: box.r, g: box.g, b: box.b });
    }
  }
  setChildList(bendCont.childList, bendChildIds);
  newRecsInfo.find((x) => x.id === bendCont.id).childIds = [...bendChildIds];

  // 2. 商店专用独立实心纸卡底面（静止态显示，动画态隐藏改由 anim.bend 接管）
  const underStaticNames = [];
  if (ownCard) {
    const uBorder = cloneDecorShape(
      faceProto, prefix + 'anim.u.card.border', underCont.id,
      0, 0, baseRect.w + 4, baseRect.h + 4, ownCard.borderColor, true, 100001, 0
    );
    const uFace = cloneDecorShape(
      faceProto, prefix + 'anim.u.card.face', underCont.id,
      0, 0, baseRect.w, baseRect.h, ownCard.faceColor, true, 100001, 0
    );
    underChildIds.push(uBorder.id, uFace.id);
    underChildNames.push(uBorder.name, uFace.name);
    underStaticNames.push(uBorder.name, uFace.name);

    const sBorder = cloneDecorShape(
      faceProto, prefix + 'card.border', sheetCont.id,
      0, 0, baseRect.w + 4, baseRect.h + 4, ownCard.borderColor, true, 100001, 0
    );
    const sFace = cloneDecorShape(
      faceProto, prefix + 'card.face', sheetCont.id,
      0, 0, baseRect.w, baseRect.h, ownCard.faceColor, true, 100001, 0
    );
    sheetChildIds.push(sBorder.id, sFace.id);
    sheetChildNames.push(sBorder.name, sFace.name);
  }

  // 3. 克隆旧纸层（直挂 anim.under，初始全 hidden=true，动画开始逐叶子点亮），并按分区迁入真实控件
  //    注意 sheetCont 内层序：静止底面/内框 -> anim.bend -> anim.ptop/pbot -> anim.top/bot
  const sheetFaceMoved = [];
  for (let i = 0; i < allKeys.length; i++) {
    const k = allKeys[i];
    const r = sheetRecs[i];
    touchedIds.add(r.id);

    // 3a. 克隆到 anim.under（坐标相对 baseRect，初始全隐藏防真机未级联穿透）
    const uName = prefix + 'anim.u.' + k;
    const uf = cloneField(r.field);
    const uid = allocId();
    replaceIdAndName(uf, r.id, uid, r.name, uName);
    F(uf, 504).num = BigInt(underCont.id);
    shiftPosAll(uf, -baseRect.cx, -baseRect.cy);
    setHiddenFlag(uf, true);
    r.holder.push(uf);
    underChildIds.push(uid);
    underChildNames.push(uName);
    if (staticSet.has(k)) underStaticNames.push(uName);
    newRecsInfo.push({ id: uid, name: uName, parentId: underCont.id, kind: 'under_clone' });

    // 3b. 迁入真实控件
    if (sheetFaceSet.has(k)) {
      F(r.field, 504).num = BigInt(sheetCont.id);
      r.parentId = sheetCont.id;
      shiftPosAll(r.field, -baseRect.cx, -baseRect.cy);
      sheetFaceMoved.push({ id: r.id, name: r.name });
    } else if (ptopSet.has(k)) {
      F(r.field, 504).num = BigInt(ptopCont.id);
      r.parentId = ptopCont.id;
      shiftPosAll(r.field, -ptopAnchor.cx, -ptopAnchor.cy);
      ptopChildIds.push(r.id);
      ptopChildNames.push(r.name);
    } else if (pbotSet.has(k)) {
      F(r.field, 504).num = BigInt(pbotCont.id);
      r.parentId = pbotCont.id;
      shiftPosAll(r.field, -pbotAnchor.cx, -pbotAnchor.cy);
      pbotChildIds.push(r.id);
      pbotChildNames.push(r.name);
    } else if (topSet.has(k)) {
      F(r.field, 504).num = BigInt(topCont.id);
      r.parentId = topCont.id;
      shiftPosAll(r.field, -topAnchor.cx, -topAnchor.cy);
      topChildIds.push(r.id);
      topChildNames.push(r.name);
    } else if (botSet.has(k)) {
      F(r.field, 504).num = BigInt(botCont.id);
      r.parentId = botCont.id;
      shiftPosAll(r.field, -botAnchor.cx, -botAnchor.cy);
      botChildIds.push(r.id);
      botChildNames.push(r.name);
    } else {
      assert.fail('未分配到任何分区的控件: ' + k);
    }
  }

  for (const m of sheetFaceMoved) {
    sheetChildIds.push(m.id);
    sheetChildNames.push(m.name);
  }
  sheetChildIds.push(bendCont.id, ptopCont.id, pbotCont.id, topCont.id, botCont.id);
  sheetChildNames.push(bendName, ptopName, pbotName, topName, botName);

  setChildList(underCont.childList, underChildIds);
  setChildList(ptopCont.childList, ptopChildIds);
  setChildList(pbotCont.childList, pbotChildIds);
  setChildList(topCont.childList, topChildIds);
  setChildList(botCont.childList, botChildIds);
  setChildList(sheetCont.childList, sheetChildIds);

  newRecsInfo.find((x) => x.id === underCont.id).childIds = [...underChildIds];
  newRecsInfo.find((x) => x.id === ptopCont.id).childIds  = [...ptopChildIds];
  newRecsInfo.find((x) => x.id === pbotCont.id).childIds  = [...pbotChildIds];
  newRecsInfo.find((x) => x.id === topCont.id).childIds   = [...topChildIds];
  newRecsInfo.find((x) => x.id === botCont.id).childIds   = [...botChildIds];
  newRecsInfo.find((x) => x.id === sheetCont.id).childIds = [...sheetChildIds];

  return {
    underCont, sheetCont, bendCont, ptopCont, pbotCont, topCont, botCont,
    movedIds: new Set(sheetRecs.map((r) => r.id)),
    underChildNames, underStaticNames, sheetChildNames, bendChildNames,
    ptopChildNames, pbotChildNames, topChildNames, botChildNames,
    ptopRelX, ptopRelY, pbotRelX, pbotRelY, topRelX, topRelY, botRelX, botRelY,
    inBoxSpecs,
  };
}

const shopPair = buildFlexiblePaper({
  prefix: 'econ.shop736.',
  baseRect: shopBase,
  topAnchor: shopTopAnchor,
  botAnchor: shopBotAnchor,
  ptopAnchor: shopPTopAnchor,
  pbotAnchor: shopPBotAnchor,
  allKeys: SHOP_ALL_KEYS,
  sheetFaceKeys: SHOP_SHEET_FACE_KEYS,
  ptopKeys: SHOP_PTOP_KEYS,
  pbotKeys: SHOP_PBOT_KEYS,
  topKeys: SHOP_TOP_KEYS,
  botKeys: SHOP_BOT_KEYS,
  staticSet: new Set(SHOP_STATIC_KEYS),
  faceProtoKey: 's9',
  borderColor: 'FFB89872',
  faceColor: 'FFF7F0DF',
  innerBoxes: [
    { geom: shopS66Geom, segs: 10, colorHex: 'FFE7D0B2', r: 231, g: 208, b: 178 },
  ],
  ownCard: {
    borderColor: 'FFB89872', // 2px 不透明暖棕框边
    faceColor: 'FFF7F0DF',   // 比外展板 #ECE2CC 更温润的实心象牙纸色
  },
});

const bagPair = buildFlexiblePaper({
  prefix: 'econ.bag741.',
  baseRect: bagBase,
  topAnchor: bagTopAnchor,
  botAnchor: bagBotAnchor,
  ptopAnchor: bagPTopAnchor,
  pbotAnchor: bagPBotAnchor,
  allKeys: BAG_ALL_KEYS,
  sheetFaceKeys: BAG_SHEET_FACE_KEYS,
  ptopKeys: BAG_PTOP_KEYS,
  pbotKeys: BAG_PBOT_KEYS,
  topKeys: BAG_TOP_KEYS,
  botKeys: BAG_BOT_KEYS,
  staticSet: new Set(BAG_STATIC_KEYS),
  faceProtoKey: 'paper.top',
  borderColor: 'FFA58868', // 2px 实心暖棕纸边（清晰勾勒纸张完整轮廓）
  faceColor: 'FFF6E7D2',   // 与原 paper.top #F6E7D2 精确一致，静止切回 0 跳色
  innerBoxes: [
    { geom: bagLabelGeom, segs: 3,  colorHex: 'FFE8D7BF', r: 232, g: 215, b: 191 },
    { geom: bagBodyGeom,  segs: 11, colorHex: 'FFE8D7BF', r: 232, g: 215, b: 191 },
  ],
});

// ── 重排 econ.ui742 子列表：保持商店标题与按钮在上/原位，纸卡居于展板 s9 之上 ──
const origEconOrder = asIdList(econRoot.childList.payload, true).map(Number);
const allMoved = new Set([...shopPair.movedIds, ...bagPair.movedIds]);
const newEconOrder = origEconOrder.filter((id) => !allMoved.has(id));

// 商店独立纸卡插在 s37（顶部标题牌）与 s71（底部按钮）之前、s9（右侧大底板）之后
const shopAnchorBeforeHeader = g.byName.get('econ.shop736.s37').id;
const shopInsertIdx = newEconOrder.indexOf(shopAnchorBeforeHeader);
assert(shopInsertIdx > 0, '找不到商店标题铭牌锚点 econ.shop736.s37');
newEconOrder.splice(shopInsertIdx, 0, shopPair.underCont.id, shopPair.sheetCont.id);

// 背包纸张双层紧插在 econ.bag741.paper.under（静态倾斜底纸）之后、return/item/hit.* 之前
const bagAnchorBeforeId = g.byName.get('econ.bag741.paper.under').id;
const bagInsertIdx = newEconOrder.indexOf(bagAnchorBeforeId);
assert(bagInsertIdx >= 0, '找不到背包静态底纸 econ.bag741.paper.under');
newEconOrder.splice(bagInsertIdx + 1, 0, bagPair.underCont.id, bagPair.sheetCont.id);

setChildList(econRoot.childList, newEconOrder);

// 同步调整序列化 holder 中的记录顺序，与 childList 严格一致
function moveInHolderBefore(holder, movedFields, anchorField) {
  for (const mf of movedFields) {
    const idx = holder.indexOf(mf);
    assert(idx >= 0, 'holder 中找不到待移动记录');
    holder.splice(idx, 1);
  }
  const ai = holder.indexOf(anchorField);
  assert(ai >= 0, 'holder 中找不到锚点记录');
  holder.splice(ai, 0, ...movedFields);
}
function moveInHolderAfter(holder, movedFields, anchorField) {
  for (const mf of movedFields) {
    const idx = holder.indexOf(mf);
    assert(idx >= 0, 'holder 中找不到待移动记录');
    holder.splice(idx, 1);
  }
  const ai = holder.indexOf(anchorField);
  assert(ai >= 0, 'holder 中找不到锚点记录');
  holder.splice(ai + 1, 0, ...movedFields);
}
assert.equal(shopPair.underCont.holder, g.byName.get('econ.shop736.s37').holder, 'shop holder 不同');
assert.equal(bagPair.underCont.holder, g.byName.get('econ.bag741.paper.under').holder, 'bag holder 不同');
moveInHolderBefore(
  shopPair.underCont.holder,
  [shopPair.underCont.field, shopPair.sheetCont.field],
  g.byName.get('econ.shop736.s37').field
);
moveInHolderAfter(
  bagPair.underCont.holder,
  [bagPair.underCont.field, bagPair.sheetCont.field],
  g.byName.get('econ.bag741.paper.under').field
);

// ── 内嵌 Lua 脚本精准补丁（零新增全局读/写，零稳态开销）───────────────────────
let lua = original;
const patches = [];
function patch(tag, before, after) {
  const parts = lua.split(before);
  assert.equal(parts.length, 2, `补丁不唯一或未命中 [${tag}] (matches=${parts.length - 1})`);
  lua = lua.replace(before, () => after);
  patches.push(tag);
}

// 1. 商店 build_layout：注入 anim.sheet/card.border/card.face/anim.ptop/anim.pbot/anim.top/anim.bot，并按分区重指 parent
patch(
  'shop_build_layout_containers',
  `      push({id='econ.shop736.s65',parent='econ.ui742',kind='image',rect={x=1239,y=268,w=214,h=187},visible=true})`,
  [
    `      push({id='econ.shop736.anim.sheet',parent='econ.ui742',kind='container',rect=${toLayoutRect(shopBase)},visible=true})`,
    `      push({id='econ.shop736.card.border',parent='econ.shop736.anim.sheet',kind='image',rect={x=1209.6,y=242.4,w=566.4,h=640.8},visible=true})`,
    `      push({id='econ.shop736.card.face',parent='econ.shop736.anim.sheet',kind='image',rect=${toLayoutRect(shopBase)},visible=true})`,
    `      push({id='econ.shop736.anim.ptop',parent='econ.shop736.anim.sheet',kind='container',rect=${toLayoutRect(shopPTopAnchor)},visible=true})`,
    `      push({id='econ.shop736.anim.pbot',parent='econ.shop736.anim.sheet',kind='container',rect=${toLayoutRect(shopPBotAnchor)},visible=true})`,
    `      push({id='econ.shop736.anim.top',parent='econ.shop736.anim.sheet',kind='container',rect=${toLayoutRect(shopTopAnchor)},visible=true})`,
    `      push({id='econ.shop736.anim.bot',parent='econ.shop736.anim.sheet',kind='container',rect=${toLayoutRect(shopBotAnchor)},visible=true})`,
    `      push({id='econ.shop736.s65',parent='econ.shop736.anim.top',kind='image',rect={x=1239,y=268,w=214,h=187},visible=true})`,
  ].join('\n')
);
for (const k of SHOP_SHEET_FACE_KEYS) {
  const full = 'econ.shop736.' + k;
  patch('shop_face_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.shop736.anim.sheet',`);
}
for (const k of SHOP_PTOP_KEYS) {
  const full = 'econ.shop736.' + k;
  patch('shop_ptop_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.shop736.anim.ptop',`);
}
for (const k of SHOP_PBOT_KEYS) {
  const full = 'econ.shop736.' + k;
  patch('shop_pbot_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.shop736.anim.pbot',`);
}
for (const k of SHOP_TOP_KEYS) {
  if (k === 's65') continue;
  const full = 'econ.shop736.' + k;
  patch('shop_top_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.shop736.anim.top',`);
}
for (const k of SHOP_BOT_KEYS) {
  const full = 'econ.shop736.' + k;
  patch('shop_bot_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.shop736.anim.bot',`);
}

// 2. 背包 build_layout：注入 anim.sheet/anim.ptop/anim.pbot/anim.top/anim.bot，并按分区重指 parent
patch(
  'bag_build_layout_containers',
  `      push({id='econ.bag741.paper.top',parent='econ.ui742',kind='image',rect={x=1189.7,y=223,w=490.2,h=739.6},visible=true})`,
  [
    `      push({id='econ.bag741.anim.sheet',parent='econ.ui742',kind='container',rect={x=1189.7,y=223,w=490.2,h=739.6},visible=true})`,
    `      push({id='econ.bag741.paper.top',parent='econ.bag741.anim.sheet',kind='image',rect={x=1189.7,y=223,w=490.2,h=739.6},visible=true})`,
    `      push({id='econ.bag741.anim.ptop',parent='econ.bag741.anim.sheet',kind='container',rect=${toLayoutRect(bagPTopAnchor)},visible=true})`,
    `      push({id='econ.bag741.anim.pbot',parent='econ.bag741.anim.sheet',kind='container',rect=${toLayoutRect(bagPBotAnchor)},visible=true})`,
    `      push({id='econ.bag741.anim.top',parent='econ.bag741.anim.sheet',kind='container',rect=${toLayoutRect(bagTopAnchor)},visible=true})`,
    `      push({id='econ.bag741.anim.bot',parent='econ.bag741.anim.sheet',kind='container',rect=${toLayoutRect(bagBotAnchor)},visible=true})`,
  ].join('\n')
);
for (const k of BAG_SHEET_FACE_KEYS) {
  if (k === 'paper.top') continue;
  const full = 'econ.bag741.' + k;
  patch('bag_face_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.bag741.anim.sheet',`);
}
for (const k of BAG_PTOP_KEYS) {
  const full = 'econ.bag741.' + k;
  patch('bag_ptop_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.bag741.anim.ptop',`);
}
for (const k of BAG_PBOT_KEYS) {
  const full = 'econ.bag741.' + k;
  patch('bag_pbot_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.bag741.anim.pbot',`);
}
for (const k of BAG_TOP_KEYS) {
  const full = 'econ.bag741.' + k;
  patch('bag_top_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.bag741.anim.top',`);
}
for (const k of BAG_BOT_KEYS) {
  const full = 'econ.bag741.' + k;
  patch('bag_bot_parent_' + k, `push({id='${full}',parent='econ.ui742',`, `push({id='${full}',parent='econ.bag741.anim.bot',`);
}

// 2.5 保护动画容器（anim.sheet/anim.ptop/anim.pbot/anim.top/anim.bot/anim.bend）不被 Controller:render(force) 覆写坐标
patch(
  'econ_pos_runtime_skip_anim_nodes',
  `if node.id:match("^econ%.") then node.raycast = node.visible~=false and node.event ~= nil; node.pos_runtime=true end`,
  `if node.id:match("^econ%.") then node.raycast = node.visible~=false and node.event ~= nil; if not node.id:match("%.anim%.") then node.pos_runtime=true end end`
);

// 3. STATIC_PATH_655：为全部新增容器、弯曲纸带、分段内容与旧纸控件登记 O(1) 静态路由
const staticRouteLines = [
  `  add("root/econ.ui742", [=[econ.shop736.anim.under`,
  `econ.shop736.anim.sheet`,
  `econ.bag741.anim.under`,
  `econ.bag741.anim.sheet]=])`,
  `  add("root/econ.ui742/econ.shop736.anim.sheet", [=[${shopPair.sheetChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.shop736.anim.sheet/econ.shop736.anim.bend", [=[${shopPair.bendChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.shop736.anim.sheet/econ.shop736.anim.ptop", [=[${shopPair.ptopChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.shop736.anim.sheet/econ.shop736.anim.pbot", [=[${shopPair.pbotChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.shop736.anim.sheet/econ.shop736.anim.top", [=[${shopPair.topChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.shop736.anim.sheet/econ.shop736.anim.bot", [=[${shopPair.botChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.shop736.anim.under", [=[${shopPair.underChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.bag741.anim.sheet", [=[${bagPair.sheetChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.bag741.anim.sheet/econ.bag741.anim.bend", [=[${bagPair.bendChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.bag741.anim.sheet/econ.bag741.anim.ptop", [=[${bagPair.ptopChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.bag741.anim.sheet/econ.bag741.anim.pbot", [=[${bagPair.pbotChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.bag741.anim.sheet/econ.bag741.anim.top", [=[${bagPair.topChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.bag741.anim.sheet/econ.bag741.anim.bot", [=[${bagPair.botChildNames.join('\n')}]=])`,
  `  add("root/econ.ui742/econ.bag741.anim.under", [=[${bagPair.underChildNames.join('\n')}]=])`,
].join('\n');

patch(
  'static_path_655_paper_anim_routes',
  `adapt715r.background.part.649]=])\nend`,
  `adapt715r.background.part.649]=])\n${staticRouteLines}\nend`
);

// 4. RAY_STATIC_DECOR748：把纯静态展示容器 anim.under 与 anim.bend 加入射线静态装饰剪枝
patch(
  'ray_static_decor_anim_under',
  `  ["police-v19"] = true,\n}\nfunction Adapter:rearm_raycast(why)`,
  `  ["police-v19"] = true,\n  ["econ.shop736.anim.under"] = true,\n  ["econ.shop736.anim.bend"] = true,\n  ["econ.bag741.anim.under"] = true,\n  ["econ.bag741.anim.bend"] = true,\n}\nfunction Adapter:rearm_raycast(why)`
);

// 5. 核心动画控制器 sync_econ_paper_anim749（749_v6：收敛位移 + 上端轻微形变反馈 + 整纸含内框同步柔性弯曲）
const shopVTop  = +((0.5 - (shopTopAnchor.cy - shopBase.cy) / shopBase.h)).toFixed(6);
const shopVBot  = +((0.5 - (shopBotAnchor.cy - shopBase.cy) / shopBase.h)).toFixed(6);
const shopVPTop = +((0.5 - (shopPTopAnchor.cy - shopBase.cy) / shopBase.h)).toFixed(6);
const shopVPBot = +((0.5 - (shopPBotAnchor.cy - shopBase.cy) / shopBase.h)).toFixed(6);

const bagVTop   = +((0.5 - (bagTopAnchor.cy - bagBase.cy) / bagBase.h)).toFixed(6);
const bagVBot   = +((0.5 - (bagBotAnchor.cy - bagBase.cy) / bagBase.h)).toFixed(6);
const bagVPTop  = +((0.5 - (bagPTopAnchor.cy - bagBase.cy) / bagBase.h)).toFixed(6);
const bagVPBot  = +((0.5 - (bagPBotAnchor.cy - bagBase.cy) / bagBase.h)).toFixed(6);

function luaStrList(arr) {
  return '{ ' + arr.map((s) => JSON.stringify(s)).join(', ') + ' }';
}
function luaInBoxSpecs(specs) {
  return '{\n' + specs.map((s) =>
    `      { name=${JSON.stringify(s.name)}, v=${s.v}, dx=${s.dx}, off=${s.off}, r=${s.r}, g=${s.g}, b=${s.b} },`
  ).join('\n') + '\n    }';
}

const animControllerLua = `-- ECON749 PAPER ANIM BEGIN
-- 749_v8：基尔霍夫薄板方程双模态解析解 + 不可伸长薄壳积分 + 整纸一体化遮挡（零半透明产物，购买绝不触发，稳态 0 开销）。
local ECON749_DUR = 0.36
local ECON749_N = ${N_STRIPS}
local ECON749_PI = math.pi
local ECON749_RAD = math.pi / 180
local ECON749_SHOP_POS_ICONS = ${luaStrList(SHOP_POS_ICON_KEYS.map((k) => 'econ.shop736.anim.u.' + k))}
local ECON749_SHOP_CLUE_ICONS = ${luaStrList(SHOP_CLUE_ICON_KEYS.map((k) => 'econ.shop736.anim.u.' + k))}
local ECON749_CFG = {
  shop = {
    prefix = "econ.shop736.",
    sheet = "econ.shop736.anim.sheet",
    under = "econ.shop736.anim.under",
    bend  = "econ.shop736.anim.bend",
    ptop  = "econ.shop736.anim.ptop",
    pbot  = "econ.shop736.anim.pbot",
    top   = "econ.shop736.anim.top",
    bot   = "econ.shop736.anim.bot",
    staticFaces = { "econ.shop736.card.border", "econ.shop736.card.face", "econ.shop736.s66" },
    underStatics = ${luaStrList(shopPair.underStaticNames)},
    inBoxes = ${luaInBoxSpecs(shopPair.inBoxSpecs)},
    baseX = ${shopBase.cx},
    baseY = ${shopBase.cy},
    w = ${shopBase.w},
    h = ${shopBase.h},
    ptopRelX = ${shopPair.ptopRelX}, ptopRelY = ${shopPair.ptopRelY},
    pbotRelX = ${shopPair.pbotRelX}, pbotRelY = ${shopPair.pbotRelY},
    topRelX  = ${shopPair.topRelX},  topRelY  = ${shopPair.topRelY},
    botRelX  = ${shopPair.botRelX},  botRelY  = ${shopPair.botRelY},
    vPTop = ${shopVPTop}, vPBot = ${shopVPBot},
    vTop  = ${shopVTop},  vBot  = ${shopVBot},
    -- 商店独立档案纸卡：基尔霍夫薄板方程（悬臂-自由端主模态 + 简支气垫穹拱模态），右手轻放，左上不撞标题、右上光滑无阶梯、左右边 0 拉伸
    headDxA = 20,
    headDxB = 22,
    headDy = 4,
    arcLiftY = 3.5,
    thetaHeadA = 1.15,
    thetaHeadB = 1.25,
    ampKl = 0.25,
    ampAir = 0.055,
    obliqueDeg = 5.6,
    airTwistDeg = 0.35,
    perspF = 4200,
    globalWidthTilt = 0.010,
    faceR = 247, faceG = 240, faceB = 223,
    brR   = 184, brG   = 152, brB   = 114,
    underEndScale = 0.994,
    underEndRot = -0.15,
  },
  bag = {
    prefix = "econ.bag741.",
    sheet = "econ.bag741.anim.sheet",
    under = "econ.bag741.anim.under",
    bend  = "econ.bag741.anim.bend",
    ptop  = "econ.bag741.anim.ptop",
    pbot  = "econ.bag741.anim.pbot",
    top   = "econ.bag741.anim.top",
    bot   = "econ.bag741.anim.bot",
    staticFaces = { "econ.bag741.paper.top", "econ.bag741.paper.label", "econ.bag741.paper.body" },
    underStatics = ${luaStrList(bagPair.underStaticNames)},
    inBoxes = ${luaInBoxSpecs(bagPair.inBoxSpecs)},
    baseX = ${bagBase.cx},
    baseY = ${bagBase.cy},
    w = ${bagBase.w},
    h = ${bagBase.h},
    ptopRelX = ${bagPair.ptopRelX}, ptopRelY = ${bagPair.ptopRelY},
    pbotRelX = ${bagPair.pbotRelX}, pbotRelY = ${bagPair.pbotRelY},
    topRelX  = ${bagPair.topRelX},  topRelY  = ${bagPair.topRelY},
    botRelX  = ${bagPair.botRelX},  botRelY  = ${bagPair.botRelY},
    vPTop = ${bagVPTop}, vPBot = ${bagVPBot},
    vTop  = ${bagVTop},  vBot  = ${bagVBot},
    -- 背包右侧便签纸：同源基尔霍夫薄板方程双模态解析积分，右上角光滑、严格不可伸长
    headDxA = 19,
    headDxB = 21,
    headDy = 5,
    arcLiftY = 4.0,
    thetaHeadA = 1.10,
    thetaHeadB = 1.20,
    ampKl = 0.26,
    ampAir = 0.055,
    obliqueDeg = 5.6,
    airTwistDeg = 0.35,
    perspF = 4200,
    globalWidthTilt = 0.010,
    faceR = 246, faceG = 231, faceB = 210,
    brR   = 165, brG   = 136, brB   = 104,
    underEndScale = 0.994,
    underEndRot = 0.15,
  },
}
local ECON749_SHOP_PRICE = SHOP_PRICE
local econ749_cx, econ749_cy, econ749_sx, econ749_sy, econ749_rz = {}, {}, {}, {}, {}
local econ749_phi, econ749_w, econ749_ang = {}, {}, {}
local econ749_st = {
  gen = -1,
  activePage = nil,
  shop = { handles = nil, lastKey = nil, lastSnap = nil, animT = nil, flip = false },
  bag  = { handles = nil, lastKey = nil, lastSnap = nil, animT = nil, flip = false },
}

local function e749_set_pos(c, x, y) if c.SetAnchoredPosition then c:SetAnchoredPosition(x, y) end end
local function e749_set_scale(c, sx, sy) if c.SetLocalScale then c:SetLocalScale(sx, sy, 1) end end
local function e749_set_rot(c, rz)
  if c.SetLocalRotation then c:SetLocalRotation(0, 0, rz)
  elseif c.localRotationZ ~= nil then c.localRotationZ = rz end
end
local function e749_set_vis(c, v)
  if v and c.SetActive ~= nil and c.active ~= true then c:SetActive(true) end
  if c.SetVisible ~= nil and c.visible ~= v then c:SetVisible(v) end
end
local function e749_set_text(c, txt)
  local s = tostring(txt or "")
  if c.text ~= s then c.text = s end
end
local function e749_pack_opaque(r, g, b, delta)
  local rr = math.floor(r + delta + 0.5); if rr < 0 then rr = 0 elseif rr > 255 then rr = 255 end
  local gg = math.floor(g + delta + 0.5); if gg < 0 then gg = 0 elseif gg > 255 then gg = 255 end
  local bb = math.floor(b + delta + 0.5); if bb < 0 then bb = 0 elseif bb > 255 then bb = 255 end
  return 0xFF000000 + rr * 65536 + gg * 256 + bb
end
local function e749_set_col(c, col)
  if c.imageColor ~= col then c.imageColor = col end
end

local function e749_ensure_handles(page)
  local gen = (adapter and adapter._lookup_gen) or 0
  if econ749_st.gen ~= gen then
    econ749_st.gen = gen
    econ749_st.shop.handles = nil
    econ749_st.bag.handles  = nil
  end
  local st = econ749_st[page]
  if st.handles ~= nil and st.handles.sheet ~= nil and st.handles.under ~= nil then
    return st.handles
  end
  local cfg = ECON749_CFG[page]
  local h = {
    sheet = adapter:find(cfg.sheet),
    under = adapter:find(cfg.under),
    bend  = adapter:find(cfg.bend),
    ptop  = adapter:find(cfg.ptop),
    pbot  = adapter:find(cfg.pbot),
    top   = adapter:find(cfg.top),
    bot   = adapter:find(cfg.bot),
    staticFaces = {},
    u_static = {},
    br = {},
    fc = {},
    inBox = {},
  }
  for i = 1, #cfg.staticFaces do h.staticFaces[i] = adapter:find(cfg.staticFaces[i]) end
  for i = 1, #cfg.underStatics do h.u_static[i] = adapter:find(cfg.underStatics[i]) end
  for i = 1, ECON749_N do
    h.br[i] = adapter:find(cfg.prefix .. "anim.b.br" .. i)
    h.fc[i] = adapter:find(cfg.prefix .. "anim.b.fc" .. i)
  end
  for i = 1, #cfg.inBoxes do
    h.inBox[i] = adapter:find(cfg.inBoxes[i].name)
  end
  if page == "shop" then
    h.u_price  = adapter:find("econ.shop736.anim.u.price")
    h.u_owned  = adapter:find("econ.shop736.anim.u.owned")
    h.u_desc   = adapter:find("econ.shop736.anim.u.desc")
    h.u_status = adapter:find("econ.shop736.anim.u.status")
    h.u_pos_icons = {}
    for i = 1, #ECON749_SHOP_POS_ICONS do h.u_pos_icons[i] = adapter:find(ECON749_SHOP_POS_ICONS[i]) end
    h.u_clue_icons = {}
    for i = 1, #ECON749_SHOP_CLUE_ICONS do h.u_clue_icons[i] = adapter:find(ECON749_SHOP_CLUE_ICONS[i]) end
  else
    h.u_title   = adapter:find("econ.bag741.anim.u.title")
    h.u_meta    = adapter:find("econ.bag741.anim.u.meta")
    h.u_desc    = adapter:find("econ.bag741.anim.u.desc")
    h.u_usage   = adapter:find("econ.bag741.anim.u.usage")
    h.u_history = adapter:find("econ.bag741.anim.u.history")
  end
  st.handles = h
  return h
end

-- 真机容器 SetVisible 不级联，必须逐叶子显式开/关 anim.bend 与 anim.under
local function e749_set_bend_vis(h, on)
  if h.bend ~= nil then pcall(e749_set_vis, h.bend, on) end
  for i = 1, #h.br do local c = h.br[i]; if c ~= nil then pcall(e749_set_vis, c, on) end end
  for i = 1, #h.fc do local c = h.fc[i]; if c ~= nil then pcall(e749_set_vis, c, on) end end
  for i = 1, #h.inBox do local c = h.inBox[i]; if c ~= nil then pcall(e749_set_vis, c, on) end end
end

local function e749_set_under_all_off(page, h)
  for i = 1, #h.u_static do local c = h.u_static[i]; if c ~= nil then pcall(e749_set_vis, c, false) end end
  if page == "shop" then
    if h.u_price  then pcall(e749_set_vis, h.u_price,  false) end
    if h.u_owned  then pcall(e749_set_vis, h.u_owned,  false) end
    if h.u_desc   then pcall(e749_set_vis, h.u_desc,   false) end
    if h.u_status then pcall(e749_set_vis, h.u_status, false) end
    for i = 1, #h.u_pos_icons  do local c = h.u_pos_icons[i];  if c then pcall(e749_set_vis, c, false) end end
    for i = 1, #h.u_clue_icons do local c = h.u_clue_icons[i]; if c then pcall(e749_set_vis, c, false) end end
  else
    if h.u_title   then pcall(e749_set_vis, h.u_title,   false) end
    if h.u_meta    then pcall(e749_set_vis, h.u_meta,    false) end
    if h.u_desc    then pcall(e749_set_vis, h.u_desc,    false) end
    if h.u_usage   then pcall(e749_set_vis, h.u_usage,   false) end
    if h.u_history then pcall(e749_set_vis, h.u_history, false) end
  end
  if h.under ~= nil then
    pcall(e749_set_scale, h.under, 1, 1)
    pcall(e749_set_rot, h.under, 0)
    pcall(e749_set_vis, h.under, false)
  end
end

local function e749_snap_rest(page, clearState)
  local st = econ749_st[page]
  local cfg = ECON749_CFG[page]
  local h = st.handles
  if h == nil and adapter ~= nil then h = e749_ensure_handles(page) end
  if h ~= nil then
    if h.sheet ~= nil then
      pcall(e749_set_pos, h.sheet, cfg.baseX, cfg.baseY)
      pcall(e749_set_scale, h.sheet, 1, 1)
      pcall(e749_set_rot, h.sheet, 0)
    end
    if h.ptop ~= nil then
      pcall(e749_set_pos, h.ptop, cfg.ptopRelX, cfg.ptopRelY)
      pcall(e749_set_scale, h.ptop, 1, 1)
      pcall(e749_set_rot, h.ptop, 0)
    end
    if h.pbot ~= nil then
      pcall(e749_set_pos, h.pbot, cfg.pbotRelX, cfg.pbotRelY)
      pcall(e749_set_scale, h.pbot, 1, 1)
      pcall(e749_set_rot, h.pbot, 0)
    end
    if h.top ~= nil then
      pcall(e749_set_pos, h.top, cfg.topRelX, cfg.topRelY)
      pcall(e749_set_scale, h.top, 1, 1)
      pcall(e749_set_rot, h.top, 0)
    end
    if h.bot ~= nil then
      pcall(e749_set_pos, h.bot, cfg.botRelX, cfg.botRelY)
      pcall(e749_set_scale, h.bot, 1, 1)
      pcall(e749_set_rot, h.bot, 0)
    end
    e749_set_bend_vis(h, false)
    e749_set_under_all_off(page, h)
    -- 仅在仍留本页时恢复静止单底面与静止内框；离页时绝不误点亮防闪烁
    if not clearState then
      for i = 1, #h.staticFaces do
        if h.staticFaces[i] ~= nil then pcall(e749_set_vis, h.staticFaces[i], true) end
      end
    end
  end
  st.animT = nil
  if clearState then
    st.lastKey = nil
    st.lastSnap = nil
  end
end

local function e749_fill_under(page, snap)
  local h = e749_ensure_handles(page)
  if h == nil then return end
  -- 显式点亮旧纸容器及全部底纸/边框/图框/说明框/角钉叶子，确保完整旧纸稳坐底层
  if h.under ~= nil then pcall(e749_set_vis, h.under, true) end
  for i = 1, #h.u_static do
    local c = h.u_static[i]
    if c ~= nil then pcall(e749_set_vis, c, true) end
  end
  if page == "shop" then
    if h.u_price  then pcall(e749_set_text, h.u_price,  snap.price);  pcall(e749_set_vis, h.u_price,  true) end
    if h.u_owned  then pcall(e749_set_text, h.u_owned,  snap.owned);  pcall(e749_set_vis, h.u_owned,  true) end
    if h.u_desc   then pcall(e749_set_text, h.u_desc,   snap.desc);   pcall(e749_set_vis, h.u_desc,   true) end
    if h.u_status then pcall(e749_set_text, h.u_status, snap.status); pcall(e749_set_vis, h.u_status, true) end
    local pk = snap.pick or ""
    local showPos = (pk == "position")
    local showClue = (pk == "clue")
    for i = 1, #h.u_pos_icons do
      local c = h.u_pos_icons[i]
      if c then pcall(e749_set_vis, c, showPos) end
    end
    for i = 1, #h.u_clue_icons do
      local c = h.u_clue_icons[i]
      if c then pcall(e749_set_vis, c, showClue) end
    end
  else
    if h.u_title   then pcall(e749_set_text, h.u_title,   snap.title);   pcall(e749_set_vis, h.u_title,   true) end
    if h.u_meta    then pcall(e749_set_text, h.u_meta,    snap.meta);    pcall(e749_set_vis, h.u_meta,    true) end
    if h.u_desc    then pcall(e749_set_text, h.u_desc,    snap.desc);    pcall(e749_set_vis, h.u_desc,    true) end
    if h.u_usage   then pcall(e749_set_text, h.u_usage,   snap.usage);   pcall(e749_set_vis, h.u_usage,   snap.usageVis) end
    if h.u_history then pcall(e749_set_text, h.u_history, snap.history); pcall(e749_set_vis, h.u_history, snap.historyVis) end
  end
end

local function e749_sample_chain(vTarget)
  local f = vTarget * ECON749_N + 0.5
  local i0 = math.floor(f)
  if i0 < 1 then i0 = 1 elseif i0 > ECON749_N then i0 = ECON749_N end
  local i1 = i0 + 1
  if i1 > ECON749_N then i1 = ECON749_N end
  local t = f - i0
  if t < 0 then t = 0 elseif t > 1 then t = 1 end
  return
    econ749_cx[i0] + (econ749_cx[i1] - econ749_cx[i0]) * t,
    econ749_cy[i0] + (econ749_cy[i1] - econ749_cy[i0]) * t,
    econ749_sx[i0] + (econ749_sx[i1] - econ749_sx[i0]) * t,
    econ749_sy[i0] + (econ749_sy[i1] - econ749_sy[i0]) * t,
    econ749_rz[i0] + (econ749_rz[i1] - econ749_rz[i0]) * t
end

local function e749_apply_frame(page, u)
  local st = econ749_st[page]
  local cfg = ECON749_CFG[page]
  local h = st.handles
  if h == nil or h.sheet == nil then return end

  -- 动画期：静止单底面/刚体说明框保持隐藏，弯曲纸带（含 16 边框 + 16 纸面 + M 同步弯曲内框）逐叶子全亮
  for i = 1, #h.staticFaces do
    if h.staticFaces[i] ~= nil then pcall(e749_set_vis, h.staticFaces[i], false) end
  end
  e749_set_bend_vis(h, true)

  local inv = 1 - u
  -- 基尔霍夫薄板阻尼模态时间包络（u=1 处 C1 平滑落平）
  local remPos = (inv ^ 2.15) * (1 + 0.50 * u)
  if remPos > 1 then remPos = 1 elseif remPos < 0 then remPos = 0 end
  local qKl   = (inv ^ 1.60) * math.exp(-0.50 * u) * (1 + 0.85 * u)
  local qAir  = (inv ^ 1.80) * math.exp(-1.10 * u) * (0.40 + 2.20 * u)
  local qTilt = (inv ^ 1.85) * (1 + 0.40 * u)

  local sinPiU = math.sin(ECON749_PI * u)
  local headDx = (st.flip and cfg.headDxB or cfg.headDxA) * remPos
  local headDy = cfg.headDy * remPos + cfg.arcLiftY * sinPiU * (inv ^ 1.45)
  local thetaHead = (st.flip and cfg.thetaHeadB or cfg.thetaHeadA) * qTilt

  local stripH = cfg.h / ECON749_N
  local klAmp = cfg.ampKl * qKl
  local airAmp = cfg.ampAir * qAir
  local globalWidthScale = 1 - cfg.globalWidthTilt * qKl

  -- 1a. 第一遍：基尔霍夫薄板方程 D*w'''' = q 解析双模态斜率 phi(xi) 与 3D 离面高程 w(xi)
  --   模态1（悬臂-自由端: w(0)=w'(0)=0, M(1)=V(1)=0）：P_kl'(xi)  = (4/3)*(3*xi - 3*xi^2 + xi^3)
  --   模态2（简支气垫穹拱: w(0)=w(1)=0, M(0)=M(1)=0）：P_air'(xi) = (16/5)*(1 - 6*xi^2 + 4*xi^3)
  local wAcc = 0
  local wMax = -1e9
  for i = 1, ECON749_N do
    local xi = (i - 0.5) / ECON749_N
    local xi2 = xi * xi
    local xi3 = xi2 * xi
    local dPKl  = (4 / 3) * (3 * xi - 3 * xi2 + xi3)
    local dPAir = (16 / 5) * (1 - 6 * xi2 + 4 * xi3)
    local slope = klAmp * dPKl + airAmp * dPAir
    local phi = math.atan(slope)
    wAcc = wAcc + stripH * math.sin(phi)
    if wAcc > wMax then wMax = wAcc end

    local ang = thetaHead + cfg.obliqueDeg * (klAmp * dPKl) + cfg.airTwistDeg * qAir * (xi - 0.5)
    econ749_phi[i] = phi
    econ749_w[i] = wAcc
    econ749_ang[i] = ang
  end

  -- 1b. 第二遍：严格不可伸长可展板积分（纯透视平滑宽度 + 外侧零拉长护栏，消除右上角阶梯感）
  local px = headDx
  local py = cfg.h * 0.5 + headDy
  local prevRad = econ749_ang[1] * ECON749_RAD
  local perspF = cfg.perspF
  for i = 1, ECON749_N do
    local phi = econ749_phi[i]
    local ang = econ749_ang[i]
    local rad = ang * ECON749_RAD

    local wDrop = econ749_w[i] - wMax
    local segSx = (perspF / (perspF - wDrop)) * globalWidthScale
    if segSx < 0.95 then segSx = 0.95 elseif segSx > 1 then segSx = 1 end

    local dRad = math.abs(rad - prevRad)
    if i < ECON749_N then
      local dRadNext = math.abs(econ749_ang[i + 1] * ECON749_RAD - rad)
      if dRadNext > dRad then dRad = dRadNext end
    end
    local hw = 0.5 * cfg.w * segSx
    local edgeGuard = 1 - (hw * dRad) / stripH
    local cosPhi = math.cos(phi)
    local segSy = cosPhi < edgeGuard and cosPhi or edgeGuard
    if segSy < 0.86 then segSy = 0.86 elseif segSy > 1 then segSy = 1 end
    prevRad = rad

    local ds = stripH * segSy
    local sa = math.sin(rad)
    local ca = math.cos(rad)
    local nx = px + ds * sa
    local ny = py - ds * ca
    local cx = 0.5 * (px + nx)
    local cy = 0.5 * (py + ny)
    px, py = nx, ny

    econ749_cx[i] = cx
    econ749_cy[i] = cy
    econ749_sx[i] = segSx
    econ749_sy[i] = segSy
    econ749_rz[i] = ang

    -- 3D 离面法向朗伯实色明暗（100% alpha=0xFF，无半透明叠片）
    local ld = 13.0 * math.sin(phi) + 4.0 * (cosPhi - 1)
    if ld > 8 then ld = 8 elseif ld < -8 then ld = -8 end
    local offB = (i == 1 and (-3.0 * segSy)) or (i == ECON749_N and (3.0 * segSy)) or 0
    local offF = (i == 1 and (-4.0 * segSy)) or (i == ECON749_N and (4.0 * segSy)) or 0

    local br = h.br[i]
    if br ~= nil then
      pcall(e749_set_pos, br, cx - offB * sa, cy + offB * ca)
      pcall(e749_set_scale, br, segSx, segSy)
      pcall(e749_set_rot, br, ang)
      pcall(e749_set_col, br, e749_pack_opaque(cfg.brR, cfg.brG, cfg.brB, ld * 0.5))
    end
    local fc = h.fc[i]
    if fc ~= nil then
      pcall(e749_set_pos, fc, cx - offF * sa, cy + offF * ca)
      pcall(e749_set_scale, fc, segSx, segSy)
      pcall(e749_set_rot, fc, ang)
      pcall(e749_set_col, fc, e749_pack_opaque(cfg.faceR, cfg.faceG, cfg.faceB, ld))
    end
  end

  -- 2. 内部浅棕说明框/标题框条带同步弯曲（与外纸面 100% 融为一体，零破边零脱节）
  local inSpecs = cfg.inBoxes
  for j = 1, #inSpecs do
    local c = h.inBox[j]
    if c ~= nil then
      local sp = inSpecs[j]
      local bx, by, bsx, bsy, bang = e749_sample_chain(sp.v)
      local rad = bang * ECON749_RAD
      local sa = math.sin(rad)
      local ca = math.cos(rad)
      local offS = sp.off * bsy
      local dxS = sp.dx * bsx
      pcall(e749_set_pos, c, bx + dxS * ca - offS * sa, by + dxS * sa + offS * ca)
      pcall(e749_set_scale, c, bsx, bsy)
      pcall(e749_set_rot, c, bang)
      local idxPhi = math.floor(sp.v * ECON749_N + 0.5)
      if idxPhi < 1 then idxPhi = 1 elseif idxPhi > ECON749_N then idxPhi = ECON749_N end
      local phiJ = econ749_phi[idxPhi]
      local ld = 13.0 * math.sin(phiJ) + 4.0 * (math.cos(phiJ) - 1)
      if ld > 8 then ld = 8 elseif ld < -8 then ld = -8 end
      pcall(e749_set_col, c, e749_pack_opaque(sp.r, sp.g, sp.b, ld))
    end
  end

  -- 3. 角钉容器（ptop/pbot）与内容容器（top/bot）精准贴合弯曲链对应位置与切线角
  if h.ptop ~= nil then
    local x1, y1, sx1, sy1, rz1 = e749_sample_chain(cfg.vPTop)
    pcall(e749_set_pos, h.ptop, x1, y1); pcall(e749_set_scale, h.ptop, sx1, sy1); pcall(e749_set_rot, h.ptop, rz1)
  end
  if h.pbot ~= nil then
    local x2, y2, sx2, sy2, rz2 = e749_sample_chain(cfg.vPBot)
    pcall(e749_set_pos, h.pbot, x2, y2); pcall(e749_set_scale, h.pbot, sx2, sy2); pcall(e749_set_rot, h.pbot, rz2)
  end
  if h.top ~= nil then
    local tx, ty, tsx, tsy, trz = e749_sample_chain(cfg.vTop)
    pcall(e749_set_pos, h.top, tx, ty); pcall(e749_set_scale, h.top, tsx, tsy); pcall(e749_set_rot, h.top, trz)
  end
  if h.bot ~= nil then
    local bx2, by2, bsx, bsy, brz = e749_sample_chain(cfg.vBot)
    pcall(e749_set_pos, h.bot, bx2, by2); pcall(e749_set_scale, h.bot, bsx, bsy); pcall(e749_set_rot, h.bot, brz)
  end

  -- 4. 下方完整旧纸：随新纸压下产生轻微承接压沉感
  if h.under ~= nil then
    local easeUnder = 1 - inv * inv * inv
    local usc = 1 - (1 - cfg.underEndScale) * easeUnder
    local urz = cfg.underEndRot * easeUnder
    pcall(e749_set_scale, h.under, usc, usc)
    pcall(e749_set_rot, h.under, urz)
  end
end

local function e749_read_shop_snap(ctrl)
  local pick = ctrl.econ_pick
  local coins, clues, pending, _, positions = ctrl.opts.wallet()
  pending = pending or ""
  local pos = (pick == "position")
  local qty = pos and positions or clues
  local qtyStr = (qty == nil) and "读取中" or tostring(qty)
  local price = pick and (tostring(ECON749_SHOP_PRICE[pick]) .. " 调查币") or ""
  local owned = pick and ("持有 " .. qtyStr .. " 张") or ""
  local desc = pick and (pos and "选中一名人物，将其棋子摆到正确位置。" or "选中一条线索，核验其真假。") or "选择左侧的道具查看用途。"
  local status = (pending ~= "" and pending) or ctrl.econ_status or (pick and "本案免费提示用完后可使用。" or "")
  -- 仅以选中商品 pick 作为翻纸触发键：购买商品（确认弹窗、提示文案、持有数+1）绝不触发纸张动画
  local key = pick or ""
  return key, { pick = pick, price = price, owned = owned, desc = desc, status = status }
end

local function e749_read_bag_snap(ctrl)
  local coins, clues, pending, last, positions, pos_last = ctrl.opts.wallet()
  pending = pending or ""
  local hasClue, hasPos = (clues or 0) > 0, (positions or 0) > 0
  local pick = (hasClue and ctrl.econ_pick == "clue" and "clue")
    or (hasPos and ctrl.econ_pick == "position" and "position")
    or nil
  local history = ""
  if pick ~= "clue" and pos_last and pos_last ~= "-" then
    local c, id, r, col = pos_last:match("^case_00(%d):([^:]+):(%d+):(%d+)$")
    if c then history = "上次揭示：案件 " .. c .. " · " .. id .. " 第" .. r .. "行第" .. col .. "列" end
  end
  if history == "" and pick ~= "position" and last and last ~= "-" then
    history = "上次线索核验：" .. (last:sub(-1) == "1" and "真" or "假")
  end
  local title = pick and (pick == "clue" and "线索核验券" or "位置揭示券") or "调查背包"
  local meta = pick and ("持有 " .. tostring(pick == "clue" and clues or positions) .. " 张")
    or ("调查币　" .. (coins == nil and "读取中" or tostring(coins)))
  local desc = (pick == "clue" and "选中一条线索，核验其真假。")
    or (pick == "position" and "选中一名人物，将其棋子摆到正确位置。")
    or (pending ~= "" and pending)
    or ((clues == nil or positions == nil) and "正在读取背包…")
    or ((hasClue or hasPos) and "选择左侧的道具查看用途。")
    or "背包为空，可到调查商城购买道具。"
  local usage = pick and "本案免费提示用完后，可在提示菜单中用券。" or ""
  local usageVis = (pick ~= nil)
  local historyVis = (history ~= "")
  local key = pick or ""
  return key, {
    pick = pick, title = title, meta = meta, desc = desc,
    usage = usage, usageVis = usageVis, history = history, historyVis = historyVis,
  }
end

local function sync_econ_paper_anim749(dt)
  if not adapter then return end
  local cur = Murdoku and Murdoku.current()
  local ctrl = cur and cur.controller
  local page = ctrl and ctrl.screen or "home"
  if page ~= "shop" and page ~= "bag" then
    if econ749_st.activePage ~= nil then
      e749_snap_rest(econ749_st.activePage, true)
      econ749_st.activePage = nil
    end
    return
  end
  if econ749_st.activePage ~= nil and econ749_st.activePage ~= page then
    e749_snap_rest(econ749_st.activePage, true)
  end
  econ749_st.activePage = page

  local st = econ749_st[page]
  local key, snap
  if page == "shop" then key, snap = e749_read_shop_snap(ctrl)
  else key, snap = e749_read_bag_snap(ctrl) end

  if st.lastKey == nil then
    st.lastKey = key
    st.lastSnap = snap
    e749_snap_rest(page, false)
    return
  end

  if key ~= st.lastKey then
    local prevSnap = st.lastSnap
    st.lastKey = key
    st.lastSnap = snap
    local h = e749_ensure_handles(page)
    if h ~= nil and h.sheet ~= nil and h.under ~= nil and prevSnap ~= nil then
      e749_fill_under(page, prevSnap)
      pcall(e749_set_scale, h.under, 1, 1)
      pcall(e749_set_rot, h.under, 0)
      st.flip = not st.flip
      st.animT = 0
      e749_apply_frame(page, 0)
    end
    return
  end

  -- 同一选中对象下（例如购买成功更新持有数或提示文案），仅在稳态刷新快照，绝不触发动画
  if st.animT == nil then
    st.lastSnap = snap
    return
  end

  local stepDt = tonumber(dt) or 0
  if stepDt < 0 then stepDt = 0 elseif stepDt > 0.05 then stepDt = 0.05 end
  local nextT = st.animT + stepDt
  if nextT >= ECON749_DUR then
    e749_snap_rest(page, false)
    st.lastSnap = snap
  else
    st.animT = nextT
    e749_apply_frame(page, nextT / ECON749_DUR)
  end
end
-- ECON749 PAPER ANIM END`;

patch(
  'insert_econ749_paper_anim_controller',
  `-- ECON742 RESPONSIVE END`,
  `-- ECON742 RESPONSIVE END\n\n${animControllerLua}`
);

patch(
  'hook_sync_econ_paper_anim749_in_OnUpdate',
  `  sync_econ742(dt, false)\nend`,
  `  sync_econ742(dt, false)\n  sync_econ_paper_anim749(dt)\nend`
);

// 6. 版本标记更新为 v749_v8
patch(
  'version_marker_1',
  `if print then print("[murdoku] ===== 构建标记 v748 / 全核查修复与自闭环验证 =====") end`,
  `if print then print("[murdoku] ===== 构建标记 v749_v8 / 基尔霍夫薄板双模态物理弯曲 =====") end`
);
patch(
  'version_marker_2',
  `print("[murdoku] ===== 构建标记 v748 / 全核查修复与自闭环验证 =====")`,
  `print("[murdoku] ===== 构建标记 v749_v8 / 基尔霍夫薄板双模态物理弯曲 =====")`
);

// ── 四维静态门禁（Lua 语法 + GETTABUP/SETTABUP 全局零新增 + 不透明审计 + shop_cold_render）───
const candLuaPath = path.join(runTmp, 'candidate749v8.lua');
fs.writeFileSync(candLuaPath, lua, 'utf8');

const syn = spawnSync('lua', ['-e', `assert(loadfile(${JSON.stringify(candLuaPath)})); print("SYNTAX PASS")`], { encoding: 'utf8' });
assert.equal(syn.status, 0, 'Lua 语法检查失败:\n' + syn.stderr);
process.stdout.write(syn.stdout);

function auditGlobals(srcText, tag) {
  const p = path.join(runTmp, `audit_${tag}.lua`);
  fs.writeFileSync(p, srcText, 'utf8');
  const r = spawnSync('luac', ['-p', '-l', p], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `luac 审计失败 (${tag}):\n` + r.stderr);
  const gets = new Set();
  const sets = new Set();
  for (const line of r.stdout.split('\n')) {
    const mg = line.match(/GETTABUP\s+\d+\s+\d+\s+\d+\s*;\s*_ENV\s+"([^"]+)"/);
    if (mg) gets.add(mg[1]);
    const ms = line.match(/SETTABUP\s+\d+\s+\d+\s+\d+\s*;\s*_ENV\s+"([^"]+)"/);
    if (ms) sets.add(ms[1]);
  }
  return { gets, sets };
}

const g748Audit = auditGlobals(original, '748');
const g749Audit = auditGlobals(lua, '749v8');
const newGets = [...g749Audit.gets].filter((k) => !g748Audit.gets.has(k));
const newSets = [...g749Audit.sets].filter((k) => !g748Audit.sets.has(k));
assert.deepEqual(newGets, [], '禁止新增全局读 (GETTABUP _ENV): ' + JSON.stringify(newGets));
assert.deepEqual(newSets, [], '禁止新增全局写 (SETTABUP _ENV): ' + JSON.stringify(newSets));
console.log('GLOBAL_AUDIT PASS (newGets=0, newSets=0)');

// 不透明审计：100% 新增装饰图元必须为 FF 开头（零半透明产物）
const decorImages = newRecsInfo.filter((x) => x.kind === 'image');
const semi = decorImages.filter((x) => !String(x.colorHex).toUpperCase().startsWith('FF'));
assert.deepEqual(semi, [], '发现半透明新增图元: ' + JSON.stringify(semi));
console.log(`OPAQUE_AUDIT PASS (decorImages=${decorImages.length}, semiTransparent=0)`);

const coldRes = spawnSync('lua', [path.join(repo, 'tests/shop_cold_render.lua')], { input: lua, encoding: 'utf8' });
assert.equal(coldRes.status, 0, 'shop_cold_render.lua 失败:\n' + coldRes.stderr);
const coldLine = coldRes.stdout.trim();
console.log('SHOP_COLD_RENDER:', coldLine);

// ── 写入临时 .gil -> 导出真实控件树 -> 运行动画专项验证 ─────────────────────────
leaf.field.payload = Buffer.from(lua, 'utf8');
leaf.field.len = leaf.field.payload.length;
leaf.field.sub = null;

const stageGil = path.join(runTmp, 'stage749v8.gil');
const expectRecCount = origRecCount + newRecsInfo.length;
const report = writeGil(g, stageGil, {
  label: '749_v8 基尔霍夫薄板双模态物理弯曲',
  expectMarker: 'v749',
  expectRecs: expectRecCount,
  assert(saved) {
    assert(findScriptLeaf(saved).buf.equals(Buffer.from(lua, 'utf8')), '重读脚本字节不一致');
    assert(saved.trailer.equals(g.trailer), 'trailer 不一致');
    for (const [id, bytes] of origRecordBytes.entries()) {
      if (touchedIds.has(id)) continue;
      const sr = saved.recs.find((x) => x.id === id);
      assert(sr, '原记录丢失 id=' + id);
      assert(encodeMsg([sr.field]).equals(bytes), '非目标控件记录被意外改动: ' + sr.name);
    }
    // 数学核验：所有迁入控件沿父链累计到 econ.ui742 的静态世界坐标与 748 原坐标误差 < 0.001px
    const byId = new Map(saved.recs.map((x) => [x.id, x]));
    const savedEcon = saved.byName.get('econ.ui742');
    const near = (a, b, msg) => assert(Math.abs(a - b) < 0.001, `${msg}: ${a} vs ${b}`);
    for (const [fullName, orig4] of origWorldPos.entries()) {
      const sr = saved.byName.get(fullName);
      assert(sr, '重读缺少迁入控件: ' + fullName);
      for (let i = 0; i < 4; i++) {
        let wx = 0, wy = 0, cur = sr, depth = 0;
        while (cur && cur.id !== savedEcon.id) {
          const st = statesOf(cur.field)[i];
          wx += pairValue(pairOf(st, 504), 0);
          wy += pairValue(pairOf(st, 504), 1);
          cur = byId.get(cur.parentId);
          depth++;
          assert(depth <= 4, '父链深度异常: ' + fullName);
        }
        assert(cur && cur.id === savedEcon.id, '父链未汇入 econ.ui742: ' + fullName);
        near(wx, orig4[i][0], `${fullName} state[${i}].x`);
        near(wy, orig4[i][1], `${fullName} state[${i}].y`);
      }
    }
    const savedOrder = asIdList(savedEcon.childList.payload, true).map(Number);
    assert.deepEqual(savedOrder, newEconOrder, 'econ.ui742 子列表不一致');
    const sheetIdx = savedOrder.indexOf(shopPair.sheetCont.id);
    for (const fixedName of [
      'econ.shop736.s9', 'econ.shop736.s37', 'econ.shop736.s38', 'econ.shop736.name',
      'econ.shop736.s71', 'econ.shop736.s73', 'econ.shop736.cancel', 'econ.shop736.purchase',
    ]) {
      const fr = saved.byName.get(fixedName);
      assert(fr && fr.parentId === savedEcon.id, '应保持静止的控件父级错误: ' + fixedName);
      if (fixedName !== 'econ.shop736.s9') {
        assert(savedOrder.indexOf(fr.id) > sheetIdx, '标题/按钮应排在商店纸卡 anim.sheet 之后: ' + fixedName);
      }
    }
    for (const info of newRecsInfo) {
      const sr = saved.byName.get(info.name);
      assert(sr && sr.id === info.id && sr.parentId === info.parentId, '新建节点校验失败: ' + info.name);
      if (info.childIds) {
        assert.deepEqual(asIdList(sr.childList.payload, true).map(Number), info.childIds, '容器子列表不一致: ' + info.name);
      }
    }
    return true;
  },
});

// 导出真实控件树并运行专项仿真验证
const tree749Path = path.join(runTmp, 'tree749v8.lua');
const expRes = spawnSync('node', [path.join(repo, 'tests/export_gil_tree.mjs'), stageGil, tree749Path], { encoding: 'utf8' });
assert.equal(expRes.status, 0, '导出控件树失败:\n' + expRes.stderr);
process.stdout.write(expRes.stdout);

const animJsonPath = path.join(runTmp, 'verify_749_paper_anim.json');
const animRes = spawnSync('lua', [path.join(repo, 'tests/verify_749_paper_anim.lua'), tree749Path, candLuaPath, animJsonPath], { encoding: 'utf8' });
assert.equal(animRes.status, 0, 'verify_749_paper_anim.lua 失败:\n' + animRes.stdout + '\n' + animRes.stderr);
process.stdout.write(animRes.stdout);
const animReport = JSON.parse(fs.readFileSync(animJsonPath, 'utf8'));
assert.equal(animReport.pass, true, '动画专项验证未通过');

// ── 原子落盘正式产物（完整保留 v1..v7，输出 749_v8）───────────────────────────────────
fs.mkdirSync(path.dirname(out), { recursive: true });
const tmpTarget = out + '.tmp';
fs.copyFileSync(stageGil, tmpTarget);
fs.renameSync(tmpTarget, out);

const outDir = path.dirname(out);
fs.writeFileSync(path.join(outDir, '749_v8_内嵌脚本.lua'), lua, 'utf8');

const summary = {
  version: '749_v8',
  baseVersion: '748',
  baseSha256: sha(g.src),
  outputPath: out,
  outputBytes: report.bytes,
  outputSha256: sha(report.g2.src),
  recordsBefore: origRecCount,
  recordsAfter: expectRecCount,
  recordsAdded: newRecsInfo.length,
  bendStripCount: N_STRIPS,
  shopInnerBendStrips: shopPair.inBoxSpecs.length,
  bagInnerBendStrips: bagPair.inBoxSpecs.length,
  decorImagesOpaque: decorImages.length,
  semiTransparentArtifacts: 0,
  shopMovedControls: SHOP_ALL_KEYS.length,
  shopFixedHeaderAndButtons: ['s8', 's9', 's37', 's38', 's43..s64', 'name', 's71..s74', 'cancel', 'purchase'],
  shopCardTheme: { outerBoard: '#ECE2CC', cardBorder: '#B89872', cardFace: '#F7F0DF', innerBox: '#E7D0B2' },
  bagMovedControls: BAG_ALL_KEYS.length,
  shopBase,
  bagBase,
  scriptBytesBefore: Buffer.byteLength(original, 'utf8'),
  scriptBytesAfter: Buffer.byteLength(lua, 'utf8'),
  staticGates: { syntaxPass: true, newGlobalGetVs748: 0, newGlobalSetVs748: 0, worldPosExactMatch: true },
  shopColdRender: coldLine,
  animVerification: animReport,
};
fs.writeFileSync(path.join(outDir, '749_v8_动画验证与结构报告.json'), JSON.stringify(summary, null, 2), 'utf8');

if (!keepTmp) fs.rmSync(runTmp, { recursive: true, force: true });
console.log(`BUILD_749_V8_OK: ${out} bytes=${report.bytes} recs=${expectRecCount} sha256=${summary.outputSha256.slice(0, 16)}`);
