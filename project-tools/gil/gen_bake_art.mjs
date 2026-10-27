// tools/gil/gen_bake_art.mjs —— 把「图元家具」静态烘进存档：`fart.case_001` / `fart.case_002`
//                             两个容器 + 每个图元一条静态图片控件（不走运行时实例化）
//
// ════════════════════════════════════════════════════════════════════════════
// 背景（2026-10-22 第八轮；用户判断：外部网站导出的内容能实机显示，是因为它把图元写成存档静态控件）
// ════════════════════════════════════════════════════════════════════════════
//   ⇒ 家具图元（椅子/植物/雕像）改成 **静态烘焙**：官方基础形状 100001 矩形 / 100002 椭圆 /
//     100003 三角 就是"和图元等价的素材"，一条图元 = 一个静态图片控件，脚本只切容器显隐，
//     彻底绕开 `InstantiateClientUIControl` 那层。
//   桌子/书架/地毯仍走模板手搭层（【不要动】）；`content/furn` 与 `tpl.prim` 保留作回退（不删）。
//
//   数据：`_work/art-work/bake-static-furn.json`（lead 侧生成）
//     { "canvas":[1600,900], "maxPerPiece":36, "total":455,
//       "perLevel": { "case_001": {rows,cols,controls:[{id,color,x,y,w,h,rot,cell}]}, "case_002": … } }
//     · id ∈ {100001,100002,100003}；color = 0xAARRGGBB；rot = 度
//     · x,y = **画布像素中心（1600×900，左上原点、Y 向下）** —— 由 `board-art.json`（预览渲染口径）直接带过来
//   本工具做：两份容器 `fart.case_001` / `fart.case_002`（root 下、labels 之后 home 之前，
//   1600×900 @(0,0)、锚点/中心 0.5、**visible=false**、无遮罩）+ 455 条静态图片控件
//   （`fart.<level>.<i>`，i 从 1 连续；imageId/imageColor 照数据；imageType=Stretch；
//     w×h 像素尺寸；中心 = 画布坐标换算；**visible 由 `--child-visible` 定**
//     （默认 true = v4/v5；v6 起传 false：真机确认"父容器隐藏不级联"⇒ 子控件默认全关，脚本逐个打开）；旋转写状态块 `#508`）。
//
// ── 坐标换算（本轮最关键的一步，已在回执里写清）────────────────────────────────
//   数据 x,y 是「画布 1600×900、左上原点、Y 向下」的**中心点**（与 `_work/art-preview/render_board.py`
//   的画布像素口径一致：棋盘外框 (608,138)–(1192,722)）。
//   存档记录里的位置是「相对父级中心、Y 向上」：
//     record.x = x - 800                     （画布中心 x = 800）
//     record.y = 450 - y                     （Y 翻转：画布中心 y = 450）
//   ★ 为什么父级中心当 (800,450)：两个 `fart` 容器是 root 的直接子控件，摆在 (0,0)；
//     root / 棋盘（stage→board）同吃 root 的 +9.6 偏移 ⇒ 两边相对量一致，静态控件与棋盘对齐。
//   旋转：`#508`（状态块里的 rotation vec3，字段 1/2/3 = x/y/z，float 度；`gen_tutorial_teach.mjs`
//     的 `applyRotation` 真机路径）；本轮把数据 `rot` 写进 `#3`，0 不写（稀疏编码）。
//
// ── 写法约束（沿用前几轮）────────────────────────────────────────────────
//   ★ 新记录 append 到 `g.recHolder` 末尾（E10：字段 diff 按位置比，插中间会制造假差异）。
//   ★ 克隆整条 remap 自身 GUID（E1：7 处）。容器/子控件的名字、父指针、子列表三处都要写。
//   ★ GUID 从 **1073746400** 起（扫全档已用集合后分配；502 已用到 1073746303）。
//   ★ 分两段写 `writeGil`：① 只加 2 个容器（差异 = 1 记录数组 + 1 root 子列表）；
//     ② 只加 455 个子控件（差异 = 1 记录数组 + 2 容器子列表）。最终 `diff_fields 502→507` = 4 处。
//   ★ 控件预算：500 + 2 + 455 = **957 < 1000** ✓（lead 的上限）。
//
// ── 用法 ───────────────────────────────────────────────────────────────────
//   node tools/gil/gen_bake_art.mjs --in=502-一二关美术-容器-v3.gil \
//        --out=507-一二关美术-容器-v4.gil [--dry] [--data=<bake-static-furn.json>]
//   --guid-base=1073746400
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
import { writeGil, loadTree, diffTrees } from './gilwrite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');             // 仓库根 qianxing-murdoku
const WORKSPACE = path.resolve(ROOT, '..');              // 工作区根（_work 在这）
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

const argv = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = argv.find((s) => s.startsWith('--' + k + '='));
  return hit ? hit.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const hasFlag = (k) => argv.includes('--' + k);

const IN = argOf('in');
const OUT = argOf('out');
const DATA = argOf('data', path.join(WORKSPACE, '_work', 'art-work', 'bake-static-furn.json'));
const DRY = hasFlag('dry');
const GUID_BASE = Number(argOf('guid-base', '1073746400'));
// 容器位置口径：zero = #504 相对父中心 (0,0)（= 画布中心，与存量 settle.btn/select.prev/stage 同口径）；center = 字面 (800,450)
const CONTAINER_POS = argOf('container-pos', 'zero');
// 旋转符号：数据 rot 与引擎 `#508/#3` 的 z 度同号（拟合工具口径：逆时针为正）。真机若方向相反，`--rot-sign=-1` 一键翻转。
const ROT_SIGN = Number(argOf('rot-sign', '1')) === -1 ? -1 : 1;
// 子控件默认可见性：true（v4/v5 口径）| false（v6：真机确认"父容器隐藏不级联" ⇒ 默认全关，脚本逐个子控件打开）。
// 默认 true 以保持 507/509 可复现；v6 出包时传 --child-visible=false。
const CHILD_VISIBLE = String(argOf('child-visible', 'true')).toLowerCase() !== 'false';

const ID_LO_NUM = Number(ID_LO), ID_HI_NUM = Number(ID_HI);
const CANVAS_W = 1600, CANVAS_H = 900;
const FART_PREFIX = 'fart.';
const PROTECTED = { contentFurn: 'furn', tplPrim: 'tpl.prim' };   // 旧路径留作回退，必须还在
const IMG_TYPE_STRETCH = 1;
const KINDS = new Set([100001, 100002, 100003]);

const fatal = (msg, code = 3) => { console.error('\n❌ ' + msg); process.exit(code); };
const hex32 = (v) => '0x' + (Number(v) >>> 0).toString(16).toUpperCase().padStart(8, '0');
const basenameOf = (p) => path.basename(p);

// ════════════════════════════════════════════════════════════════════════════
// 字段级 helper
// ════════════════════════════════════════════════════════════════════════════
function topVarint(fields, no) {
  const f = (fields || []).find((x) => x.field === no);
  return f && f.wt === 0 ? f : null;
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
  if (nodes.length !== 1) throw new Error('图片节点 `/505/503/84` 命中 ' + nodes.length + ' 个（预期 1）');
  const n = nodes[0];
  const leaf = (no) => n.sub.find((f) => f.field === no && f.wt === 0) || null;
  return {
    node: n,
    id: leaf(503) ? Number(leaf(503).num) : null,
    color: leaf(502) ? Number(leaf(502).num) : null,
    type: leaf(504) ? Number(leaf(504).num) : null,
  };
}
function setImgLeaf(node, no, value) {
  let f = node.sub.find((x) => x.field === no && x.wt === 0);
  if (!f) { f = { field: no, wt: 0, num: 0n }; node.sub.push(f); }
  f.num = BigInt(value >>> 0);
}
function imageMaskLeaves(recField) {
  const out = [];
  for (const n of imageNodes(recField)) for (const f of n.sub) if (f.wt === 0 && [508, 509, 510, 511, 512, 513, 514, 515, 516].includes(f.field)) out.push('#' + f.field + '=' + f.num);
  return out;
}
function stateSummary(recField) {
  return stateBlocks(recField.sub, []).map((b) => {
    const pos = pairOf(b, 504), size = pairOf(b, 505);
    return {
      block: b, pos, size,
      x: pairValue(pos, 0), y: pairValue(pos, 1),
      w: pairValue(size, 0), h: pairValue(size, 1),
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
    p17.payload = encodeMsg(p17.sub);
    p17.len = p17.payload.length;
    p17.isText = false;
    found = true;
  }
  if (!found) fatal('找不到 #505(4/86) 可见性块');
}
/** 写旋转：每个状态块 `#508` = vec3(#1/#2/#3 float 度)，只写 z；0 ⇒ 空（稀疏） */
function applyRotation(recField, degZ) {
  const bl = stateBlocks(recField.sub, []);
  if (!bl.length) fatal('没有状态块，没法写旋转');
  for (const b of bl) {
    let f = b.sub.find((x) => x.field === 508);
    if (!f) { f = { field: 508, wt: 2, sub: [], len: 0, payload: null, isText: false }; b.sub.push(f); }
    f.sub = degZ ? [{ field: 3, wt: 5, f: degZ }] : [];
    f.len = degZ ? 5 : 0;
    f.payload = null;
  }
  return bl.length;
}
function readRotZ(recField) {
  const bl = stateBlocks(recField.sub, []);
  return bl.map((b) => {
    const f = b.sub.find((x) => x.field === 508);
    if (!f || !f.sub) return 0;
    const z = f.sub.find((x) => x.field === 3 && x.wt === 5);
    return z ? Math.round(z.f * 1000) / 1000 : 0;
  });
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

// ════════════════════════════════════════════════════════════════════════════
// 数据读取 + 校验
// ════════════════════════════════════════════════════════════════════════════
function loadBakeData() {
  const file = path.isAbsolute(DATA) ? DATA : path.resolve(WORKSPACE, DATA);
  if (!fs.existsSync(file)) fatal('找不到烘焙数据：' + file + '（用 --data= 指定）', 1);
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { fatal('烘焙 JSON 解析失败：' + e.message, 1); }
  if (!doc.perLevel || typeof doc.perLevel !== 'object') fatal('烘焙数据缺 perLevel', 2);
  const levels = [];
  let total = 0;
  for (const name of Object.keys(doc.perLevel)) {
    const lv = doc.perLevel[name];
    if (!Array.isArray(lv.controls)) fatal(name + ' 缺 controls 数组', 2);
    for (const c of lv.controls) {
      const id = Number(c.id);
      if (!KINDS.has(id)) fatal(name + ' 有非法图元 id=' + c.id + '（只允许 100001/100002/100003）', 2);
      const color = typeof c.color === 'string' ? Number(BigInt(c.color) & 0xFFFFFFFFn) : Number(c.color) >>> 0;
      const x = Number(c.x), y = Number(c.y), w = Number(c.w), h = Number(c.h), rot = Number(c.rot || 0);
      for (const [k, v] of Object.entries({ x, y, w, h, rot })) if (!Number.isFinite(v)) fatal(name + ' 控件字段 ' + k + ' 非有限数：' + JSON.stringify(c), 2);
      if (w <= 0 || h <= 0) fatal(name + ' 控件尺寸非正：w=' + w + ' h=' + h, 2);
    }
    total += lv.controls.length;
    levels.push({ name, rows: lv.rows, cols: lv.cols, controls: lv.controls });
  }
  if (doc.total != null && Number(doc.total) !== total) fatal('数据自述 total=' + doc.total + '，实际统计 ' + total + ' 条（不一致）', 2);
  console.log('  · 数据 ' + basenameOf(file) + '：' + levels.map((l) => l.name + '=' + l.controls.length).join(' / ')
    + '，合计 ' + total + ' 条图元控件');
  return { levels, total };
}

// ════════════════════════════════════════════════════════════════════════════
// 段①：两个 `fart.case_00X` 容器（root 下、labels 之后 home 之前）
// ════════════════════════════════════════════════════════════════════════════
function buildContainers(g, alloc, data) {
  const re = { added: [], skipped: [], rootChanged: false, containerIds: [], containerFields: [], targets: [] };
  const root = g.recs.find((r) => r.name === 'root');
  const labels = g.recs.find((r) => r.name === 'labels');
  const home = g.recs.find((r) => r.name === 'home');
  if (!root) fatal('找不到 root', 2);
  if (!labels) fatal('找不到 labels（容器要插在它之后）', 2);
  if (!home) fatal('找不到 home（容器要插在它之前）', 2);
  const rootCl = findChildListTop(root.field.sub);
  if (!rootCl) fatal('root 没有子控件列表', 2);
  const cur = (asIdList(rootCl.payload, true) || []).map(Number);

  for (const lv of data.levels) {
    const name = FART_PREFIX + lv.name;
    const exists = g.recs.find((r) => r.name === name);
    let cid;
    if (exists) {
      cid = exists.id;
      re.skipped.push(name + '#' + cid);
      re.containerFields.push(exists.field);
    } else {
      const clone = cloneField(labels.field);                 // labels = 普通容器（root 子、组件 68/91）
      cid = alloc.take();
      const selfCnt = countVarintEqual(labels.field.sub, labels.id);
      const n = remapSelfIds(clone.sub, labels.id, cid);
      if (n !== selfCnt) fatal(name + ' 克隆：自身 GUID 替换 ' + n + '/' + selfCnt + ' 处');
      const rn = renameRecord(clone.sub, 'labels', name);
      if (!rn.ok) fatal(name + ' 克隆：改名命中 ' + rn.hits + ' 处');
      const p504 = topVarint(clone.sub, 504);
      if (!p504) fatal(name + ' 克隆：顶层没有 #504');
      p504.num = BigInt(root.id);
      const st = stateSummary(clone);
      if (st.length !== 4) fatal(name + ' 状态块 ' + st.length + ' 个（预期 4）');
      for (const s of st) {
        // 记录里的 #504 = 相对父级中心；root 子控件要居中 ⇒ (0,0)。
        setPair(s.pos, CONTAINER_POS === 'center' ? CANVAS_W / 2 : 0, CONTAINER_POS === 'center' ? CANVAS_H / 2 : 0);
        setPair(s.size, CANVAS_W, CANVAS_H);
        if (s.aMinX !== 0.5 || s.aMinY !== 0.5 || s.aMaxX !== 0.5 || s.aMaxY !== 0.5 || s.pivX !== 0.5 || s.pivY !== 0.5) {
          fatal(name + ' 锚点/中心不是 0.5/0.5');
        }
      }
      const ccl = findChildListTop(clone.sub);
      if (ccl) setChildList(ccl, []);                          // 清掉 labels 的 7 个 label 子控件
      if (imageNodes(clone).length) fatal(name + ' 不应有图片槽（容器）');
      if (imageMaskLeaves(clone).length) fatal(name + ' 不应带遮罩/羽化字段');
      setHiddenRec(clone, true);                               // 容器初始 visible=false
      g.recHolder.push(clone);
      re.containerFields.push(clone);
      re.added.push({ name, id: cid, parent: root.id });
    }
    re.containerIds.push(cid);
    re.targets.push({ level: lv.name, name, id: cid });
  }

  // root 子列表：labels 之后插入 case_001、case_002（保持相对顺序）
  const kept = cur.filter((id) => !re.containerIds.includes(id));
  const li = kept.indexOf(Number(labels.id));
  const hi = kept.indexOf(Number(home.id));
  if (li < 0 || hi < 0 || hi !== li + 1) fatal('root 子列表里 labels 之后不是 home（labels@' + li + ' home@' + hi + '）', 2);
  const next = [...kept.slice(0, li + 1), ...re.containerIds, ...kept.slice(li + 1)];
  if (next.join(',') !== cur.join(',')) {
    setChildList(rootCl, next);
    re.rootChanged = true;
  }
  re.expectedRecs = g.recs.length + re.added.length;
  re.expectedDiffs = (re.added.length ? 1 : 0) + (re.rootChanged ? 1 : 0);
  return re;
}

function assertContainers(g2, re) {
  const bad = [];
  const nameOf = (id) => (g2.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id;
  const root = g2.recs.find((r) => r.name === 'root');
  const rootCl = root ? findChildListTop(root.field.sub) : null;
  const ids = rootCl ? (asIdList(rootCl.payload, true) || []).map(Number) : [];
  const names = ids.map(nameOf);
  const li = names.indexOf('labels');
  const hi = names.indexOf('home');
  if (li < 0) bad.push('root 里找不到 labels');
  if (hi < 0) bad.push('root 里找不到 home');
  for (let i = 0; i < re.targets.length; i++) {
    const t = re.targets[i];
    const expect = li + 1 + i;
    if (names[expect] !== t.name) bad.push('root[' + expect + '] = ' + names[expect] + '（预期 ' + t.name + '）');
    const r = g2.recs.find((x) => x.id === Number(t.id));
    if (!r) { bad.push('重读后缺 ' + t.name + '#' + t.id); continue; }
    if (Number(r.parentId) !== Number(root.id)) bad.push(t.name + ' 父=' + r.parentId + '（预期 root）');
    const st = stateSummary(r.field);
    if (st.length !== 4) bad.push(t.name + ' 状态块 ' + st.length);
    for (const s of st) {
      if (s.w !== CANVAS_W || s.h !== CANVAS_H) bad.push(t.name + ' 尺寸 ' + s.w + 'x' + s.h + '（预期 1600x900）');
      if (s.aMinX !== 0.5 || s.aMaxX !== 0.5 || s.pivX !== 0.5) bad.push(t.name + ' 锚点/中心不是 0.5');
      const wantX = CONTAINER_POS === 'center' ? CANVAS_W / 2 : 0;
      const wantY = CONTAINER_POS === 'center' ? CANVAS_H / 2 : 0;
      if (Math.abs(s.x - wantX) > 0.02 || Math.abs(s.y - wantY) > 0.02) bad.push(t.name + ' 位置 (' + s.x + ',' + s.y + ')（预期 ' + wantX + ',' + wantY + '）');
    }
    if (imageNodes(r.field).length) bad.push(t.name + ' 不应有图片槽');
    if (imageMaskLeaves(r.field).length) bad.push(t.name + ' 带遮罩/羽化字段');
    if (!isHiddenRec(r.field)) bad.push(t.name + ' 可见性应为 false（隐藏）');
  }
  if (g2.recs.length !== re.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re.expectedRecs + '）');
  const tops = g2.recs.map((r) => r.id);
  if (new Set(tops).size !== tops.length) bad.push('顶层 #501 有重复');
  if (bad.length) return '✗ 容器断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 容器断言：root 顺序 labels → fart.case_001 → fart.case_002 → home；两容器 1600×900/锚点0.5/visible=false/无图片槽/无遮罩');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 段②：455 条静态图片控件
// ════════════════════════════════════════════════════════════════════════════
function buildControls(g, alloc, data, containerIds, containerFields) {
  const re = { added: [], skipped: [], childListChanges: [], levelInfo: [] };
  const imgProto = g.recs.find((r) => r.name === 'obj.table' && Number(r.parentId) != null)
    || g.recs.find((r) => r.name === 'obj.table');
  if (!imgProto) fatal('找不到图片控件母本 things/obj.table', 2);
  console.log('  · 图片控件母本 ' + imgProto.name + '#' + imgProto.id);
  for (let li = 0; li < data.levels.length; li++) {
    const lv = data.levels[li];
    const cid = containerIds[li];
    const cfield = containerFields[li];
    const cl = cfield ? findChildListTop(cfield.sub) : null;
    if (!cfield || !cl) fatal('找不到容器 ' + lv.name + '#' + cid + ' 或其子列表', 2);
    const cur = (asIdList(cl.payload, true) || []).map(Number);
    const ids = [];
    let n = 0;
    for (const c of lv.controls) {
      n++;
      const name = FART_PREFIX + lv.name + '.' + n;
      const exists = g.recs.find((r) => Number(r.parentId) === Number(cid) && r.name === name);
      if (exists) { ids.push(exists.id); re.skipped.push(name + '#' + exists.id); continue; }
      const clone = cloneField(imgProto.field);
      const nid = alloc.take();
      const selfCnt = countVarintEqual(imgProto.field.sub, imgProto.id);
      const rn0 = remapSelfIds(clone.sub, imgProto.id, nid);
      if (rn0 !== selfCnt) fatal(name + ' 克隆：自身 GUID 替换 ' + rn0 + '/' + selfCnt + ' 处');
      const rn = renameRecord(clone.sub, 'obj.table', name);
      if (!rn.ok) fatal(name + ' 克隆：改名命中 ' + rn.hits + ' 处');
      const p504 = topVarint(clone.sub, 504);
      if (!p504) fatal(name + ' 克隆：顶层没有 #504');
      p504.num = BigInt(cid);
      // 几何：画布坐标(左上,y 向下) → 记录(相对父中心, y 向上)
      const st = stateSummary(clone);
      if (st.length !== 4) fatal(name + ' 状态块 ' + st.length + ' 个（预期 4）');
      const recX = Number(c.x) - CANVAS_W / 2;
      const recY = CANVAS_H / 2 - Number(c.y);
      for (const s of st) {
        setPair(s.pos, recX, recY);
        setPair(s.size, Number(c.w), Number(c.h));
        if (s.aMinX !== 0.5 || s.aMinY !== 0.5 || s.aMaxX !== 0.5 || s.aMaxY !== 0.5 || s.pivX !== 0.5 || s.pivY !== 0.5) {
          fatal(name + ' 锚点/中心不是 0.5/0.5');
        }
      }
      // 图片三件套 + 旋转
      const img = imageTriple(clone);
      setImgLeaf(img.node, 502, Number(c.color));
      setImgLeaf(img.node, 503, Number(c.id));
      setImgLeaf(img.node, 504, IMG_TYPE_STRETCH);
      const rot = Number(c.rot || 0) * ROT_SIGN;
      applyRotation(clone, rot);
      // 子控件默认可见性：--child-visible=true（默认，v4/v5）| false（v6：默认全关，脚本逐个子控件打开）
      setHiddenRec(clone, !CHILD_VISIBLE);
      g.recHolder.push(clone);
      ids.push(nid);
      re.added.push({ name, id: nid, parent: cid, level: lv.name, idx: n });
    }
    // 容器子列表 = 数据顺序（幂等：先摘掉本次要放的 id 再按序追加）
    const kept = cur.filter((id) => !ids.includes(id));
    const next = [...kept, ...ids];
    if (next.join(',') !== cur.join(',')) {
      setChildList(cl, next);
      re.childListChanges.push({ where: lv.name + '#' + cid, before: cur.length, after: next.length });
    }
    re.levelInfo.push({ level: lv.name, containerId: cid, count: lv.controls.length, ids, controls: lv.controls });
  }
  re.expectedRecs = g.recs.length + re.added.length;
  re.expectedDiffs = (re.added.length ? 1 : 0) + re.childListChanges.length;
  return re;
}

function assertControls(g2, re) {
  const bad = [];
  const nameOf = (id) => (g2.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id;
  let checked = 0;
  for (const info of re.levelInfo) {
    const container = g2.recs.find((r) => r.id === Number(info.containerId));
    const cl = container ? findChildListTop(container.field.sub) : null;
    const ids = cl ? (asIdList(cl.payload, true) || []).map(Number) : [];
    const names = ids.map(nameOf);
    const wantNames = info.controls.map((_, i) => FART_PREFIX + info.level + '.' + (i + 1));
    if (names.slice(0, wantNames.length).join(',') !== wantNames.join(',')) {
      bad.push(info.level + ' 子控件顺序/名字不符（前 3：' + names.slice(0, 3).join(',') + '…）');
    }
    for (let i = 0; i < info.controls.length; i++) {
      const c = info.controls[i];
      const name = FART_PREFIX + info.level + '.' + (i + 1);
      const r = g2.recs.find((x) => Number(x.parentId) === Number(info.containerId) && x.name === name);
      if (!r) { bad.push('缺 ' + name); continue; }
      checked++;
      const img = imageTriple(r.field);
      if (img.id !== Number(c.id)) bad.push(name + ' imageId=' + img.id + '（预期 ' + c.id + '）');
      const wantColor = typeof c.color === 'string' ? Number(BigInt(c.color) & 0xFFFFFFFFn) : Number(c.color) >>> 0;
      if (img.color !== wantColor) bad.push(name + ' imageColor=' + hex32(img.color) + '（预期 ' + hex32(wantColor) + '）');
      if (img.type !== IMG_TYPE_STRETCH) bad.push(name + ' imageType=' + img.type + '（预期 Stretch=1）');
      const st = stateSummary(r.field);
      if (st.length !== 4) { bad.push(name + ' 状态块 ' + st.length); continue; }
      const wantX = Number(c.x) - CANVAS_W / 2, wantY = CANVAS_H / 2 - Number(c.y);
      for (const s of st) {
        if (Math.abs(s.x - wantX) > 0.02 || Math.abs(s.y - wantY) > 0.02) bad.push(name + ' 位置 (' + s.x + ',' + s.y + ')（预期 ' + wantX.toFixed(2) + ',' + wantY.toFixed(2) + '）');
        if (Math.abs(s.w - Number(c.w)) > 0.02 || Math.abs(s.h - Number(c.h)) > 0.02) bad.push(name + ' 尺寸 ' + s.w + 'x' + s.h + '（预期 ' + c.w + 'x' + c.h + '）');
      }
      const rots = readRotZ(r.field);
      const wantRot = Math.round(Number(c.rot || 0) * 1000) / 1000;
      for (const rz of rots) if (Math.abs(rz - wantRot) > 0.02) bad.push(name + ' rotation=' + rz + '（预期 ' + wantRot + '）');
      if (CHILD_VISIBLE ? isHiddenRec(r.field) : !isHiddenRec(r.field)) {
        bad.push(name + ' 可见性=' + (isHiddenRec(r.field) ? '隐藏' : '可见') + '（本轮要求 visible=' + CHILD_VISIBLE + '）');
      }
    }
  }
  if (g2.recs.length !== re.expectedRecs) bad.push('记录数 ' + g2.recs.length + '（预期 ' + re.expectedRecs + '）');
  const tops = g2.recs.map((r) => r.id);
  if (new Set(tops).size !== tops.length) bad.push('顶层 #501 有重复');
  const need = Object.values(PROTECTED);
  for (const nm of need) if (!g2.recs.some((r) => r.name === nm)) bad.push('旧路径 ' + nm + ' 不见了（要求保留作回退）');
  if (bad.length) return '✗ 控件断言失败：\n  ' + bad.join('\n  ');
  console.log('  ✅ 控件断言：' + checked + ' 条静态图片控件全部回读一致（imageId/色/Stretch/位置/尺寸/旋转/visible='
    + CHILD_VISIBLE + '；容器子列表顺序 = 数据顺序；content/furn 与 tpl.prim 保留）');
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// 外部闸门
// ════════════════════════════════════════════════════════════════════════════
function runNode(tool, args) {
  const r = spawnSync(process.execPath, [path.join(HERE, tool), ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}
function runExternalGates(outAbs, inAbs, re) {
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
  const want = re.expectedFinalDiffs;
  const recA = /记录数：A (\d+) → B (\d+)/.exec(df.stdout);
  const recOk = recA ? (Number(recA[2]) === re.expectedFinalRecs && Number(recA[1]) + re.totalAdded === Number(recA[2])) : (re.totalAdded === 0);
  const dfPass = got === want && recOk && (want === 0 ? df.status === 0 : df.status === 3);
  results.push({ name: 'diff_fields', pass: dfPass });
  say('  ⇒ ' + (dfPass ? '✅ 通过：差异 ' + got + ' 处 = ' + (re.totalAdded ? 1 : 0) + ' 记录数组条数 + ' + (re.rootChanged ? 1 : 0) + ' root 子列表（= ' + want + '）'
    : '❌ 未通过：差异 ' + got + '，预期 ' + want));
  say('     ★ 两个新建容器的子控件列表在"新增记录内部"⇒ diff_fields 不报为字段差异（与 E10 同口径）✓');

  say('\n── ⑤ list_names fart. ──');
  const ln = runNode('list_names.mjs', [outAbs, FART_PREFIX]);
  const lineCount = (ln.stdout.match(/^\s+\d+\s+\S+/gm) || []).length;
  say(ln.stdout.trim());
  const expect = re.controlsTotal + re.levels;
  const lnPass = ln.status === 0 && lineCount === expect;
  results.push({ name: 'list_names', pass: lnPass });
  say('  ⇒ ' + (lnPass ? '✅ 通过：fart. 命中 ' + lineCount + ' = 2 容器 + ' + re.controlsTotal + ' 控件'
    : '❌ 未通过：fart. 命中 ' + lineCount + '（预期 ' + expect + '）'));

  // ⑥ 回读容器/控件样例 + 旧路径保留
  say('\n── ⑥ 回读：容器顺序 + 每条数据的字段样例 + 旧路径保留 ──');
  const g3 = readGil(outAbs);
  const root = g3.recs.find((r) => r.name === 'root');
  const rcl = root ? findChildListTop(root.field.sub) : null;
  const rootNames = rcl ? (asIdList(rcl.payload, true) || []).map((id) => (g3.recs.find((r) => r.id === Number(id)) || {}).name || '#' + id) : [];
  const li = rootNames.indexOf('labels');
  say('  root 顺序（labels 起）：' + rootNames.slice(li, li + 5).join(' , '));
  let orderPass = rootNames[li + 1] === 'fart.case_001' && rootNames[li + 2] === 'fart.case_002' && rootNames[li + 3] === 'home';
  say('    ' + (orderPass ? '✅' : '❌') + ' labels → fart.case_001 → fart.case_002 → home');
  for (const info of re.levelInfo) {
    const r = g3.recs.find((x) => x.name === FART_PREFIX + info.level + '.1');
    const arr = g3.recs.filter((x) => FART_PREFIX + info.level + '.' === (x.name || '').slice(0, FART_PREFIX.length + info.level.length + 1) - 0 ? false : (x.name || '').startsWith(FART_PREFIX + info.level + '.'));
    const first = info.controls[0], last = info.controls[info.controls.length - 1];
    const show = (c, r2) => {
      const img = imageTriple(r2.field);
      const st = stateSummary(r2.field)[0];
      const rot = readRotZ(r2.field)[0];
      return 'id=' + img.id + ' color=' + hex32(img.color) + ' type=' + img.type
        + ' pos=(' + st.x + ',' + st.y + ') size=' + st.w + 'x' + st.h + ' rot=' + rot;
    };
    const rFirst = g3.recs.find((x) => x.name === FART_PREFIX + info.level + '.1');
    const rLast = g3.recs.find((x) => x.name === FART_PREFIX + info.level + '.' + info.controls.length);
    say('  ' + info.level + '：' + info.controls.length + ' 条；样例')
    say('    ' + FART_PREFIX + info.level + '.1  ← 数据 ' + JSON.stringify(first));
    say('      回读 ' + show(first, rFirst));
    say('    ' + FART_PREFIX + info.level + '.' + info.controls.length + '  ← 数据 ' + JSON.stringify(last));
    say('      回读 ' + show(last, rLast));
  }
  const keep = Object.values(PROTECTED).map((n) => n + '=' + (g3.recs.some((r) => r.name === n) ? '✅' : '❌')).join('  ');
  say('  旧路径保留：' + keep);
  if (!Object.values(PROTECTED).every((n) => g3.recs.some((r) => r.name === n))) orderPass = false;
  results.push({ name: 'order/readback', pass: orderPass });
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════
function main() {
  if (!IN || !OUT) {
    console.error('用法: node tools/gil/gen_bake_art.mjs --in=<存档.gil> --out=<输出.gil> [--dry] [--data=<bake-static-furn.json>]');
    process.exit(1);
  }
  const inAbs = P(IN), outAbs = P(OUT);
  if (!fs.existsSync(inAbs)) fatal('找不到输入存档：' + inAbs, 1);
  console.log('══ gen_bake_art —— 图元家具静态烘焙（fart.case_001 / fart.case_002 + 静态图片控件）══');
  console.log('  · 子控件默认可见性：' + CHILD_VISIBLE + '（容器始终 visible=false；'
    + (CHILD_VISIBLE ? 'v4/v5 口径' : 'v6 口径：默认全关，脚本逐个子控件打开') + '）');
  const data = loadBakeData();
  const budget = 500 + data.total;   // 仅用于打印（真实以基线为准）
  const g = readGil(inAbs);
  console.log('  输入 ' + basenameOf(inAbs) + '（' + g.src.length + ' 字节，记录 ' + g.recs.length + ' 条，maxId=' + g.maxId + '）');
  console.log('  输出 ' + basenameOf(outAbs) + '（' + (DRY ? '--dry 只预测不写' : '写') + '）');
  // 记录预算：以"还差多少条"算（幂等复跑时输入里已有这批控件 ⇒ projected = 现有条数）
  const existingContainers = g.recs.filter((r) => /^fart\.case_\d+$/.test(r.name || '')).length;
  const existingFart = g.recs.filter((r) => (r.name || '').startsWith(FART_PREFIX)).length;
  const missingContainers = Math.max(0, data.levels.length - existingContainers);
  const missingControls = Math.max(0, data.total - (existingFart - existingContainers));
  const missing = missingContainers + missingControls;
  const projected = g.recs.length + missing;
  console.log('  · 记录预算：' + g.recs.length + ' + ' + missing + '（还需补 ' + missingContainers + ' 容器 + '
    + missingControls + ' 控件）= '
    + projected + (projected < 1000 ? '（< 1000 ✓）' : '（≥ 1000 ✗ 需回报 lead 降 N_PER_PIECE）'));
  if (projected >= 1000) fatal('控件数 ' + projected + ' ≥ 1000，按 lead 要求停下报数，不写文件', 2);

  const { used, maxGuid } = scanGuidUsage(g.tree);
  if (!Number.isInteger(GUID_BASE) || GUID_BASE < 1073741824 || GUID_BASE >= ID_HI_NUM) fatal('--guid-base 不合法', 1);
  let nextId = Math.max(GUID_BASE, maxGuid + 1);
  if (maxGuid >= GUID_BASE) console.log('  · 输入已用到 ' + maxGuid + ' ⇒ 幂等复跑，新号从 ' + nextId + ' 起（本次应无新增）');
  const alloc = {
    base: nextId, ids: [],
    take() { while (used.has(nextId)) nextId++; if (nextId >= ID_HI_NUM) fatal('GUID 号段耗尽'); const v = nextId++; used.add(v); alloc.ids.push(v); return v; },
  };
  console.log('  · GUID 扫描：已用 id 区间 varint ' + used.size + ' 个，maxGuid=' + maxGuid + ' ⇒ 新号从 ' + alloc.base + ' 起');

  let tmp1 = null, tmp2 = null;
  try {
    // 段①：容器
    console.log('\n── ① 两个容器 fart.case_001 / fart.case_002（root：labels 之后、home 之前）──');
    const reA = buildContainers(g, alloc, data);
    console.log('  新增容器 ' + reA.added.length + ' 条：' + reA.added.map((a) => a.name + '#' + a.id).join(', '));
    if (reA.skipped.length) console.log('  （已存在、跳过 ' + reA.skipped.length + ' 条）');
    console.log('  记录数：' + g.recs.length + ' → ' + reA.expectedRecs + '；第一段预计差异 ' + reA.expectedDiffs
      + ' 处（' + (reA.added.length ? 1 : 0) + ' 记录数组条数 + ' + (reA.rootChanged ? 1 : 0) + ' root 子列表）');
    let midSrc = inAbs;
    if (reA.added.length > 0 && !DRY) {
      tmp1 = path.join(os.tmpdir(), 'gen_bake_art_A_' + process.pid + '_' + Date.now() + '.gil');
      writeGil(g, tmp1, {
        label: 'gen_bake_art ① 两个 fart 容器',
        expectRecs: reA.expectedRecs,
        expectDiffs: reA.expectedDiffs,
        assert: (g2) => assertContainers(g2, reA),
      });
      midSrc = tmp1;
    }

    // 段②：455 控件
    console.log('\n── ② ' + data.total + ' 条静态图片控件（每条图元 = 一条图片控件）──');
    const gB = DRY ? g : readGil(midSrc);
    const baseRecs = g.recs.length;
    // ★ 段② 必须用「重读磁盘那份」的容器字段（段① 写完后内存树已过期）；--dry 才用内存引用
    const containerFieldsB = DRY ? reA.containerFields : reA.containerIds.map((id) => {
      const r = gB.recs.find((x) => x.id === Number(id));
      if (!r) fatal('重读后找不到容器 #' + id, 2);
      return r.field;
    });
    const reB = buildControls(gB, alloc, data, reA.containerIds, containerFieldsB);
    const totalAdded = reA.added.length + reB.added.length;
    const expectedRecs = baseRecs + totalAdded;     // 幂等复跑时 totalAdded=0 ⇒ 记录数不变
    reB.expectedRecs = expectedRecs;
    console.log('  新增控件 ' + reB.added.length + ' 条（' + reB.levelInfo.map((x) => x.level + '=' + x.count).join(' / ') + '）');
    if (reB.skipped.length) console.log('  （已存在、跳过 ' + reB.skipped.length + ' 条）');
    console.log('  记录数：' + baseRecs + ' → ' + expectedRecs + '；第二段预计差异 ' + reB.expectedDiffs
      + ' 处（' + (reB.added.length ? 1 : 0) + ' 记录数组条数 + ' + reB.childListChanges.length + ' 容器子列表）');

    const reTotal = {
      totalAdded,
      expectedFinalRecs: expectedRecs,
      // ★ 两个容器是本轮**新建**的记录：它们的子控件列表属于"新增记录内部"，
      //   diff_fields（按位置比）不会报成字段差异 ⇒ 基线→输出只剩 1 记录数组条数 + 1 root 子列表。
      expectedFinalDiffs: (totalAdded ? 1 : 0) + (reA.rootChanged ? 1 : 0),
      rootChanged: reA.rootChanged,
      containerListChanges: reB.childListChanges.length,
      levels: data.levels.length,
      controlsTotal: data.total,
      levelInfo: reB.levelInfo,
    };

    if (DRY) {
      const buf = gB.pack(encodeMsg(gB.tree));
      console.log('\n[--dry] 不写任何文件。预测：');
      console.log('  记录数 ' + baseRecs + ' → ' + expectedRecs + '（+' + totalAdded + '）');
      console.log('  输出字节 ' + g.src.length + ' → ' + buf.length + '（+' + (buf.length - g.src.length) + '）');
      console.log('  diff_fields 基线→输出 = ' + reTotal.expectedFinalDiffs + ' 处（1 记录数组条数 + ' + (reA.rootChanged ? 1 : 0) + ' root 子列表；两个新建容器的子列表在"新增记录内部"不计）');
      return 0;
    }

    let finalBytes = 0, finalRecs = 0;
    if (reB.added.length > 0) {
      tmp2 = path.join(os.tmpdir(), 'gen_bake_art_B_' + process.pid + '_' + Date.now() + '.gil');
      const rep = writeGil(gB, tmp2, {
        label: 'gen_bake_art ② ' + data.total + ' 条静态图元控件',
        expectRecs: reB.expectedRecs,
        expectDiffs: reB.expectedDiffs,
        assert: (g2) => assertControls(g2, reB),
      });
      finalBytes = rep.bytes; finalRecs = rep.recs;
      fs.copyFileSync(tmp2, outAbs);
    } else if (path.resolve(midSrc) !== path.resolve(outAbs)) {
      fs.copyFileSync(midSrc, outAbs);
      finalBytes = fs.statSync(outAbs).size; finalRecs = expectedRecs;
    } else { finalBytes = fs.statSync(outAbs).size; finalRecs = expectedRecs; }

    const results = runExternalGates(outAbs, inAbs, reTotal);
    const allPass = results.every((r) => r.pass);
    console.log('\n════════════════ 交付摘要 ════════════════');
    console.log('  输出：' + OUT + '（' + finalBytes + ' 字节，记录 ' + finalRecs + ' 条）');
    console.log('  记录数：' + baseRecs + ' → ' + finalRecs + '（+' + (finalRecs - baseRecs) + '）'
      + (finalRecs === expectedRecs ? ' ✅' : ' ❌')
      + '   算式：' + baseRecs + ' + 2 容器 + ' + data.total + ' 控件 = ' + expectedRecs);
    console.log('  GUID 号段：' + alloc.base + '–' + (alloc.ids.length ? alloc.ids[alloc.ids.length - 1] : alloc.base - 1));
    console.log('  旋转：已写入状态块 #508（vec3 #3 = z 度）；数据 ri 全量回读核对过（0 不写 = 稀疏）');
    console.log('  闸门：' + results.map((r) => r.name + ' ' + (r.pass ? '✅' : '❌')).join('  '));
    if (!allPass) { console.error('\n❌ 外部闸门未全过 —— 文件已写出但**不要导入**。'); return 4; }
    console.log('  ★ 全部通过。导入用：' + OUT);
    return 0;
  } finally {
    for (const t of [tmp1, tmp2]) if (t && fs.existsSync(t)) { try { fs.unlinkSync(t); } catch { /* ignore */ } }
  }
}

process.exit(main());
