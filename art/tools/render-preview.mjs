#!/usr/bin/env node
// 用「模板层规格 + 关卡布局」离线渲染观感基准图（SVG，无任何依赖、无官方素材）。
// 画的是"脚本按模板实例化之后，棋盘上应该长什么样"：房间底色 → 每件家具逐层（矩形/椭圆）。
//
// 用法：
//   node art/tools/render-preview.mjs --layout=art/examples/level-demo.json \
//        --spec=art/specs/furniture_templates.json --out=out/art-preview.svg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argOf = (k, d = null) => {
  const a = process.argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};

const CANVAS = [1600, 900];
const FRAME = { x: 608, y: 138, size: 584, ruler: 12, gap: 4 };

function colorOf(argb) {
  const v = typeof argb === 'string' ? parseInt(argb.replace(/^0x/i, ''), 16) : argb;
  const a = ((v >>> 24) & 0xff) / 255;
  const r = (v >>> 16) & 0xff;
  const g = (v >>> 8) & 0xff;
  const b = v & 0xff;
  return { fill: `rgb(${r},${g},${b})`, alpha: a };
}

function geometry(n) {
  const avail = FRAME.size - 2 * FRAME.ruler;
  const pitch = Math.floor(avail / n);
  const cell = pitch - FRAME.gap;
  const grid = n * pitch - FRAME.gap;
  const gx = FRAME.x + FRAME.ruler + Math.floor((avail - grid) / 2);
  const gy = FRAME.y + FRAME.ruler + Math.floor((avail - grid) / 2);
  return { n, pitch, cell, gx, gy };
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function main() {
  const layoutPath = argOf('layout', path.join(HERE, '..', 'examples', 'level-demo.json'));
  const specPath = argOf('spec', path.join(HERE, '..', 'specs', 'furniture_templates.json'));
  const outPath = argOf('out', path.join(HERE, '..', '..', 'out', 'art-preview.svg'));
  const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const g = geometry(Math.max(layout.rows, layout.cols));
  const roomById = new Map((layout.rooms || []).map((r) => [String(r.id), r]));

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS[0]}" height="${CANVAS[1]}" viewBox="0 0 ${CANVAS[0]} ${CANVAS[1]}">`);
  parts.push(`<rect width="100%" height="100%" fill="#141018"/>`);
  // 棋盘外框
  parts.push(`<rect x="${FRAME.x}" y="${FRAME.y}" width="${FRAME.size}" height="${FRAME.size}" fill="#0b0a0d" rx="4"/>`);
  // 房间底色（= 运行时 face 层要画的颜色）
  for (let r = 1; r <= layout.rows; r++) {
    const row = (layout.cells || [])[r - 1] || '';
    for (let c = 1; c <= layout.cols; c++) {
      const room = roomById.get(row[c - 1]);
      const color = room ? room.color : '#CCCCCC';
      const x = g.gx + (c - 1) * g.pitch;
      const y = g.gy + (r - 1) * g.pitch;
      parts.push(`<rect x="${x}" y="${y}" width="${g.cell}" height="${g.cell}" fill="${esc(color)}"/>`);
    }
  }
  // 家具（按 slice 的规则重新分组；这里直接内联，保持工具零依赖）
  const pieces = slice(layout);
  const scale = g.cell / spec.cellTemplatePx;   // 模板层按 108 基准写死，运行时按 格子/108 缩放
  for (const p of pieces) {
    const tpl = (spec.templates || {})[p.templateKey];
    if (!tpl) { parts.push(`<!-- 缺模板 ${esc(p.templateKey)} -->`); continue; }
    const cx = g.gx + (p.anchor.c - 1) * g.pitch + g.cell / 2 + p.offsetCells.dx * g.pitch;
    const cy = g.gy + (p.anchor.r - 1) * g.pitch + g.cell / 2 + p.offsetCells.dy * g.pitch;
    for (const L of tpl.layers) {
      const w = L.w * scale;
      const h = L.h * scale;
      const x = cx + (L.dx ?? 0) * scale - w / 2;
      const y = cy + (L.dy_down ?? 0) * scale - h / 2;
      const col = colorOf(L.color);
      const opacity = col.alpha < 0.999 ? ` opacity="${col.alpha.toFixed(3)}"` : '';
      if (L.imageId === 100002) {
        parts.push(`<ellipse cx="${(x + w / 2).toFixed(2)}" cy="${(y + h / 2).toFixed(2)}" rx="${(w / 2).toFixed(2)}" ry="${(h / 2).toFixed(2)}" fill="${col.fill}"${opacity}/>`);
      } else if (L.imageId === 107102) {
        const r = Math.min(w, h) * 0.06;
        parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${r.toFixed(2)}" fill="${col.fill}"${opacity}/>`);
      } else if (L.imageId === 106056) {
        parts.push(`<ellipse cx="${(x + w / 2).toFixed(2)}" cy="${(y + h / 2).toFixed(2)}" rx="${(w / 2).toFixed(2)}" ry="${(h / 2).toFixed(2)}" fill="${col.fill}" opacity="${(col.alpha * 0.5).toFixed(3)}"/>`);
      } else {
        parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${col.fill}"${opacity}/>`);
      }
    }
    // 调试标签：件名 + 模板键（导出给美术核对用；需要干净图时加 --no-labels）
    if (!process.argv.includes('--no-labels')) {
      parts.push(`<text x="${cx.toFixed(1)}" y="${(cy - tpl.sizePx[1] * scale / 2 - 4).toFixed(1)}" font-size="10" fill="#ffe9a8" text-anchor="middle">${esc(p.name)}</text>`);
    }
  }
  // 房间名（白字黑边，和运行时 label 一致）
  for (let r = 1; r <= layout.rows; r++) {
    const row = (layout.cells || [])[r - 1] || '';
    for (let c = 1; c <= layout.cols; c++) {
      const room = roomById.get(row[c - 1]);
      if (!room || !room.name) continue;
      if (r < layout.rows && (layout.cells || [])[r]?.[c - 1] === row[c - 1]) continue;   // 只在房间最后一行画名字
      const x = g.gx + (c - 1) * g.pitch + g.cell / 2;
      const y = g.gy + (r - 1) * g.pitch + g.cell - 8;
      parts.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="16" fill="#ffffff" stroke="#1F1A14" stroke-width="2" paint-order="stroke" text-anchor="middle">${esc(room.name)}</text>`);
    }
  }
  parts.push('</svg>');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, parts.join('\n'));
  console.log(`render-preview: ${pieces.length} 件 → ${outPath}`);
}

// 与 slice-layout.mjs 相同的分组规则（工具间保持行为一致）
function slice(layout) {
  const rows = layout.rows;
  const cols = layout.cols;
  const grid = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(null));
  for (const obj of layout.objects || []) for (const [r, c] of obj.cells || []) grid[r][c] = obj;
  const seen = new Set();
  const out = [];
  const combine = new Set(['table', 'carpet']);
  const keyOf = (kind, spanR, spanC) => {
    if (kind === 'table') return spanC > 1 ? 'furn.table.h2' : (spanR > 1 ? 'furn.table.v2' : 'furn.table.1');
    if (kind === 'carpet') return 'furn.rug';
    return 'furn.' + kind;
  };
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const obj = grid[r][c];
      if (!obj || seen.has(r + ',' + c)) continue;
      if (!combine.has(obj.kind)) {
        seen.add(r + ',' + c);
        out.push({ name: obj.name, kind: obj.kind, templateKey: keyOf(obj.kind, 1, 1), anchor: { r, c }, offsetCells: { dx: 0, dy: 0 } });
        continue;
      }
      const group = [];
      const q = [[r, c]];
      seen.add(r + ',' + c);
      while (q.length) {
        const [cr, cc] = q.shift();
        group.push([cr, cc]);
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 1 || nr > rows || nc < 1 || nc > cols) continue;
          if (grid[nr][nc] !== obj || seen.has(nr + ',' + nc)) continue;
          seen.add(nr + ',' + nc);
          q.push([nr, nc]);
        }
      }
      const rs = group.map((x) => x[0]);
      const cs = group.map((x) => x[1]);
      const box = { r1: Math.min(...rs), r2: Math.max(...rs), c1: Math.min(...cs), c2: Math.max(...cs) };
      const anchor = { r: box.r2, c: box.c2 };
      out.push({
        name: obj.name, kind: obj.kind,
        templateKey: keyOf(obj.kind, box.r2 - box.r1 + 1, box.c2 - box.c1 + 1),
        anchor,
        offsetCells: { dx: (box.c1 + box.c2) / 2 - anchor.c, dy: (box.r1 + box.r2) / 2 - anchor.r },
      });
    }
  }
  return out;
}

main();
