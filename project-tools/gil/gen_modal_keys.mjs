// tools/gil/gen_modal_keys.mjs —— 把 exit_menu 的四键**定型**：几何 / 兄弟顺序 / 底图子控件
//
// 为什么单独一个工具（2026-10-07，用户四条反馈）：
//   「只有文字没配图，也只有两个，还不能点击，并严格按照我的文本从上到下」——
//   四条里三条是**确定性**的 gil 侧工作，必须一次做对：
//     ① 四个按钮 = `modal.exit/save/settle/cancel`，同尺寸同列，兄弟顺序 = 从上到下；
//     ② 每个按钮挂一个**图片子控件**（`bg`）并排在它的**第 1 位**（最先绘制、垫在最底，
//        不会盖住 `label`）；图对**成对**沿用已可见的 `clues.bg`（source 4279900704 / id 100001）；
//     ③ `modal.cancel` 原来是老的形状（133×50 @ 1017,307，又小又靠右）⇒ 必须拉齐到同一列。
//   第 4 条「点不动」**不在本工具里猜**：实测四个按钮与能点的 `home.select`
//   **字段路径 0 差异、值只差 ID/名字/几何** ⇒ 不是按钮缺字段，得靠真机日志定位（见回报）。
//
// 用法：
//   node tools/gil/gen_modal_keys.mjs --in=212-弹窗-真基准.gil --out=213-弹窗四键.gil [--probe]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, cloneField, setPair, pairOf, stateBlocks, textsOf,
  findChildListTop, ensureChildListTop, setChildList, asIdList, writeVarint,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const DRY = argv.includes('--probe');
const BASE = argOf('in') || path.join(ROOT, '212-弹窗-真基准.gil');
const OUT = argOf('out') || path.join(ROOT, '213-弹窗四键.gil');
const PANEL = argOf('panel') || 'modal';
const PROTO = argOf('proto') || 'clues.bg';      // 已实测可见的图片控件（成对携带 source+id）
const W = Number(argOf('w') || 480), H = Number(argOf('h') || 56);
const CHILD = argOf('child') || 'bg';

// 从上到下（用户指定的文案顺序，严格照抄）
const KEYS = [
  { name: 'modal.exit',   cy: 500 },
  { name: 'modal.save',   cy: 430 },
  { name: 'modal.settle', cy: 360 },
  { name: 'modal.cancel', cy: 290 },
];

const g = readGil(BASE);
console.log('基准：' + path.basename(BASE) + '  记录 ' + g.recs.length + ' 条');
const panel = g.byName.get(PANEL);
if (!panel) { console.error('找不到面板 ' + PANEL); process.exit(1); }
const proto = g.byName.get(PROTO);
if (!proto) { console.error('找不到图片原型 ' + PROTO); process.exit(1); }

// 面板中心（画布坐标）：从面板状态块 #504(位置) 反推 —— 面板位置存的是"父中心偏移"，
// modal 的父是 root，root 中心 = 画布中心 (800,450)，root 的 #504 为空 ⇒ 面板中心 = (800,450) + 面板#504。
const pairVal = (b, no, i) => { const p = pairOf(b, no); if (!p || !p.sub) return 0; const w = i === 0 ? 501 : 502; const h = p.sub.find((x) => x.field === w && x.wt === 5); return h ? h.f : 0; };
let pcx = 800, pcy = 450;
for (const b of stateBlocks(panel.field.sub, [])) {
  const x = pairVal(b, 504, 0), y = pairVal(b, 504, 1);
  if (x !== 0 || y !== 0) { pcx += x; pcy += y; break; }
}
console.log('面板 ' + PANEL + ' #' + panel.id + ' 中心≈(' + pcx + ',' + pcy + ')  图片原型 ' + PROTO + ' #' + proto.id);
console.log('四键：' + W + '×' + H + '  cx=' + pcx + '  cy=' + KEYS.map((k) => k.cy).join('/'));

const built = [];
for (const k of KEYS) {
  const rec = g.byName.get(k.name);
  if (!rec) { console.error('找不到按钮 ' + k.name); process.exit(2); }

  // ① 几何：四个状态块都写（位置相对面板中心；尺寸 480×56）
  let geo = 0;
  for (const b of stateBlocks(rec.field.sub, [])) {
    if (setPair(pairOf(b, 504), pcx > 0 ? 0 : 0, k.cy - pcy)) geo++;
    setPair(pairOf(b, 505), W, H);
  }
  if (geo !== 4) { console.error(k.name + ' 状态块几何只改了 ' + geo + ' 个'); process.exit(3); }

  // ② 图片子控件：克隆已可见的图片控件 → 换 ID / 换父 / 换名 / 铺满本按钮 / 清自身子列表
  const lst = ensureChildListTop(rec, null);
  const existing = (asIdList(lst.payload, true) || []).map((id) => (g.recs.find((r) => r.id === id) || {}).name);
  if (existing.includes(CHILD)) { console.log('  ' + k.name + ' 已有 ' + CHILD + ' → 跳过配图'); built.push({ k, rec, lst, id: null }); continue; }

  const clone = cloneField(proto.field);
  const newId = ++g.maxId ? g.maxId : g.maxId;   // 占位（下面用 nextId 统一分配）
  built.push({ k, rec, lst, id: null, clone });
}
let nextId = Math.max(...g.recs.map((r) => r.id)) + 1;
for (const it of built) {
  if (!it.clone) continue;
  const { k, rec, clone } = it;
  const newId = nextId++;
  (function fix(fs2) {
    for (const f of fs2) {
      if (f.wt === 0 && Number(f.num) === proto.id) f.num = BigInt(newId);
      else if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 1 && f.payload.length <= 8) {
        const ids = asIdList(f.payload, false);
        if (ids && ids.length === 1 && ids[0] === proto.id) { f.payload = writeVarint(newId); f.len = f.payload.length; }
      }
      if (f.sub) fix(f.sub);
    }
  })(clone.sub);
  let pOk = false;
  (function fixParent(fs2) {
    for (const f of fs2) {
      if (!pOk && f.wt === 0 && f.field === 504 && Number(f.num) === proto.parentId) { f.num = BigInt(rec.id); pOk = true; }
      if (f.sub) fixParent(f.sub);
    }
  })(clone.sub);
  const nf = textsOf(clone.sub, []).find((t) => t.payload.toString('utf8') === proto.name);
  let nOk = false;
  if (nf) { nf.payload = Buffer.from(CHILD, 'utf8'); nf.len = nf.payload.length; nOk = true; }
  let geo = 0;
  for (const b of stateBlocks(clone.sub, [])) { setPair(pairOf(b, 504), 0, 0); setPair(pairOf(b, 505), W, H); geo++; }
  if (!pOk || !nOk || geo !== 4) { console.error('  ❌ ' + k.name + ' 的 ' + CHILD + ' 克隆不完整（父' + pOk + ' 名' + nOk + ' 几何' + geo + '）'); process.exit(4); }
  const own = findChildListTop(clone.sub); if (own) setChildList(own, []);
  it.clone = clone; it.id = newId;
  // ③ 插到**子列表第 1 位**：底图最先绘制 ⇒ 垫在 label 下面（append 会盖住 label）
  const cur = asIdList(it.lst.payload, true) || [];
  setChildList(it.lst, [newId, ...cur.filter((x) => x !== newId)]);
}
built.forEach((it) => { if (it.clone) it.rec.holder.splice(it.rec.index + 1, 0, it.clone); });

// ④ 兄弟顺序：modal 子列表 = [bg, exit, save, settle, cancel, ...其余]
const order = KEYS.map((k) => g.byName.get(k.name).id);
const bgId = (g.recs.find((r) => r.name === 'bg' && r.parentId === panel.id) || {}).id;
const pl = ensureChildListTop(panel, null);
const cur = asIdList(pl.payload, true) || [];
const head = [bgId, ...order].filter((x) => x !== undefined && cur.includes(x));
setChildList(pl, [...head, ...cur.filter((x) => !head.includes(x))]);
console.log('  modal 子列表新顺序（前 6）：' + (asIdList(pl.payload, true) || []).slice(0, 6).map((id) => (g.recs.find((r) => r.id === id) || {}).name).join(' → '));

// ⑤ 自检 + 写盘
const chk = [];
for (const k of KEYS) {
  const rec = g.byName.get(k.name);
  const b0 = stateBlocks(rec.field.sub, [])[0];
  const x = pairVal(b0, 504, 0), y = pairVal(b0, 504, 1), w = pairVal(b0, 505, 0), h = pairVal(b0, 505, 1);
  const ids = asIdList(findChildListTop(rec.field.sub).payload, true) || [];
  const first = (g.recs.find((r) => r.id === ids[0]) || {}).name || (ids[0] === undefined ? '(空)' : '(新#' + ids[0] + ')');
  chk.push(k.name + ' (' + x + ',' + y + ') ' + w + 'x' + h + '  第1个子=' + first);
}
console.log('自检：');
for (const c of chk) console.log('  ' + c);
if (DRY) { console.log('--probe：不写文件'); process.exit(0); }

fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
const g2 = readGil(OUT);
console.log('输出：' + OUT + '  ' + fs.statSync(OUT).size + ' 字节  记录 ' + g2.recs.length);
