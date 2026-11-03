// tools/gen_save.mjs —— 生成完整模拟器存档（qxqy-simulator-save）
//
// 做法：以 records/proto-project.json（当前会话 get 出来的**真实**工程快照）为模板，
//       深拷贝四种控件原型（容器/文本框/预设按钮/图片），再覆盖名字、几何、业务字段。
//       这样每个节点都带齐四平台槽位与 giaRaw 默认值，不会因「手工拼节点缺槽位」被拒。
//
// 产出：workspace/qxqy-ui-system/qxqy-ui-system.save.json
// 用法：node tools/gen_save.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PROTO = path.join(ROOT, 'records', 'proto-project.json');
const LUA = path.join(ROOT, 'lua', 'main.lua');
const OUT = path.join(ROOT, 'qxqy-ui-system.save.json');

const proto = JSON.parse(fs.readFileSync(PROTO, 'utf8'));
const luaSource = fs.readFileSync(LUA, 'utf8');

// ── 原型：从快照里按 id 取，深拷贝后改 ──────────────────────────────────────
function findById(node, id) {
  if (node.id === id) return node;
  for (const c of node.children || []) {
    const hit = findById(c, id);
    if (hit) return hit;
  }
  return null;
}
const PROTOS = {
  container: findById(proto.root, 'n1'),
  textbox: findById(proto.root, 'n2'),
  button: findById(proto.root, 'n6'),
  image: findById(proto.root, 'n9'),
};
for (const [k, v] of Object.entries(PROTOS)) {
  if (!v) throw new Error(`原型缺失：${k}`);
}

const clone = (o) => JSON.parse(JSON.stringify(o));

// ── 几何：四平台同步写入（同一套锚点，各平台画布尺寸不同但锚点相对解析） ──
const PLATFORMS = ['KEYBOARD', 'TOUCHSCREEN', 'CONTROLLER_CONSOLE', 'CONTROLLER_MOBILE'];
function tf({ ax = 0.5, ay = 0.5, bx = ax, by = ay, ox = 0, oy = 0, w = 0, h = 0, pivotX = 0.5, pivotY = 0.5 }) {
  const slot = {
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    anchorMin: { x: ax, y: ay },
    anchorMax: { x: bx, y: by },
    offset: { x: ox, y: oy },
    size: { x: w, y: h },
    pivot: { x: pivotX, y: pivotY },
  };
  const out = {};
  for (const p of PLATFORMS) out[p] = clone(slot);
  return out;
}
const STRETCH = tf({ ax: 0, ay: 0, bx: 1, by: 1 });      // 铺满父级
const stretchIn = (l, b, r, t) => tf({ ax: l, ay: b, bx: r, by: t }); // 相对父级的比例框

const WHITE = 0xffffffff >>> 0;
const argb = (a, r, g, b) => (((a << 24) | (r << 16) | (g << 8) | b) >>> 0) >>> 0;

// ── 生成器 ─────────────────────────────────────────────────────────────────
let guidSeq = 1073741851; // 从默认工程第一个控件之后开始分配
const usedIds = new Set();
let idSeq = 0;
function nextId(prefix) {
  for (;;) {
    idSeq += 1;
    const id = `${prefix}${idSeq}`;
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
}

function make(kind, { name, transform, active = true, visible = true, children = [], extra = {} }) {
  const node = clone(PROTOS[kind]);
  node.id = nextId('n');
  node.guid = guidSeq++;
  node.name = name;
  node.active = active;
  node.visible = visible;
  node.transformByPlatform = transform;
  node.canControllerFocus = false;
  node.syncAllDevices = true;
  node.scriptMappingIds = [];
  node.children = children;
  Object.assign(node, extra);
  return node;
}

const container = (name, transform, children = [], extra = {}) => make('container', { name, transform, children, extra });

const text = (name, transform, s, { size = 20, align = 'Middle', valign = 'Middle', color = WHITE, outline = 0x55000000, active = true, visible = true } = {}) =>
  make('textbox', {
    name,
    transform,
    active,
    visible,
    extra: { text: s, fontSize: size, minimumFontSize: Math.max(8, Math.round(size * 0.6)), adaptiveFontSize: false, fontColor: color, enableOutline: true, outlineColor: outline >>> 0, horizontalAlignment: align, verticalAlignment: valign, bgColor: 0x00000000 },
  });

const image = (name, transform, imageId, color = WHITE) =>
  make('image', { name, transform, extra: { imageSource: 'StaticReference', imageId, imageColor: color >>> 0 } });

const button = (name, transform, children = []) =>
  make('button', { name, transform, children, extra: { raycastTarget: true, interactable: true, clickAudioId: 50888 } });

// ── 一棵演示界面：3 页 + 3 页签 + 翻页/重置/关闭 ────────────────────────────
// 布局只用锚点/比例，内容文案是占位（详细设计留白）
const TAB_Y = 250;
const tabX = (i) => -170 + (i - 1) * 170;

function makeTab(pageId, label, i) {
  const sel = image('state.sel', tf({ ax: 0.5, ay: 0.5, ox: 0, oy: -48, w: 22, h: 22 }), 100005, argb(0xff, 0xff, 0xd0, 0x50));
  const off = image('state.off', tf({ ax: 0.5, ay: 0.5, ox: 0, oy: -48, w: 22, h: 22 }), 100006, argb(0xaa, 0x9a, 0xa8, 0xbf));
  const label_ = text('text', tf({ ax: 0, ay: 0, bx: 1, by: 1 }), label, { size: 22, align: 'Middle', valign: 'Middle' });
  const plate = image('plate', tf({ ax: 0, ay: 0, bx: 1, by: 1 }), 100001, argb(0xdd, 0x2e, 0x3d, 0x52));
  // 同级顺序：先出现者在上 ⇒ 文字/S 标记在底板之上
  return button(`tab.${pageId}`, tf({ ax: 0.5, ay: 0.5, ox: tabX(i), oy: TAB_Y, w: 120, h: 56 }), [label_, sel, off, plate]);
}

function makeActionButton(name, label, ox, oy, w = 120, h = 60) {
  const label_ = text('text', tf({ ax: 0, ay: 0, bx: 1, by: 1 }), label, { size: 24, align: 'Middle', valign: 'Middle' });
  const plate = image('plate', tf({ ax: 0, ay: 0, bx: 1, by: 1 }), 100001, argb(0xdd, 0x35, 0x46, 0x5e));
  return button(name, tf({ ax: 0.5, ay: 0.5, ox, oy, w, h }), [label_, plate]);
}

function makePage(id, index, tint) {
  const label = text('label', tf({ ax: 0.5, ay: 0.5, ox: 0, oy: 0, w: 620, h: 80 }), `第 ${index} 页 · 内容留白`, { size: 30, align: 'Middle', valign: 'Middle' });
  const bg = image('bg', stretchIn(0, 0, 1, 1), 100001, tint);
  return container(`page.${id}`, stretchIn(0.08, 0.14, 0.92, 0.84), [label, bg], { active: true, visible: index === 1 });
}

const pages = [
  makePage('p1', 1, argb(0x8c, 0x1e, 0x2a, 0x3a)),
  makePage('p2', 2, argb(0x8c, 0x2a, 0x1e, 0x2a)),
  makePage('p3', 3, argb(0x8c, 0x1e, 0x2a, 0x1e)),
];

const screenDemo = container('screen.demo', STRETCH, [
  // ① 交互层在前（同级先出现者在上，见插件 AGENTS「层序」）
  makeActionButton('btn.close', '×', 560, 300, 80, 56),
  text('hud.title', tf({ ax: 0.5, ay: 0.5, ox: 0, oy: 310, w: 820, h: 56 }), '教程 UI 系统 · 翻页单击活动（架构骨架）', { size: 28 }),
  text('hud.pager', tf({ ax: 0.5, ay: 0.5, ox: 0, oy: -300, w: 220, h: 44 }), '1 / 3', { size: 22 }),
  makeTab('p1', '1', 1),
  makeTab('p2', '2', 2),
  makeTab('p3', '3', 3),
  makeActionButton('btn.prev', '‹', -470, -250, 110, 64),
  makeActionButton('btn.next', '›', 470, -250, 110, 64),
  makeActionButton('btn.reset', '重置', 0, -250, 150, 60),
  // ② 内容页在后（被交互层覆盖，避免底板挡住按钮）
  ...pages,
], { showCursor: true });

const appRoot = container('app.root', STRETCH, [screenDemo], { showCursor: true });

const root = {
  id: 'sc1',
  kind: 'server-container',
  name: '客户端控件容器',
  guid: 1073741850,
  giaRelatedGuids: [],
  active: true,
  visible: true,
  canControllerFocus: false,
  syncAllDevices: true,
  giaRaw: { genericField501: 0, footerField505: 0 },
  transformByPlatform: STRETCH,
  children: [appRoot],
  scriptMappingIds: [],
  isolateNavigation: false,
  disableKeyEventPassthrough: false,
  disableCursorEventPassthrough: false,
  showCursor: false,
};

// ── 派生：tree[] / boxes[] / mountTargets ──────────────────────────────────
const CANVAS = { width: 1600, height: 900 }; // 工程画布 pc-16-9（试玩可切到手机画布验证锚点）
function boxOf(node, parentBox) {
  const t = node.transformByPlatform.KEYBOARD;
  const { anchorMin, anchorMax, offset, size, pivot } = t;
  const w = anchorMax.x * parentBox.width - anchorMin.x * parentBox.width + size.x;
  const h = anchorMax.y * parentBox.height - anchorMin.y * parentBox.height + size.y;
  const left = parentBox.left + anchorMin.x * parentBox.width + offset.x - size.x * pivot.x;
  const bottom = parentBox.bottom + anchorMin.y * parentBox.height + offset.y - size.y * pivot.y;
  return { left, bottom, width: w, height: h, right: left + w, top: bottom + h, centerX: left + w / 2, centerY: bottom + h / 2 };
}
const KIND_LABEL = { 'server-container': '客户端控件容器', container: '容器节点', textbox: '文本框', button: '预设按钮', image: '图片', textwindow: '文本视窗', cursor: '光标检测区域', grid: '网格视窗', keyhint: '按键提示', animation: '界面动效', fullscreen: '全屏动效', reference: '模板引用控件' };
const r3 = (v) => Math.round(v * 1000) / 1000;

const tree = [];
const boxes = [];
const flat = [];
(function walk(node, parentBox, depth, ancestorIds, parentId) {
  const box = boxOf(node, parentBox);
  tree.push({
    id: node.id,
    guid: node.guid,
    kind: node.kind,
    name: node.name,
    label: KIND_LABEL[node.kind] || node.kind,
    depth,
    parentId,
    ancestorIds,
    siblingIndex: 0,
    siblingCount: (node.children || []).length,
    templateId: 'sc1',
    childCount: (node.children || []).length,
    incomplete: false,
  });
  const b = {
    left: r3(box.left), bottom: r3(box.bottom), width: r3(box.width), height: r3(box.height),
    right: r3(box.right), top: r3(box.top), centerX: r3(box.centerX), centerY: r3(box.centerY),
    posX: r3(box.centerX), posY: r3(box.centerY),
    id: node.id, kind: node.kind, name: node.name,
    visible: node.visible !== false, active: node.active !== false,
    rotationZ: 0, renderLeft: r3(box.left), renderBottom: r3(box.bottom),
    renderWidth: r3(box.width), renderHeight: r3(box.height), renderRotationZ: 0,
    renderMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    primitive: node.kind === 'image' ? ({ 100001: 'rect', 100005: 'fivestar', 100006: 'ring' }[node.imageId] || null) : null,
  };
  if (node.kind === 'image') Object.assign(b, { imageSource: node.imageSource, imageId: node.imageId, imageColor: node.imageColor, enableMask: false, enableSoftEdge: false, softEdgeMode: 'Percentage', softEdgeWidthX: 8, softEdgeWidthY: 8, horizontalSoftRange: 85, verticalSoftRange: 85, enableFill: false, fillType: 'Horizontal', fillHorizontalType: 'Left', fillVerticalType: 'Bottom', fillRadial90Type: 'BottomLeft', fillRadialType: 'Bottom', fillAmount: 1, reverseMaskArea: false });
  if (node.kind === 'textbox' || node.kind === 'textwindow') Object.assign(b, { text: node.text, fontSize: node.fontSize, fontColor: node.fontColor, bgColor: node.bgColor, enableOutline: node.enableOutline, outlineColor: node.outlineColor, horizontalAlignment: node.horizontalAlignment, verticalAlignment: node.verticalAlignment });
  if (node.kind === 'button') Object.assign(b, { raycastTarget: node.raycastTarget, interactable: node.interactable, clickAudioId: node.clickAudioId, unavailableChildId: null, hoverChildId: null, pressedChildId: null, selectedChildId: null });
  boxes.push(b);
  flat.push({ node, name: node.name, kind: node.kind });
  const ids = [...ancestorIds, node.id];
  (node.children || []).forEach((c, i) => {
    walk(c, box, depth + 1, ids, node.id);
  });
  // siblingIndex 修正见下
})(root, { left: 0, bottom: 0, width: CANVAS.width, height: CANVAS.height }, 0, [], null);
(function fixSiblings() {
  const groups = new Map();
  for (const t of tree) {
    const k = t.parentId ?? '(root)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  for (const arr of groups.values()) arr.forEach((t, i) => { t.siblingIndex = i; t.siblingCount = arr.length; });
})();

// ── 脚本与服务器逻辑 ───────────────────────────────────────────────────────
// 脚本 id 必须与工程里其它脚本映射 id 不冲突：`load` 是**合并**脚本注册表，
// 与既有条目的 id 相同会互相覆盖（实测：沿用旧 id 时探针脚本会挂到新工程的同名
// 内部 id 上继续运行）。所以这里用一个固定的、独立的 id，并在 docs 里写明。
const SCRIPT_ID = '1073742200';
const scripts = [{
  id: SCRIPT_ID,
  guid: Number(SCRIPT_ID),
  path: 'workspace/qxqy-ui-system/lua/main.lua',
  // 内联 source 故意留空：运行时会去读 `path` 指向的磁盘文件（lua/main.lua）。
  // [实测] 这样「改源码 → 重开试玩」就能生效，不用每次都把 40KB 源码塞进存档；
  //        代价是要保证 lua/main.lua 一定是最新构建产物（node tools/build_bundle.mjs）。
  source: '',
  controlId: 'sc1',
  controlAsset: 'server-control-template',
  controlName: '容器节点',
  assetType: 'server-control-template',
  assetLabel: '服务器控件模板',
  mounted: true,
}];
// 注：controlId 在生成后会被改写成 app.root 的内部 id（脚本挂到整屏根容器上）

const serverLogic = {
  version: 1,
  rules: [
    {
      id: 'ui-nav-record',
      signalName: 'ui/nav',
      actions: [
        { kind: 'setCustomVariable', entityType: 'Level', name: 'UiLastPage', value: { fromSignalParam: 1 } },
        { kind: 'setCustomVariable', entityType: 'Level', name: 'UiLastIndex', value: { fromSignalParam: 2 } },
        { kind: 'sendClientScriptSignal', target: 'PlayerSelf', signalName: 'ui/sync', params: [{ fromSignalParam: 1 }] },
      ],
    },
  ],
};

const save = {
  layoutSchemaVersion: 2,
  version: 1,
  meta: {
    name: 'qxqy-ui-system',
    assetType: 'server-control-template',
    sourceFormat: 'authoring',
    sourceFile: '',
  },
  canvasId: 'pc-16-9',
  canvas: clone(proto.canvas),
  selectedId: 'sc1',
  asset: { type: 'server-control-template', label: '服务端控件模板', templateCount: 1, currentTemplateId: '' },
  tree,
  boxes,
  inspector: { id: 'sc1', guid: 1073741850, kind: 'container', label: '容器节点', incomplete: false, fields: [] },
  root,
  workspace: { name: path.basename(path.dirname(path.dirname(ROOT))), path: path.dirname(path.dirname(ROOT)), bound: true },
  save: {
    format: 'qxqy-simulator-save',
    name: 'qxqy-ui-system',
    activeAssetType: 'server-control-template',
    assets: {
      server: { type: 'server-control-template', name: 'qxqy-ui-system', sourceFile: '' },
      client: clone(proto.save.assets.client),
      scripts,
    },
  },
  scripts,
  mountTargets: flat
    .filter((f) => f.kind !== 'server-container')
    .map((f) => ({ id: f.node.id, name: f.name, kind: f.kind, assetType: 'server-control-template', assetLabel: '服务器控件模板' })),
  serverLogic,
  migrationWarnings: [],
  controlGuidChanges: [],
  scriptSync: null,
  storage: { path: '' },
};

// 脚本挂到 app.root（整屏根容器）
const appRootId = appRoot.id;
for (const s of scripts) {
  s.controlId = appRootId;
  s.controlName = appRoot.name;
}
appRoot.scriptMappingIds = [Number(SCRIPT_ID)];

fs.writeFileSync(OUT, JSON.stringify(save, null, 1));

const count = (n) => 1 + (n.children || []).reduce((a, c) => a + count(c), 0);
console.log(JSON.stringify({
  out: path.relative(ROOT, OUT),
  bytes: fs.statSync(OUT).size,
  nodes: count(root),
  scripts: scripts.length,
  scriptOn: `${appRoot.name}#${appRoot.id}`,
  luaBytes: luaSource.length,
  serverRules: serverLogic.rules.length,
  topLevel: root.children.map((c) => c.name),
  pages: pages.map((p) => p.name),
  firstIds: flat.slice(0, 6).map((f) => `${f.name}=${f.node.id}`),
}, null, 1));
