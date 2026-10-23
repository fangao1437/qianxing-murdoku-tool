#!/usr/bin/env node
// 把「关卡布局 JSON」切成「每件家具 → 模板键 + 锚点格 + 跨格数 + 整件中心偏移」。
// 这是脚本运行时下发给适配层的东西（ui_controller 里那段 TPL_KEY / furn_span / furn_offset 的等价物），
// 工具化之后可以在离线先验证"哪一格用哪个模板、偏移对不对"。
//
// 用法：
//   node art/tools/slice-layout.mjs --layout=art/examples/level-demo.json [--out=out/slice.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argOf = (k, d = null) => {
  const a = process.argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};

const SINGLE_KINDS = new Set(['chair', 'plant', 'statue', 'shelf']);
const COMBINE_KINDS = new Set(['table', 'carpet']);   // 4 邻接合并成"一件"
const KNOWN_KINDS = new Set([...SINGLE_KINDS, ...COMBINE_KINDS]);

function templateKey(kind, spanR, spanC) {
  if (kind === 'table') {
    if (spanC > 1) return 'furn.table.h2';
    if (spanR > 1) return 'furn.table.v2';
    return 'furn.table.1';
  }
  if (kind === 'carpet') return 'furn.rug';
  return 'furn.' + kind;
}

function main() {
  const layoutPath = argOf('layout', path.join(HERE, '..', 'examples', 'level-demo.json'));
  const outPath = argOf('out', path.join(HERE, '..', '..', 'out', 'slice.json'));
  const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  const rows = layout.rows;
  const cols = layout.cols;

  const errors = [];
  const grid = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(null));
  for (const obj of layout.objects || []) {
    if (!KNOWN_KINDS.has(obj.kind)) errors.push(`未知家具类型：${obj.kind}（${obj.name}）`);
    for (const [r, c] of obj.cells || []) {
      if (r < 1 || r > rows || c < 1 || c > cols) errors.push(`${obj.name}: 格子 (${r},${c}) 越界`);
      if (grid[r][c] != null) errors.push(`${obj.name}: 格子 (${r},${c}) 已被 ${grid[r][c].name} 占用`);
      grid[r][c] = obj;
    }
  }

  // 4 邻接分组（只对 COMBINE_KINDS 合并）
  const seen = new Set();
  const pieces = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const obj = grid[r][c];
      if (obj == null || seen.has(r + ',' + c)) continue;
      if (!COMBINE_KINDS.has(obj.kind)) {
        seen.add(r + ',' + c);
        pieces.push({
          name: obj.name, kind: obj.kind, templateKey: templateKey(obj.kind, 1, 1),
          anchor: { r, c }, span: { r: 1, c: 1 }, offsetCells: { dx: 0, dy: 0 },
          cells: [{ r, c }],
        });
        continue;
      }
      // BFS 同 kind 且同 object 的格子
      const group = [];
      const queue = [[r, c]];
      seen.add(r + ',' + c);
      while (queue.length > 0) {
        const [cr, cc] = queue.shift();
        group.push({ r: cr, c: cc });
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 1 || nr > rows || nc < 1 || nc > cols) continue;
          if (grid[nr][nc] !== obj || seen.has(nr + ',' + nc)) continue;
          seen.add(nr + ',' + nc);
          queue.push([nr, nc]);
        }
      }
      const rs = group.map((g) => g.r);
      const cs = group.map((g) => g.c);
      const box = { r1: Math.min(...rs), r2: Math.max(...rs), c1: Math.min(...cs), c2: Math.max(...cs) };
      const span = { r: box.r2 - box.r1 + 1, c: box.c2 - box.c1 + 1 };
      const anchor = { r: box.r2, c: box.c2 };   // 锚点格 = 包围盒右下格（与主项目一致）
      pieces.push({
        name: obj.name, kind: obj.kind, templateKey: templateKey(obj.kind, span.r, span.c),
        anchor, span,
        offsetCells: {
          dx: (box.c1 + box.c2) / 2 - anchor.c,
          dy: (box.r1 + box.r2) / 2 - anchor.r,
        },
        cells: group,
      });
    }
  }

  const out = {
    level: layout.name,
    rows, cols, cellTemplatePx: 108,
    imageIds: { rect: 100001, ellipse: 100002, round: 107102, shadowSoft: 106056 },
    pieces,
    errors,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  for (const e of errors) console.log('  ERROR ' + e);
  console.log(`slice-layout: ${pieces.length} 件，${errors.length} 个错误 → ${outPath}`);
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
