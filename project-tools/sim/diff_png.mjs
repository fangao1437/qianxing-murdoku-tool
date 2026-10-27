// tools/sim/diff_png.mjs —— 比较两张同尺寸截图，报告差异像素的包围盒
// 用法：node tools/sim/diff_png.mjs a.png b.png

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const FF = process.env.FFMPEG || 'C:\\Users\\18182\\AppData\\Local\\Temp\\ffs\\node_modules\\ffmpeg-static\\ffmpeg.exe';
const [a, b] = process.argv.slice(2);
const raw = (p) => {
  const out = p.replace(/\.png$/i, '.' + Math.random().toString(36).slice(2) + '.raw');
  execFileSync(FF, ['-y', '-loglevel', 'error', '-i', p, '-f', 'rawvideo', '-pix_fmt', 'rgb24', out]);
  const buf = fs.readFileSync(out);
  fs.unlinkSync(out);
  return buf;
};
const A = raw(a), B = raw(b);
const W = 1600, H = 900;
if (A.length !== B.length) { console.log('尺寸不同，无法比较'); process.exit(1); }

let n = 0, minX = W, maxX = -1, minY = H, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) {
      n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
console.log('差异像素 ' + n + ' 个');
if (n === 0) { console.log('两张图完全相同'); process.exit(0); }
console.log('屏幕包围盒: x ' + minX + '..' + maxX + '  y ' + minY + '..' + maxY);
console.log('画布坐标（左下原点）: x ' + minX + '..' + maxX + '  y ' + (H - maxY - 1) + '..' + (H - minY - 1));
// 按行统计，找出"变化最密集的几条带"
const rows = [];
for (let y = minY; y <= maxY; y++) {
  let c = 0;
  for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2]) c++; }
  if (c > 0) rows.push({ y, c });
}
rows.sort((p, q) => q.c - p.c);
console.log('变化最多的 8 行（屏幕 y / 画布 y / 该行变化像素数）:');
for (const r of rows.slice(0, 8)) {
  console.log('  屏幕 y=' + String(r.y).padStart(3) + '  画布 y=' + String(H - r.y - 1).padStart(3) + '   变化 ' + r.c);
}
