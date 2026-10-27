// tools/sim/where.mjs —— 算出**每个按钮在画布上的绝对位置**，并列出压在棋盘上的
//
// 为什么重写：我上一版相交诊断（`engine_adapter_qianxing.lua` 的 `diagnose_overlap`）
//   拿 `ctrl:GetAnchoredPosition()` 去和棋盘的坐标比 —— 但**那个 API 返回的是"相对各自父控件"
//   的偏移**，坐标原点根本不一样。结果真机日志报了 **100 个控件压在棋盘上**（全是误报），
//   而玩家在屏幕上真正看到的是 **2 条**。
//   ⇒ 教训：**比坐标之前先确认两者在同一坐标系**。这里改成"逐级往上累加父级偏移"，
//     算出真正的画布绝对坐标，再和棋盘的绝对矩形比。
//
// 用法：node tools/sim/where.mjs            （用规划数据，即 .gil 的几何来源）

import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/新建文件夹/miHoYo Launcher/qianxing-murdoku';
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/sim/out/layout-plan.json'), 'utf8'));
const byId = new Map(plan.nodes.map((n) => [n.id, n]));

// 规划里的 cx/cy 就是**画布绝对坐标**（中心点），所以不用累加 —— 直接比。
// 但 .gil 里存的是相对父级的；所以"规划"这一份本身已经是换算后的结果。
const board = byId.get('board');
const bx0 = board.cx - board.w / 2, bx1 = board.cx + board.w / 2;
const by0 = board.cy - board.h / 2, by1 = board.cy + board.h / 2;
console.log('  棋盘（画布绝对）：x[' + bx0 + ',' + bx1 + ']  y[' + by0 + ',' + by1 + ']');

console.log('\n  === 所有按钮的实际位置 ===');
const rows = [];
for (const n of plan.nodes) {
  if (n.kind !== 'button') continue;
  const inside = n.cx > bx0 && n.cx < bx1 && n.cy > by0 && n.cy < by1;
  rows.push({ id: n.id, parent: n.parent, cx: n.cx, cy: n.cy, w: n.w, h: n.h, inside, vis: n.visible !== false });
}
rows.sort((a, b) => b.cy - a.cy || a.cx - b.cx);
for (const r of rows) {
  const flag = r.inside ? (r.vis ? '❌ 压棋盘' : '（棋盘内但隐藏）') : '';
  console.log('    ' + r.id.padEnd(26) + ' 父=' + String(r.parent).padEnd(9)
    + ' (' + String(r.cx).padStart(5) + ',' + String(r.cy).padStart(5) + ') '
    + String(r.w).padStart(4) + 'x' + String(r.h).padEnd(4)
    + (r.vis ? '' : ' [隐藏]') + '  ' + flag);
}
const bad = rows.filter((r) => r.inside && r.vis);
console.log('\n  ⇒ **可见且压在棋盘上的按钮：' + bad.length + ' 个**：' + (bad.map((r) => r.id).join(', ') || '（无）'));

console.log('\n  === 各分区位置（用来核对"哪一条属于哪个区"）===');
for (const id of ['topbar', 'toolbar', 'actions', 'left', 'tray', 'clues', 'board', 'right', 'intro', 'modal']) {
  const n = byId.get(id);
  if (!n) continue;
  const inside = n.cx > bx0 && n.cx < bx1 && n.cy > by0 && n.cy < by1;
  console.log('    ' + id.padEnd(10) + ' (' + String(n.cx).padStart(5) + ',' + String(n.cy).padStart(5) + ') '
    + String(n.w).padStart(4) + 'x' + String(n.h).padEnd(4)
    + (n.visible === false ? ' [隐藏]' : '') + (inside ? '  ← 与棋盘相交' : ''));
}
