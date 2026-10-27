// tools/sim/white_blobs.mjs —— 找截图里的白色方块（占位图元 imageId=100001 渲染成白色），
// 报告每个白块的包围盒（屏幕左上原点 + 换算成左下原点）。
// 用法：node tools/sim/white_blobs.mjs <png>

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const png = process.argv[2];
const FF = process.env.FFMPEG || 'C:\\Users\\18182\\AppData\\Local\\Temp\\ffs\\node_modules\\ffmpeg-static\\ffmpeg.exe';
const raw = png.replace(/\.png$/i, '.raw');
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
const buf = fs.readFileSync(raw);
const W = 1600, H = 900;
const white = (x, y) => { const i = (y * W + x) * 3; return buf[i] > 215 && buf[i + 1] > 215 && buf[i + 2] > 215; };

const seen = new Uint8Array(W * H);
const comps = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const idx = y * W + x;
  if (seen[idx] || !white(x, y)) continue;
  const st = [idx]; seen[idx] = 1;
  let a = x, b = x, c2 = y, d = y, n = 0;
  while (st.length) {
    const cur = st.pop(); const cy = (cur / W) | 0, cx = cur - cy * W; n++;
    if (cx < a) a = cx; if (cx > b) b = cx; if (cy < c2) c2 = cy; if (cy > d) d = cy;
    for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!seen[ni] && white(nx, ny)) { seen[ni] = 1; st.push(ni); }
    }
  }
  if (n > 300) comps.push({ a, b, c: c2, d, w: b - a + 1, h: d - c2 + 1, n });
}
comps.sort((p, q) => q.n - p.n);
console.log('白块 ' + comps.length + ' 个');
console.log('  屏幕: x0 y0 x1 y1   宽x高   面积    |  左下原点: left bottom  (供与设计坐标比对)');
for (const k of comps) {
  const left = k.a, bottom = H - k.d - 1;
  console.log('  x ' + String(k.a).padStart(4) + ' ' + String(k.c).padStart(4) + ' .. '
    + String(k.b).padStart(4) + ' ' + String(k.d).padStart(4) + '   '
    + (k.w + 'x' + k.h).padStart(9) + ' ' + String(k.n).padStart(7)
    + '  | left=' + String(left).padStart(4) + ' bottom=' + String(bottom).padStart(4)
    + ' center=(' + (left + k.w / 2) + ',' + (bottom + k.h / 2) + ')');
}
fs.unlinkSync(raw);
