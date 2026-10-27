// tools/qx/make_icons.mjs —— 六个图标素材（**2026-10-03 第四版：用"分段折线弧"画真正的弯钩箭头**）
//
// 用户给的 6 张美术参考（美术参考\*.jpg）要点：
//   D3C370FB…  返回菜单：暖黑「花角牌形」底 + 浅色细描边 + 白色**弯钩箭头**（尖朝左上、尾向右下弯）
//   78E33726…  重置关卡：同款牌形底 + 白色**双向环形箭头**
//   960FA572…  提示    ：同款牌形底 + 白色**放大镜**（圆环 + 45° 圆头手柄）
//   D5EC8714…  撤回    ：深色弯钩箭头（**尾端平截面** → 逐渐变粗 → 箭头在左下）
//                       要求：统一风格；= 返回菜单箭头翻到这个角度；尾端加粗做出截面，
//                       但**保持"尾细 → 头粗"的渐变**
//   5A5ABC60…  确认卡  ：横向牌形底 + ✓ + ✗；要求**去掉白块拼接**，平滑底 + 两个图标
//   65D9CAAD…  相对位置：确认卡在**返回菜单右侧**，等高、宽约 2.8 倍
//
// ★ 关键手法（第三版失败后改的）：
//   工具只有 ellipse/rectangle/triangle/four_point_star/five_point_star/ring/textbox/image 八种，
//   **没有弧线**；第三版我拿几个大矩形硬拼，出来是"一堆方块"。
//   这一版改成**分段折线**：把弧切成 N 段小矩形，每段按切线角旋转、宽度按"尾细→头粗"渐变，
//   拼出来就是一条光滑的弯钩 —— 这是用直尺画曲线的标准做法。
//
// 用法：node tools/qx/make_icons.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCENES = path.join(ROOT, 'tools', 'qx', 'scenes');

// ── 配色（照参考图：暖黑底 / 米灰细边 / 纯白图形）──────────────────────
const PLATE = '#1F1D1A';
const EDGE  = '#8C867A';
const GLYPH = '#FFFFFF';

// ── 尺寸 ──────────────────────────────────────────────────────────────
const KEY = 70, BACK = 62, CARD_W = 172, CARD_H = 62;

const mk = (id, type, x, y, w, h, color, rot = 0, z = 0) =>
  ({ id, type, x: +(+x).toFixed(2), y: +(+y).toFixed(2),
     width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)),
     rotation: Math.round(rot * 10) / 10, color, opacity: 1, zIndex: z });

/** 花角牌形底：两个矩形取并集（四角各缺一块）⇒ 八边形；外圈再套一层浅色 = 细描边 */
function plate(W, H, z0 = 0, c = 7) {
  const o = 1.5, oc = c + o;
  return [
    mk('edgeA', 'rectangle', W / 2, H / 2, W + 2 * o - 2 * oc, H + 2 * o, EDGE, 0, z0),
    mk('edgeB', 'rectangle', W / 2, H / 2, W + 2 * o, H + 2 * o - 2 * oc, EDGE, 0, z0),
    mk('baseA', 'rectangle', W / 2, H / 2, W - 2 * c, H, PLATE, 0, z0 + 1),
    mk('baseB', 'rectangle', W / 2, H / 2, W, H - 2 * c, PLATE, 0, z0 + 1),
  ];
}

const R = (id, x, y, w, h, rot, z, color = GLYPH) => mk(id, 'rectangle', x, y, w, h, color, rot, z);

/**
 * **画一段弧**（分段折线）：从 `a0` 转到 `a1`（角度制，0=正右，顺时针为正，屏幕坐标系 y 向下）
 * · 半径 r、圆心 (cx,cy)、厚度从 w0 线性变到 w1（**尾细 → 头粗**）
 * · 段数 n 越多越圆滑
 */
function arc(id, cx, cy, r, a0, a1, w0, w1, n, z, color = GLYPH) {
  const out = [];
  const rad = (d) => (d * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
    const am = a0 + (a1 - a0) * tm;
    const x = cx + r * Math.cos(rad(am));
    const y = cy + r * Math.sin(rad(am));
    const w = w0 + (w1 - w0) * tm;                       // 厚度渐变
    const seg = r * Math.abs(rad(a1 - a0)) / n + 3.2;    // 每段长度（**重叠 3.2px 消锯齿**）
    out.push(R(id + '_' + i, x, y, seg, w, -am, z, color)); // rotation 0 = 竖条 ⇒ 取切线角
  }
  return out;
}

/** 箭头尖：等腰三角，`rot` 0=上 90=右 180=下 270=左 */
const tri = (id, x, y, w, h, rot, z) => mk(id, 'triangle', x, y, w, h, GLYPH, rot, z);

const scene = (name, w, h, elements) => ({
  canvas: { width: Math.round(w), height: Math.round(h), background: '#00000000' },
  elements, meta: { sourceType: 'editor', sourceName: name, warnings: [] },
});

const icons = {};

// ══ ① 返回菜单 62×62：弯钩箭头 —— 尖朝左上，尾向右下弯 ══════════════════
//    参考图 1：箭头尖在左上（约 -135°），弧从尖往下经右侧绕回，尾部收在下方偏右。
{
  const W = BACK, H = BACK, cx = W / 2, cy = H / 2, z = 3;
  icons['hex-back'] = scene('murdoku-hex-back', W, H, [
    ...plate(W, H, 0, 6),
    // 弧：从"尾部"(-60°，即右上偏下) 逆时针走到箭头根部(190°)，厚度 3.2 → 6.5
    ...arc('h', cx + 2, cy + 3, 13, -55, 175, 3.2, 6.5, 13, z),
    // 箭头尖（朝左上）
    tri('head', cx - 11, cy - 9, 20, 20, 315, z + 1),
  ]);
}

// ══ ② 重置关卡 70×70：双向环形箭头（两段弧 + 两个箭头）══════════════════
{
  const W = KEY, H = KEY, cx = W / 2, cy = H / 2, z = 3, r = 15;
  icons['hex-redo'] = scene('murdoku-hex-redo', W, H, [
    ...plate(W, H, 0, 7),
    ...arc('a', cx, cy, r, -172, 8, 6, 6, 12, z),     // 上弧（右端接箭头）
    ...arc('b', cx, cy, r, 8, 188, 6, 6, 12, z),      // 下弧（左端接箭头）
    tri('ar1', cx + r + 1, cy + 3, 11, 11, 145, z + 2),
    tri('ar2', cx - r - 1, cy - 3, 11, 11, 325, z + 2),
  ]);
}

// ══ ③ 提示（放大镜）70×70 ══════════════════════════════════════════════
{
  const W = KEY, H = KEY, cx = W / 2, cy = H / 2, z = 3;
  icons['hex-hint'] = scene('murdoku-hex-hint', W, H, [
    ...plate(W, H, 0, 7),
    mk('lens', 'ring', cx - 4, cy - 3, 36, 36, GLYPH, 0, z),
    // 手柄：45° 的圆头长条（用 ellipse 加圆头）
    mk('grip', 'ellipse', cx + 16, cy + 17, 13, 27, GLYPH, 45, z + 1),
  ]);
}

// ══ ④ 撤回 70×70：返回菜单箭头**翻到参考图 4 的角度** ═══════════════════
//    参考图 4：尾部在上中（**平截面**）→ 弧向右下再绕到左下 → 箭头在左下（朝左下）
//    要求：尾端加粗做出截面，但保持"尾细 → 头粗"
{
  const W = KEY, H = KEY, cx = W / 2, cy = H / 2, z = 3;
  icons['hex-undo'] = scene('murdoku-hex-undo', W, H, [
    ...plate(W, H, 0, 7),
    // 弧：尾在正上方(-90°)，顺时针绕到左下(150°)；厚度 4 → 8
    ...arc('u', cx - 1, cy + 2, 15, -90, 145, 4.0, 8.0, 14, z),
    // 尾端截面：让尾部是平的（一小段加厚）
    R('tail', cx - 1, cy - 13, 15, 6, 0, z),
    // 箭头（朝左下）
    tri('head', cx - 16, cy - 12, 21, 21, 225, z + 1),
  ]);
}

// ══ ⑤ 提交 70×70：向上箭头（**下细上粗**）═══════════════════════════════
{
  const W = KEY, H = KEY, cx = W / 2, cy = H / 2, z = 3;
  icons['hex-submit'] = scene('murdoku-hex-submit', W, H, [
    ...plate(W, H, 0, 7),
    R('s1', cx, cy - 2, 10, 12, 0, z),        // 下段最细
    R('s2', cx, cy + 8, 12, 12, 0, z),
    R('s3', cx, cy + 17, 14, 10, 0, z),       // 上段最粗
    tri('head', cx, cy - 15, 28, 22, 0, z + 1),
  ]);
}

// ══ ⑥ 勾叉确认卡 172×62：平滑底 + ✓ / ✗（**不要白块拼接**）══════════════
{
  const W = CARD_W, H = CARD_H, cy = H / 2, z = 3;
  icons['hex-confirm'] = scene('murdoku-hex-confirm', W, H, [
    ...plate(W, H, 0, 7),
    // ✓：短臂 + 长臂（都用旋转矩形，端点做圆头椭圆遮一下接缝）
    R('ok1', 52, cy + 6, 8, 13, -50, z),
    R('ok2', 59, cy - 2, 8, 29, 50, z),
    // ✗：两段 ±45°
    R('no1', 128, cy, 8, 26, 45, z),
    R('no2', 128, cy, 8, 26, -45, z),
  ]);
}

fs.mkdirSync(SCENES, { recursive: true });
for (const [name, sc] of Object.entries(icons)) {
  fs.writeFileSync(path.join(SCENES, name + '.json'), JSON.stringify(sc, null, 2), 'utf8');
  console.log('  ✅ ' + name.padEnd(14) + sc.canvas.width + '×' + sc.canvas.height
    + '  图元 ' + sc.elements.length);
}
console.log('  共 ' + Object.keys(icons).length + ' 个（分段折线画弧 + 花角牌形底 + 米灰细边）');
