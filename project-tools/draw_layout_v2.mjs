// tools/draw_layout.mjs —— 生成「关卡内 UI 布局图（v2·按参考图）」PNG
//
// 依据（2026-10-02 用户给的两张参考 + 口头指令）：
//   参考 1 `美术参考/6DE4F26824AEADC920F326531D78219F.jpg`：整体布局
//   参考 2 `美术参考/EE68C9D6325964E79F019591CDC461DC.jpg`：✓/✗ 确认键的用法
//   指令：
//     · 左上只留「返回菜单」；标题 / 计时器在它下面
//     · 右上三个图标位置，**从上到下**改成：提交 / 重置关卡 / 撤销
//       （重置关卡用那个被标题挡住的 ↻ 图标）
//     · 右下保留「关卡进度 0/6 + 放大镜」
//     · ✓ / ✗ 同时绑到「返回菜单 / 提交 / 重置关卡」——点这三个键时出现，✓ 执行、✗ 取消
//     · **参考图里没提到的按键全部删除**
//
// 输出：docs/布局图-关卡内-v2.png

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', '布局图-关卡内-v3.png');

const W = 1600, H = 900;
const px = Buffer.alloc(W * H * 3, 255);

function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const i = (yy * W + xx) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  }
}
function strokeRect(x, y, w, h, c, t = 2) {
  fillRect(x, y, w, t, c); fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c); fillRect(x + w - t, y, t, h, c);
}
function dashedRect(x, y, w, h, c, t = 2, dash = 10) {
  for (let i = 0; i < w; i += dash * 2) { fillRect(x + i, y, Math.min(dash, w - i), t, c); fillRect(x + i, y + h - t, Math.min(dash, w - i), t, c); }
  for (let i = 0; i < h; i += dash * 2) { fillRect(x, y + i, t, Math.min(dash, h - i), c); fillRect(x + w - t, y + i, t, Math.min(dash, h - i), c); }
}
function disc(cx, cy, r, c) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) fillRect(cx + x, cy + y, 1, 1, c);
}

const F = {
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11111','00010','00100','00010','00001','10001','01110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','11110','00001','00001','10001','01110'],
  '6':['00110','01000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00010','01100'],
  'A':['01110','10001','10001','11111','10001','10001','10001'],
  'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01110','10001','10000','10000','10000','10001','01110'],
  'D':['11110','10001','10001','10001','10001','10001','11110'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],
  'F':['11111','10000','10000','11110','10000','10000','10000'],
  'G':['01110','10001','10000','10111','10001','10001','01111'],
  'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['01110','00100','00100','00100','00100','00100','01110'],
  'J':['00111','00010','00010','00010','00010','10010','01100'],
  'K':['10001','10010','10100','11000','10100','10010','10001'],
  'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10101','10001','10001','10001'],
  'N':['10001','11001','10101','10011','10001','10001','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'P':['11110','10001','10001','11110','10000','10000','10000'],
  'Q':['01110','10001','10001','10001','10101','10010','01101'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01111','10000','10000','01110','00001','00001','11110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],
  'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','11011','10001'],
  'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],
  'Z':['11111','00001','00010','00100','01000','10000','11111'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
  '.':['00000','00000','00000','00000','00000','01100','01100'],
  ':':['00000','01100','01100','00000','01100','01100','00000'],
  '/':['00001','00010','00010','00100','01000','01000','10000'],
  '(':['00010','00100','01000','01000','01000','00100','00010'],
  ')':['01000','00100','00010','00010','00010','00100','01000'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  '+':['00000','00100','00100','11111','00100','00100','00000'],
  '=':['00000','00000','11111','00000','11111','00000','00000'],
  '?':['01110','10001','00001','00110','00100','00000','00100'],
  '!':['00100','00100','00100','00100','00100','00000','00100'],
  '*':['00000','10101','01110','11111','01110','10101','00000'],
  '>':['01000','00100','00010','00001','00010','00100','01000'],
  '<':['00010','00100','01000','10000','01000','00100','00010'],
  '|':['00100','00100','00100','00100','00100','00100','00100'],
  ',':['00000','00000','00000','00000','01100','01100','01000'],
};
function text(s, x, y, sc, c) {
  let cx = x;
  for (const ch of String(s).toUpperCase()) {
    const g = F[ch];
    if (g) for (let r = 0; r < 7; r++) for (let col = 0; col < 5; col++) if (g[r][col] === '1') fillRect(cx + col * sc, y + r * sc, sc, sc, c);
    cx += 6 * sc;
  }
}
const tw = (s, sc) => String(s).length * 6 * sc;

const C = {
  bg: [243, 236, 220], card: [24, 24, 28], cardTxt: [235, 235, 235],
  gold: [246, 232, 190], iconBg: [30, 30, 34], iconOn: [245, 245, 245],
  boardBg: [30, 30, 30], roomA: [214, 199, 176], roomB: [156, 196, 232], roomC: [150, 200, 140],
  furn: [232, 226, 205], ink: [40, 36, 30], sub: [110, 100, 86],
  mark: [150, 170, 190], white: [255, 255, 255],
};

fillRect(0, 0, W, H, C.bg);
fillRect(16, 16, W - 32, H - 32, [246, 240, 226]);
strokeRect(16, 16, W - 32, H - 32, [214, 200, 170], 3);

function iconBox(x, y, s, glyph, on = true) {
  fillRect(x, y, s, s, on ? C.iconBg : [205, 205, 208]);
  strokeRect(x, y, s, s, [90, 90, 95], 2);
  const sc = Math.max(2, Math.floor(s / 16));
  const gp = F[glyph] ? glyph : '?';
  text(gp, x + (s - tw(gp, sc)) / 2, y + (s - 7 * sc) / 2, sc, C.iconOn);
}

// ① 左上：返回菜单
iconBox(60, 48, 62, '<');
text('BACK TO MENU', 134, 64, 3, C.ink);

// ② ✓ / ✗（虚线 = 默认隐藏，点危险键时出现）
dashedRect(430, 46, 150, 66, C.mark, 2, 8);
iconBox(438, 52, 54, 'Y', false);
iconBox(500, 52, 54, 'X', false);
text('APPEARS WHEN SUBMIT / RESET / BACK IS PRESSED', 596, 60, 1, C.sub);
text('Y = EXECUTE     X = CANCEL', 596, 76, 1, C.sub);

// ③ 标题 / 计时器
text('TITLE  (LEVEL NAME)', 60, 140, 4, C.ink);
text('TIMER  00:33', 60, 190, 4, C.ink);

// ④ 线索卡
const CLX = 60, CLY = 262, CLW = 380, CLH = 88;
text('SCROLLING CLUE CARDS', CLX, CLY - 24, 2, C.sub);
  text('EACH CARD = AVATAR + CLUE TEXT  (MERGED, NO SEPARATE TRAY)', CLX, CLY - 40, 1, C.sub);
for (let i = 0; i < 5; i++) {
  const y = CLY + i * (CLH + 10);
  fillRect(CLX, y, CLW, CLH, C.card);
  strokeRect(CLX, y, CLW, CLH, i === 1 ? C.white : [70, 70, 74], i === 1 ? 3 : 1);
  disc(CLX + 44, y + CLH / 2, 26, [120, 200, 210]);
  text('SUSPECT ' + String.fromCharCode(65 + i), CLX + 84, y + 22, 2, C.cardTxt);
  text('CLUE TEXT HERE', CLX + 84, y + 48, 2, C.cardTxt);
  text('AVATAR + TEXT IN ONE CARD', CLX + 84, y + 66, 1, [150, 150, 155]);
  fillRect(CLX + CLW - 46, y + CLH - 38, 34, 28, C.gold);
  text(String.fromCharCode(65 + i), CLX + CLW - 38, y + CLH - 34, 2, C.ink);
}

// ⑤ 右上三个键：提交 / 重置关卡 / 撤销
const IX = W - 152, IY = 48, IS = 70, IGAP = 26;
text('RIGHT TOP  (TOP -> BOTTOM)', IX - 210, IY - 22, 2, C.sub);
iconBox(IX, IY, IS, 'S');
text('SUBMIT', IX - 104, IY + 28, 2, C.ink);
iconBox(IX, IY + IS + IGAP, IS, 'R');
text('RESET LEVEL', IX - 160, IY + IS + IGAP + 28, 2, C.ink);
iconBox(IX, IY + (IS + IGAP) * 2, IS, 'U');
text('UNDO', IX - 84, IY + (IS + IGAP) * 2 + 28, 2, C.ink);

// ⑥ 棋盘（房间底色 + 家具 + 房名）
const BX = 620, BY = 150, BW = 560, BH = 560;
fillRect(BX - 12, BY - 12, BW + 24, BH + 24, C.boardBg);
const N = 6, cell = BW / N;
const roomColor = (r, c) => {
  if (r <= 2 && c >= 3) return C.roomC;
  if (r <= 2) return C.roomB;
  if (r >= 4) return C.roomC;
  return C.roomA;
};
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  const x = BX + c * cell, y = BY + r * cell;
  fillRect(x, y, cell, cell, roomColor(r, c));
  strokeRect(x, y, cell, cell, [40, 40, 40], 2);
}
for (const [r, c] of [[1, 3], [1, 4], [2, 1], [3, 3], [3, 4], [4, 2], [5, 1], [5, 4]]) {
  const x = BX + c * cell + cell * 0.2, y = BY + r * cell + cell * 0.2;
  fillRect(x, y, cell * 0.6, cell * 0.6, C.furn);
  strokeRect(x, y, cell * 0.6, cell * 0.6, [150, 140, 120], 2);
}
text('BEDROOM', BX + 3 * cell + 8, BY + 1 * cell + 8, 1, C.ink);
text('KITCHEN', BX + 4 * cell + 8, BY + 2 * cell + 8, 1, C.ink);
text('DINING', BX + 1 * cell + 8, BY + 3 * cell + 8, 1, C.ink);
text('HALL', BX + 1 * cell + 8, BY + 4 * cell + 8, 1, C.ink);
text('COURT', BX + 3 * cell + 8, BY + 4 * cell + 8, 1, C.ink);

// ⑦ 右下：关卡进度 + 0/6 + 放大镜
// ★ 2026-10-02 用户要求：右下（0/6 + 放大镜）的**右边缘与右上三键的右边缘对齐**
//   右上三键：x = IX = W-152, 尺寸 IS = 70  ⇒ 右边缘 = W-82
//   ⇒ 右下这一组整体右对齐到同一条竖线（放大镜与三键**同列同尺寸**）
const RB = IX + IS;                         // 右边缘基准线 = 1518
iconBox(IX, 694, IS, 'Q');                  // 放大镜：与右上三键同 x、同尺寸
text('MAGNIFIER = HINT (KEPT)', RB - tw('MAGNIFIER = HINT (KEPT)', 2), 792, 2, C.sub);
text('LEVEL PROGRESS', RB - tw('LEVEL PROGRESS', 3), 664, 3, C.ink);
text('0 / 6', IX - 24 - tw('0 / 6', 3), 722, 3, C.ink);   // 数字右对齐到放大镜左侧留 24px

// ⑧ 说明
text('DELETED: REVEAL / SHARE / SCORE / VIOLATIONS / TOAST / OLD RESET / OLD SUBMIT', 620, 754, 1, C.sub);
text('CONFIRM FLOW: BACK-TO-MENU | SUBMIT | RESET-LEVEL  ->  SHOW Y / X  ->  Y EXECUTES, X CANCELS', 620, 770, 1, C.sub);
text('TOTAL INTERACTIVE KEYS = 7  (BACK, Y, X, SUBMIT, RESET, UNDO, MAGNIFIER)', 620, 806, 1, C.sub);
text('NOTE: THE SUSPECT TRAY IS GONE - - - AVATARS LIVE INSIDE THE SCROLLING CLUE CARDS', 620, 822, 1, C.sub);

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xFF; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(OUT, png);
console.log('  OK ' + path.relative(ROOT, OUT) + '  ' + Math.round(png.length / 1024) + ' KB  ' + W + 'x' + H);
