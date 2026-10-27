// tools/sim/gil_to_save.mjs
// ─────────────────────────────────────────────────────────────────────────────
// `.gil`（千星编辑器导出的界面存档）→ `qxqy-simulator-save`（模拟器可加载存档）
//
// 用法：
//   node tools/sim/gil_to_save.mjs --in="371-结算按钮-v240.gil" \
//        --out="tools/sim/out/371-v240.save.json" \
//        [--check="sim-save/murdoku-v215-测试存档.save.json"] [--geom=auto|canvas|design]
//
// 为什么能这么写（全部有据，见 docs/转换器-gil到模拟器存档.md）：
//   1. `.gil` 的**信封**不是 GIA 的 Root（顶层 `#9` 装整组），但**控件记录本身**与
//      插件内嵌的 protobuf 模式**逐字段同构**（ContentWrapper#501 guid / #502 info /
//      #503 children / #504 parent / #505 data，Data 槽位号 2/15、4/86、1/12、63/83…，
//      Details oneof 13=transform、14=field14、74=genericSlot、75=textConfig、81=buttonPreset…）
//      ⇒ 字段语义直接取插件 worker.js 里的模式文本 + GIA 读取器 `hr()`，不猜。
//   2. 坐标有两套口径（本文件必须处理、且要报告）：
//      · canvas 口径（编辑器原生 / add_button.mjs / v240 文档）：位置 = 控件中心在
//        1600×900 画布里的绝对坐标 − 画布中心（y 向上），尺寸已是画布像素；
//      · design 口径（`gen_home.mjs` 等早期脚本直接写原值）：位置 = (x,y) 中心，
//        1920×1080 设计空间、左上原点、y 向下；尺寸也是设计像素（×5/6 才是画布）。
//      两者差一个「原点 +(960,540) 且 y 翻转」的变换，`--geom=auto` 按几何自洽性逐条判定
//      并逐条 WARN。
//   3. id 方案取自插件自己：`hr(e,{idOffset})` 里 `n${idOffset+f+1}`（f = 扁平数组下标）
//      ⇒ 本转换器用 `n<记录在 #9/#502 扁平表里的位置+1>`（确定性、与插件同构）。
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { readGil, asIdList, ID_LO, ID_HI } from '../gil/gilread.mjs';

// ── 常量：全部来自插件 worker.js（不发明） ──────────────────────────────────
const PLATFORMS = ['KEYBOARD', 'TOUCHSCREEN', 'CONTROLLER_CONSOLE', 'CONTROLLER_MOBILE'];
const PLATFORM_TYPE = { 0: 'KEYBOARD', 1: 'TOUCHSCREEN', 2: 'CONTROLLER_CONSOLE', 3: 'CONTROLLER_MOBILE' };
const KIND_OF_TYPE = { '客户端控件容器': 'server-container', '容器节点': 'container', '文本框': 'textbox', '文本视窗': 'textwindow', '图片': 'image', '预设按钮': 'button', '交互按钮': 'button', '光标检测区域': 'cursor', '网格视窗': 'grid', '模板引用控件': 'reference', '按键提示': 'keyhint', '界面动效': 'animation', '全屏动效': 'fullscreen' };
const KIND_LABEL = { 'server-container': '客户端控件容器', container: '容器节点', textbox: '文本框', image: '图片', button: '预设按钮', cursor: '光标检测区域', grid: '网格视窗', reference: '模板引用控件', textwindow: '文本视窗', keyhint: '按键提示', animation: '界面动效', fullscreen: '全屏动效' };
// 变换 preset（MultiPlatform.field502）：Dt[kind]，来自 worker.js
const PRESET = { image: 23, 'server-container': 24, container: 25, grid: 26, reference: 27, button: 28, animation: 29, fullscreen: 30, textbox: 31, textwindow: 32, cursor: 33, keyhint: 34 };
const CANVAS_PRESETS = [
  { id: 'pc-16-9', label: 'PC 1600×900', width: 1600, height: 900, platform: 'KEYBOARD' },
  { id: 'pc-21-9', label: 'PC 2100×900', width: 2100, height: 900, platform: 'KEYBOARD' },
  { id: 'mobile-16-9', label: '手机 1280×720', width: 1280, height: 720, platform: 'TOUCHSCREEN' },
  { id: 'mobile-19.5-9', label: '手机 1560×720', width: 1560, height: 720, platform: 'TOUCHSCREEN' },
  { id: 'mobile-4-3', label: '手机 1280×960', width: 1280, height: 960, platform: 'TOUCHSCREEN' }
];
const DESIGN_W = 1920, DESIGN_H = 1080;           // 本工程的设计空间（docs/控件坐标表-1600x900.md）
const CANVAS_W = 1600, CANVAS_H = 900;            // pc-16-9
const SC = CANVAS_W / DESIGN_W;                   // 5/6
// 参考存档里的缺省值（`qxqy_studio_get` 默认形状，逐键抄自 sim-save/murdoku-v215-测试存档.save.json）
const DEF = {
  textbox: { fontSize: 20, minimumFontSize: 20, adaptiveFontSize: false, fontColor: 4294967295, bgColor: 16777215, enableOutline: true, outlineColor: 858993459, horizontalAlignment: 'Left', verticalAlignment: 'Top', text: '' },
  image: { imageSource: 'StaticReference', imageId: 100001, imageColor: 4294967295, enableMask: false, enableSoftEdge: false, softEdgeMode: 'Percentage', softEdgeWidthX: 8, softEdgeWidthY: 8, horizontalSoftRange: 85, verticalSoftRange: 85, enableFill: false, fillType: 'Horizontal', fillHorizontalType: 'Left', fillVerticalType: 'Bottom', fillRadial90Type: 'BottomLeft', fillRadialType: 'Bottom', fillAmount: 1, reverseMaskArea: false },
  button: { raycastTarget: true, interactable: true, clickAudioId: 50888, unavailableChildId: null, hoverChildId: null, pressedChildId: null, selectedChildId: null },
  container: { isolateNavigation: false, disableKeyEventPassthrough: false, disableCursorEventPassthrough: false, showCursor: false },
  grid: { cellSizeX: 50, cellSizeY: 50, spacingX: 8, spacingY: 8, padding1X: 20, padding1Y: 20, padding2X: 20, padding2Y: 20, previewCount: 5 },
  keyhint: { keyboardKeyCode: null, controllerKeyCode: null },
  textwindow: { interactable: true, showScrollBar: true },
  cursor: { raycastTarget: false },
  reference: { referencedPrefabId: '' },
  animation: { animationId: '' },
  fullscreen: { animationId: '' }
};

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s === '--' + k || s.startsWith('--' + k + '=')); return a ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : '') : null; };
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IN = path.resolve(REPO, argOf('in') || '371-结算按钮-v240.gil');
const OUT = path.resolve(REPO, argOf('out') || 'tools/sim/out/371-v240.save.json');
const CHECK = argOf('check') ? path.resolve(REPO, argOf('check')) : null;
const GEOM = argOf('geom') || 'auto';
const WARN_LIMIT = Number(argOf('warnLimit') || 400);

const warnings = [];
const anchorFallback = [];
const warn = (scope, msg) => { if (warnings.length < WARN_LIMIT) warnings.push(`[${scope}] ${msg}`); };

// ── 基础工具 ────────────────────────────────────────────────────────────────
const F = {
  g: (fs, n) => (fs || []).find((f) => f.field === n),
  all: (fs, n) => (fs || []).filter((f) => f.field === n),
  num: (f) => (f && f.wt === 0 ? Number(f.num) : null),
  f32: (f) => (f && f.wt === 5 ? f.f : null),
  txt: (f) => (f && f.wt === 2 && f.isText ? f.payload.toString('utf8') : null),
  // 两分量对：缺分量 = 0（跟 gilread.pairValue 同一判据）
  // ★ 存档用 float NaN 表示「未设置」：本档 30+ 条记录的 scale / anchorMin / anchorMax / pivot
  //   就是 NaN（offset/size 正常）。NaN 一律当「缺省」处理，并在报告里计数。
  nanCount: 0,
  pair: (f) => {
    const s = f && f.sub ? f.sub : null;
    if (!s) return null;
    const pick = (n) => { const h = s.find((y) => y.field === n); if (!h) return null; const v = Number(h.f); return Number.isFinite(v) ? v : null; };
    const x = pick(501), y = pick(502);
    if (x === null && y === null) { F.nanCount += 1; return null; }
    return { x: x ?? 0, y: y ?? 0, hadX: x !== null, hadY: y !== null };
  },
  vec3: (f) => {
    const s = f && f.sub ? f.sub : null;
    if (!s) return null;
    const v = (n, d) => { const h = s.find((y) => y.field === n); if (!h) return d; const val = Number(h.f); return Number.isFinite(val) ? val : d; };
    const anyFinite = s.some((y) => Number.isFinite(Number(y.f)));
    return { x: v(1, 0), y: v(2, 0), z: v(3, 0), present: anyFinite };
  }
};
const r3 = (v) => Math.round(v * 1000) / 1000;
const R = (v) => Math.round(v);   // add_button.mjs 用整数取整；几何按 3 位小数保留更忠实，另给整数仅用于核对

// ── 1. 解析 .gil ────────────────────────────────────────────────────────────
const gil = readGil(IN);
const group = gil.tree.find((f) => f.field === 9);
const groupField501 = group && F.g(group.sub, 501);
const groupRootIds = groupField501 && groupField501.payload ? (asIdList(groupField501.payload, true) || []) : [];
const flatList = group ? F.all(group.sub, 502) : [];
const gameVersion = F.txt(gil.tree.find((f) => f.field === 43)) || '';

// 每条记录的精确解析（按插件 proto 的结构，不靠启发式）
const nodes = new Map();       // guid → node
const order = [];              // 扁平顺序（= #9/#502 位置）
const DATA_SLOT = { 2: 'name', 4: 'field14', 1: 'transform', 62: 'rootChildRef', 63: 'genericSlot', 64: 'textConfig', 65: 'cursorConfig', 66: 'templateRefSlot', 67: 'footerSlot', 68: 'containerNodeSlot', 69: 'gridView', 70: 'buttonPreset', 71: 'textConfigTw', 72: 'keyHint', 73: 'imageSlot', 74: 'image', 75: 'effectSlot', 76: 'fullscreenEffectSlot' };
const DET_SLOT = { 13: 'transform', 14: 'field14', 73: 'rootChildRef', 74: 'genericSlot', 75: 'textConfig', 76: 'cursorConfig', 77: 'templateRefSlot', 78: 'footerSlot', 79: 'containerNodeSlot', 80: 'gridView', 81: 'buttonPreset', 83: 'keyHint', 84: 'imageSlot', 85: 'image', 86: 'effectSlot', 87: 'fullscreenEffectSlot' };

flatList.forEach((cw, idx) => {
  if (!cw.sub) return;                                     // 空槽（本文件 20 个）
  const guid = F.num(F.g(cw.sub, 501));
  if (guid == null || guid < 1000) return;
  const dataList = F.all(cw.sub, 505).map((d) => {
    const ds = d.sub || [];
    const det = F.g(ds, 503);
    return { slotA: F.num(F.g(ds, 501)), slotB: F.num(F.g(ds, 502)), det: det ? det.sub : null, raw: ds };
  });
  const detKey = (name) => {
    for (const d of dataList) {
      const hit = (d.det || []).find((x) => DET_SLOT[x.field] === name);
      if (hit) return hit;
    }
    return null;
  };
  const infoList = F.all(cw.sub, 502).map((i) => ({
    a: F.num(F.g(i.sub, 501)), b: F.num(F.g(i.sub, 502)),
    guid: F.num(F.g((F.g(i.sub, 11) || {}).sub, 501)),
    index: F.num(F.g((F.g(i.sub, 12) || {}).sub, 501)),
    relatedList: (F.all((F.g(i.sub, 14) || {}).sub, 501) || []).map((x) => Number(x.num)).filter((v) => Number.isFinite(v))
  }));
  const nameStr = (() => {
    const nm = dataList.map((d) => F.g(d.raw, 12)).find(Boolean);
    return nm ? F.txt(F.g(nm.sub, 501)) : null;
  })();
  // 平台变换
  const xf = detKey('transform');
  const mp = xf ? F.g(xf.sub, 12) : null;
  const platList = mp ? F.all(mp.sub, 501) : [];
  const platforms = {};
  for (const p of platList) {
    const pt = F.num(F.g(p.sub, 501)) ?? 0;
    const rt = F.g(p.sub, 502);
    const rs = rt ? rt.sub : null;
    const key = PLATFORM_TYPE[pt];
    if (!key) { warn(nameStr || guid, `平台槽 platformType=${pt} 未知，已忽略`); continue; }
    platforms[key] = {
      scale: F.vec3(F.g(rs, 501)) || { x: 1, y: 1, z: 1, present: false },
      anchorMin: F.pair(F.g(rs, 502)), anchorMax: F.pair(F.g(rs, 503)),
      offset: F.pair(F.g(rs, 504)), size: F.pair(F.g(rs, 505)), pivot: F.pair(F.g(rs, 506)),
      rot: F.vec3(F.g(rs, 508))
    };
  }
  const node = {
    guid, idx, name: nameStr, info: infoList,
    giaInfoIndex: (infoList.find((i) => i.a === 2 && i.b === 6) || {}).index ?? null,
    giaRelatedGuids: (infoList.find((i) => i.a === 4 && i.b === 4) || {}).relatedList ?? [],
    children: (() => { const cl = F.g(cw.sub, 503); return cl && cl.payload ? (asIdList(cl.payload, true) || []) : []; })(),
    parentGuid: F.num(F.g(cw.sub, 504)),
    dataList, detKey, platforms,
    preset: mp ? F.num(F.g(mp.sub, 502)) : null,
    syncAllDevices: mp ? (F.num(F.g(mp.sub, 504)) === 1) : true,
    xfType: xf ? F.num(F.g(xf.sub, 501)) : null,
    _childrenOut: []
  };
  nodes.set(guid, node);
  order.push(node);
});

// 引擎自带的脚手架：`默认布局`（小地图/技能区/摇杆… 一串内置 HUD 节点）及其子树、以及
// `*HierarchyRoot` 一族占位根（ClientUIRootHierarchyRoot / ClientUIPrototypeHierarchyRoot …）。
// 它们不是用户控件，参考存档（插件自己从真机 GIA 导入的 v215）里也没有它们
// ⇒ 剔除，剩下的正好等于本档的用户控件数（345，= gilread 的记录数）。
const groupRecEarly = gil.recs.find((r) => r.names.some((s) => KIND_OF_TYPE[s] === 'server-container'));
const scGuidEarly = groupRecEarly ? groupRecEarly.id : null;
const ENGINE_ROOT_NAMES = new Set(['默认布局']);
const isScaffoldName = (nm) => !!nm && (ENGINE_ROOT_NAMES.has(nm) || /HierarchyRoot$/.test(nm));
// 引擎块 = guid 落在 `客户端控件容器`（sc1）记录之前的那一段（本档 1073741825…1073741844，
// 共 20 条：默认布局 + 小地图/技能区/摇杆… 一串内置 HUD，加 5 个 *HierarchyRoot 占位根）。
// 判据不是"名字表"而是"id 段"：sc1 记录本身的 guid 是用户控件的起点。
const scaffoldGuids = new Set(order.filter((n) => scGuidEarly != null && n.guid < scGuidEarly).map((n) => n.guid));
const scaffold = order.filter((n) => scaffoldGuids.has(n.guid));
for (const n of scaffold) if (isScaffoldName(n.name)) n._engineNamed = true;
if (scaffold.length) {
  warn('组结构', `${scaffold.length} 条引擎脚手架记录（guid < ${scGuidEarly}：${scaffold.map((n) => n.name || n.guid).join('、')}）不是用户控件，已剔除；参考存档里同样没有它们`);
}
const controlOrder = order.filter((n) => !scaffoldGuids.has(n.guid));

// 类型判定：完全按插件 `hi(e)` 的次序
function kindOf(n) {
  const has = (k) => !!n.detKey(k);
  const slotsA = n.dataList.map((d) => d.slotA);
  if (has('textConfig')) return slotsA.includes(71) ? 'textwindow' : 'textbox';
  if (has('cursorConfig')) return 'cursor';
  if (has('templateRefSlot')) return 'reference';
  if (has('gridView')) return 'grid';
  if (has('buttonPreset')) return 'button';
  if (has('keyHint')) return 'keyhint';
  if (has('image') || has('imageSlot')) return 'image';
  if (has('effectSlot')) return 'animation';
  if (has('fullscreenEffectSlot')) return 'fullscreen';
  return 'container';
}
for (const n of order) {
  n.kind = kindOf(n);
  if (n.preset != null && PRESET[n.kind] != null && n.preset !== PRESET[n.kind]) {
    warn(n.name || n.guid, `变换 preset=${n.preset}，按 kind=${n.kind} 应为 ${PRESET[n.kind]}（记录里的 kind 与 preset 不一致，已按 kind 处理）`);
  }
}

// ── 2. 组树：sc1 → root（＋模板根挂到 root，与原档 1073741844/1073741825 占位父不一致时 WARN）──
const NON_RECORD_PARENT = new Set([1073741825, 1073741844, 1073741840, 1073741841, 1073741842, 1073741843]);
const byGuid = nodes;
const sc1Guid = (order.find((n) => (n.names || []).includes('客户端控件容器')) || {}).guid
  || (order.find((n) => n.info.some((i) => i.a === 1 && i.b === 5) && !n.name) || {}).guid || null;
// 上面 order 里没有 names 字段，改从 gil.recs 取（保留原始 names）
const groupRec = gil.recs.find((r) => r.names.some((s) => KIND_OF_TYPE[s] === 'server-container'));
const scGuid = groupRec ? groupRec.id : sc1Guid;
const mainRoot = order.find((n) => n.name === 'root') || order.find((n) => n.guid === 1073741846);

const attach = (node, parentGuid) => {
  node.parentGuidOut = parentGuid;
  if (parentGuid != null && byGuid.has(parentGuid)) byGuid.get(parentGuid)._childrenOut.push(node.guid);
  return node;
};
// 有效的"树内父"：是控件记录、且不是被剔除的引擎脚手架
const inTree = (guid) => guid != null && byGuid.has(guid) && !scaffoldGuids.has(guid) && guid !== scGuid;
const orphans = [];
const reparented = new Map();   // 原父 guid → 记录名列表（用于报告）
for (const n of controlOrder) {
  if (n.guid === scGuid) continue;
  if (n.guid === (mainRoot ? mainRoot.guid : -1)) continue;
  const pg = n.parentGuid;
  if (pg === scGuid) continue;                       // sc1 的直接孩子，下面统一挂
  if (inTree(pg)) { attach(n, pg); continue; }
  orphans.push(n);
  const key = pg == null ? '(#504 缺失)' : String(pg);
  if (!reparented.has(key)) reparented.set(key, []);
  reparented.get(key).push(n.name || n.guid);
}
for (const [key, list] of reparented) {
  const why = key === '(#504 缺失)' ? '#504 缺失（原档里就是根）'
    : key === '1073741844' ? '父是引擎占位根 ClientUIPrototypeHierarchyRoot（客户端模板组）'
      : key === '1073741825' ? '父是引擎占位根 默认布局' : `父 ${key} 不是本档里的控件记录`;
  warn('组结构', `${list.length} 条记录改挂到 root（${why}）：${list.join('、')}`);
}
for (const n of orphans) attach(n, mainRoot ? mainRoot.guid : null);
// sc1 的孩子：root ＋ 直接挂在「客户端控件容器」记录下的记录（如 111）
const scChildren = [];
if (mainRoot) scChildren.push(mainRoot.guid);
for (const n of controlOrder) {
  if (n.guid === scGuid || n === mainRoot) continue;
  if (n.parentGuid === scGuid) { n.parentGuidOut = scGuid; scChildren.push(n.guid); }
}
if (mainRoot) mainRoot.parentGuidOut = scGuid;

// ── 3. 几何：口径判定 + 转成「相对父中心的 offset」 ────────────────────────
const isStretch = (p) => !!(p && p.anchorMin && p.anchorMax && (p.anchorMin.x !== p.anchorMax.x || p.anchorMin.y !== p.anchorMax.y));
const baseKeyOf = (node) => (node.platforms.KEYBOARD ? 'KEYBOARD' : Object.keys(node.platforms)[0]);
const platOf = (node, key) => node.platforms[key] || node.platforms[baseKeyOf(node)];
const geomNote = [];
// ── 三套候选口径（都是「该节点在 1600×900 画布里的绝对中心 + 画布像素尺寸」）──
//   P（parent-relative）：位置 = 父中心 + 存档值；尺寸 = 存档值（编辑器原生口径，也是插件语义）
//   A（canvas-absolute）：位置 = 画布中心 + 存档值；尺寸 = 存档值（add_button.mjs 的算式）
//   D（design-absolute）：位置 = 存档值 ×5/6、y 翻转；尺寸 = 存档值 ×5/6（gen_home.mjs 等直接写设计原值）
function rectsOf(node, key) {
  const p = platOf(node, key);
  if (!p) return null;
  const off = p.offset || { x: 0, y: 0 }, size = p.size || { x: 0, y: 0 };
  const A = { cx: CANVAS_W / 2 + off.x, cy: CANVAS_H / 2 + off.y, w: size.x, h: size.y };
  const D = { cx: off.x * SC, cy: CANVAS_H - off.y * SC, w: size.x * SC, h: size.y * SC };
  return { A, D, off, size, p };
}
const insideCanvas = (r, margin = 0) => r.cx - r.w / 2 >= -margin && r.cx + r.w / 2 <= CANVAS_W + margin
  && r.cy - r.h / 2 >= -margin && r.cy + r.h / 2 <= CANVAS_H + margin;
const centerInCanvas = (cx, cy, m = 0) => cx >= -m && cx <= CANVAS_W + m && cy >= -m && cy <= CANVAS_H + m;
const designPlausible = (off) => off.x >= 0 && off.x <= DESIGN_W && off.y >= 0 && off.y <= DESIGN_H;
// 决策（GBOM 见 docs/转换器-gil到模拟器存档.md）：
//   ① 拉伸节点 → 原样透传（offset/size 是相对锚点矩形的增量，编辑器与插件同义）
//   ② 父本身停在画布外（暂存区 assets / face.1.1…）→ P（跟着父停着，别搬回画布中间）
//   ③ P 的中心在画布内 → P（编辑器原生口径，也是插件语义 & 真机 GIA 的口径）
//   ④ 否则 D（1920 设计空间原值）合法且落在画布内 → D
//   ⑤ 否则 A（画布绝对坐标）中心在画布内 → A
//   ⑥ 否则 → P（原样）
function pickConv(node, key, parentCenterFor) {
  if (GEOM === 'canvas') return 'A';
  if (GEOM === 'design') return 'D';
  const r = rectsOf(node, key);
  if (!r) return 'A';
  if (isStretch(r.p)) return 'P';
  const pc = parentCenterFor(node, key);
  if (!centerInCanvas(pc.cx, pc.cy)) return 'P';
  const P = { cx: pc.cx + r.off.x, cy: pc.cy + r.off.y, w: r.size.x, h: r.size.y };
  if (centerInCanvas(P.cx, P.cy)) return 'P';
  if (designPlausible(r.off) && insideCanvas(r.D, -40)) return 'D';
  if (centerInCanvas(r.A.cx, r.A.cy)) return 'A';
  return 'P';
}
// 中心：P 依赖父链 ⇒ 先按树序（深度）定 conv，再算中心
const depthOf = new Map();
(function assignDepth(guid, d) { depthOf.set(guid, d); for (const n of controlOrder) if (n.parentGuidOut === guid) assignDepth(n.guid, d + 1); })(scGuid, 0);
const orderedByDepth = [...controlOrder].sort((a, b) => (depthOf.get(a.guid) ?? 99) - (depthOf.get(b.guid) ?? 99));
const scCenter = { cx: CANVAS_W / 2, cy: CANVAS_H / 2 };
function parentCenterOf(node, key) {
  const pg = node.parentGuidOut;
  if (pg == null || pg === scGuid) return scCenter;
  const p = byGuid.get(pg);
  if (!p) return scCenter;
  // 拉伸父（或中心尚未算出）：用它的 box 中心（与插件 Ne 一致）
  if (isStretch(platOf(p, key)) || !p.centerAbs || !Number.isFinite((p.centerAbs[key] || {}).cx)) {
    const box = canvasLevelBox(p, key);
    return { cx: box.left + box.width / 2, cy: box.bottom + box.height / 2 };
  }
  return p.centerAbs[key] || scCenter;
}
for (const n of orderedByDepth) {
  n.conv = n.conv || {};
  n.centerAbs = {};
  for (const key of PLATFORMS) {
    const r = rectsOf(n, key);
    const conv = n.conv.KEYBOARD ? n.conv.KEYBOARD : pickConv(n, key, parentCenterOf);
    n.conv[key] = conv;
    n.conv.KEYBOARD = n.conv.KEYBOARD || conv;
    if (!r) { n.centerAbs[key] = scCenter; continue; }
    const pc = parentCenterOf(n, key);
    if (conv === 'A') n.centerAbs[key] = { cx: r.A.cx, cy: r.A.cy, w: r.A.w, h: r.A.h };
    else if (conv === 'D') n.centerAbs[key] = { cx: r.D.cx, cy: r.D.cy, w: r.D.w, h: r.D.h };
    else if (isStretch(r.p)) n.centerAbs[key] = { cx: NaN, cy: NaN, w: 0, h: 0 };      // 拉伸节点不做中心换算
    else n.centerAbs[key] = { cx: pc.cx + r.off.x, cy: pc.cy + r.off.y, w: r.size.x, h: r.size.y };
  }
  const kb = platOf(n, 'KEYBOARD');
  const koff = (kb && kb.offset) || { x: 0, y: 0 }, ksz = (kb && kb.size) || { x: 0, y: 0 };
  if (n.conv.KEYBOARD === 'D') geomNote.push(`${n.name || n.guid}: 口径 D(design)（存档值 x=${r3(koff.x)} y=${r3(koff.y)} size=${r3(ksz.x)}×${r3(ksz.y)}）→ 画布中心 (${r3(n.centerAbs.KEYBOARD.cx)}, ${r3(n.centerAbs.KEYBOARD.cy)}) 画布尺寸 ${r3(n.centerAbs.KEYBOARD.w)}×${r3(n.centerAbs.KEYBOARD.h)}`);
  else if (n.conv.KEYBOARD === 'A') geomNote.push(`${n.name || n.guid}: 口径 A(canvas-absolute)（存档值 x=${r3(koff.x)} y=${r3(koff.y)}）→ 画布中心 (${r3(n.centerAbs.KEYBOARD.cx)}, ${r3(n.centerAbs.KEYBOARD.cy)})`);
}
function centerAbs(node, key) { return (node.centerAbs && node.centerAbs[key]) || scCenter; }
function parentCenter(node, key) { return parentCenterOf(node, key); }
// 画布级 box（仅用于拉伸节点 / sc1）
function canvasLevelBox(node, key) {
  const parent = node.parentGuidOut == null || node.parentGuidOut === scGuid ? { left: 0, bottom: 0, width: CANVAS_W, height: CANVAS_H } : canvasLevelBox(byGuid.get(node.parentGuidOut), key);
  const p = platOf(node, key);
  const aMin = p.anchorMin || { x: 0, y: 0 }, aMax = p.anchorMax || { x: 0, y: 0 };
  const off = p.offset || { x: 0, y: 0 }, size = p.size || { x: 0, y: 0 };
  const piv = p.pivot || { x: 0.5, y: 0.5 };
  const w = aMax.x * parent.width - aMin.x * parent.width + size.x;
  const h = aMax.y * parent.height - aMin.y * parent.height + size.y;
  const left = parent.left + aMin.x * parent.width + off.x - size.x * piv.x;
  const bottom = parent.bottom + aMin.y * parent.height + off.y - size.y * piv.y;
  return { left, bottom, width: w, height: h, right: left + w, top: bottom + h, centerX: left + w / 2, centerY: bottom + h / 2 };
}
// 生成插件的 transformByPlatform
function buildTransform(node) {
  const out = {};
  const present = Object.keys(node.platforms);
  const baseKey = present.includes('KEYBOARD') ? 'KEYBOARD' : present[0];
  for (const key of PLATFORMS) {
    const src = node.platforms[key] || node.platforms[baseKey];
    if (!src) { out[key] = stretchDefault(); continue; }
    if (!node.platforms[key]) warn(node.name || node.guid, `缺少 ${key} 平台槽，已按 ${baseKey} 克隆（与插件 Fa() 同策略）`);
    const p = src;
    const aMin = p.anchorMin || { x: 0, y: 0 }, aMax = p.anchorMax || { x: 0, y: 0 };
    const piv = p.pivot && p.pivot.present !== false ? p.pivot : { x: 0.5, y: 0.5 };
    const anchorsPresent = !!(p.anchorMin || p.anchorMax);
    let aMinOut, aMaxOut;
    if (!anchorsPresent) {
      // 两对都缺（缺字段或 NaN）→ 本工程口径「自定义 Min=Max=0.5」（docs/控件坐标表-1600x900.md 规则 2）。
      // 数值上验证过：settle.btn 存 (-642,-380) 217×60 + (0.5,0.5) → box 左 49.5 =“设计 x=60 ⇒ 画布 50” ✓
      aMinOut = { x: 0.5, y: 0.5 }; aMaxOut = { x: 0.5, y: 0.5 };
      anchorFallback.push(`${node.name || node.guid}(${key})`);
      warn(node.name || node.guid, `锚点两对都缺或为 NaN，已按本工程口径补 (0.5,0.5)/(0.5,0.5)：${key}`);
    } else if (!p.anchorMin && p.anchorMax) {
      aMinOut = { x: 0, y: 0 }; aMaxOut = { x: p.anchorMax.x, y: p.anchorMax.y };
      if (aMaxOut.x === 1 && aMaxOut.y === 1) {
        anchorFallback.push(`${node.name || node.guid}(${key}:stretch)`);
      } else warn(node.name || node.guid, `只有 anchorMax（${JSON.stringify(aMaxOut)}）没有 anchorMin，已按插件默认补 (0,0)：${key}`);
    } else if (p.anchorMin && !p.anchorMax) {
      aMinOut = { x: p.anchorMin.x, y: p.anchorMin.y }; aMaxOut = { ...aMinOut };
      warn(node.name || node.guid, `只有 anchorMin（${JSON.stringify(aMinOut)}）没有 anchorMax，已按「点锚点」补成同值：${key}`);
    } else {
      aMinOut = { x: aMin.x, y: aMin.y }; aMaxOut = { x: aMax.x, y: aMax.y };
    }
    const stretched = aMinOut.x !== aMaxOut.x || aMinOut.y !== aMaxOut.y;
    const scale = p.scale && p.scale.present ? { x: p.scale.x, y: p.scale.y, z: p.scale.z } : { x: 1, y: 1, z: 1 };
    const rotZ = p.rot && p.rot.present ? p.rot.z : 0;
    let off, size;
    if (stretched) {
      // 拉伸节点：offset/size 是「相对锚点矩形的增量」，编辑器与插件同义 ⇒ 原样透传
      off = { x: p.offset ? p.offset.x : 0, y: p.offset ? p.offset.y : 0 };
      size = { x: p.size ? p.size.x : 0, y: p.size ? p.size.y : 0 };
    } else {
      const c = centerAbs(node, key);
      const pc = parentCenter(node, key);
      off = { x: r3(c.cx - pc.cx), y: r3(c.cy - pc.cy) };
      size = { x: r3(c.w), y: r3(c.h) };
    }
    out[key] = { scale, rotation: { x: 0, y: 0, z: rotZ }, anchorMin: aMinOut, anchorMax: aMaxOut, offset: off, size, pivot: { x: piv.x ?? 0.5, y: piv.y ?? 0.5 } };
  }
  return out;
}
const stretchByPlatform = () => Object.fromEntries(PLATFORMS.map((k) => [k, stretchDefault()]));
const stretchDefault = () => ({ scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, offset: { x: 0, y: 0 }, size: { x: 0, y: 0 }, pivot: { x: 0.5, y: 0.5 } });

// ── 4. 各 kind 的业务字段（逐条照 worker.js `hr()` 的映射） ─────────────────
const idOf = (guid) => { const n = byGuid.get(guid); return n ? n.id : null; };
function buildNodeJson(node) {
  const k = node.kind;
  const p0 = node.platforms.KEYBOARD || node.platforms[Object.keys(node.platforms)[0]] || {};
  const d = (name) => node.detKey(name);
  const detNum = (name, f) => { const x = d(name); return x ? F.num(F.g(x.sub, f)) : null; };
  const detTxt = (name, f) => { const x = d(name); return x ? F.txt(F.g(x.sub, f)) : null; };
  const txt = d('textConfig');
  const imgSlot = d('imageSlot'), img = d('image'), btn = d('buttonPreset'), gen = d('genericSlot');
  const foot = d('footerSlot'), cur = d('cursorConfig'), grid = d('gridView'), kh = d('keyHint');
  const ctn = d('containerNodeSlot'), f14 = d('field14');
  const giaRaw = {
    genericField501: (gen ? F.num(F.g(gen.sub, 501)) : null) ?? 0,
    footerField505: (foot ? F.num(F.g(foot.sub, 505)) : null) ?? 0
  };
  if (k === 'textbox' || k === 'textwindow') {
    giaRaw.textField501 = detNum('textConfig', 501) ?? 20;
    giaRaw.textField503 = detNum('textConfig', 503) ?? 12;
    giaRaw.textAlign = detNum('textConfig', 508) ?? 0;
    const va = detNum('textConfig', 509);
    if (va != null && ![0, 1, 2].includes(va)) giaRaw.textVerticalAlign = va;
    if (k === 'textwindow') {
      giaRaw.textField511 = detNum('textConfig', 511) ?? 1;
      const vf = txt ? F.g(txt.sub, 62) : null;
      giaRaw.textViewField502 = vf ? (F.num(F.g(vf.sub, 502)) ?? 1) : 1;
      giaRaw.textViewField503 = vf ? (F.num(F.g(vf.sub, 503)) ?? 1) : 1;
    }
  } else if (k === 'cursor') giaRaw.cursorField501 = detNum('cursorConfig', 501) ?? 0;
  else if (k === 'reference') giaRaw.templateRefSlot = detTxt('templateRefSlot', 0) ?? (d('templateRefSlot') ? '' : '');
  else if (k === 'grid') {
    giaRaw.gridField501 = detNum('gridView', 501) ?? 1;
    giaRaw.gridField507 = detNum('gridView', 507) ?? 1;
    giaRaw.gridField508 = detNum('gridView', 508) ?? 1;
    giaRaw.gridField509 = detNum('gridView', 509) ?? 1;
    giaRaw.gridField511 = detNum('gridView', 511) ?? 5;
    giaRaw.gridField512 = detNum('gridView', 512) ?? 1;
  } else if (k === 'keyhint') {
    giaRaw.keyHintField501 = detNum('keyHint', 501) ?? 1;
    giaRaw.keyHintField502 = detNum('keyHint', 502) ?? 1;
  } else if (k === 'image') {
    giaRaw.imageField502 = img ? (F.num(F.g(img.sub, 502)) ?? 1) : 1;
    giaRaw.imageField504 = img ? (F.num(F.g(img.sub, 504)) ?? 1) : 1;
    giaRaw.imageField505 = img ? (F.num(F.g(img.sub, 505)) ?? 1) : 1;
    giaRaw.imageField507 = img ? (F.num(F.g(img.sub, 507)) ?? 2) : 2;
    giaRaw.imageFillType = img ? (F.num(F.g(img.sub, 515)) ?? 1) : 1;
  } else if (k === 'animation') giaRaw.effectSlot = detTxt('effectSlot', 0) ?? '';
  else if (k === 'fullscreen') giaRaw.fullscreenEffectSlot = detTxt('fullscreenEffectSlot', 0) ?? '';

  const js = { id: node.id, kind: k, name: node.name ?? KIND_LABEL[k] ?? k, guid: node.guid, giaRelatedGuids: node.giaRelatedGuids || [] };
  if (node.giaInfoIndex != null) js.giaInfoIndex = node.giaInfoIndex;
  js.active = f14 ? F.num(F.g(f14.sub, 502)) !== 1 : true;
  js.visible = f14 ? (F.g(f14.sub, 17) ? F.num(F.g(F.g(f14.sub, 17).sub, 503)) !== 1 : true) : true;
  js.canControllerFocus = foot ? F.num(F.g(foot.sub, 505)) === 1 : false;
  js.syncAllDevices = node.syncAllDevices;
  js.giaRaw = giaRaw;
  js.transformByPlatform = node.transformOut;
  js.children = node._childrenOut.map((g) => byGuid.get(g).id);
  js.scriptMappingIds = gen ? F.all(gen.sub, 502).map((r) => F.num(F.g((F.g(r.sub, 1) || {}).sub, 1))).filter((v) => Number.isSafeInteger(v) && v > 0) : [];
  if (k === 'container') Object.assign(js, {
    isolateNavigation: ctn ? F.num(F.g(ctn.sub, 501)) === 1 : false,
    disableKeyEventPassthrough: ctn ? F.num(F.g(ctn.sub, 502)) === 1 : false,
    disableCursorEventPassthrough: ctn ? F.num(F.g(ctn.sub, 503)) === 1 : false,
    showCursor: ctn ? F.num(F.g(ctn.sub, 504)) === 1 : false
  });
  if (k === 'textbox' || k === 'textwindow') {
    const t = txt ? F.g(txt.sub, 510) : null;
    const align = detNum('textConfig', 508);
    Object.assign(js, {
      fontSize: detNum('textConfig', 512) ?? DEF.textbox.fontSize,
      adaptiveFontSize: detNum('textConfig', 502) === 1,
      minimumFontSize: detNum('textConfig', 513) ?? DEF.textbox.minimumFontSize,
      fontColor: (detNum('textConfig', 504) ?? DEF.textbox.fontColor) >>> 0,
      bgColor: (detNum('textConfig', 505) ?? DEF.textbox.bgColor) >>> 0,
      enableOutline: detNum('textConfig', 506) !== 1,
      outlineColor: (detNum('textConfig', 507) ?? DEF.textbox.outlineColor) >>> 0,
      horizontalAlignment: align === 1 ? 'Middle' : align === 2 ? 'Right' : 'Left',
      verticalAlignment: { 0: 'Top', 1: 'Middle', 2: 'Bottom' }[detNum('textConfig', 509) ?? 0] || 'Top',
      text: t ? (F.txt(F.g(t.sub, 501)) ?? '') : ''
    });
    if (k === 'textwindow') Object.assign(js, { interactable: true, showScrollBar: true });
  }
  if (k === 'image') {
    const fillType = img ? F.num(F.g(img.sub, 515)) : null;
    const f508 = img ? F.f32(F.g(img.sub, 508)) : null;
    Object.assign(js, {
      imageSource: 'StaticReference',
      imageId: (imgSlot ? F.num(F.g(imgSlot.sub, 503)) : null) ?? 0,
      imageColor: (imgSlot && F.num(F.g(imgSlot.sub, 502)) != null ? F.num(F.g(imgSlot.sub, 502)) >>> 0 : DEF.image.imageColor),
      enableMask: img ? F.num(F.g(img.sub, 501)) === 1 : false,
      enableSoftEdge: img ? F.num(F.g(img.sub, 509)) === 1 : false,
      softEdgeMode: img && F.num(F.g(img.sub, 510)) === 1 ? 'Pixel' : 'Percentage',
      softEdgeWidthX: (img ? F.pair(F.g(img.sub, 511)) : null)?.x ?? DEF.image.softEdgeWidthX,
      softEdgeWidthY: (img ? F.pair(F.g(img.sub, 511)) : null)?.y ?? DEF.image.softEdgeWidthY,
      horizontalSoftRange: (img ? F.f32(F.g(img.sub, 512)) : null) ?? DEF.image.horizontalSoftRange,
      verticalSoftRange: (img ? F.f32(F.g(img.sub, 513)) : null) ?? DEF.image.verticalSoftRange,
      enableFill: img ? F.num(F.g(img.sub, 514)) === 1 : false,
      fillType: { 1: 'Horizontal', 2: 'Vertical', 3: 'Radial90', 4: 'Radial180', 5: 'Radial360' }[fillType] || 'Horizontal',
      fillHorizontalType: DEF.image.fillHorizontalType,
      fillVerticalType: DEF.image.fillVerticalType,
      fillRadial90Type: DEF.image.fillRadial90Type,
      fillRadialType: DEF.image.fillRadialType,
      fillAmount: f508 != null ? Math.max(0, Math.min(1, f508 / 100)) : (img && F.num(F.g(img.sub, 514)) === 1 ? 0 : 1),
      reverseMaskArea: img ? F.num(F.g(img.sub, 516)) === 1 : false
    });
  }
  if (k === 'button') {
    const refs = [501, 502, 503, 504].map((f) => (btn ? F.num(F.g(btn.sub, f)) : null));
    Object.assign(js, {
      interactable: btn ? F.num(F.g(btn.sub, 505)) === 1 : DEF.button.interactable,
      raycastTarget: btn ? F.num(F.g(btn.sub, 507)) === 1 : DEF.button.raycastTarget,
      clickAudioId: (btn ? F.num(F.g(btn.sub, 506)) : null) ?? DEF.button.clickAudioId,
      unavailableChildId: refs[0] ? idOf(refs[0]) : null,
      hoverChildId: refs[1] ? idOf(refs[1]) : null,
      pressedChildId: refs[2] ? idOf(refs[2]) : null,
      selectedChildId: refs[3] ? idOf(refs[3]) : null
    });
    if (refs.every((v) => !v) && node._childrenOut.length) {
      warn(node.name || node.guid, `buttonPreset 的四状态子控件引用在存档里为空（#501~#504 缺省），输出 null；参考存档里同类按钮指向具体子控件（插件预览会少状态外观）`);
    }
  }
  if (k === 'cursor') js.raycastTarget = cur ? F.num(F.g(cur.sub, 501)) === 1 : false;
  if (k === 'grid') {
    const gv = (f) => (grid ? F.pair(F.g(grid.sub, f)) : null);
    Object.assign(js, {
      cellSizeX: gv(502)?.x ?? DEF.grid.cellSizeX, cellSizeY: gv(502)?.y ?? DEF.grid.cellSizeY,
      spacingX: gv(503)?.x ?? DEF.grid.spacingX, spacingY: gv(503)?.y ?? DEF.grid.spacingY,
      padding1X: gv(504)?.x ?? DEF.grid.padding1X, padding1Y: gv(504)?.y ?? DEF.grid.padding1Y,
      padding2X: gv(505)?.x ?? DEF.grid.padding2X, padding2Y: gv(505)?.y ?? DEF.grid.padding2Y,
      previewCount: detNum('gridView', 511) ?? DEF.grid.previewCount
    });
  }
  if (k === 'reference') js.referencedPrefabId = detTxt('templateRefSlot', 0) ?? '';
  if (k === 'keyhint') Object.assign(js, { keyboardKeyCode: detNum('keyHint', 502) ?? null, controllerKeyCode: detNum('keyHint', 501) ?? null });
  if (k === 'animation' || k === 'fullscreen') js.animationId = detTxt(k === 'animation' ? 'effectSlot' : 'fullscreenEffectSlot', 0) ?? '';
  return js;
}

// id 方案：n<扁平位置+1>（插件 hr() 的 n${idOffset+f+1}）
controlOrder.forEach((n) => { n.id = 'n' + (n.idx + 1); });
// 校验 id 唯一
(() => { const s = new Set(); for (const n of controlOrder) { if (s.has(n.id)) warn(n.name || n.guid, `id 冲突 ${n.id}`); s.add(n.id); } })();
for (const n of controlOrder) n.transformOut = buildTransform(n);
const nodeJson = new Map();
for (const n of controlOrder) nodeJson.set(n.guid, buildNodeJson(n));

// ── 5. 组装：sc1 → root → …（形状/键序抄参考存档） ─────────────────────────
const childrenOf = (guid) => controlOrder.filter((n) => n.parentGuidOut === guid).map((n) => n.guid);
function buildTree(guid) {
  const node = byGuid.get(guid);
  const js = nodeJson.get(guid);
  js.children = childrenOf(guid).map((g) => nodeJson.get(g).id);
  return js;
}
function buildSubtree(guid) {
  const self = buildTree(guid);
  const kids = childrenOf(guid);
  if (kids.length) self.children = kids.map((g) => buildSubtree(g));
  else self.children = [];
  return self;
}
const sc = {
  id: 'sc1', kind: 'server-container', name: '客户端控件容器', guid: scGuid ?? 0,
  giaRelatedGuids: [], active: true, visible: true, canControllerFocus: false, syncAllDevices: true,
  giaRaw: { genericField501: 0, footerField505: 0 },
  transformByPlatform: stretchByPlatform(),
  children: scChildren.map((g) => buildSubtree(g)),
  scriptMappingIds: [],
  isolateNavigation: false, disableKeyEventPassthrough: false, disableCursorEventPassthrough: false, showCursor: false
};
const root = sc;

// 顺序：树遍历（含 sc1），用来生成 tree/boxes（与插件 Ga/Ur 同序：兄弟倒序压栈后取正序）
function walkNodes(node, depth, parentId, out) {
  const siblings = node.children || [];
  out.push({ node, depth, parentId, siblingIndex: out.filter((o) => o.parentId === parentId).length, siblingCount: siblings.length });
  for (const c of siblings) walkNodes(c, depth + 1, node.id, out);
  return out;
}
const flat = [];
walkNodes(root, 0, null, []);
// 修正 siblingIndex（上面的 filter 计数在深层会错；重算）
(() => {
  const idx = new Map();
  for (const o of flat) {
    const key = o.parentId ?? '(root)';
    const i = idx.get(key) || 0;
    o.siblingIndex = i; idx.set(key, i + 1);
  }
})();
// 插件 Ne()：锚点盒
function boxOf(node, parentBox) {
  const t = node.transformByPlatform.KEYBOARD;
  const aMin = t.anchorMin, aMax = t.anchorMax, off = t.offset, size = t.size, piv = t.pivot;
  const w = aMax.x * parentBox.width - aMin.x * parentBox.width + size.x;
  const h = aMax.y * parentBox.height - aMin.y * parentBox.height + size.y;
  const left = parentBox.left + aMin.x * parentBox.width + off.x - size.x * piv.x;
  const bottom = parentBox.bottom + aMin.y * parentBox.height + off.y - size.y * piv.y;
  return { left, bottom, width: w, height: h, right: left + w, top: bottom + h, centerX: left + w / 2, centerY: bottom + h / 2 };
}
const canvasBox = { left: 0, bottom: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, top: CANVAS_H, centerX: CANVAS_W / 2, centerY: CANVAS_H / 2 };
const subtreeParent = (pathIds) => (pathIds.length ? pathIds[pathIds.length - 1] : null);
const tree = [], boxes = [];
(function walk(node, parentBox, depth, pathIds) {
  const box = boxOf(node, parentBox);
  tree.push({
    id: node.id, guid: node.guid, kind: node.kind, name: node.name, label: KIND_LABEL[node.kind] || node.kind,
    depth, parentId: subtreeParent(pathIds), ancestorIds: pathIds.slice(),
    siblingIndex: 0, siblingCount: 0, templateId: 'sc1', childCount: (node.children || []).length,
    incomplete: false
  });
  boxes.push({
    left: r3(box.left), bottom: r3(box.bottom), width: r3(box.width), height: r3(box.height), right: r3(box.right), top: r3(box.top),
    centerX: r3(box.centerX), centerY: r3(box.centerY), posX: r3(box.centerX), posY: r3(box.centerY),
    id: node.id, kind: node.kind, name: node.name, visible: node.visible !== false, active: node.active !== false,
    rotationZ: node.transformByPlatform.KEYBOARD.rotation.z, renderLeft: r3(box.left), renderBottom: r3(box.bottom),
    renderWidth: r3(box.width), renderHeight: r3(box.height), renderRotationZ: node.transformByPlatform.KEYBOARD.rotation.z,
    renderMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, primitive: null
  });
  const ids = [...pathIds, node.id];
  for (const c of node.children || []) walk(c, box, depth + 1, ids);
})(root, canvasBox, 0, []);
// siblingIndex/siblingCount 修正
(() => {
  const groups = new Map();
  for (const r of tree) { const k = r.parentId ?? '(root)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const arr of groups.values()) arr.forEach((r, i) => { r.siblingIndex = i; r.siblingCount = arr.length; });
})();
const idByGuid = new Map(order.map((n) => [n.guid, n.id]));
const mountTargets = flat.map(({ node }) => ({ id: node.id, name: node.name, kind: node.kind, assetType: 'server-control-template', assetLabel: '服务器控件模板' }));
const selectedId = (mainRoot ? idByGuid.get(mainRoot.guid) : null) || root.id;

const out = {
  layoutSchemaVersion: 2,
  version: 1,
  meta: {
    name: path.basename(IN).replace(/\.gil$/i, ''),
    assetType: 'server-control-template',
    sourceFormat: 'gia',
    sourceFile: path.basename(IN),
    ...(gameVersion ? { gameVersion } : {}),
    giaFilePath: IN
  },
  canvasId: 'pc-16-9',
  canvas: { id: 'pc-16-9', width: CANVAS_W, height: CANVAS_H, platform: 'KEYBOARD', label: 'PC 1600×900', presets: CANVAS_PRESETS.map((p) => ({ ...p })) },
  selectedId,
  asset: { type: 'server-control-template', label: '服务端控件模板', templateCount: 1, currentTemplateId: '' },
  tree,
  boxes,
  inspector: { id: selectedId, guid: (() => { const n = flat.find((o) => o.node.id === selectedId); return n ? n.node.guid : 0; })(), kind: 'container', label: '容器节点', incomplete: false, fields: [] },
  root,
  workspace: { name: path.basename(REPO), path: REPO, bound: true },
  save: {
    format: 'qxqy-simulator-save', name: path.basename(IN).replace(/\.gil$/i, ''), activeAssetType: 'server-control-template',
    assets: {
      server: { type: 'server-control-template', name: path.basename(IN).replace(/\.gil$/i, ''), sourceFile: path.basename(IN) },
      client: { type: 'client-control-template', name: 'Lua实例化面板', sourceFile: '' },
      scripts: []
    }
  },
  scripts: [],
  mountTargets,
  serverLogic: { version: 1, rules: [] },
  migrationWarnings: [],
  controlGuidChanges: []
};

// ── 6. --check：与参考存档交叉核对 ─────────────────────────────────────────
let checkReport = null;
if (CHECK) {
  const ref = JSON.parse(fs.readFileSync(CHECK, 'utf8'));
  const refNodes = new Map(); const refBoxes = new Map(ref.boxes.map((b) => [b.id, b]));
  (function w(n, parentId) { refNodes.set(n.name, { n, parentId, box: refBoxes.get(n.id) }); for (const c of n.children || []) w(c, n.id); })(ref.root, null);
  // (a) 先用插件同样的盒算法核算参考存档自身，验证本转换器的几何实现
  let selfBad = 0;
  (function w(n, pb, depth) {
    const t = n.transformByPlatform.KEYBOARD;
    const b = boxOf({ transformByPlatform: n.transformByPlatform }, pb);
    const rb = refBoxes.get(n.id);
    if (rb && (Math.abs(rb.left - b.left) > 0.02 || Math.abs(rb.width - b.width) > 0.02)) selfBad++;
    for (const c of n.children || []) w(c, b, depth + 1);
  })(ref.root, canvasBox, 0);
  // (b) 按名称核对本次输出
  const outTreeIds = new Map(tree.map((r) => [r.id, r]));
  const outNodeById = new Map();
  (function w(n) { outNodeById.set(n.id, n); for (const c of n.children || []) w(c); })(root);
  const mine = new Map();
  for (const [id, n] of outNodeById) if (n.name) mine.set(n.name, { n, box: boxes.find((b) => b.id === id) });
  const diffs = [];
  let same = 0, moved = 0;
  for (const [name, rv] of refNodes) {
    const m = mine.get(name);
    if (!m || !rv.box || !m.box) continue;
    const dC = Math.hypot(rv.box.centerX - m.box.centerX, rv.box.centerY - m.box.centerY);
    const dS = Math.hypot(rv.box.width - m.box.width, rv.box.height - m.box.height);
    if (dC < 0.05 && dS < 0.05) same++; else { moved++; diffs.push(`${name}: 参考中心(${r2(rv.box.centerX)},${r2(rv.box.centerY)}) ${r2(rv.box.width)}×${r2(rv.box.height)} ↔ 本次中心(${r2(m.box.centerX)},${r2(m.box.centerY)}) ${r2(m.box.width)}×${r2(m.box.height)}  Δ中心=${r2(dC)} Δ尺寸=${r2(dS)}`); }
  }
  checkReport = { refPath: CHECK, refSelfMismatch: selfBad, refNodeCount: refNodes.size, comparedSame: same, comparedMoved: moved, diffs: diffs.slice(0, 30) };
}
function r2(v) { return Math.round(v * 100) / 100; }

// ── 7. 写文件 ──────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const warnPath = OUT.replace(/\.json$/, '') + '.warnings.txt';
const summary = {
  in: IN, out: OUT, geom: GEOM,
  records: gil.recs.length, controlsInOutput: controlOrder.length, scaffoldDropped: scaffold.length,
  kinds: controlOrder.reduce((m, n) => (m[n.kind] = (m[n.kind] || 0) + 1, m), {}),
  designNodes: geomNote.filter((x) => x.includes('口径 D')).length,
  canvasAbsoluteNodes: geomNote.filter((x) => x.includes('口径 A')).length,
  nanPairsTreatedAsMissing: F.nanCount,
  anchorFallbacks: anchorFallback.length,
  warnings: warnings.length,
  sha256: (() => { const h = crypto.createHash('sha256'); h.update(fs.readFileSync(IN)); return h.digest('hex').toUpperCase(); })(),
  outBytes: fs.statSync(OUT).size,
  outSha256: (() => { const h = crypto.createHash('sha256'); h.update(fs.readFileSync(OUT)); return h.digest('hex').toUpperCase(); })()
};
fs.writeFileSync(OUT.replace(/\.json$/, '') + '.summary.json', JSON.stringify({ summary, check: checkReport, geomNotes: geomNote }, null, 1));
fs.writeFileSync(warnPath, [
  `# ${path.basename(OUT)} 转换 WARN 列表（${warnings.length} 条，上限 ${WARN_LIMIT}）`,
  `# 输入 ${IN}`,
  `# 口径 ${GEOM}`,
  '',
  '## 口径判定为 design（存档写的是 1920×1080 设计空间原值）的记录',
  ...geomNote,
  '',
  '## 其余 WARN / 回退',
  ...warnings
].join('\n'));
console.log(JSON.stringify(summary, null, 1));
console.log('WARN ' + warnings.length + ' 条 → ' + warnPath);
console.log('design 口径 ' + geomNote.length + ' 条：');
geomNote.slice(0, 12).forEach((s) => console.log('  ' + s));
if (checkReport) console.log('CHECK ' + JSON.stringify({ ...checkReport, diffs: checkReport.diffs.slice(0, 10) }, null, 1));
