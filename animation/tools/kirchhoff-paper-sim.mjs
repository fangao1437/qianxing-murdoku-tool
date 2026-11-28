#!/usr/bin/env node
// animation/tools/kirchhoff-paper-sim.mjs
// 千星奇域 2D UI「基尔霍夫薄板方程双模态解析解 + 不可伸长薄壳积分」纸张动画离线求解、审计、SVG 预览与 Lua 生成工具（零依赖）
//
// 用法：
//   node animation/tools/kirchhoff-paper-sim.mjs --self-test
//   node animation/tools/kirchhoff-paper-sim.mjs --preset=shop_card --audit
//   node animation/tools/kirchhoff-paper-sim.mjs --preset=bag_note --audit --svg=out/bag-anim.svg
//   node animation/tools/kirchhoff-paper-sim.mjs --preset=shop_card --emit-lua=out/shop_solver.lua
//   node animation/tools/kirchhoff-paper-sim.mjs --spec=path/to/custom.json --audit --frames=60

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRESETS = path.resolve(HERE, '../specs/paper_presets.json');
const DEG2RAD = Math.PI / 180;

function parseArgs(argv) {
  const opts = { _: [] };
  for (const raw of argv) {
    if (!raw.startsWith('--')) {
      opts._.push(raw);
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq === -1) {
      opts[raw.slice(2)] = true;
    } else {
      opts[raw.slice(2, eq)] = raw.slice(eq + 1).replace(/^"|"$/g, '');
    }
  }
  return opts;
}

export function parseColorHex(hex) {
  const clean = String(hex).replace(/^#|^0x/i, '').trim();
  if (clean.length === 8) {
    return {
      a: parseInt(clean.slice(0, 2), 16),
      r: parseInt(clean.slice(2, 4), 16),
      g: parseInt(clean.slice(4, 6), 16),
      b: parseInt(clean.slice(6, 8), 16),
    };
  }
  if (clean.length === 6) {
    return {
      a: 255,
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  throw new Error(`非法颜色值: ${hex}`);
}

export function packOpaqueColor(r, g, b, delta) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.floor(v + delta + 0.5)));
  const rr = clamp(r);
  const gg = clamp(g);
  const bb = clamp(b);
  return {
    a: 255,
    r: rr,
    g: gg,
    b: bb,
    argb: (0xFF000000 + rr * 65536 + gg * 256 + bb) >>> 0,
    css: `rgb(${rr},${gg},${bb})`,
  };
}

/**
 * 与 qianxing-murdoku 749_v8 内嵌 Lua `e749_apply_frame` 严格数学等价的单帧求解器。
 * 坐标系：x 向右为正，y 向上为正（千星 UI anchoredPosition 约定），原点位于纸张静止中心。
 */
export function solveFrame(spec, uRaw, flip = false) {
  const u = Math.max(0, Math.min(1, Number(uRaw)));
  const N = spec.strips || 16;
  const { w, h } = spec.base;
  const p = spec.params;
  const faceRGB = parseColorHex(spec.colors.face);
  const brRGB = parseColorHex(spec.colors.border);

  const inv = 1 - u;
  let remPos = Math.pow(inv, 2.15) * (1 + 0.50 * u);
  if (remPos > 1) remPos = 1;
  else if (remPos < 0) remPos = 0;

  const qKl = Math.pow(inv, 1.60) * Math.exp(-0.50 * u) * (1 + 0.85 * u);
  const qAir = Math.pow(inv, 1.80) * Math.exp(-1.10 * u) * (0.40 + 2.20 * u);
  const qTilt = Math.pow(inv, 1.85) * (1 + 0.40 * u);

  const sinPiU = Math.sin(Math.PI * u);
  const headDx = (flip ? p.headDxB : p.headDxA) * remPos;
  const headDy = p.headDy * remPos + p.arcLiftY * sinPiU * Math.pow(inv, 1.45);
  const thetaHead = (flip ? p.thetaHeadB : p.thetaHeadA) * qTilt;

  const stripH = h / N;
  const klAmp = p.ampKl * qKl;
  const airAmp = p.ampAir * qAir;
  const globalWidthScale = 1 - p.globalWidthTilt * qKl;

  // 第一遍：Kirchhoff-Love 双模态解析斜率与 3D 离面高程 w(xi)
  const phiArr = new Array(N);
  const wArr = new Array(N);
  const angArr = new Array(N);
  let wAcc = 0;
  let wMax = -1e9;
  for (let i = 0; i < N; i++) {
    const xi = (i + 0.5) / N;
    const xi2 = xi * xi;
    const xi3 = xi2 * xi;
    const dPKl = (4 / 3) * (3 * xi - 3 * xi2 + xi3);
    const dPAir = (16 / 5) * (1 - 6 * xi2 + 4 * xi3);
    const slope = klAmp * dPKl + airAmp * dPAir;
    const phi = Math.atan(slope);
    wAcc += stripH * Math.sin(phi);
    if (wAcc > wMax) wMax = wAcc;

    const ang = thetaHead + p.obliqueDeg * (klAmp * dPKl) + p.airTwistDeg * qAir * (xi - 0.5);
    phiArr[i] = phi;
    wArr[i] = wAcc;
    angArr[i] = ang;
  }

  // 第二遍：严格不可伸长可展板积分
  const strips = new Array(N);
  let px = headDx;
  let py = h * 0.5 + headDy;
  let prevRad = angArr[0] * DEG2RAD;
  const perspF = p.perspF;

  for (let i = 0; i < N; i++) {
    const phi = phiArr[i];
    const ang = angArr[i];
    const rad = ang * DEG2RAD;

    const wDrop = wArr[i] - wMax;
    let segSx = (perspF / (perspF - wDrop)) * globalWidthScale;
    if (segSx < 0.95) segSx = 0.95;
    else if (segSx > 1) segSx = 1;

    let dRad = Math.abs(rad - prevRad);
    if (i < N - 1) {
      const dRadNext = Math.abs(angArr[i + 1] * DEG2RAD - rad);
      if (dRadNext > dRad) dRad = dRadNext;
    }
    const hw = 0.5 * w * segSx;
    const edgeGuard = 1 - (hw * dRad) / stripH;
    const cosPhi = Math.cos(phi);
    let segSy = cosPhi < edgeGuard ? cosPhi : edgeGuard;
    if (segSy < 0.86) segSy = 0.86;
    else if (segSy > 1) segSy = 1;
    prevRad = rad;

    const ds = stripH * segSy;
    const sa = Math.sin(rad);
    const ca = Math.cos(rad);
    const nx = px + ds * sa;
    const ny = py - ds * ca;
    const cx = 0.5 * (px + nx);
    const cy = 0.5 * (py + ny);
    px = nx;
    py = ny;

    let ld = 13.0 * Math.sin(phi) + 4.0 * (cosPhi - 1);
    if (ld > 8) ld = 8;
    else if (ld < -8) ld = -8;

    const offB = i === 0 ? -3.0 * segSy : (i === N - 1 ? 3.0 * segSy : 0);
    const offF = i === 0 ? -4.0 * segSy : (i === N - 1 ? 4.0 * segSy : 0);

    strips[i] = {
      index: i + 1,
      cx,
      cy,
      sx: segSx,
      sy: segSy,
      rz: ang,
      phi,
      w3d: wArr[i],
      facePos: { x: cx - offF * sa, y: cy + offF * ca },
      borderPos: { x: cx - offB * sa, y: cy + offB * ca },
      faceColor: packOpaqueColor(faceRGB.r, faceRGB.g, faceRGB.b, ld),
      borderColor: packOpaqueColor(brRGB.r, brRGB.g, brRGB.b, ld * 0.5),
      leftEdge: { x: cx - hw * ca, y: cy - hw * sa },
      rightEdge: { x: cx + hw * ca, y: cy + hw * sa },
      hw,
    };
  }

  // 测量真实几何指标（与 tests/verify_749_paper_anim.lua 中 measure_paper_edges 完全同源）
  let lLen = 0;
  let rLen = 0;
  let maxStepX = 0;
  for (let i = 1; i < N; i++) {
    const a = strips[i - 1];
    const b = strips[i];
    lLen += Math.hypot(b.leftEdge.x - a.leftEdge.x, b.leftEdge.y - a.leftEdge.y);
    rLen += Math.hypot(b.rightEdge.x - a.rightEdge.x, b.rightEdge.y - a.rightEdge.y);
    const dhw = Math.abs(b.hw - a.hw);
    if (dhw > maxStepX) maxStepX = dhw;
  }
  const restArc = ((N - 1) / N) * h;

  const s0 = strips[0];
  const r0 = s0.rz * DEG2RAD;
  const topCx = s0.cx - 0.5 * stripH * s0.sy * Math.sin(r0);
  const topCy = s0.cy + 0.5 * stripH * s0.sy * Math.cos(r0);
  const tl = { x: topCx - s0.hw * Math.cos(r0), y: topCy - s0.hw * Math.sin(r0) };
  const tr = { x: topCx + s0.hw * Math.cos(r0), y: topCy + s0.hw * Math.sin(r0) };

  const sN = strips[N - 1];
  const rN = sN.rz * DEG2RAD;
  const botCx = sN.cx + 0.5 * stripH * sN.sy * Math.sin(rN);
  const botCy = sN.cy - 0.5 * stripH * sN.sy * Math.cos(rN);
  const bl = { x: botCx - sN.hw * Math.cos(rN), y: botCy - sN.hw * Math.sin(rN) };
  const br = { x: botCx + sN.hw * Math.cos(rN), y: botCy + sN.hw * Math.sin(rN) };

  const sampleChain = (vTarget) => {
    const f = vTarget * N + 0.5;
    let i0 = Math.floor(f);
    if (i0 < 1) i0 = 1;
    else if (i0 > N) i0 = N;
    const i1 = Math.min(N, i0 + 1);
    const t = Math.max(0, Math.min(1, f - i0));
    const a = strips[i0 - 1];
    const b = strips[i1 - 1];
    return {
      x: a.cx + (b.cx - a.cx) * t,
      y: a.cy + (b.cy - a.cy) * t,
      sx: a.sx + (b.sx - a.sx) * t,
      sy: a.sy + (b.sy - a.sy) * t,
      rz: a.rz + (b.rz - a.rz) * t,
    };
  };

  const easeUnder = 1 - inv * inv * inv;
  const under = {
    scale: 1 - (1 - p.underEndScale) * easeUnder,
    rz: p.underEndRot * easeUnder,
  };

  return {
    u,
    strips,
    under,
    anchors: {
      ptop: sampleChain(spec.anchors.vPTop),
      pbot: sampleChain(spec.anchors.vPBot),
      top: sampleChain(spec.anchors.vTop),
      bot: sampleChain(spec.anchors.vBot),
    },
    metrics: {
      restArc,
      lLen,
      rLen,
      maxStretchPx: Math.max(0, lLen - restArc, rLen - restArc),
      maxStepX,
      fc1Rz: s0.rz,
      fcNRz: sN.rz,
      bendDiffDeg: sN.rz - s0.rz,
      tl,
      tr,
      bl,
      br,
      opaqueAll: strips.every((s) => s.faceColor.a === 255 && s.borderColor.a === 255),
    },
  };
}

export function auditTimeline(spec, frames = 60, flip = false) {
  const gates = spec.gates || {};
  const maxStretchAllowed = gates.maxStretchPx ?? 0.01;
  const minBlYAllowed = gates.minBottomLeftY ?? (-spec.base.h * 0.5 - 0.5);
  const maxTlYAllowed = gates.maxTopLeftY ?? (spec.base.h * 0.5 + 15);
  const maxTrYAllowed = gates.maxTopRightY ?? (spec.base.h * 0.5 + 25);
  const maxStepAllowed = gates.maxAdjacentHalfWidthStepPx ?? 0.6;

  let worstStretch = 0;
  let minBlY = Infinity;
  let maxTlY = -Infinity;
  let maxTrY = -Infinity;
  let worstStepX = 0;
  let opaqueAll = true;
  let maxFinalErr = 0;

  for (let k = 0; k <= frames; k++) {
    const u = k / frames;
    const f = solveFrame(spec, u, flip);
    const m = f.metrics;
    if (m.maxStretchPx > worstStretch) worstStretch = m.maxStretchPx;
    if (m.bl.y < minBlY) minBlY = m.bl.y;
    if (m.tl.y > maxTlY) maxTlY = m.tl.y;
    if (m.tr.y > maxTrY) maxTrY = m.tr.y;
    if (m.maxStepX > worstStepX) worstStepX = m.maxStepX;
    if (!m.opaqueAll) opaqueAll = false;
    if (k === frames) {
      const stripH = spec.base.h / (spec.strips || 16);
      for (let i = 0; i < f.strips.length; i++) {
        const expectedY = (0.5 - (i + 0.5) / f.strips.length) * spec.base.h;
        const s = f.strips[i];
        maxFinalErr = Math.max(
          maxFinalErr,
          Math.abs(s.cx),
          Math.abs(s.cy - expectedY),
          Math.abs(s.sx - 1),
          Math.abs(s.sy - 1),
          Math.abs(s.rz)
        );
      }
      if (Math.abs(stripH) <= 0) maxFinalErr = 999;
    }
  }

  // 与 verify_749_paper_anim.lua 的 mid1 时刻（3 帧 @ 60fps / 0.36s = 1/7.2）对账
  const uMid = Math.min(1, (3 / 60) / (spec.duration || 0.36));
  const mid = solveFrame(spec, uMid, flip).metrics;

  const checks = [
    { name: 'zero_stretch', pass: worstStretch <= maxStretchAllowed, actual: +worstStretch.toFixed(4), limit: `<= ${maxStretchAllowed}` },
    { name: 'bottom_left_no_protrude', pass: minBlY >= minBlYAllowed, actual: +minBlY.toFixed(4), limit: `>= ${minBlYAllowed}` },
    { name: 'top_left_clearance', pass: maxTlY <= maxTlYAllowed, actual: +maxTlY.toFixed(4), limit: `<= ${maxTlYAllowed}` },
    { name: 'top_right_clearance', pass: maxTrY <= maxTrYAllowed, actual: +maxTrY.toFixed(4), limit: `<= ${maxTrYAllowed}` },
    { name: 'top_right_smooth_step', pass: worstStepX <= maxStepAllowed, actual: +worstStepX.toFixed(4), limit: `<= ${maxStepAllowed}` },
    { name: 'all_opaque_255', pass: opaqueAll, actual: opaqueAll, limit: 'true' },
    { name: 'rest_convergence_u1', pass: maxFinalErr < 1e-6, actual: +maxFinalErr.toExponential(2), limit: '< 1e-6' },
  ];

  if (gates.minMidTailAngleDeg != null) {
    checks.push({
      name: 'mid_tail_angle_range',
      pass: mid.fcNRz >= gates.minMidTailAngleDeg && mid.fcNRz <= (gates.maxMidTailAngleDeg ?? 10),
      actual: +mid.fcNRz.toFixed(4),
      limit: `[${gates.minMidTailAngleDeg}, ${gates.maxMidTailAngleDeg ?? 10}]`,
    });
  }
  if (gates.minMidBendDiffDeg != null) {
    checks.push({
      name: 'mid_bend_curvature',
      pass: mid.bendDiffDeg >= gates.minMidBendDiffDeg,
      actual: +mid.bendDiffDeg.toFixed(4),
      limit: `>= ${gates.minMidBendDiffDeg}`,
    });
  }

  return {
    pass: checks.every((c) => c.pass),
    frames,
    flip,
    uMid: +uMid.toFixed(4),
    mid: {
      fc1Rz: +mid.fc1Rz.toFixed(4),
      fcNRz: +mid.fcNRz.toFixed(4),
      bendDiffDeg: +mid.bendDiffDeg.toFixed(4),
      lLen: +mid.lLen.toFixed(4),
      rLen: +mid.rLen.toFixed(4),
      restArc: +mid.restArc.toFixed(4),
      maxStepX: +mid.maxStepX.toFixed(4),
      tlY: +mid.tl.y.toFixed(4),
      trY: +mid.tr.y.toFixed(4),
      blY: +mid.bl.y.toFixed(4),
    },
    checks,
  };
}

export function renderMultiFrameSvg(spec, sampleUs = [0.0, 0.14, 0.30, 0.55, 0.85, 1.0]) {
  const { w, h } = spec.base;
  const padX = 70;
  const padY = 65;
  const cellW = Math.ceil(w + padX * 2);
  const cellH = Math.ceil(h + padY * 2 + 40);
  const cols = 3;
  const rows = Math.ceil(sampleUs.length / cols);
  const totalW = cols * cellW;
  const totalH = rows * cellH;
  const stripH = h / (spec.strips || 16);

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`,
    `<rect width="100%" height="100%" fill="#261A14"/>`,
  ];

  sampleUs.forEach((u, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ox = col * cellW + cellW / 2;
    const oy = row * cellH + padY + h / 2;
    const frame = solveFrame(spec, u, false);

    // 静止参考虚线框 + 底部安全线
    parts.push(`<g id="frame-${idx}">`);
    parts.push(
      `<rect x="${(ox - w / 2).toFixed(1)}" y="${(oy - h / 2).toFixed(1)}" width="${w}" height="${h}" ` +
      `fill="#ECE2CC" fill-opacity="0.14" stroke="#DA9347" stroke-dasharray="6 4" stroke-width="1.5"/>`
    );

    // 16 条边框带
    for (let i = 0; i < frame.strips.length; i++) {
      const s = frame.strips[i];
      const hb = (i === 0 || i === frame.strips.length - 1 ? stripH + 10 : stripH + 12) * s.sy;
      const wb = (w + 4) * s.sx;
      const sx = ox + s.borderPos.x;
      const sy = oy - s.borderPos.y;
      parts.push(
        `<rect x="${(-wb / 2).toFixed(2)}" y="${(-hb / 2).toFixed(2)}" width="${wb.toFixed(2)}" height="${hb.toFixed(2)}" ` +
        `fill="${s.borderColor.css}" transform="translate(${sx.toFixed(2)},${sy.toFixed(2)}) rotate(${(-s.rz).toFixed(3)})"/>`
      );
    }
    // 16 条纸面带
    for (let i = 0; i < frame.strips.length; i++) {
      const s = frame.strips[i];
      const hf = (i === 0 || i === frame.strips.length - 1 ? stripH + 8 : stripH + 12) * s.sy;
      const wf = w * s.sx;
      const sx = ox + s.facePos.x;
      const sy = oy - s.facePos.y;
      parts.push(
        `<rect x="${(-wf / 2).toFixed(2)}" y="${(-hf / 2).toFixed(2)}" width="${wf.toFixed(2)}" height="${hf.toFixed(2)}" ` +
        `fill="${s.faceColor.css}" transform="translate(${sx.toFixed(2)},${sy.toFixed(2)}) rotate(${(-s.rz).toFixed(3)})"/>`
      );
    }

    const m = frame.metrics;
    parts.push(
      `<text x="${(col * cellW + 18).toFixed(1)}" y="${(row * cellH + 26).toFixed(1)}" fill="#F6E7D2" font-family="monospace" font-size="14">` +
      `u=${u.toFixed(2)}  rz=[${m.fc1Rz.toFixed(2)}°,${m.fcNRz.toFixed(2)}°]  stepX=${m.maxStepX.toFixed(2)}px  stretch=${m.maxStretchPx.toFixed(2)}px` +
      `</text>`
    );
    parts.push(`</g>`);
  });

  parts.push(`</svg>`);
  return parts.join('\n');
}

export function emitLuaConfigSnippet(key, spec) {
  const faceRGB = parseColorHex(spec.colors.face);
  const brRGB = parseColorHex(spec.colors.border);
  const p = spec.params;
  return [
    `-- 由 qianxing-murdoku-tool/animation/tools/kirchhoff-paper-sim.mjs 自动生成`,
    `-- 预设：${key}（${spec.name || key}） · 基尔霍夫薄板方程双模态解析配置`,
    `local PAPER_ANIM_CFG_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')} = {`,
    `  prefix = ${JSON.stringify(spec.prefix || 'panel.')},`,
    `  duration = ${spec.duration ?? 0.36},`,
    `  strips = ${spec.strips ?? 16},`,
    `  baseX = ${spec.base.cx}, baseY = ${spec.base.cy}, w = ${spec.base.w}, h = ${spec.base.h},`,
    `  vPTop = ${spec.anchors.vPTop}, vPBot = ${spec.anchors.vPBot},`,
    `  vTop = ${spec.anchors.vTop}, vBot = ${spec.anchors.vBot},`,
    `  headDxA = ${p.headDxA}, headDxB = ${p.headDxB}, headDy = ${p.headDy}, arcLiftY = ${p.arcLiftY},`,
    `  thetaHeadA = ${p.thetaHeadA}, thetaHeadB = ${p.thetaHeadB},`,
    `  ampKl = ${p.ampKl}, ampAir = ${p.ampAir}, obliqueDeg = ${p.obliqueDeg}, airTwistDeg = ${p.airTwistDeg},`,
    `  perspF = ${p.perspF}, globalWidthTilt = ${p.globalWidthTilt},`,
    `  faceR = ${faceRGB.r}, faceG = ${faceRGB.g}, faceB = ${faceRGB.b},`,
    `  brR = ${brRGB.r}, brG = ${brRGB.g}, brB = ${brRGB.b},`,
    `  underEndScale = ${p.underEndScale}, underEndRot = ${p.underEndRot},`,
    `}`,
    '',
  ].join('\n');
}

function runSelfTest() {
  const data = JSON.parse(fs.readFileSync(DEFAULT_PRESETS, 'utf8'));
  let allPass = true;
  const summary = {};
  for (const [key, spec] of Object.entries(data.presets)) {
    for (const flip of [false, true]) {
      const rep = auditTimeline(spec, 60, flip);
      summary[`${key}${flip ? ':flip' : ''}`] = { pass: rep.pass, mid: rep.mid };
      if (!rep.pass) {
        allPass = false;
        console.error(`❌ 自检失败: ${key} (flip=${flip})`, rep.checks.filter((c) => !c.pass));
      }
    }
    const svg = renderMultiFrameSvg(spec);
    if (!svg.startsWith('<svg') || (svg.match(/<rect/g) || []).length < 100) {
      allPass = false;
      console.error(`❌ SVG 预览生成异常: ${key}`);
    }
    const lua = emitLuaConfigSnippet(key, spec);
    if (!lua.includes('ampKl') || !lua.includes('perspF')) {
      allPass = false;
      console.error(`❌ Lua 配置生成异常: ${key}`);
    }
  }
  console.log(JSON.stringify({ selfTest: allPass ? 'PASS' : 'FAIL', summary }, null, 2));
  process.exit(allPass ? 0 : 1);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts['self-test']) {
    runSelfTest();
    return;
  }

  let spec;
  let presetKey = opts.preset || 'shop_card';
  if (opts.spec) {
    spec = JSON.parse(fs.readFileSync(path.resolve(opts.spec), 'utf8'));
    presetKey = path.basename(opts.spec, path.extname(opts.spec));
  } else {
    const data = JSON.parse(fs.readFileSync(DEFAULT_PRESETS, 'utf8'));
    spec = data.presets[presetKey];
    if (!spec) {
      console.error(`❌ 未找到预设 "${presetKey}"，可选：${Object.keys(data.presets).join(', ')}`);
      process.exit(2);
    }
  }

  const flip = Boolean(opts.flip);
  const frames = Number(opts.frames || 60);

  if (opts.svg) {
    const svgPath = path.resolve(opts.svg);
    fs.mkdirSync(path.dirname(svgPath), { recursive: true });
    fs.writeFileSync(svgPath, renderMultiFrameSvg(spec), 'utf8');
    console.log(`✅ SVG 预览已写出: ${svgPath}`);
  }

  if (opts['emit-lua']) {
    const luaPath = path.resolve(opts['emit-lua']);
    fs.mkdirSync(path.dirname(luaPath), { recursive: true });
    fs.writeFileSync(luaPath, emitLuaConfigSnippet(presetKey, spec), 'utf8');
    console.log(`✅ Lua 配置片段已写出: ${luaPath}`);
  }

  if (opts.u !== undefined) {
    const res = solveFrame(spec, Number(opts.u), flip);
    console.log(JSON.stringify({ preset: presetKey, u: res.u, metrics: res.metrics, anchors: res.anchors }, null, 2));
    return;
  }

  const report = auditTimeline(spec, frames, flip);
  console.log(JSON.stringify({ preset: presetKey, ...report }, null, 2));
  if (opts.audit && !report.pass) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
