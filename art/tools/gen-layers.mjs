#!/usr/bin/env node
// 从主项目的 `lua/furn_art.lua` 生成「家具模板逐层规格」JSON（与 art/specs/furniture_templates.json 同构）。
// 这是美术制作流程的第 ③ 步：把"手写层表"变成可校验、可渲染、可交给 .gil 写入工具的数据。
//
// 用法：
//   node art/tools/gen-layers.mjs --furn-art=../qianxing-murdoku/lua/furn_art.lua --out=out/furniture_templates.json
//   node art/tools/gen-layers.mjs --furn-art=... --out=out/x.json --check   # 与 art/specs 内的版本比对
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.join(HERE, '..', 'specs', 'furniture_templates.json');
const argOf = (k, d = null) => {
  const a = process.argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};

const CELL_PX = 108;

// ── 地毯模板（3 层；F.ART 里没有它，走 F.rug_cell_els 的程序化路线，这里固化成模板层规格）──
const RUG = {
  'furn.rug': {
    kind: 'carpet', variant: '1',
    desc: '地毯：3 层（外框/内面/内框线，整块按包围盒拉伸，居中）',
    sizePx: [108, 108], layerCount: 3,
    layers: [
      { order: 1, imageId: 100001, shape: 'rect', color: '0xFFB89A62', w: 108, h: 108, dx: 0, dy_down: 0, y_up: 0 },
      { order: 2, imageId: 100001, shape: 'rect', color: '0xFFDCC684', w: 82.1, h: 82.1, dx: 0, dy_down: 0, y_up: 0 },
      { order: 3, imageId: 100001, shape: 'rect', color: '0xFFC9B072', w: 64.8, h: 64.8, dx: 0, dy_down: 0, y_up: 0 },
    ],
  },
};

const round2 = (v) => Math.round(v * 100) / 100;

function blockOf(src, openRe, closeRe) {
  const start = openRe.exec(src);
  if (!start) return '';
  const tail = src.slice(start.index + start[0].length);
  const end = closeRe.exec(tail);
  return end ? tail.slice(0, end.index) : tail;
}

export function generate(luaSrc) {
  const palette = {};
  for (const m of luaSrc.matchAll(/^\s+([a-zA-Z_][\w]*)\s*=\s*(0x[0-9A-Fa-f]{8}),/gm)) {
    palette[m[1]] = m[2].toUpperCase();
  }
  const imgBlock = blockOf(luaSrc, /local IMG = \{/, /\n\}/);
  const img = {};
  for (const m of imgBlock.matchAll(/([a-zA-Z_][\w]*)\s*=\s*(\d{6})/g)) img[m[1]] = Number(m[2]);

  const artBlock = blockOf(luaSrc, /F\.ART = \{/, /\n\}/);
  const templates = {};

  // 逐件：`\n  kind = {`，件内逐变体 `["1"] = { ... },`
  for (const km of artBlock.matchAll(/\n {2}([a-z_]+) = \{/g)) {
    const kind = km[1];
    const from = km.index;
    const nextKind = artBlock.slice(from + 1).search(/\n {2}[a-z_]+ = \{/);
    const block = nextKind >= 0 ? artBlock.slice(from, from + 1 + nextKind) : artBlock.slice(from);
    for (const vm of block.matchAll(/\["([^"]+)"\] = \{(.*?)\n {4}\},/gs)) {
      const variant = vm[1];
      const body = vm[2];
      const layers = [];
      for (const lm of body.matchAll(
        /\{ id = IMG\.([a-z_0-9]+),\s*color = C\.([a-z_0-9]+),\s*w = ([0-9.]+), h = ([0-9.]+)(?:, dx = (-?[0-9.]+))?(?:, dy = (-?[0-9.]+))?/g)) {
        const shape = lm[1];
        const colorName = lm[2];
        const w = Number(lm[3]) * CELL_PX;
        const h = Number(lm[4]) * CELL_PX;
        const dx = (lm[5] ? Number(lm[5]) : 0) * CELL_PX;
        const dy = (lm[6] ? Number(lm[6]) : 0) * CELL_PX;
        layers.push({
          order: layers.length + 1,
          imageId: img[shape],
          shape,
          color: palette[colorName],
          colorName,
          w: round2(w), h: round2(h),
          dx: round2(dx), dy_down: round2(dy), y_up: round2(-dy),
        });
      }
      if (layers.length === 0) continue;
      const name = kind === 'table' ? 'furn.table' + (variant === '1' ? '.1' : '.' + variant) : 'furn.' + kind;
      const canvas = kind === 'table'
        ? (variant === 'h2' ? [216, 108] : (variant === 'v2' ? [108, 216] : [108, 108]))
        : [108, 108];
      templates[name] = {
        kind, variant, desc: `${kind} 变体 ${variant}`,
        sizePx: canvas, layerCount: layers.length, layers,
      };
    }
  }
  Object.assign(templates, RUG);
  return {
    note: '家具模板逐层规格（生成物）。坐标相对模板 content 中心；dy_down 向下为正，y_up = -dy_down。模板 content 画布基准 = 1 格 = 108 画布像素。',
    cellTemplatePx: CELL_PX,
    imageIds: { rect: 100001, ellipse: 100002, round: 107102, shadowSoft: 106056 },
    templates,
  };
}

function comparable(spec) {
  const out = {};
  for (const [name, t] of Object.entries(spec.templates || {})) {
    out[name] = {
      kind: t.kind, sizePx: t.sizePx, layerCount: t.layerCount,
      layers: (t.layers || []).map((l) => ({
        order: l.order, imageId: l.imageId, color: l.color,
        w: l.w, h: l.h, dx: l.dx, dy_down: l.dy_down, y_up: l.y_up,
      })),
    };
  }
  return out;
}

function diffSpecs(a, b) {
  const diffs = [];
  const ca = comparable(a);
  const cb = comparable(b);
  const names = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  for (const n of names) {
    if (!ca[n] || !cb[n]) { diffs.push(`模板 ${n}: 只在一边存在`); continue; }
    if (ca[n].layerCount !== cb[n].layerCount) diffs.push(`模板 ${n}: 层数 ${ca[n].layerCount} != ${cb[n].layerCount}`);
    const la = ca[n].layers;
    const lb = cb[n].layers;
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      const x = la[i] || {};
      const y = lb[i] || {};
      for (const k of ['order', 'imageId', 'color', 'w', 'h', 'dx', 'dy_down', 'y_up']) {
        const xv = x[k];
        const yv = y[k];
        if (typeof xv === 'number' && typeof yv === 'number') {
          if (Math.abs(xv - yv) > 0.011) diffs.push(`模板 ${n} L${i + 1}: ${k} ${xv} != ${yv}`);
        } else if (xv !== yv) diffs.push(`模板 ${n} L${i + 1}: ${k} ${xv} != ${yv}`);
      }
    }
  }
  return diffs;
}

function main() {
  const src = argOf('furn-art');
  const out = argOf('out', path.join(HERE, '..', '..', 'out', 'furniture_templates.json'));
  if (!src) {
    console.error('用法：node art/tools/gen-layers.mjs --furn-art=<主项目 lua/furn_art.lua 路径> [--out=...] [--check]');
    process.exit(2);
  }
  const lua = fs.readFileSync(src, 'utf8');
  const spec = generate(lua);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(spec, null, 1));
  const names = Object.keys(spec.templates);
  console.log(`gen-layers: ${names.length} 个模板（${names.join(', ')}）→ ${out}`);

  if (process.argv.includes('--check')) {
    const shipped = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
    const diffs = diffSpecs(spec, shipped);
    if (diffs.length > 0) {
      for (const d of diffs.slice(0, 30)) console.log('  DIFF ' + d);
      console.log(`gen-layers --check: ✗ ${diffs.length} 处差异（与 art/specs/furniture_templates.json 不一致）`);
      process.exit(1);
    }
    console.log('gen-layers --check: ✓ 与 art/specs/furniture_templates.json 一致（容差 0.011px）');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
