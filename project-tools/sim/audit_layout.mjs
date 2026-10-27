// tools/sim/audit_layout.mjs —— **UI 布局现状盘点**
//
// 为什么要有它：接下来要改主页/选关/关卡三处的布局，**不先看清楚就改就是盲改**。
// 模拟器**不能出图**（`requestScreenshot` 在离线环境返回 null），所以走另一条路：
//   ① 把每个页面**画成 ASCII 布局图**（一眼看出东西在哪、挤不挤）
//   ② 自动查几类问题：出画布、太小点不到、重叠、间距不均
//
// 用法：
//   node tools/sim/audit_layout.mjs            # 三个页面都盘
//   node tools/sim/audit_layout.mjs --page=home

import path from 'node:path';
import { makeController, loadPlan, buildProject, indexTree, textOf, WORKSPACE } from './kit.mjs';

const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const WANT = argOf('page');

const CANVAS_W = 1600, CANVAS_H = 900;

// ★ 真实父子关系（来自布局计划）—— 用来消掉"父子必然重叠"这类假阳性。
//   我第一版用 id 前缀猜父子（`a.startsWith(b + '.')`），但 `clues` 和 `clue.1`
//   这种根本猜不出来（一个是容器、一个是它的行），于是报了 92 条噪音。
const PLAN = loadPlan();
const PARENT = new Map();
for (const n of (PLAN.nodes || [])) PARENT.set(n.id, n.parent || null);
function isAncestor(a, b) {
  let cur = PARENT.get(b), guard = 0;
  while (cur != null && guard++ < 24) { if (cur === a) return true; cur = PARENT.get(cur); }
  return false;
}
function related(a, b) { return isAncestor(a, b) || isAncestor(b, a); }

// 自动查问题时**故意忽略**的 id —— 这些都是"设计上就该重叠/很小"的
const IGNORE = [
  /^cell\.\d+\.\d+\./,        // 格子内部零件（face/note/x/wall/door/obj）本来就叠在格子上
  /^clue\.\d+\./,             // 线索卡的 who/what/face/badge 叠在行底板上
  /^(ruler|tray)\./,
  /\.(face|note|label|bg|text|what|who|badge|hex\d|hexbg)$/,
  /^容器节点$/,               // 导入素材带进来的无名容器
];
const ignored = (id) => IGNORE.some((re) => re.test(id));

/** 是不是"离屏停放的调色板"（assets/portrait.* 放在 2995,2995 是故意的） */
const isParked = (it) => it.x > 1500 && it.y > 1500;
/** 是不是"全屏背景容器"（root/topbar 这种铺满屏幕的，画图时只会把格子涂满） */
const isBackdrop = (it) => it.w > CANVAS_W * 0.85 || it.h > CANVAS_H * 0.85;

async function main() {
  const c = await makeController();
  buildProject(c, loadPlan(), path.join(WORKSPACE, 'dist', 'client_script.lua'));
  const get = async () => { const g = await c.play('get', { inspect: true }); return g && g.result ? g.result : g; };
  const tick = async (dt) => { await c.play('step', { dt }); };
  const click = async (n) => { await c.play('click', { name: n }); };

  await c.play('start', {}); await tick(0.3);

  const pages = [];
  // 主页
  pages.push({ name: 'home', label: '主页', go: async () => {} });
  // 选关
  pages.push({ name: 'select', label: '选关', go: async () => { await click('home.select'); await tick(0.35); } });
  // 关卡内
  pages.push({
    name: 'level', label: '关卡内',
    go: async () => {
      await click('home.select'); await tick(0.3);
      await click('select.card.2'); await tick(0.3);
      await click('intro.skip'); await tick(0.3);
    },
  });

  for (const p of pages) {
    if (WANT && WANT !== p.name) continue;
    await p.go();
    const ri = await get();
    const idx = indexTree(ri);
    // 只取"可见 + 有盒子"的
    const items = [];
    for (const [id, k] of idx) {
      if (k.visible !== true || !k.box) continue;
      const b = k.box;
      items.push({ id, x: b.left, y: b.bottom, w: b.width, h: b.height, text: textOf(ri, id) });
    }
    report(p, items);
  }
  process.exit(0);
}

function report(p, items) {
  console.log('\n════════ ' + p.label + '（' + p.name + '）  可见控件 ' + items.length + ' 个 ════════');

  // ① ASCII 布局图：32×14 格，每格 50×64 画布像素
  const COLS = 32, ROWS = 14;
  const cw = CANVAS_W / COLS, ch = CANVAS_H / ROWS;
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
  // 用 id 首字母做标记；同一格被多个控件占就显示 '*'
  for (const it of items) {
    if (ignored(it.id) || isParked(it) || isBackdrop(it)) continue;
    const c0 = Math.max(0, Math.min(COLS - 1, Math.floor(it.x / cw)));
    const c1 = Math.max(0, Math.min(COLS - 1, Math.ceil((it.x + it.w) / cw) - 1));
    const r1 = Math.max(0, Math.min(ROWS - 1, Math.floor((CANVAS_H - it.y - it.h) / ch)));
    const r0 = Math.max(0, Math.min(ROWS - 1, Math.ceil((CANVAS_H - it.y) / ch) - 1));
    const ch2 = it.id.replace(/[^a-zA-Z]/g, '').charAt(0).toUpperCase() || '?';
    for (let r = r1; r <= r0; r++) for (let cc = c0; cc <= c1; cc++) {
      grid[r][cc] = grid[r][cc] === ' ' ? ch2 : '*';
    }
  }
  console.log('  ┌' + '─'.repeat(COLS) + '┐   （每格 50×64 画布像素；* = 重叠）');
  for (let r = 0; r < ROWS; r++) console.log('  │' + grid[r].join('') + '│');
  console.log('  └' + '─'.repeat(COLS) + '┘');

  // ② 问题检查
  const probs = [];
  for (const it of items) {
    if (isParked(it)) continue;
    if (it.x < -2 || it.y < -2 || it.x + it.w > CANVAS_W + 2 || it.y + it.h > CANVAS_H + 2) {
      if (!ignored(it.id)) probs.push('出画布：' + it.id + ' (' + fmt(it) + ')');
    }
    if (it.w > 0 && it.h > 0 && (it.w < 44 || it.h < 44) && /^action\.|^home\.|^select\.card\.\d+$/.test(it.id)) {
      probs.push('太小点不到：' + it.id + ' ' + it.w + '×' + it.h);
    }
  }
  // 重叠（同层、非父子、且都没被忽略）
  const real = items.filter((i) => !ignored(i.id) && !isParked(i) && !isBackdrop(i));
  for (let a = 0; a < real.length; a++) for (let b = a + 1; b < real.length; b++) {
    const A = real[a], B = real[b];
    if (related(A.id, B.id)) continue;                       // 父子/祖孙：本来就该叠
    const contains = A.x <= B.x + 2 && A.y <= B.y + 2
      && A.x + A.w >= B.x + B.w - 2 && A.y + A.h >= B.y + B.h - 2;
    const containsR = B.x <= A.x + 2 && B.y <= A.y + 2
      && B.x + B.w >= A.x + A.w - 2 && B.y + B.h >= A.y + A.h - 2;
    if (contains || containsR) continue;                     // 一个把另一个整个包住：不是"叠"
    // ★ 没有底图的容器**不可能遮挡**（它只是给子控件分组的框）——
    //   `right` / `topbar` / `left` / `board` 都是这种，报它们纯属噪音。
    const opaque = (id) => {
      const n = PLAN.nodes.find((x) => x.id === id);
      return !(n && n.kind === 'container' && n.image_id === undefined && n.text === undefined);
    };
    if (!opaque(A.id) || !opaque(B.id)) continue;
    const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
    if (ox > 4 && oy > 4) {
      const area = ox * oy, small = Math.min(A.w * A.h, B.w * B.h);
      if (area > small * 0.5) probs.push('重叠过半：' + A.id + ' ↔ ' + B.id + '  (' + ox + '×' + oy + ')');
    }
  }
  if (probs.length === 0) console.log('\n  ✅ 没查出问题（出画布/太小/重叠过半）');
  else {
    console.log('\n  ⚠️ 查出 ' + probs.length + ' 条：');
    for (const s of probs.slice(0, 24)) console.log('    · ' + s);
    if (probs.length > 24) console.log('    … 还有 ' + (probs.length - 24) + ' 条');
  }

  // ③ 主要控件清单（按位置从上到下、从左到右）
  const list = items.filter((i) => !ignored(i.id) && !isParked(i) && !isBackdrop(i)).sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.x - b.x);
  console.log('\n  控件清单（上→下、左→右）：');
  for (const it of list.slice(0, 40)) {
    console.log('    ' + it.id.padEnd(22) + ' 位置 ' + String(Math.round(it.x)).padStart(4) + ',' + String(Math.round(it.y)).padStart(4)
      + '  尺寸 ' + String(Math.round(it.w)).padStart(4) + '×' + String(Math.round(it.h)).padStart(3)
      + (it.text ? '  「' + String(it.text).slice(0, 16) + '」' : ''));
  }
  if (list.length > 40) console.log('    … 还有 ' + (list.length - 40) + ' 个');
}

const fmt = (i) => Math.round(i.x) + ',' + Math.round(i.y) + ' ' + Math.round(i.w) + '×' + Math.round(i.h);

await main();
