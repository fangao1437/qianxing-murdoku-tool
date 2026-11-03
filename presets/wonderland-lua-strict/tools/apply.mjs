#!/usr/bin/env node
// 把本目录（优化后的预设）应用到已安装的 dsh-plugin-beyond-simulator 插件包。
//
//   node tools/apply.mjs --target <插件包目录> [--dry-run]
//
// 说明：DSH 目前由插件包内的 dsh-plugin/cordis.patch.yml 注册 wonderland-lua-builder 预设，
// 技能目录由该预设的 customSkillDirs 指向包内 dsh-plugin/presets/wonderland-lua-builder/skills。
// 所以应用 = 写补丁 + 覆盖包内预设目录内容。写前一律备份，回滚只需还原备份。
// 上游升级插件包会覆盖这些文件：升级后重新执行本脚本即可。

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPatch } from './lib/build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TREE = resolve(HERE, '..');

function parseArgs(argv) {
  const out = { target: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--target') out.target = resolve(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.target) throw new Error('--target <installed dsh-plugin-beyond-simulator dir> is required');
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function listTree(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTree(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const pluginDir = join(args.target, 'dsh-plugin');
const patchFile = join(pluginDir, 'cordis.patch.yml');
const presetDir = join(pluginDir, 'presets', 'wonderland-lua-builder');

for (const [label, path] of [['dsh-plugin/cordis.patch.yml', patchFile], ['dsh-plugin/presets/wonderland-lua-builder', presetDir]]) {
  if (!existsSync(path)) throw new Error(`target does not look like dsh-plugin-beyond-simulator: missing ${label} (${path})`);
}

const patch = buildPatch({ source: TREE, form: 'installed' });
const previous = readFileSync(patchFile, 'utf8').replace(/\r\n/g, '\n');
// `docs/` 随包安装：它是这个预设"为什么这样设计"的说明，维护者需要它。
// `LOCAL-SETUP.md` 是这台机器的本地接入记录，不随包分发。
const items = ['agent.cordis.yml', 'preset.yml', 'README.md', 'evals', 'skills', 'docs']
  .filter((name) => existsSync(join(TREE, name)));

process.stdout.write(`target   : ${args.target}\n`);
process.stdout.write(`patch    : ${Buffer.byteLength(patch, 'utf8')} bytes (installed form)\n`);
process.stdout.write(`preset   : ${items.join(', ')}\n`);
process.stdout.write(`patch differs from installed: ${previous !== patch ? 'yes' : 'no'}\n`);

if (args.dryRun) {
  process.stdout.write('dry-run: nothing written\n');
  process.exit(0);
}

const ts = stamp();
const patchBackup = `${patchFile}.bak-${ts}`;
const presetBackup = `${presetDir}.bak-${ts}`;
// 运行中的 Harness 可能持有包内文件（Windows 上目录改名会 EPERM），所以备份与写入都用"复制"而不是"改名"。
if (previous !== patch) cpSync(patchFile, patchBackup);
cpSync(presetDir, presetBackup, { recursive: true });
mkdirSync(presetDir, { recursive: true });
for (const name of items) {
  cpSync(join(TREE, name), join(presetDir, name), { recursive: true, force: true });
}
writeFileSync(patchFile, patch, 'utf8');

const installed = listTree(presetDir).sort();
// 只留在本目录的输入：本地接入记录，以及 build-bundle 用来替换严格版 persona 的源文件。
const LOCAL_ONLY = ['LOCAL-SETUP.md', 'persona-strict.txt'];
const source = listTree(TREE)
  .filter((p) => !p.startsWith('tools') && p !== 'cordis.patch.yml' && p !== 'CHANGELOG.md')
  .filter((p) => !LOCAL_ONLY.includes(p))
  .sort();
const missing = source.filter((p) => !installed.includes(p));
const extra = installed.filter((p) => !source.includes(p));

process.stdout.write(`backup   : ${patchBackup}\n`);
process.stdout.write(`backup   : ${presetBackup}\n`);
process.stdout.write(`installed: ${installed.length} files, missing=${missing.length}, extra=${extra.length}\n`);
if (missing.length) process.stdout.write(`  missing: ${missing.join(', ')}\n`);
if (extra.length) process.stdout.write(`  extra  : ${extra.join(', ')}\n`);
process.stdout.write('next     : 重启 Harness（或按 profile 的 patchReload）后新建会话并选择“千星 2D+Lua 游戏制作”预设\n');
process.stdout.write('rollback : 还原上面的备份目录/文件即可\n');
