#!/usr/bin/env node
// art-pipeline 自检（离线、无依赖）：
//   1. 规格自检（check-spec.mjs）
//   2. gen-layers：若给了主项目 furn_art.lua，则重新生成并与 art/specs 比对
//   3. slice-layout：示例布局切件结果断言（横桌/竖桌/方桌/地毯/椅子）
//   4. render-preview：生成 SVG 预览并做基本断言
//
// 用法：
//   node art/test/run.mjs                                   # 只跑仓库内规格（不需要主项目）
//   node art/test/run.mjs --furn-art=../qianxing-murdoku/lua/furn_art.lua   # 额外做"生成一致"校验
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(HERE, '..');
const REPO = path.join(ART, '..');
const OUT = path.join(REPO, 'out');
const argOf = (k, d = null) => {
  const a = process.argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};

let passed = 0;
let failed = 0;
const ok = (cond, msg) => { if (cond) { passed += 1; } else { failed += 1; console.log('  FAIL  ' + msg); } };

function runNode(args) {
  const r = spawnSync(process.execPath, args, { cwd: REPO, stdio: 'inherit' });
  return r.status === 0;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  console.log('== [1/4] 规格自检 ==');
  ok(runNode([path.join(ART, 'tools', 'check-spec.mjs')]), 'check-spec 应通过');

  console.log('== [2/4] gen-layers ==');
  const furnArt = argOf('furn-art');
  if (furnArt) {
    const outJson = path.join(OUT, 'gen-templates.json');
    const okGen = runNode([
      path.join(ART, 'tools', 'gen-layers.mjs'),
      '--furn-art=' + furnArt,
      '--out=' + outJson,
      '--check',
    ]);
    ok(okGen, 'gen-layers 生成结果应与 art/specs/furniture_templates.json 一致');
    ok(fs.existsSync(outJson), 'gen-layers 应产出 JSON');
  } else {
    console.log('  SKIP（未给 --furn-art=，跳过"从主项目 lua 重新生成并比对"）');
  }

  console.log('== [3/4] slice-layout ==');
  const sliceJson = path.join(OUT, 'slice.json');
  ok(runNode([
    path.join(ART, 'tools', 'slice-layout.mjs'),
    '--layout=' + path.join(ART, 'examples', 'level-demo.json'),
    '--out=' + sliceJson,
  ]), 'slice-layout 应成功');
  const sliced = JSON.parse(fs.readFileSync(sliceJson, 'utf8'));
  ok(sliced.pieces.length === 8, `示例布局应切出 8 件（实际 ${sliced.pieces.length}）`);
  const byName = Object.fromEntries(sliced.pieces.map((p) => [p.name, p]));
  const longTable = byName['长桌'];
  ok(longTable && longTable.templateKey === 'furn.table.h2', '长桌应选横桌模板 furn.table.h2');
  ok(longTable && longTable.anchor.r === 1 && longTable.anchor.c === 2, '长桌锚点格 = (1,2)（包围盒右下）');
  ok(longTable && longTable.span.r === 1 && longTable.span.c === 2, '长桌 span = 1×2');
  ok(longTable && Math.abs(longTable.offsetCells.dx + 0.5) < 1e-9, '长桌整件中心相对锚点格 dx = -0.5');
  const tallTable = byName['竖桌'];
  ok(tallTable && tallTable.templateKey === 'furn.table.v2', '竖桌应选竖桌模板 furn.table.v2');
  ok(tallTable && tallTable.span.r === 2 && tallTable.span.c === 1, '竖桌 span = 2×1');
  const square = byName['方桌'];
  ok(square && square.templateKey === 'furn.table.1', '方桌应选 furn.table.1');
  const rug = byName['地毯'];
  ok(rug && rug.templateKey === 'furn.rug', '地毯应选 furn.rug');
  ok(rug && rug.span.r === 2 && rug.span.c === 1, '地毯 span = 2×1');
  ok(sliced.errors.length === 0, '示例布局不应有切件错误');

  console.log('== [4/4] render-preview ==');
  const svgPath = path.join(OUT, 'art-preview.svg');
  ok(runNode([
    path.join(ART, 'tools', 'render-preview.mjs'),
    '--layout=' + path.join(ART, 'examples', 'level-demo.json'),
    '--spec=' + path.join(ART, 'specs', 'furniture_templates.json'),
    '--out=' + svgPath,
  ]), 'render-preview 应成功');
  const svg = fs.readFileSync(svgPath, 'utf8');
  ok(svg.startsWith('<svg'), 'SVG 开头正确');
  ok(svg.length > 4096, `SVG 体积应 > 4KB（实际 ${svg.length}）`);
  ok(svg.includes('大屋') && svg.includes('内室'), 'SVG 应包含房间名');
  ok((svg.match(/<rect/g) || []).length > 20, 'SVG 应有足够多的矩形层');

  console.log(`\nart-pipeline: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
