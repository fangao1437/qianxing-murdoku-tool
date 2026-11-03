#!/usr/bin/env node
// 把「严格版」Agent 预设声明插入 profile 的 patch 层（profiles/<p>/cordis.patch.yml）。
//
//   node tools/install-profile-preset.mjs --profile-patch <cordis.patch.yml> --bundle <bundle 目录> [--remove]
//
// 为什么用 profile patch：plugin_manager install_bundle 在本机会挂在后续 dsh 调用上（profile 被
// 运行中的 Desktop 占用），而 profile patch 是用户自己的层，应用在所有 bundle 之后，且可随时删除。
// 只做文本级插入/替换（保留文件其余内容与 !!js 表达式原样），写前备份，写后校验 YAML 与技能路径。
//
// 本脚本**只碰自己的标记区块**，原有的 wonderland-lua-builder / 严格版声明不受影响。

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadYaml } from './lib/build.mjs';
import { PRESET_ID, ROW_ID } from './lib/identity.mjs';

const BEGIN = `# >>> ${PRESET_ID} preset — managed by wonderland-lua-strict/tools/install-profile-preset.mjs`;
const END = `# <<< ${PRESET_ID} preset`;

function parseArgs(argv) {
  const out = { patch: null, bundle: null, remove: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--profile-patch') out.patch = resolve(argv[++i]);
    else if (a === '--bundle') out.bundle = resolve(argv[++i]);
    else if (a === '--remove') out.remove = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.patch) throw new Error('--profile-patch <file> is required');
  if (!out.remove && !out.bundle) throw new Error('--bundle <dir> is required unless --remove');
  return out;
}

const args = parseArgs(process.argv.slice(2));
const yaml = await loadYaml();
const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: (value) => String(value) };
const parse = (text) => yaml.parse(text, { customTags: [JS_TAG] });

function fail(msg) {
  process.stderr.write(`FAIL  ${msg}\n`);
  process.exit(1);
}

// 去掉上一次插入的区块（按标记，文本级）
function stripBlock(text) {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return text;
  const end = text.indexOf(END, begin);
  if (end === -1) fail('found the begin marker without the end marker; fix the patch file by hand');
  return text.slice(0, begin) + text.slice(end + END.length);
}

let patchText = readFileSync(args.patch, 'utf8').replace(/\r\n/g, '\n');
const before = patchText;
let block = '';
if (!args.remove) {
  const bundlePatch = join(args.bundle, 'cordis.patch.yml');
  if (!existsSync(bundlePatch)) fail(`bundle patch not found: ${bundlePatch}`);
  const skillsDir = join(args.bundle, 'skills').replace(/\\/g, '/');
  if (!existsSync(join(args.bundle, 'skills', 'qxqy-game-studio', 'SKILL.md'))) {
    fail(`bundle skills are incomplete: ${skillsDir}`);
  }
  const raw = readFileSync(bundlePatch, 'utf8').replace(/\r\n/g, '\n').trimEnd();
  const parsed = parse(raw);
  const row = parsed?.[0]?.insert?.[0];
  if (row?.id !== ROW_ID) fail(`bundle declares row ${row?.id}, expected ${ROW_ID}`);
  // 把 bundle 里"多候选解析"的 !!js 表达式换成确定存在的绝对路径，少一层运行时不确定性。
  const pinned = raw.replace(
    /^(\s*)- !!js "\(\(\)=>\{[\s\S]*?\}\)\(\)"$/m,
    (_line, indent) => `${indent}- ${JSON.stringify(skillsDir)}`,
  );
  if (pinned === raw) fail('could not pin the skills directory inside the bundle patch');
  if (!pinned.includes(JSON.stringify(skillsDir))) fail('skills directory was not pinned');
  block = `${BEGIN}\n${pinned}\n${END}\n`;
}

patchText = stripBlock(patchText).replace(/\n+$/, '\n');
if (block) patchText = `${patchText}${patchText.endsWith('\n\n') ? '' : '\n'}${block}`;

// 校验整体仍是合法 patch 层
let doc;
try {
  doc = parse(patchText);
} catch (e) {
  fail(`patch file would not parse after the change: ${e.message}`);
}
if (!Array.isArray(doc)) fail('patch file top level is not a list');
const entries = doc.filter((e) => e && typeof e === 'object');
const decl = entries.find((e) => (e.insert || []).some((r) => r && r.id === ROW_ID));
if (args.remove && decl) fail('remove did not take effect');
if (!args.remove) {
  if (!decl) fail('the new preset declaration is missing from the parsed patch');
  const row = decl.insert.find((r) => r.id === ROW_ID);
  if (row.name !== '@deepseek-ai/dsh-agent-preset') fail(`unexpected plugin for ${ROW_ID}: ${row.name}`);
  if (!row.config?.plugins?.length) fail('declaration has no plugin list');
  const skillPath = row.config.plugins.find((r) => r.id === 'skill-filesystem')?.config?.customSkillDirs?.[0];
  const plain = typeof skillPath === 'string' ? skillPath : '';
  if (!plain || plain.startsWith('process.') || plain.startsWith('(')) fail('skills directory was not pinned to a literal path');
  if (!existsSync(join(plain.replace(/\//g, '\\'), 'qxqy-game-studio', 'SKILL.md'))) {
    fail(`pinned skills directory has no qxqy-game-studio/SKILL.md: ${plain}`);
  }
}

if (patchText === before) {
  process.stdout.write('no change (already up to date)\n');
  process.exit(0);
}
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
copyFileSync(args.patch, `${args.patch}.bak-${ts}`);
writeFileSync(args.patch, patchText, 'utf8');
process.stdout.write(`${args.remove ? 'removed' : 'installed'} ${ROW_ID} in ${args.patch}\n`);
process.stdout.write(`  backup: ${args.patch}.bak-${ts}\n`);
process.stdout.write(`  patch entries: ${entries.length}; preset rows: ${decl ? decl.insert[0].config.plugins.length : 0}\n`);
