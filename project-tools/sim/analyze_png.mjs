// tools/sim/analyze_png.mjs —— 把截图里「非背景」的色块找出来，报告包围盒
// 用法：node tools/sim/analyze_png.mjs <png>

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const png = process.argv[2];
if (!png) { console.error('用法: node analyze_png.mjs <png>'); process.exit(1); }
const FF = process.env.FFMPEG || 'C:\\Users\\18182\\AppData\\Local\\Temp\\ffs\\node_modules\\ffmpeg-static\\ffmpeg.exe';
const raw = png.replace(/\.png$/i, '.raw');
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
const buf = fs.readFileSync(raw);

// 读尺寸（ffmpeg 把信息写 stderr 并以 1 退出，是正常行为）
let W = 0, H = 0;
let info = '';
try { execFileSync(FF, ['-hide_banner', '-i', png], { stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (e) { info = String(e.stderr || ''); }
const m = info.match(/,\s*(\d{2,5})x(\d{2,5})/);
if (m) { W = +m[1]; H = +m[2]; }
if (!W || !H) { W = 1600; H = Math.round(buf.length / 3 / W); }

console.log('图像 ' + W + 'x' + H + '  像素 ' + (buf.length / 3));

const at = (x, y) => { const i = (y * W + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };

// 背景 = 四角平均
const corners = [at(2, 2), at(W - 3, 2), at(2, H - 3), at(W - 3, H - 3)];
const bg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, c) => s + c[k], 0) / corners.length));
console.log('背景色 ≈ rgb(' + bg.join(',') + ')');

const isFg = (x, y) => {
  const [r, g, b] = at(x, y);
  return Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 60;
};

// 连通域（4 邻域，栈式）
const seen = new Uint8Array(W * H);
const comps = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const idx = y * W + x;
  if (seen[idx] || !isFg(x, y)) continue;
  const stack = [idx]; seen[idx] = 1;
  let minX = x, maxX = x, minY = y, maxY = y, n = 0;
  let sr = 0, sg = 0, sb = 0;
  while (stack.length) {
    const cur = stack.pop();
    const cy = (cur / W) | 0, cx = cur - cy * W;
    n++;
    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
    const px = at(cx, cy); sr += px[0]; sg += px[1]; sb += px[2];
    const nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni] || !isFg(nx, ny)) continue;
      seen[ni] = 1; stack.push(ni);
    }
  }
  if (n >= 200) comps.push({ minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, n,
    rgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] });
}
comps.sort((a, b) => b.n - a.n);
console.log('\n找到 ' + comps.length + ' 个色块（面积>=200），按面积降序，前 20 个:');
console.log('  屏幕左上角包围盒           宽x高     面积   平均色            左下角(以图高换算)');
for (const k of comps.slice(0, 20)) {
  const bl = H - k.maxY - 1;
  console.log('  x=' + String(k.minX).padStart(4) + ' y=' + String(k.minY).padStart(4)
    + ' .. x=' + String(k.maxX).padStart(4) + ' y=' + String(k.maxY).padStart(4)
    + '  ' + String(k.w).padStart(4) + 'x' + String(k.h).padEnd(4)
    + ' ' + String(k.n).padStart(7) + '  rgb(' + k.rgb.join(',') + ')'.padEnd(4)
    + '  y_bottom=' + String(bl).padStart(4));
}
fs.unlinkSync(raw);
