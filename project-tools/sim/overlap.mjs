// tools/sim/overlap.mjs —— 找出**中心落在棋盘范围内**的按钮
//
// 为什么要这个：真机截图里有几块按钮**压在棋盘上**（用户报"白色方块粘连"）。
// 与其反复截图量像素，不如直接从规划数据里算 —— 棋盘是个已知矩形，
// 任何按钮中心落进去就是摆错了。
//
// 用法：node tools/sim/overlap.mjs

import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/新建文件夹/miHoYo Launcher/qianxing-murdoku';
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/sim/out/layout-plan.json'), 'utf8'));
const byId = new Map(plan.nodes.map((n) => [n.id, n]));
const board = byId.get('board');

console.log('  画布 ' + plan.canvas.w + 'x' + plan.canvas.h);
console.log('  board  cx=' + board.cx + ' cy=' + board.cy + '  ' + board.w + 'x' + board.h);
const bx0 = board.cx - board.w / 2, bx1 = board.cx + board.w / 2;
const by0 = board.cy - board.h / 2, by1 = board.cy + board.h / 2;
console.log('  范围  x[' + bx0 + ',' + bx1 + ']  y[' + by0 + ',' + by1 + ']');

console.log('\n  [按钮] 中心落在棋盘里的：');
let n = 0;
for (const nd of plan.nodes) {
  if (nd.kind !== 'button') continue;
  if (nd.cx > bx0 && nd.cx < bx1 && nd.cy > by0 && nd.cy < by1) {
    console.log('    ' + nd.id.padEnd(24) + ' 父=' + String(nd.parent).padEnd(10)
      + ' c=(' + nd.cx + ',' + nd.cy + ') ' + nd.w + 'x' + nd.h
      + (nd.visible === false ? '  (隐藏)' : '  **可见**'));
    n++;
  }
}
console.log('  合计 ' + n + ' 个');

console.log('\n  [文本] 中心落在棋盘里的：');
let m = 0;
for (const nd of plan.nodes) {
  if (nd.kind !== 'text') continue;
  if (nd.cx > bx0 && nd.cx < bx1 && nd.cy > by0 && nd.cy < by1) {
    console.log('    ' + nd.id.padEnd(24) + ' 父=' + String(nd.parent).padEnd(10)
      + ' c=(' + nd.cx + ',' + nd.cy + ') ' + nd.w + 'x' + nd.h
      + (nd.visible === false ? '  (隐藏)' : '  **可见**'));
    m++;
  }
}
console.log('  合计 ' + m + ' 个');

console.log('\n  各面板位置：');
for (const id of ['topbar', 'toolbar', 'left', 'tray', 'clues', 'board', 'right', 'actions', 'intro', 'modal', 'ruler']) {
  const nd = byId.get(id);
  if (nd) console.log('    ' + id.padEnd(10) + ' cx=' + String(nd.cx).padStart(5) + ' cy=' + String(nd.cy).padStart(5)
    + '  ' + nd.w + 'x' + nd.h + (nd.visible === false ? '  (隐藏)' : ''));
}
