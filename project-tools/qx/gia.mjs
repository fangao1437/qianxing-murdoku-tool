// tools/qx/gia.mjs —— **程序化生成 .gia（千星「外部资产」格式）**
//
// ★★★ 2026-10-01：**这是"自主配美术"的完整通路**。
//
//   用户说：「外部资产这个选项是千星沙箱里就有的」—— 也就是说**不需要我去破解导入格式**，
//   千星自带这个功能，我只要**产出它要的 .gia 文件**就行。
//
//   而 https://qx.070077.xyz （Miliastra Image Editor）的 API 是**同源相对路径**、
//   可以直接程序化调用，所以：
//
//       构造 scene JSON  →  POST /api/export/gia  →  得到 .gia  →  千星里作为外部资产导入
//
//   实测（2026-10-01）：
//     · POST body 必须是 `{ scene: <场景>, giaGroupName: "<素材组名>" }`
//       （我第一版直接 POST 场景本身 ⇒ **422 Unprocessable Entity**）
//     · 成功返回的 .gia **头结构 .gil 完全一致**：
//         [u32 文件大小−4][u32 1][u32 806][u32 3][u32 体长][protobuf 体][u32 0x00000679]
//       注意第 4 个字段：`.gil` 是 **2**，`.gia` 是 **3** —— 这是两者唯一的头差别。
//     · 所以 `.gia` 也能用 `tools/gil/gilread.mjs` 那一套读（同一个容器格式）
//
//   场景结构（从编辑器 JS 包里读出来的）：
//     { canvas: { width, height, background },
//       elements: [ { id, type, x, y, width, height, rotation, color, opacity, zIndex, ... } ],
//       meta: { sourceType:"editor", sourceName:"", warnings:[] } }
//     type 见 SHAPES；textbox 支持 `<color>` `<i>` `<size>` 标记。
//
// 用法：
//   node tools/qx/gia.mjs --name=六边形按钮 --out=btn.gia --scene=path/to/scene.json
//   node tools/qx/gia.mjs --demo              # 用一个内置示例场景试通路

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.QX_BASE || 'https://qx.070077.xyz';
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };

/** 判断"是不是直接跑的这个文件"。
 *  ⚠️ 不要写 `'file:///' + process.argv[1]` —— 路径里有中文/空格时
 *     `import.meta.url` 是**百分号编码**的（`%E6%96%B0...`），字符串拼永远匹配不上，
 *     表现是"跑起来一行输出都没有"（我第一版就这么哑掉的）。 */
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; }
})();

/**
 * 可用的图元类型 —— **这是编辑器里 `baseShapePresets` 的确切清单**，
 * 不是猜的。（我第一版猜了 `hexagon` / `line`，那两个**不存在**。）
 *
 * `baseShapePresets` 给了每种形状的默认色与尺寸：
 *   ellipse #0f766e 88×88 / rectangle #c2410c 102×70 / triangle #7c3aed 96×86
 *   four_point_star #0f4c81 90×90 / five_point_star #be123c 92×92 / ring #f59e0b 92×92
 *   textbox #ffffff 180×40
 *
 * ⚠️ **没有 hexagon** —— 六边形要用基础图元拼，或者用素材库里的图。
 */
export const SHAPES = [
  'ellipse', 'rectangle', 'triangle', 'four_point_star', 'five_point_star',
  'ring', 'textbox', 'image',
];

/** 造一个空场景 */
export function scene(width = 512, height = 512, background = '#ffffff00') {
  return { canvas: { width, height, background }, elements: [], meta: { sourceType: 'editor', sourceName: '', warnings: [] } };
}

/** 加一个图元（只补默认值，不猜字段名 —— 字段名全部来自编辑器 JS 包） */
export function add(sc, type, x, y, w, h, opts = {}) {
  const el = Object.assign({
    id: 'e' + (sc.elements.length + 1), type, x, y, width: w, height: h,
    rotation: 0, opacity: type === 'textbox' || type === 'image' ? 1 : 0.85,
    zIndex: sc.elements.length,
  }, opts);
  sc.elements.push(el);
  return el;
}

/** 调 API 导出 */
async function exportGia(sc, name) {
  const body = JSON.stringify({ scene: sc, giaGroupName: name });
  const r = await fetch(BASE + '/api/export/gia', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 300));
  }
  return Buffer.from(await r.arrayBuffer());
}

/** 解析 .gia / .gil 的容器头，用于验证。
 *
 *  ⚠️ **整个头都是大端**（`readUInt32BE`），尾标记也是。
 *     我第一版把尾读成小端，得到 `0x79060000` ⇒ 误报"尾标记错"。
 *     （`.gil` 的尾就是 `00 00 06 79` = 大端 0x679。） */
export function header(buf) {
  const sizeMinus4 = buf.readUInt32BE(0);
  const kind = buf.readUInt32BE(12);          // .gil=2  .gia=3
  const bodyLen = buf.readUInt32BE(16);
  const trailer = buf.readUInt32BE(20 + bodyLen);
  return {
    sizeMinus4, kind, bodyLen, trailer,
    okSize: sizeMinus4 === buf.length - 4,
    okTrailer: trailer === 0x679,
    okBody: 20 + bodyLen + 4 === buf.length,
  };
}

if (isMain) {
  const out = argOf('out') || path.join(ROOT, 'tools', 'qx', 'out', 'probe.gia');
  const name = argOf('name') || 'murdoku';
  let sc;
  const sf = argOf('scene');
  if (sf) sc = JSON.parse(fs.readFileSync(path.resolve(ROOT, sf), 'utf8'));
  else {
    // 内置示例：一个圆角矩形 + 一个六边形 + 一行文字（验证三种图元都能出）
    sc = scene(512, 512, '#00000000');
    add(sc, 'rectangle', 256, 120, 400, 120, { color: '#2b3a55', opacity: 1 });
    add(sc, 'hexagon', 256, 320, 200, 200, { color: '#4a90d9', opacity: 1 });
    add(sc, 'textbox', 256, 460, 400, 60, { text: '藏品 · <color=#ff4040>夜盗</color>', color: '#ffffff', fontSize: 40 });
  }
  console.log('  场景：' + sc.canvas.width + '×' + sc.canvas.height + '  图元 ' + sc.elements.length + ' 个：' + sc.elements.map((e) => e.type).join(', '));
  try {
    const buf = await exportGia(sc, name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    const h = header(buf);
    console.log('  ✅ 导出 ' + path.relative(ROOT, out) + '  ' + buf.length + ' 字节');
    console.log('     头：大小−4=' + h.sizeMinus4 + (h.okSize ? ' ✅' : ' ❌') +
      '  类型=' + h.kind + '（3=.gia）  体长=' + h.bodyLen +
      '  尾=0x' + h.trailer.toString(16) + (h.okTrailer ? ' ✅' : ' ❌') + '  体长自洽=' + (h.okBody ? '✅' : '❌'));
    console.log('     前 20 字节：' + buf.subarray(0, 20).toString('hex'));
  } catch (e) {
    console.error('  ❌ 导出失败：' + e.message);
    process.exit(4);
  }
}
