#!/usr/bin/env node
// animation-pipeline 自检（离线、零依赖）：
//   1. presets JSON 规格自洽校验
//   2. kirchhoff-paper-sim.mjs --self-test（shop_card / bag_note 双姿态全 60 帧物理硬闸门）
//   3. 产出 SVG 多帧预览与 Lua 配置片段并断言
//   4. 可选：传入 --gil=<749_v8.gil> [--base=<748.gil>] 时执行真实存档 6 道静态审计闸门
//
// 用法：
//   node animation/test/run.mjs
//   node animation/test/run.mjs --gil=../qianxing-murdoku/749_背包商店右侧纸张切换动画/749_背包商店右侧纸张切换动画_v8.gil --base=../qianxing-murdoku/748_全核查修复与自闭环验证/748_全核查修复与自闭环验证.gil

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANIM = path.resolve(HERE, '..');
const REPO = path.resolve(ANIM, '..');
const OUT = path.join(REPO, 'out');

const argOf = (k) => {
  const a = process.argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null;
};

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) {
    passed += 1;
    console.log('  ✅ ' + msg);
  } else {
    failed += 1;
    console.log('  ❌ ' + msg);
  }
};

function runNode(args) {
  return spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  console.log('== [1/4] 预设规格自洽 ==');
  const presetsPath = path.join(ANIM, 'specs', 'paper_presets.json');
  const data = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
  ok(data.schema === 'qx-kirchhoff-paper-presets/v1', 'schema 版本正确');
  ok(Boolean(data.presets.shop_card && data.presets.bag_note), '包含 shop_card 与 bag_note 双预设');
  for (const [k, sp] of Object.entries(data.presets)) {
    ok(sp.strips === 16, `${k}: strips = 16`);
    ok(sp.colors.border.startsWith('#FF') && sp.colors.face.startsWith('#FF'), `${k}: 边框与纸面均为 100% 不透明 #FF`);
    ok(sp.params.perspF >= 2000, `${k}: 透视焦距合理 (${sp.params.perspF})`);
  }

  console.log('== [2/4] 基尔霍夫薄板求解器 --self-test ==');
  const rSelf = runNode([path.join(ANIM, 'tools', 'kirchhoff-paper-sim.mjs'), '--self-test']);
  ok(rSelf.status === 0, 'kirchhoff-paper-sim --self-test 全部 60 帧硬闸门通过');
  if (rSelf.status !== 0) console.error(rSelf.stderr || rSelf.stdout);

  console.log('== [3/4] SVG 多帧预览 + Lua 配置生成 ==');
  const svgOut = path.join(OUT, 'anim-shop-preview.svg');
  const luaOut = path.join(OUT, 'anim-shop-cfg.lua');
  const rGen = runNode([
    path.join(ANIM, 'tools', 'kirchhoff-paper-sim.mjs'),
    '--preset=shop_card',
    '--audit',
    '--svg=' + svgOut,
    '--emit-lua=' + luaOut,
  ]);
  ok(rGen.status === 0, 'shop_card 审计 + SVG 预览 + Lua 片段生成通过');
  const svgTxt = fs.readFileSync(svgOut, 'utf8');
  const luaTxt = fs.readFileSync(luaOut, 'utf8');
  ok(svgTxt.startsWith('<svg') && (svgTxt.match(/<rect/g) || []).length >= 190, 'SVG 包含 6 帧 × 32 条弯曲纸带');
  ok(luaTxt.includes('PAPER_ANIM_CFG_SHOP_CARD') && luaTxt.includes('ampKl = 0.25'), 'Lua 配置片段格式正确');

  console.log('== [4/4] .gil 动画静态审计器 ==');
  const rBad = runNode([path.join(ANIM, 'tools', 'audit-gil-anim.mjs')]);
  ok(rBad.status === 2, 'audit-gil-anim 缺参数时干净返回 exit 2');
  const gilPath = argOf('gil');
  if (gilPath) {
    const args = [
      path.join(ANIM, 'tools', 'audit-gil-anim.mjs'),
      '--gil=' + gilPath,
      '--prefix=econ.shop736.,econ.bag741.',
      '--above=econ.shop736.s37,',
      '--strips=16',
    ];
    const basePath = argOf('base');
    if (basePath) args.push('--base=' + basePath);
    const rGil = runNode(args);
    ok(rGil.status === 0, '真实 .gil 存档 6 道动画静态审计全通过');
    if (rGil.status !== 0) console.error(rGil.stderr || rGil.stdout);
  } else {
    console.log('  SKIP（未传 --gil=，跳过真实 .gil 存档审计）');
  }

  console.log(`\nanimation-pipeline: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
