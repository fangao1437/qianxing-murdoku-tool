#!/usr/bin/env node
// 规格自检：校验 art/specs/furniture_templates.json 的结构、层数、颜色、尺寸、层序、模板键。
// 退出码 0 = 全部通过；1 = 有失败（打印 FAIL 行）。
//
// 用法：
//   node art/tools/check-spec.mjs [--spec=art/specs/furniture_templates.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SPEC = path.join(HERE, '..', 'specs', 'furniture_templates.json');

const argOf = (k, d = null) => {
  const a = process.argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : d;
};

const ALLOWED_IMAGE_IDS = new Set([100001, 100002, 100003, 107102, 106056]);
const EXPECTED_LAYERS = {
  'furn.chair': 9,
  'furn.plant': 10,
  'furn.statue': 10,
  'furn.table.1': 10,
  'furn.table.h2': 10,
  'furn.table.v2': 10,
  'furn.shelf': 12,
  'furn.rug': 3,
};
const EXPECTED_CANVAS = {
  'furn.table.h2': [216, 108],
  'furn.table.v2': [108, 216],
};

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed += 1; } else { failed += 1; console.log('  FAIL  ' + msg); }
};

function main() {
  const specPath = argOf('spec', DEFAULT_SPEC);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  console.log(`== 规格自检：${specPath} ==`);

  ok(spec.cellTemplatePx === 108, 'cellTemplatePx 必须是 108（1 格 = 108 画布像素）');
  const ids = spec.imageIds || {};
  ok(ids.rect === 100001 && ids.ellipse === 100002, 'imageIds.rect/ellipse 必须是官方基础形状 100001/100002');

  const templates = spec.templates || {};
  const names = Object.keys(templates).sort();
  const expected = Object.keys(EXPECTED_LAYERS).sort();
  ok(JSON.stringify(names) === JSON.stringify(expected),
    `模板集合必须恰好是 ${expected.join(', ')}（实际 ${names.join(', ')}）`);

  for (const name of expected) {
    const t = templates[name];
    if (t == null) continue;
    const layers = t.layers || [];
    ok(layers.length === EXPECTED_LAYERS[name],
      `${name}: 层数应为 ${EXPECTED_LAYERS[name]}（实际 ${layers.length}）`);
    ok(t.layerCount === layers.length, `${name}: layerCount 与 layers.length 一致`);
    const canvas = t.sizePx || [];
    const want = EXPECTED_CANVAS[name] || [108, 108];
    ok(canvas[0] === want[0] && canvas[1] === want[1],
      `${name}: content 画布应为 ${want[0]}×${want[1]}（实际 ${canvas[0]}×${canvas[1]}）`);

    const orders = layers.map((l) => l.order);
    ok(JSON.stringify(orders) === JSON.stringify(layers.map((_, i) => i + 1)),
      `${name}: 层 order 必须从 1 连续递增`);
    for (const l of layers) {
      const tag = `${name} L${l.order}`;
      ok(ALLOWED_IMAGE_IDS.has(l.imageId), `${tag}: imageId ${l.imageId} 不在允许集合`);
      ok(/^0[xX][0-9A-Fa-f]{8}$/.test(l.color), `${tag}: color 必须是 0xAARRGGBB（实际 ${l.color}）`);
      ok(typeof l.w === 'number' && l.w > 0 && l.w <= 240, `${tag}: w 必须在 (0,240]`);
      ok(typeof l.h === 'number' && l.h > 0 && l.h <= 240, `${tag}: h 必须在 (0,240]`);
      ok(Math.abs((l.y_up ?? 0) + (l.dy_down ?? 0)) < 0.011, `${tag}: y_up 必须等于 -dy_down`);
    }
  }

  // 地毯：三层必须同色系、居中、尺寸递减（108 > 82.1 > 64.8）
  const rug = templates['furn.rug'];
  if (rug) {
    const [a, b, c] = rug.layers;
    ok(a.w === 108 && a.h === 108, 'furn.rug L1 必须是整格 108×108');
    ok(Math.abs(b.w - 82.1) < 0.011 && Math.abs(b.h - 82.1) < 0.011, 'furn.rug L2 内面 82.1×82.1');
    ok(Math.abs(c.w - 64.8) < 0.011 && Math.abs(c.h - 64.8) < 0.011, 'furn.rug L3 内框线 64.8×64.8');
    ok(rug.layers.every((l) => (l.dx ?? 0) === 0 && (l.dy_down ?? 0) === 0), 'furn.rug 三层都居中（dx=dy=0）');
  }

  // 手搭层规格（回退路线）也顺手校验一下存在性与层数上限
  const handPath = path.join(HERE, '..', 'specs', 'furniture_hand_layers.json');
  if (fs.existsSync(handPath)) {
    const hand = JSON.parse(fs.readFileSync(handPath, 'utf8'));
    const parts = hand.parts || {};
    ok(Object.keys(parts).length >= 5, '手搭层规格：至少包含 5 类家具');
    for (const [kind, variants] of Object.entries(parts)) {
      for (const [v, layers] of Object.entries(variants)) {
        ok(layers.length <= 12, `手搭 ${kind}[${v}]: 层数必须 ≤ 12（模板层上限；实际 ${layers.length}）`);
      }
    }
  }

  console.log(`\ncheck-spec: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
