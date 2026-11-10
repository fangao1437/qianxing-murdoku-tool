#!/usr/bin/env node
// 原生基本图形拟合工具 —— 把设计图里的一块「楔形/斜边区域」拟合成严格的分段直线多边形，
// 再用官方 100003 等腰三角（底边贴每条斜边）把凸多边形 100% 铺满，且保证零溢出。
//
// 背景（见主项目 qianxing-murdoku/docs/美术资产-原生图形构造与v12-v15演进.md）：
//  - 倾斜形状用「矩形 + 旋转」，斜边可以用 100003 压缩拉伸后的一条边；
//  - 不透明同色重叠无缝，只要每个图元完全落在目标凸区域内；
//  - 只做扇形剖分覆盖 92.5%，必须叠加「整幅每边等腰三角」才到 100%（A+B 双保险）。
//  - 100003 实测模型：局部 w×h「顶点上中(0,-h/2)、底边 y=+h/2 长 w」，
//    按 rotation r 视觉逆时针旋转，变换 (x,y)->(x cos r + y sin r, -x sin r + y cos r)；
//    顶点方向 = (-sin r, -cos r)，故让顶点指向内法线 n 时 r = atan2(-n.x, -n.y)，
//    中心 = 底边中点 + n*h/2。rot=±90 时包围盒 w/h 交换。
//
// 用法（零依赖路径，推荐）：
//   node art/tools/fit-primitive-shape.mjs \
//     --samples=out/wedge-samples.json \
//     --left-breaks=320,500 --right-breaks= \
//     --color=#C85D11 --out=out/wedge-fit.json
//
// 直接从设计图取边界（需要 node_modules/@napi-rs/canvas，缺失时报错并提示改用 --samples）：
//   node art/tools/fit-primitive-shape.mjs \
//     --png=path/to/design.png --color=#C75C18 --box=380,220,500,660 --tol=12 \
//     --left-breaks=320,500 --out=out/wedge-fit.json
//
// 已有多边形、只想生成图元并自检：
//   node art/tools/fit-primitive-shape.mjs --poly=out/poly.json --color=#C85D11 --out=out/elements.json
//
// 自检（不读任何文件）：
//   node art/tools/fit-primitive-shape.mjs --self-test
//
// 输入 samples： [{ "y": 233, "left": 473, "right": 476 }, ...]
// 输入 poly：    [[477.5,220.7],[449.7,298.6],[412.1,499.4],[456.2,653.2]]
// 输出：         { polygon, lines, residual, coverage, elements, stats }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAD = Math.PI / 180;
const argOf = (k, d = null) => {
  const a = process.argv.find(s => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};
const has = k => process.argv.includes('--' + k);
const r2 = v => Math.round(v * 1000) / 1000;

// ───────────────────────── 几何基础 ─────────────────────────
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function inside(poly, p) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(poly[i], poly[(i + 1) % poly.length], p);
    if (Math.abs(c) < 1e-9) continue;
    const sg = c > 0 ? 1 : -1;
    if (s === 0) s = sg; else if (s !== sg) return false;
  }
  return true;
}
function isConvex(poly) {
  if (poly.length < 3) return false;
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(poly[i], poly[(i + 1) % poly.length], poly[(i + 2) % poly.length]);
    if (Math.abs(c) < 1e-9) continue;
    const sg = c > 0 ? 1 : -1;
    if (s === 0) s = sg; else if (s !== sg) return false;
  }
  return s !== 0;
}
function centroid(poly) {
  return poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);
}
function lineIntersect(l1, l2) {
  // 直线写作 x = a*y + b
  const y = (l2.b - l1.b) / (l1.a - l2.a);
  return [l1.a * y + l1.b, y];
}
function fitLine(samples, key, lo, hi) {
  const pts = samples.filter(s => s.y >= lo && s.y < hi);
  if (pts.length < 3) throw new Error(`分段 [${lo},${hi}) 的 ${key} 样本不足 (${pts.length})`);
  let sy = 0, sx = 0, syy = 0, sxy = 0;
  for (const p of pts) { sy += p.y; sx += p[key]; syy += p.y * p.y; sxy += p.y * p[key]; }
  const n = pts.length, den = n * syy - sy * sy;
  const a = (n * sxy - sy * sx) / den, b = (sx - a * sy) / n;
  let mae = 0, max = 0;
  for (const p of pts) { const e = Math.abs(p[key] - (a * p.y + b)); mae += e; max = Math.max(max, e); }
  return { a, b, lo, hi, n, mae: mae / n, max, key };
}

// ───────────────────────── 边界拟合 ─────────────────────────
function fitPolygon(samples, leftBreaks, rightBreaks) {
  const ys = samples.map(s => s.y);
  const y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
  const cuts = arr => [y0, ...arr.filter(v => v > y0 && v < y1), y1];
  const segs = (key, breaks) => {
    const c = cuts(breaks), out = [];
    for (let i = 0; i < c.length - 1; i++) out.push(fitLine(samples, key, c[i], c[i + 1]));
    return out;
  };
  const L = segs('left', leftBreaks), R = segs('right', rightBreaks);
  // 顶点：从上到下沿左边界，再从下到上沿右边界
  const poly = [];
  poly.push(lineIntersect(L[0], R[0]));                    // 顶点
  for (let i = 1; i < L.length; i++) poly.push(lineIntersect(L[i - 1], L[i]));
  poly.push(lineIntersect(L[L.length - 1], R[R.length - 1])); // 底点
  for (let i = R.length - 1; i > 0; i--) poly.push(lineIntersect(R[i - 1], R[i]));
  // 若右边界只有一段，上面循环不会追加；补上右边界的折点（顶/底已由交点给出）
  const residual = {
    left: L.map(l => ({ range: [l.lo, l.hi], a: r2(l.a), b: r2(l.b), mae: r2(l.mae), max: r2(l.max), n: l.n })),
    right: R.map(l => ({ range: [l.lo, l.hi], a: r2(l.a), b: r2(l.b), mae: r2(l.mae), max: r2(l.max), n: l.n })),
  };
  const all = [...L, ...R];
  const overall = { mae: all.reduce((s, l) => s + l.mae * l.n, 0) / all.reduce((s, l) => s + l.n, 0), max: Math.max(...all.map(l => l.max)) };
  return { poly, residual, overall: { mae: r2(overall.mae), max: r2(overall.max) } };
}

// ───────────────────────── 100003 图元 ─────────────────────────
function triVertices(cx, cy, w, h, rot) {
  const a = rot * RAD, co = Math.cos(a), si = Math.sin(a);
  const f = (X, Y) => [cx + X * co + Y * si, cy - X * si + Y * co];
  return [f(0, -h / 2), f(-w / 2, h / 2), f(w / 2, h / 2)];
}
function edgeTri(a, b, poly, color, els) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const u = [dx / len, dy / len];
  let n = [-u[1], u[0]];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const cen = centroid(poly);
  if ((cen[0] - mid[0]) * n[0] + (cen[1] - mid[1]) * n[1] < 0) n = [-n[0], -n[1]];
  let lo = 0, hi = 3000;
  for (let k = 0; k < 46; k++) {
    const m = (lo + hi) / 2;
    if (inside(poly, [mid[0] + n[0] * m, mid[1] + n[1] * m])) lo = m; else hi = m;
  }
  if (lo < 0.05) return;
  const rot = Math.atan2(-n[0], -n[1]) / RAD;
  const cx = mid[0] + n[0] * lo / 2, cy = mid[1] + n[1] * lo / 2;
  els.push({ type: 'image', imageAssetId: 100003, imageType: 'stretch', imageTint: true,
    x: r2(cx), y: r2(cy), width: r2(len), height: r2(lo), rotation: r2(rot), color, opacity: 1,
    _vertices: triVertices(cx, cy, len, lo, rot) });
}
function fillTri(A, B, C, color, els) {
  const tri = [A, B, C];
  const edges = [[A, B], [B, C], [C, A]];
  for (const [a, b] of edges) edgeTri(a, b, tri, color, els);
}
// C：尖角补形。凸多边形每个顶点放一枚 100003，其「顶点」正好落在该多边形顶点上，
// 两腰沿相邻两条边各取长度 d —— 由构造保证等腰、且三个顶点都在多边形边界上（零溢出）。
// A+B 在细长尖角处覆盖不足，正是这些「顶角三角」补上。
function cornerTriangles(poly, color, scales = [0.62]) {
  const els = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const V = poly[i], prev = poly[(i - 1 + n) % n], next = poly[(i + 1) % n];
    const u1 = [prev[0] - V[0], prev[1] - V[1]], u2 = [next[0] - V[0], next[1] - V[1]];
    const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2);
    if (l1 < 0.01 || l2 < 0.01) continue;
    for (const fraction of scales) {
      if (fraction <= 0 || fraction > 1) continue;   // >1 会越过相邻顶点造成溢出
      const d = Math.min(l1, l2) * fraction;
      const A = [V[0] + u1[0] / l1 * d, V[1] + u1[1] / l1 * d];
      const B = [V[0] + u2[0] / l2 * d, V[1] + u2[1] / l2 * d];
      const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const h = Math.hypot(V[0] - M[0], V[1] - M[1]);
      if (h < 0.05) continue;
      const nn = [(V[0] - M[0]) / h, (V[1] - M[1]) / h];
      const w = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const rot = Math.atan2(-nn[0], -nn[1]) / RAD;
      const cx = M[0] + nn[0] * h / 2, cy = M[1] + nn[1] * h / 2;
      els.push({ type: 'image', imageAssetId: 100003, imageType: 'stretch', imageTint: true,
        x: r2(cx), y: r2(cy), width: r2(w), height: r2(h), rotation: r2(rot), color, opacity: 1,
        _vertices: triVertices(cx, cy, w, h, rot) });
    }
  }
  return els;
}
function fillConvex(poly, color, scales = [0.62]) {
  if (!isConvex(poly)) throw new Error('目标多边形非凸；请拆成若干凸块后分别调用');
  const els = [];
  // A：整幅多边形每条边一个「大」等腰三角（顶点可延伸到整个多边形内部）
  for (let i = 0; i < poly.length; i++) edgeTri(poly[i], poly[(i + 1) % poly.length], poly, color, els);
  // B：扇形剖分，每个三角形三条边各一个等腰三角（补尖角）
  for (let i = 1; i < poly.length - 1; i++) fillTri(poly[0], poly[i], poly[i + 1], color, els);
  // C：顶角三角（顶点贴多边形顶点，两腰贴相邻边；可给多档尺度叠加）
  els.push(...cornerTriangles(poly, color, scales));
  return els;
}

function coverageOf(poly, els, step = 2) {
  const minX = Math.min(...poly.map(p => p[0])), maxX = Math.max(...poly.map(p => p[0]));
  const minY = Math.min(...poly.map(p => p[1])), maxY = Math.max(...poly.map(p => p[1]));
  const inTriangle = (p, t) => {
    const d1 = cross(t[0], t[1], p), d2 = cross(t[1], t[2], p), d3 = cross(t[2], t[0], p);
    return (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) || (d1 <= 1e-9 && d2 <= 1e-9 && d3 <= 1e-9);
  };
  let total = 0, covered = 0;
  for (let y = Math.ceil(minY); y <= maxY; y += step) {
    for (let x = Math.ceil(minX); x <= maxX; x += step) {
      const p = [x + 0.5, y + 0.5];
      if (!inside(poly, p)) continue;
      total++;
      for (const e of els) if (inTriangle(p, e._vertices)) { covered++; break; }
    }
  }
  return total ? covered / total : 1;
}
// A+B+C 体系：A 整幅每边大等腰三角、B 扇形补尖角、C 顶角三角。
// 逐档加大 C 的尺度（仍是「顶点贴多边形顶点」的零溢出图元），直到覆盖率达标。
function fillAdaptive(poly, color, opts = {}) {
  const target = opts.target ?? 0.9995;
  const scaleSets = opts.scaleSets ?? [[0.62], [0.4, 0.8], [0.3, 0.55, 0.8, 1.0],
    [0.2, 0.35, 0.5, 0.62, 0.75, 0.88, 1.0]];
  let best = null;
  for (const scales of scaleSets) {
    const els = fillConvex(poly, color, scales);
    const cov = coverageOf(poly, els, 1);
    const cand = { els, stats: { strategy: 'A+B+C', cornerScales: scales, coverage: r2(cov * 100), elements: els.length } };
    if (!best || cov > best.cov) best = Object.assign(cand, { cov });
    if (cov >= target) return { els: cand.els, stats: cand.stats };
  }
  return { els: best.els, stats: best.stats };
}

// ───────────────────────── 自检 ─────────────────────────
function verify(poly, els, color, gridStep = 1) {
  // 用「有向距离」衡量溢出：允许多边形边界上 0.5px 内的浮点误差，超过才算真溢出。
  const orient = Math.sign(cross(poly[0], poly[1], poly[2])) || 1;
  const outsideDist = p => {
    let d = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-9) continue;
      d = Math.max(d, -(cross(a, b, p) * orient) / len);
    }
    return d;
  };
  const TOL = 0.5;
  let overflow = 0, maxViolation = 0;
  const samples = [];
  for (const e of els) for (const v of e._vertices) {
    const d = outsideDist(v);
    if (d > TOL) { overflow++; maxViolation = Math.max(maxViolation, d); if (samples.length < 4) samples.push(v.map(q => +q.toFixed(2))); }
  }
  const minX = Math.min(...poly.map(p => p[0])), maxX = Math.max(...poly.map(p => p[0]));
  const minY = Math.min(...poly.map(p => p[1])), maxY = Math.max(...poly.map(p => p[1]));
  let total = 0, covered = 0;
  const triOf = e => e._vertices;
  const inTriangle = (p, t) => {
    const d1 = cross(t[0], t[1], p), d2 = cross(t[1], t[2], p), d3 = cross(t[2], t[0], p);
    return (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) || (d1 <= 1e-9 && d2 <= 1e-9 && d3 <= 1e-9);
  };
  for (let y = Math.ceil(minY); y <= maxY; y += gridStep) {
    for (let x = Math.ceil(minX); x <= maxX; x += gridStep) {
      const p = [x + 0.5, y + 0.5];
      if (!inside(poly, p)) continue;
      total++;
      for (const e of els) if (inTriangle(p, triOf(e))) { covered++; break; }
    }
  }
  return { elements: els.length, overflowVertices: overflow, maxViolation: r2(maxViolation), overflowSamples: samples,
    coverage: total ? r2(covered / total * 100) : 0, sampled: total,
    bbox: [r2(minX), r2(minY), r2(maxX), r2(maxY)] };
}

// ───────────────────────── 取样（PNG → samples） ─────────────────────────
async function samplesFromPng(png, colorHex, box, tol) {
  let loadImage;
  try { ({ loadImage } = await import('@napi-rs/canvas')); }
  catch (e) { throw new Error('PNG 取样需要 @napi-rs/canvas；请改用 --samples=<json>（零依赖路径）'); }
  const img = await loadImage(path.resolve(png));
  // @napi-rs/canvas 没有 getImageData，用离屏 canvas 读取
  const { createCanvas } = await import('@napi-rs/canvas');
  const cv = createCanvas(img.width, img.height), ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const [x0, y0, x1, y1] = box;
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const W = x1 - x0;
  const target = [parseInt(colorHex.slice(1, 3), 16), parseInt(colorHex.slice(3, 5), 16), parseInt(colorHex.slice(5, 7), 16)];
  const out = [];
  for (let yy = 0; yy < y1 - y0; yy++) {
    const mask = new Uint8Array(W);
    for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      if (Math.abs(data[i] - target[0]) <= tol && Math.abs(data[i + 1] - target[1]) <= tol &&
          Math.abs(data[i + 2] - target[2]) <= tol && data[i + 3] > 200) mask[xx] = 1;
    }
    let bestLen = 0, bestL = -1, bestR = -1, st = -1;
    for (let xx = 0; xx <= W; xx++) {
      if (xx < W && mask[xx]) { if (st < 0) st = xx; }
      else if (st >= 0) { if (xx - st > bestLen) { bestLen = xx - st; bestL = st; bestR = xx - 1; } st = -1; }
    }
    if (bestLen >= 2) out.push({ y: y0 + yy, left: x0 + bestL, right: x0 + bestR });
  }
  return out;
}

// ───────────────────────── 自检用例 ─────────────────────────
function selfTest() {
  const poly = [[477.5, 220.7], [449.7, 298.6], [412.1, 499.4], [456.2, 653.2]];
  const plain = verify(poly, fillConvex(poly, '#C85D11', [0.62]), '#C85D11', 2);
  const { els, stats } = fillAdaptive(poly, '#C85D11');
  const v = verify(poly, els, '#C85D11', 1);
  console.log(JSON.stringify({ convex: isConvex(poly), plainAB_coverage: plain.coverage, adaptive: stats, ...v }, null, 2));
  if (v.overflowVertices !== 0 || v.coverage < 99.9) { console.error('SELF-TEST FAILED'); process.exit(1); }
  console.log('SELF-TEST OK');
}

// ───────────────────────── 主流程 ─────────────────────────
(async () => {
  if (has('self-test')) return selfTest();
  let poly, residual = null, overall = null, samples = null;
  const polyFile = argOf('poly');
  if (polyFile) {
    poly = JSON.parse(fs.readFileSync(polyFile, 'utf8'));
  } else {
    const sampleFile = argOf('samples');
    if (sampleFile) samples = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
    else if (argOf('png')) {
      const box = (argOf('box') || '').split(',').map(Number);
      if (box.length !== 4 || box.some(Number.isNaN)) throw new Error('--box=x0,y0,x1,y1 必填');
      samples = await samplesFromPng(argOf('png'), argOf('color', '#C75C18'), box, Number(argOf('tol', '12')));
      if (argOf('save-samples')) fs.writeFileSync(argOf('save-samples'), JSON.stringify(samples, null, 2));
    } else throw new Error('需要 --poly / --samples / --png 之一');
    const parseBreaks = s => (s || '').split(',').map(v => Number(v.trim())).filter(v => Number.isFinite(v));
    const L = parseBreaks(argOf('left-breaks')), R = parseBreaks(argOf('right-breaks'));
    const fitted = fitPolygon(samples, L, R);
    poly = fitted.poly; residual = fitted.residual; overall = fitted.overall;
  }
  if (!isConvex(poly)) throw new Error('拟合出的多边形不是凸多边形：' + JSON.stringify(poly));
  const color = argOf('color', '#C85D11');
  const { els, stats } = fillAdaptive(poly, color, {
    maxDepth: Number(argOf('max-depth', '7')), target: Number(argOf('target', '0.9995')) });
  const v = verify(poly, els, color, Number(argOf('grid', '1')));
  const result = {
    tool: 'fit-primitive-shape', version: 1,
    color, polygon: poly.map(p => p.map(r2)),
    lines: residual, residual: overall,
    samples: samples ? samples.length : null,
    adaptive: stats, verification: v,
    elements: els.map(({ _vertices, ...e }, i) => Object.assign({ id: 'fit' + (i + 1), zIndex: i }, e)),
  };
  const out = argOf('out');
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 2)); }
  console.log(JSON.stringify({ polygon: result.polygon, residual: overall, verification: v, out: out || '(stdout)' }, null, 2));
  if (!out) console.log(JSON.stringify(result.elements, null, 2));
  const minCov = Number(argOf('min-coverage', '99.9'));
  if (v.overflowVertices !== 0 || v.coverage < minCov) { console.error('VERIFY FAILED'); process.exit(1); }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
