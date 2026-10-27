// tools/gil/place_select.mjs —— **专治选关屏**：补齐缺失子控件 + 把几何写对（一次只做这一件事）
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么必须是"专用工具"，不是 `sync_plan.mjs`（2026-10-15）
// ════════════════════════════════════════════════════════════════════════════
//   ★ `sync_plan.mjs` 是"补**整个计划并集**"的通用工具（281 个节点级别）✗ ——
//     `-project` 仓的交班里已经点过它：「它同步整份计划并集，落地 .gil 还需要
//     一个按 `gen_icons` 模子写的专用工具」✓
//   ⇒ ★ 本工具只做**选关屏**这一件事 ✓，且**只改它列出来的名字** ✓：
//     · 不加别的屏的控件 ✗
//     · 不动已有控件的父级/类型 ✗
//
// ════════════════════════════════════════════════════════════════════════════
// 两条被"读数"证明过的根因（2026-10-15 实测，不是猜）
// ════════════════════════════════════════════════════════════════════════════
//   ★★ 根因 1：**`respect_editor_rect = true` ⇒ 存档里的几何就是最终几何** ✓
//     （`entry_client_script.lua` 里写着 ✓；适配器 `set_property("rect")` 那一分支
//       对"存档里已有、且没标 `pos_runtime`"的控件**直接空操作返回** ✓ 见
//       `engine_adapter_qianxing.lua:4619` ✓）
//     ⇒ ★ 而 `select.*` / `hit.select.*` 全是**克隆体** ✗ ——
//       克隆只改了 id / 名字 / 尺寸，**位置原样留着 `hex.back` 的** ✓
//       （实测：12 条记录的位置全是 `[-709, 371]` ✓ 那是关卡内左上角返回箭头的位置 ✓）
//     ⇒ ★★ 所以选关屏上这 12 个控件**全都叠在同一个点上** ✓ ——
//       这才是"四张卡看起来不对/下排有白条"的直接原因 ✓
//
//   ★★ 根因 2：**脚本每帧要写的子控件，存档里一个都没有** ✗
//     （`select.title` / `select.page` / `select.card.N.title` / `.info` /
//       `.room.1..6` —— 计划里有 34 个 ✓ 存档里 0 个 ✗）
//     ⇒ ★ 表现：卡片只剩一块**纯白底板**（没有关名、没有人数、没有房间色块）✓
//     ⇒ ★ 本工具把它们按计划建出来 ✓（原型：文本用 `modal.title`、图片用 `select.card.1` ✓
//       两个都在**同一份记录容器**里 ✓ —— `千星存档-gil格式.md` 坑 #7：不能跨画布拿原型 ✓）
//
//   ⚠️ 另有一条**被证伪**的说法，别再照抄 ✗：
//     「命中层 `hit.select.*` 会渲染成白块」✗ ——
//     `tools/gil/compare_records.mjs hit.back hit.select.back` 实测：
//     **两条记录归一化后 181 行逐行相同** ✓（只差 id/父/名字/几何 ✓）
//     ⇒ ★ `hit.back` 在关卡内不显形 ⇒ 它的克隆体也不会显形 ✓
//
// ════════════════════════════════════════════════════════════════════════════
// 坐标系（**这条错了整个屏都会飞**，所以写清楚）
// ════════════════════════════════════════════════════════════════════════════
//   · 计划 `layout-plan.json` 给的是**画布空间**（1600×900，原点左下、Y 向上）✓
//   · `.gil` 状态块里存的是**相对父级中心**的偏移（同画布空间）✓ 尺寸 = 画布尺寸 ✓
//   · 父级 = `root`（实测：`hex.back` 计划画布 = (60,790,62,62) ⇒ 中心 (91,821)；
//     存档里 = (-709,371) ⇒ 中心 = 根中心 (800,450) + (-709,371) = (91,821) ✓ **逐位吻合** ✓）
//   ⇒ 本工具：`stored = round(cx - canvas.w/2), round(cy - canvas.h/2)`，`size = round(w/h)` ✓
//
// ════════════════════════════════════════════════════════════════════════════
// 用法
// ════════════════════════════════════════════════════════════════════════════
//   node tools/gil/place_select.mjs --in=<存档> --out=<输出> [--dry]
//        [--plan=tools/sim/out/layout-plan.json]
//        [--card-mat=106053] [--thumb-mat=106053]      # 卡面 / 缩略图素材（底板类 ✓）
//
//   ★ 写盘走 `writeGil()`（唯一安全通道 ✓）：落盘 → 重读 → 往返闸门 → 字段 diff → 自定义断言 ✓

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, stateBlocks, pairOf, pairValue, setPair, bigIdTop,
  findChildListTop, ensureChildListTop, setChildList, asIdList, textsOf, KNOWN_TYPES,
} from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const DRY = argv.includes('--dry');

const IN = argOf('in');
const OUT = argOf('out');
const PLAN = argOf('plan') || path.join(ROOT, 'tools/sim/out/layout-plan.json');
const CARD_MAT = Number(argOf('card-mat') || 106053);   // 白底板（`main.lua:1637` 实测过 Stretch ✓）
const THUMB_MAT = Number(argOf('thumb-mat') || 106053); // 同上（计划里脚本给的就是 106053 ✓）
if (!IN || !OUT) { console.error('用法: node tools/gil/place_select.mjs --in=<存档> --out=<输出> [--dry]'); process.exit(1); }

// ── 本工具只认这些名字（写死在代码里 ⇒ 不会"顺手"改别的屏 ✓）─────────────
const CREATE_RE = [
  /^select\.title$/, /^select\.page$/,
  /^select\.card\.\d+\.title$/, /^select\.card\.\d+\.info$/,
  /^select\.card\.\d+\.room\.\d+$/,
];
const PLACE_RE = [
  /^select\.(title|page|back|prev|next)$/,
  /^select\.card\.\d+$/,
  /^select\.card\.\d+\.(title|info)$/,
  /^select\.card\.\d+\.room\.\d+$/,
  /^hit\.select\.(back|prev|next)$/,
  /^hit\.select\.card\.\d+$/,
];
const IMG_RE = [/^select\.card\.\d+$/, /^select\.card\.\d+\.room\.\d+$/];
const matchAny = (res, id) => res.some((re) => re.test(id));

const g = readGil(IN);
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const planById = new Map(plan.nodes.map((n) => [n.id, n]));
const CANVAS_W = (plan.canvas && plan.canvas.width) || 1600;
const CANVAS_H = (plan.canvas && plan.canvas.height) || 900;
const RCX = CANVAS_W / 2, RCY = CANVAS_H / 2;

console.log('输入：' + path.basename(IN) + '（记录 ' + g.recs.length + '，maxId=' + g.maxId + '）');
console.log('计划：' + path.relative(ROOT, PLAN) + '（节点 ' + plan.nodes.length + '，画布 ' + CANVAS_W + '×' + CANVAS_H + '）');

/** 计划 → 存档的几何（画布空间 → 相对根中心；尺寸保持画布尺寸） */
function geomOf(id) {
  const n = planById.get(id);
  if (!n) return null;
  return {
    x: Math.round(n.cx - RCX), y: Math.round(n.cy - RCY),
    w: Math.round(n.w), h: Math.round(n.h),
    cx: n.cx, cy: n.cy, pw: n.w, ph: n.h,
  };
}

// ── 原型（必须与目标**同一份记录容器** ✓）────────────────────────────────
const protoText = g.byName.get('modal.title') || g.byName.get('home.title');
const protoImg = g.byName.get('select.card.1') || g.byName.get('hex.back');
if (!protoText) { console.error('❌ 找不到文本原型（modal.title / home.title）'); process.exit(3); }
if (!protoImg) { console.error('❌ 找不到图片原型（select.card.1 / hex.back）'); process.exit(3); }
console.log('原型：文本 = ' + protoText.name + ' #' + protoText.id
  + '　图片 = ' + protoImg.name + ' #' + protoImg.id);

function holderPathOf(rec) {
  // 只用于打印：确认原型与目标在同一个 holder 里
  let found = null;
  (function walk(fields, p) {
    for (const f of fields) {
      if (f.sub === rec.holder) { found = p; return; }
      if (f.sub) walk(f.sub, p + '/#' + f.field);
    }
  })(g.tree, '');
  return found || '(?)';
}

// ── 克隆（与 sync_plan 同源的写法 + 两处加固）──────────────────────────────
let nextId = g.maxId + 1;
function deepField(f) {
  const c = { field: f.field, wt: f.wt, sub: null, num: f.num, len: f.len, isText: f.isText,
              payload: f.payload ? Buffer.from(f.payload) : Buffer.alloc(0) };
  if (f.sub) c.sub = f.sub.map(deepField);
  return c;
}
function walkFields(fs, fn) { for (const f of fs) { fn(f); if (f.sub) walkFields(f.sub, fn); } }

/** 改名字：**按原型名精确匹配**那条短文本 ✓（比"钻 #505 再钻 #12"稳 ✓） */
function renameFrom(fields, oldName, newName) {
  const buf = Buffer.from(newName, 'utf8');
  let done = false;
  walkFields(fields, (f) => {
    if (done) return;
    if (f.wt === 2 && f.isText && f.field === 501 && f.payload && f.payload.toString('utf8') === oldName) {
      f.payload = buf; f.len = buf.length; done = true;
    }
  });
  return done;
}

/** 图片块 `/#505/#503/#84`：写 imageId(+可选 Stretch) */
function setImage(fields, imageId, stretch) {
  let hits = 0, stretchHits = 0;
  (function walk(fs, p) {
    for (const f of fs) {
      if (f.sub) { walk(f.sub, p + '/#' + f.field); continue; }
      if (p === '/#505/#503/#84') {
        if (f.field === 503 && f.wt === 0) { f.num = BigInt(imageId); hits++; }
      }
    }
  })(fields, '');
  if (stretch) {
    (function find84(fs, p) {
      for (const f of fs) {
        if (f.sub && p + '/#' + f.field === '/#505/#503/#84') {
          const has = f.sub.find((x) => x.field === 504 && x.wt === 0);
          if (has) { has.num = 1n; stretchHits++; }
          else { f.sub.push({ field: 504, wt: 0, num: 1n, sub: null, payload: null, len: 0, isText: false, s0: 0, s1: 0 }); stretchHits++; }
          continue;
        }
        if (f.sub) find84(f.sub, p + '/#' + f.field);
      }
    })(fields, '');
  }
  return { hits, stretchHits };
}

const created = [];
function makeRecord(proto, id, parentRec, geom, imageId) {
  const newId = nextId++;
  const field = deepField(proto.field);
  // ① 自己的 id（顶层 #501，其余等于原型 id 的回指也一起改）
  const top = field.sub.find((f) => f.wt === 0 && f.field === 501 && Number(f.num) === proto.id);
  if (top) top.num = BigInt(newId);
  walkFields(field.sub, (f) => {
    if (f.wt === 0 && f.field === 501 && Number(f.num) === proto.id) f.num = BigInt(newId);
    if (f.wt === 0 && f.field === 4 && Number(f.num) === proto.id) f.num = BigInt(newId);
  });
  // ② 父级
  const p504 = field.sub.find((f) => f.wt === 0 && f.field === 504);
  if (!p504) { console.error('❌ 原型 ' + proto.name + ' 顶层没有 #504（父级字段）'); process.exit(4); }
  p504.num = BigInt(parentRec.id);
  // ③ 名字
  if (!renameFrom(field.sub, proto.name, id)) { console.error('❌ 改不动名字（原型名 ' + proto.name + '）'); process.exit(4); }
  // ④ 清空子列表（原型若带子控件，别让它们跟着飘过来）
  const cl = findChildListTop(field.sub);
  if (cl) setChildList(cl, []);
  // ⑤ 几何（四个状态块都写 ✓）
  let pairs = 0;
  for (const b of stateBlocks(field.sub, [])) {
    const p5 = pairOf(b, 505); if (p5) { setPair(p5, geom.w, geom.h); pairs++; }
    const p4 = pairOf(b, 504); if (p4) { setPair(p4, geom.x, geom.y); pairs++; }
  }
  // ⑥ 图片（只有图片类原型才给）
  let img = null;
  if (imageId != null) img = setImage(field.sub, imageId, true);

  const recField = { field: proto.field.field, wt: 2, sub: field.sub, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false };
  g.recHolder.push(recField);
  const pl = ensureChildListTop(parentRec, findChildListTop(proto.field.sub));
  const ids = asIdList(pl.payload, true) || [];
  ids.push(newId);
  setChildList(pl, ids);
  created.push({ id, newId, pairs, img });
  return newId;
}

const root = g.byName.get('root');
if (!root) { console.error('❌ 存档里没有 root'); process.exit(3); }

// ══════════════════════════════════════════════════════════════════════════
// 第一遍：补缺失的（只补本工具认的 34 个名字）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── 第一遍：补缺失控件 ──');
const planSelectIds = plan.nodes
  .map((n) => n.id)
  .filter((id) => matchAny(CREATE_RE, id))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const missing = planSelectIds.filter((id) => !g.byName.has(id));
console.log('计划里本工具负责的节点 ' + planSelectIds.length + ' 个；存档里缺 ' + missing.length + ' 个');
for (const id of missing) {
  const geom = geomOf(id);
  if (!geom) { console.log('  ⚠️ 计划里没有 ' + id + ' 的几何 ⇒ 跳过'); continue; }
  if (/\.(title|info)$/.test(id) || /^select\.(title|page)$/.test(id)) {
    const nid = makeRecord(protoText, id, root, geom, null);
    console.log('  + 文本 ' + id.padEnd(26) + ' #' + nid + '  ' + JSON.stringify({ x: geom.x, y: geom.y, w: geom.w, h: geom.h }));
  } else if (/\.room\.\d+$/.test(id)) {
    const nid = makeRecord(protoImg, id, root, geom, THUMB_MAT);
    console.log('  + 图片 ' + id.padEnd(26) + ' #' + nid + '  ' + JSON.stringify({ x: geom.x, y: geom.y, w: geom.w, h: geom.h })
      + '  mat=' + THUMB_MAT + ' Stretch');
  } else {
    console.log('  ⚠️ ' + id + ' 既不是文本也不是缩略图 ⇒ 跳过（本工具不建别的种类）');
  }
}
const toCreate = new Set(created.map((c) => c.id));

// ══════════════════════════════════════════════════════════════════════════
// 第二遍：把几何写对（**已有的也写** —— 根因 1 ✓）
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── 第二遍：几何（存档优先，所以必须写进存档）──');
const placed = [];
for (const n of plan.nodes) {
  if (!matchAny(PLACE_RE, n.id)) continue;
  const rec = g.byName.get(n.id);
  if (!rec) { continue; }   // 计划里有、但既没建也不在存档（例如 hit.* 之外的）
  const geom = geomOf(n.id);
  if (!geom) continue;
  const blocks = stateBlocks(rec.field.sub, []);
  if (!blocks.length) { console.log('  ⚠️ ' + n.id + ' 没有状态块 ⇒ 写不了几何'); continue; }
  let pairs = 0;
  for (const b of blocks) {
    const p5 = pairOf(b, 505); if (p5) { setPair(p5, geom.w, geom.h); pairs++; }
    const p4 = pairOf(b, 504); if (p4) { setPair(p4, geom.x, geom.y); pairs++; }
  }
  placed.push({ id: n.id, idNum: rec.id, x: geom.x, y: geom.y, w: geom.w, h: geom.h, pairs });
  console.log('  · ' + n.id.padEnd(26) + ' #' + String(rec.id).padEnd(11)
    + ' pos=[' + geom.x + ',' + geom.y + ']  size=[' + geom.w + '×' + geom.h + ']  写 ' + pairs + ' 对');
}

// ══════════════════════════════════════════════════════════════════════════
// 第三遍：图片（卡面 / 缩略图）—— 换成"底板"类素材 + 显式 Stretch
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── 第三遍：图片（底板类素材 + Stretch）──');
const imgDone = [];
for (const rec of g.recs) {
  if (!rec.name || !matchAny(IMG_RE, rec.name)) continue;
  const mat = /\.room\.\d+$/.test(rec.name) ? THUMB_MAT : CARD_MAT;
  const r = setImage(rec.field.sub, mat, true);
  if (r.hits === 0) { console.log('  ⚠️ ' + rec.name + ' 没有图片块 ⇒ 跳过'); continue; }
  imgDone.push({ id: rec.name, idNum: rec.id, mat, ...r });
  console.log('  · ' + rec.name.padEnd(26) + ' #' + String(rec.id).padEnd(11) + ' imageId → ' + mat
    + '（改 ' + r.hits + ' 处）  Stretch(#504=1) → ' + r.stretchHits + ' 处');
}

console.log('\n小结：新建 ' + created.length + ' 条；几何 ' + placed.length + ' 条；图片 ' + imgDone.length + ' 条');

if (DRY) { console.log('\n--dry：不写文件 ✓'); process.exit(0); }

// ══════════════════════════════════════════════════════════════════════════
// 写盘（唯一通道 ✓）+ 断言（全部用**从磁盘重读**的那份 ✓）
// ══════════════════════════════════════════════════════════════════════════
const expectRecs = g.recs.length + created.length;
try {
  const rep = writeGil(g, OUT, {
    label: '选关屏：补齐子控件 + 几何写对',
    expectRecs,
    assert: (g2) => {
      const bad = [];
      for (const p of placed) {
        const r2 = g2.byName.get(p.id);
        if (!r2) { bad.push(p.id + ' 不见了'); continue; }
        const b = stateBlocks(r2.field.sub, [])[0];
        const pos = pairOf(b, 504), sz = pairOf(b, 505);
        const x = pos ? pairValue(pos, 0) : 0, y = pos ? pairValue(pos, 1) : 0;
        const w = sz ? pairValue(sz, 0) : 0, h = sz ? pairValue(sz, 1) : 0;
        if (Math.abs(x - p.x) > 0.5 || Math.abs(y - p.y) > 0.5 || Math.abs(w - p.w) > 0.5 || Math.abs(h - p.h) > 0.5) {
          bad.push(p.id + ' 几何 = [' + x + ',' + y + ' ' + w + '×' + h + ']，期望 [' + p.x + ',' + p.y + ' ' + p.w + '×' + p.h + ']');
        }
      }
      for (const c of created) if (!g2.byName.has(c.id)) bad.push('新建的 ' + c.id + ' 回读不到');
      return bad.length ? bad.slice(0, 8).join('；') : true;
    },
  });
  console.log('\n输出：' + path.basename(OUT) + '（' + rep.bytes + ' 字节，记录 ' + rep.recs + ' 条，字段差异 ' + rep.diffs + ' 处）');
  console.log('★ 独立复核：');
  console.log('    node tools/gil/roundtrip.mjs ' + path.basename(OUT));
  console.log('    node tools/gil/delete_controls.mjs --dry --in=' + path.basename(OUT));
} catch (e) {
  console.error('\n❌ ' + e.message);
  process.exit(5);
}
