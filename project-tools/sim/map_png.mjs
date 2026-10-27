// tools/sim/map_png.mjs —— 打印截图的 ASCII 分布图 + 主色直方图
// 用法：node tools/sim/map_png.mjs <png> [cols] [rows]

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const png = process.argv[2];
const COLS = +(process.argv[3] || 96);
const ROWS = +(process.argv[4] || 40);
const FF = process.env.FFMPEG || 'C:\\Users\\18182\\AppData\\Local\\Temp\\ffs\\node_modules\\ffmpeg-static\\ffmpeg.exe';
const raw = png.replace(/\.png$/i, '.raw');
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
const buf = fs.readFileSync(raw);
const W = 1600, H = 900;
const at = (x, y) => { const i = (y * W + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };

// 直方图（量化到 16 级）
const hist = new Map();
for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
  const [r, g, b] = at(x, y);
  const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
  hist.set(k, (hist.get(k) || 0) + 1);
}
const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
const unq = (k) => [((k >> 8) & 15) * 16 + 8, ((k >> 4) & 15) * 16 + 8, (k & 15) * 16 + 8];
console.log('主色（量化后，占比）:');
for (const [k, n] of top) {
  const [r, g, b] = unq(k);
  console.log('  rgb(' + [r, g, b].map((v) => String(v).padStart(3)).join(',') + ')  '
    + ((n / (W * H / 4) * 100).toFixed(2) + '%').padStart(7) + '   #'
    + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''));
}

// ASCII 图：按亮度/饱和度分档
console.log('\n分布图（上=屏幕上边，左下原点坐标标注在两侧）:');
const cw = W / COLS, ch = H / ROWS;
let header = '     ';
for (let c = 0; c < COLS; c++) header += (c % 10 === 0) ? String(Math.round(c * cw / 100) % 10) : ' ';
console.log(header + '   ← 屏幕 x（×100px）');
for (let r = 0; r < ROWS; r++) {
  let line = '';
  for (let c = 0; c < COLS; c++) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    const x0 = Math.floor(c * cw), x1 = Math.max(x0 + 1, Math.floor((c + 1) * cw));
    const y0 = Math.floor(r * ch), y1 = Math.max(y0 + 1, Math.floor((r + 1) * ch));
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const p = at(x, y); sr += p[0]; sg += p[1]; sb += p[2]; n++; }
    const R = sr / n, G = sg / n, B = sb / n;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    const sat = mx - mn, lum = (R + G + B) / 3;
    let ch2 = '.';
    if (sat > 45 && B > R) ch2 = lum > 120 ? '#' : (lum > 80 ? '+' : 'o');   // 偏蓝的按钮/图片
    else if (sat > 45 && R > B) ch2 = 'R';                                    // 偏红
    else if (lum > 150) ch2 = ':';                                            // 亮（文字/白）
    else if (lum > 95) ch2 = ',';                                             // 中
    line += ch2;
  }
  const yBottom = 900 - Math.round((r + 1) * ch);
  console.log(String(yBottom).padStart(4) + ' ' + line);
}
fs.unlinkSync(raw);
