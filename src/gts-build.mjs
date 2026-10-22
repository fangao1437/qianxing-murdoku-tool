#!/usr/bin/env node
// src/gts-build.mjs —— 把 emit.mjs 产出的 TS 交给 MIT 的 genshin-ts：compile → (可选) inject
//
// ════════════════════════════════════════════════════════════════════════════
// 为什么要有这个脚本
// ════════════════════════════════════════════════════════════════════════════
//
//   `emit.mjs --target=gts` 只产出 TS 源码，**落盘不是它的事**。真实链路是：
//
//       <spec>.json --emit--> <graph>.ts --gsts compile--> .gs.ts → .json(IR) → .gia
//                                                             --injector--> .gil 里的节点图段
//
//   本脚本把后半段固定成一条可复现命令，并且**只往 workbench（_work/）和 .gil 副本写**：
//     · compile 产物落在 workbench 的临时工程里；
//     · inject 的输入是**复制出来**的 `.gil`，输出是另一个新文件；仓库里的存档一个字节都不动。
//
//   ⚠️ 本工程**不写** protobuf：写入 = 调 genshin-ts（MIT）的 `injectGilFile()`。这里只做胶水。
//
// ════════════════════════════════════════════════════════════════════════════
// 用法
// ════════════════════════════════════════════════════════════════════════════
//
//   # 只编译，得到 .gia
//   node src/gts-build.mjs --src=<x.ts> --workbench=<装了 genshin-ts 的目录>
//
//   # 编译 + 注入到 .gil **副本**（必须先 --copy-gil，脚本拒绝原地写）
//   node src/gts-build.mjs --src=<x.ts> --workbench=_work/gts \
//        --copy-gil="<你的存档>.gil" --outdir=_work/gts-out [--skip-safe-check]
//
// 注意：workbench 是「`node_modules/genshin-ts` 所在目录」，不是包目录本身。Node 的模块解析要求
//       临时工程就在它下面，否则 `import 'genshin-ts/runtime/core'` 会解析失败。
//
// 退出码：0 = 成功；1 = 编译器/注入器报错；2 = 参数或环境不满足

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const argOf = (k) => {
  const a = argv.find((s) => s.startsWith('--' + k + '='));
  return a ? a.slice(k.length + 3) : null;
};
const has = (k) => argv.includes('--' + k);

const srcArg = argOf('src');
const wbArg = argOf('workbench') || process.env.QX_GTS_WORKBENCH || '';
const copyGilArg = argOf('copy-gil');
const outdirArg = argOf('outdir') || path.join('_work', 'gts-out');
const targetIdArg = argOf('target-id');
const skipSafeCheck = has('skip-safe-check');

if (!srcArg) {
  console.error('用法: node src/gts-build.mjs --src=<x.ts> --workbench=<装了 genshin-ts 的目录> [--copy-gil=<x.gil>] [--target-id=N] [--outdir=dir] [--skip-safe-check]');
  process.exit(2);
}
const src = path.resolve(ROOT, srcArg);
if (!fs.existsSync(src)) {
  console.error('❌ --src 不存在: ' + src);
  process.exit(2);
}
if (!wbArg) {
  console.error(
    '❌ 缺少 --workbench。它应该是「装了 genshin-ts 的目录」（该目录下有 node_modules/genshin-ts）。\n' +
      '   复现装法见 docs/spike-报告摘要.md 的「MIT 写入路线」。'
  );
  process.exit(2);
}
const wb = path.resolve(ROOT, wbArg);
const gtsPkg = path.join(wb, 'node_modules', 'genshin-ts');
if (!fs.existsSync(path.join(gtsPkg, 'bin', 'gsts.mjs'))) {
  console.error('❌ workbench 里找不到 genshin-ts（缺 node_modules/genshin-ts/bin/gsts.mjs）：' + wb);
  process.exit(2);
}

// ── 1. 在 workbench 里搭一个最小工程，只放这一个入口 ──────────────────────
const proj = path.join(wb, 'proj-qx-emit');
const srcDir = path.join(proj, 'src');
fs.rmSync(srcDir, { recursive: true, force: true });
fs.mkdirSync(srcDir, { recursive: true });

const enc = 'utf8';
const writeIfChanged = (p, text) => {
  if (fs.existsSync(p) && fs.readFileSync(p, enc) === text) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, enc);
};
writeIfChanged(
  path.join(proj, 'package.json'),
  JSON.stringify(
    { name: 'qx-gts-emit-scratch', private: true, version: '0.0.0', type: 'module' },
    null,
    2
  ) + '\n'
);
writeIfChanged(
  path.join(proj, 'gsts.config.ts'),
  [
    "import type { GstsConfig } from 'genshin-ts'",
    '',
    '// 由 src/gts-build.mjs 现场生成：只编译，不注入。',
    '// 注入由本脚本用 injector API 对 `.gil` **副本**做，避免 gsts 直连真机存档目录。',
    'const config: GstsConfig = {',
    "  compileRoot: '.',",
    "  entries: ['./src'],",
    "  outDir: './dist'",
    '}',
    '',
    'export default config',
    '',
  ].join('\n')
);

const base = path.basename(src, '.ts');
const stagedTs = path.join(srcDir, base + '.ts');
fs.copyFileSync(src, stagedTs);
console.log('[1/2] compile');
console.log('    workbench : ' + wb);
console.log('    entry     : ' + stagedTs);

const gstsBin = path.join(gtsPkg, 'bin', 'gsts.mjs');
const res = spawnSync(process.execPath, [gstsBin, '-c', 'gsts.config.ts', '--noinject', '--lang', 'zh-CN'], {
  cwd: proj,
  encoding: 'utf8',
  timeout: 600000,
});
const compileOut = ((res.stdout || '') + (res.stderr || '')).trim();
const noise = /update check failed|notice check failed|检查更新|检查公告/;
for (const line of compileOut.split(/\r?\n/)) {
  if (line.trim() && !noise.test(line)) console.log('    ' + line);
}
if (res.status !== 0) {
  console.error('❌ gsts compile 失败（exit ' + res.status + '）');
  process.exit(1);
}

const gia = path.join(proj, 'dist', 'src', base + '.gia');
if (!fs.existsSync(gia)) {
  console.error('❌ 没找到 .gia 产物: ' + gia);
  process.exit(1);
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
console.log('    ✅ .gia ' + gia + '  (' + fs.statSync(gia).size + ' bytes, sha256=' + sha(gia).slice(0, 16) + '…)');

// ── 2. 可选：注入到 .gil 副本 ────────────────────────────────────────────
if (!copyGilArg) {
  console.log('');
  console.log('ℹ️ 未给 --copy-gil，只做到 .gia。要落盘到 .gil 副本请加：');
  console.log('   --copy-gil=<某个 .gil>  --outdir=_work/gts-out  [--skip-safe-check]');
  process.exit(0);
}

console.log('');
console.log('[2/2] inject（只写 .gil 副本）');
const gilSrc = path.resolve(ROOT, copyGilArg);
if (!fs.existsSync(gilSrc)) {
  console.error('❌ --copy-gil 不存在: ' + gilSrc);
  process.exit(2);
}
const outdir = path.resolve(ROOT, outdirArg);
fs.mkdirSync(outdir, { recursive: true });
const gilBase = path.basename(gilSrc, '.gil');
const before = path.join(outdir, gilBase + '.before.gil');
const after = path.join(outdir, gilBase + '.after.gil');
fs.copyFileSync(gilSrc, before);
const shaSrc = sha(gilSrc);
if (sha(before) !== shaSrc) {
  console.error('❌ 复制后校验不一致（磁盘问题？）：' + before);
  process.exit(1);
}
console.log('    源（只读）      : ' + gilSrc + '  sha256=' + shaSrc.slice(0, 16) + '…');
console.log('    基线副本        : ' + before);

const { injectGilFile } = await import(
  pathToFileURL(path.join(gtsPkg, 'dist', 'src', 'injector', 'index.js')).href
);

let out;
try {
  out = injectGilFile({
    gilPath: before,
    giaPath: gia,
    ...(targetIdArg ? { targetId: Number(targetIdArg) } : {}),
    skipNonEmptyCheck: skipSafeCheck,
    outPath: after,
    lang: 'zh-CN',
  });
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('❌ 注入被拒/失败：' + msg);
  if (/not empty|_GSTS/i.test(msg)) {
    console.error(
      '   ↑ 这是上游的**安全检查**：目标节点图非空且名字不以 `_GSTS` 开头。\n' +
        '     两条正路：① 在编辑器里建一个名为 `_GSTS*` 的图再注入；' +
        '② 明确知道自己在干什么，加 --skip-safe-check（= gsts.config 的 inject.skipSafeCheck）。'
    );
  }
  process.exit(1);
}

console.log('    ✅ 注入完成  mode=' + out.mode);
console.log('    产出            : ' + after);
console.log('    前后字节差      : ' + (fs.statSync(after).size - fs.statSync(before).size) + ' bytes');
console.log('    产出 sha256     : ' + sha(after));
console.log('');
console.log('⚠️ 注入后**必须在编辑器里重载地图**才会生效；若在重载前用编辑器保存地图，注入内容会被覆盖。');
