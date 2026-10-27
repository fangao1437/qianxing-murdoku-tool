// tools/gil/move_side_buttons.mjs —— 把「撤销 / 提交 / 揭示」挪到**右侧竖排**（参考执律庭实习）
//
// 背景：用户确定的映射（2026-09-30）——
//   重做 → 已被「重置关卡」占用、提示 → 已被右下角放大镜占用
//   ⇒ 剩下 **撤销 / 提交 / 揭示** 放右侧三个六边形位置。
//
// 为什么走"直改控件"而不是脚本：见 `docs/工作约定-优先直改控件.md` ——
//   几何是静态数据，改 `.gil` 一步到位；走脚本要"创建→找→设→每帧维持"，环节多、易错。
//
// ⚠️ 关键（踩过两次）：**记录里的 `#504` 才是真正的父级引用**，
//   只改父控件的子列表、不改 `#504` ⇒ 编辑器里看不到这个控件。
//   本工具**两处都改**。
//
// 用法：
//   node tools/gil/move_side_buttons.mjs --in=完整界面33-主页可用.gil --out=完整界面34.gil

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readGil, encodeMsg, setPair, pairOf, pairValue, stateBlocks,
  findChildList, findChildListTop, ensureChildListTop, setChildList, asIdList,
} from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const IN = argOf('in') || path.join(ROOT, '完整界面33-主页可用.gil');
const OUT = argOf('out') || path.join(ROOT, '完整界面34-右侧三按钮.gil');

// 设计坐标（1920×1080）。
//
// ★★★ 2026-09-30：**这个工具现在管两批挪位**（原来只管右侧三按钮）：
//   ① 右侧竖排三个（撤销/提交/揭示）—— 上一轮做的
//   ② 按参考图重排的四个 —— 本轮：
//        左上  action.back（返回列表）+ action.redo（重置关卡）
//        右下  hud.progress（计数）+ action.hint（放大镜）
//      参考图右上还有「0/6 + 放大镜」，正好对应我们这两个。
//
//   布局常量必须和 `lua/ui_controller.lua` 里那份**同源**（`right` 面板 x=1420 y=128 w=460 h=880）。
const RIGHT = { x: 1420, y: 128, w: 460, h: 880 };
const X = 1790, W = 110, H = 110;
const TARGETS = [
  // ① 右侧竖排三个
  { id: 'action.undo',   parent: 'root',   x: X, y: 390, w: W, h: H },
  { id: 'action.submit', parent: 'root',   x: X, y: 540, w: W, h: H },
  { id: 'action.reveal', parent: 'root',   x: X, y: 690, w: W, h: H },
  // ② 左上：返回列表 + 重置关卡（参考图左上那两个）
  { id: 'action.back',   parent: 'topbar', x: 24, y: 24, w: 300, h: 60 },
  { id: 'action.redo',   parent: 'topbar', x: 24, y: 94, w: 300, h: 60 },
  // ③ 右下：计数 + 放大镜（参考图右下那两个）
  { id: 'hud.progress',  parent: 'right',  x: RIGHT.x + 20, y: RIGHT.y + RIGHT.h - 150, w: 260, h: 44 },
  { id: 'action.hint',   parent: 'right',  x: RIGHT.x + RIGHT.w - 140, y: RIGHT.y + RIGHT.h - 160, w: 110, h: 110 },
];

const g = readGil(IN);
const byId = new Map(g.recs.map((r) => [r.id, r]));
const rootRec = g.byName.get('root');
if (!rootRec) { console.error('❌ 找不到 root'); process.exit(3); }

// ── 工具函数 ──────────────────────────────────────────────────────────────
function setGeom(fields, x, y, w, h) {
  let n = 0;
  for (const b of stateBlocks(fields, [])) {
    const p5 = pairOf(b, 505);
    if (p5) { setPair(p5, w, h); n++; }
    const p4 = pairOf(b, 504);
    if (p4) { setPair(p4, x, y); n++; }
  }
  return n;
}

function ensureChildList(rec) {
  let l = findChildListTop(rec.field.sub);
  if (!l) {
    const src = g.recs.map((r) => findChildList(r.field.sub, true)).find(Boolean);
    if (src) {
      const f = JSON.parse(JSON.stringify({ field: src.field }));
      // 用 cloneField 更稳，但这里手搓一个最小结构也行：直接复用同字段号
      rec.field.sub.push({ field: src.field, wt: 2, sub: null, num: 0n, payload: Buffer.alloc(0), len: 0, isText: false });
      l = findChildList(rec.field.sub, true);
    }
  }
  return l;
}

function listOf(rec) {
  const l = ensureChildList(rec);
  return l ? (asIdList(l.payload, true) || []) : [];
}
function setList(rec, ids) {
  const l = ensureChildList(rec);
  if (l) setChildList(l, ids);
}

// 把 `#504` 改成新的父级（**这是编辑器认的那个**）
function setParentField(rec, parentId) {
  let done = false;
  (function walk(fs) {
    for (const f of fs) {
      if (f.wt === 0 && f.field === 504) { f.num = BigInt(parentId); done = true; return true; }
    }
    return false;
  })(rec.field.sub);
  return done;
}

// ── 挪动 ──────────────────────────────────────────────────────────────────
const moved = [];
for (const t of TARGETS) {
  const rec = g.byName.get(t.id);
  if (!rec) { console.log('  ⚠️ 找不到 ' + t.id + '（跳过）'); continue; }
  const oldParent = byId.get(rec.parentId);
  const oldName = oldParent ? oldParent.name : '?';
  // 目标父级由表里的 `parent` 指定（原来写死 root —— 现在左上要挂 topbar、
  // 右下要挂 right，所以必须按目标走）。找不到就退回 root，并**说清楚**。
  let targetRec = g.byName.get(t.parent) || null;
  if (targetRec == null) {
    console.log('  ⚠️ ' + t.id + ' 目标父级 `' + t.parent + '` 不存在，退回 root');
    targetRec = rootRec;
  }

  // ① 从旧父级的子列表里摘掉
  if (oldParent && oldParent.id !== targetRec.id) {
    const ids = listOf(oldParent).filter((i) => i !== rec.id);
    setList(oldParent, ids);
  }
  // ② 改 `#504` 指向新父级
  setParentField(rec, targetRec.id);
  rec.parentId = targetRec.id;
  // ③ 加进新父级的子列表
  const rids = listOf(targetRec);
  if (!rids.includes(rec.id)) { rids.push(rec.id); setList(targetRec, rids); }
  // ④ 几何
  const n = setGeom(rec.field.sub, t.x, t.y, t.w, t.h);

  moved.push({ id: t.id, from: oldName, to: targetRec.name, pairs: n });
  console.log('  ✅ ' + t.id.padEnd(16) + ' ' + oldName + ' → ' + targetRec.name
    + '   位置=(' + t.x + ',' + t.y + ') 尺寸=' + t.w + 'x' + t.h + '  改了 ' + n + ' 组坐标');
  if (n < 4) console.log('     ⚠️ 坐标组数不足 4（可能有字段没找到），请回读确认');
}

const body = encodeMsg(g.tree);
const outBuf = g.pack(body);
fs.writeFileSync(OUT, outBuf);

// ── 回读验证（**必须**：只看"写成功"不够）──────────────────────────────
const g2 = readGil(OUT);
const b2 = new Map(g2.recs.map((r) => [r.id, r]));
const tr = outBuf.subarray(outBuf.length - g.trailer.length);
console.log('\n输出：' + path.basename(OUT));
console.log('  文件 ' + outBuf.length + '（+' + (outBuf.length - g.src.length) + '）');
console.log('  尾 ' + tr.toString('hex') + (tr.equals(g.trailer) ? '  ✅' : '  ❌')
  + '   控件记录 ' + g2.recs.length + '（+' + (g2.recs.length - g.recs.length) + '）');

let bad = 0;
for (const t of TARGETS) {
  const r = g2.byName.get(t.id);
  if (!r) { bad++; console.log('  ❌ ' + t.id + ' 丢了'); continue; }
  const p = b2.get(r.parentId);
  // ★ 校验要按**这一项自己的目标父级**比，不能写死 root
  //   —— 原来写死 root，加进左上/右下的挪位之后全报 ❌（其实都挪对了）。
  let pos = '?', size = '?';
  for (const st of stateBlocks(r.field.sub, [])) {
    const p4 = pairOf(st, 504), p5 = pairOf(st, 505);
    if (p4) pos = pairValue(p4, 0) + ',' + pairValue(p4, 1);
    if (p5) size = pairValue(p5, 0) + 'x' + pairValue(p5, 1);
  }
  const okParent = p && p.name === t.parent;
  const okGeom = pos === (t.x + ',' + t.y) && size === (t.w + 'x' + t.h);
  const ok = okParent && okGeom;
  if (!ok) bad++;
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + t.id.padEnd(16) + '父级=' + (p ? p.name : '?')
    + '(期望 ' + t.parent + ')  位置=' + pos + '(期望 ' + t.x + ',' + t.y + ') 尺寸=' + size);
}
console.log('\n' + (bad === 0 ? '★ ' + TARGETS.length + ' 个控件都挪到位了（编辑器里能看到）' : '❌ 有 ' + bad + ' 个没挂对'));
process.exit(bad === 0 ? 0 : 4);
