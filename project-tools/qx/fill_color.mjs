// tools/qx/fill_color.mjs —— 反解「填充色」（编辑器里 填充色 × 底板色 = 最终色）
//
// 用户 2026-10-03 给的实测：
//   · 底板（官方素材，本身是彩色的棕色牌形）
//   · 填充 (255,255,255) 时截图 = 屏幕截图 2026-10-03 182258.png
//   · 填充 (230,255,255) 时截图 = 屏幕截图 2026-10-03 182604.png
//   · 「编辑器内的填充色与底色是叠加的，所以我需要你单独给填充色」
//
// 我从两张截图采样得到：
//   ① 填充 255,255,255 ⇒ rgb(98,70,52)     ← 即底板本色
//   ② 填充 230,255,255 ⇒ rgb(89,70,52)
//   检验乘算模型：98 × 230/255 = 88 ≈ 实测 89（差 1）· G/B 完全相同 ⇒ **结果 = 底板 × 填充 / 255** ✅
//
// ⇒ 要什么最终色，填充 = 目标 × 255 / 底板（每通道，上限 255）
//
// 用法：node tools/qx/fill_color.mjs

const BASE = { r: 98, g: 70, b: 52 };   // 底板本色（= 填充 255,255,255 时的采样值）
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('');
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** 目标最终色 ⇒ 需要的填充色 */
function fillFor(t) {
  return { r: clamp(t.r * 255 / BASE.r), g: clamp(t.g * 255 / BASE.g), b: clamp(t.b * 255 / BASE.b) };
}
/** 用填充色反算最终色（自查） */
function resultOf(f) {
  return { r: clamp(BASE.r * f.r / 255), g: clamp(BASE.g * f.g / 255), b: clamp(BASE.b * f.b / 255) };
}

console.log('底板本色            rgb(' + BASE.r + ',' + BASE.g + ',' + BASE.b + ')  ' + hex(BASE.r, BASE.g, BASE.b));
console.log('模型                结果 = 底板 × 填充 / 255');
console.log('');
console.log('目标最终色                  需要的填充色                校验(底板×填充/255)');
console.log('──────────────────────────────────────────────────────────────────────────────');

const targets = [
  ['★ 参考图底色（暖黑）主目标', 44, 40, 32],
  ['更深一档',                  38, 34, 27],
  ['更亮一档',                  51, 46, 37],
  ['描边色（参考图那道细线）', 147, 140, 131],
  ['图形色（暖白）',           250, 244, 232],
];

const rows = [];
for (const [name, r, g, b] of targets) {
  const f = fillFor({ r, g, b });
  const back = resultOf(f);
  console.log(
    '  ' + name.padEnd(24) +
    ('rgb(' + r + ',' + g + ',' + b + ')').padEnd(18) +
    ('rgb(' + f.r + ',' + f.g + ',' + f.b + ')').padEnd(22) +
    hex(f.r, f.g, f.b).padEnd(10) +
    'rgb(' + back.r + ',' + back.g + ',' + back.b + ')'
  );
  rows.push({ name, target: `rgb(${r},${g},${b})`, fill: `rgb(${f.r},${f.g},${f.b})`, fillHex: hex(f.r, f.g, f.b) });
}

console.log('');
console.log('★ 结论（暖黑底那一行就是要填的）：');
const main = rows[0];
console.log('  填充色 = ' + main.fill + '   ' + main.fillHex + '   ⇒ 最终得到 ' + main.target);

export { BASE, fillFor, resultOf };
