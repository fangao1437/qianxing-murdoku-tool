#!/usr/bin/env node
// 生成一个独立的、可安装的 Agent 预设 bundle：与原有的 wonderland-lua-builder /
// 严格版预设并存，互不覆盖（不同的 Loader 行 id，各自的 preset id）。
//
//   node tools/build-bundle.mjs --out <输出目录> [--id <preset-id>] [--name <显示名>]
//
// 输出目录包含：package.json（dsh.bundle.patch）、cordis.patch.yml（插入 @deepseek-ai/dsh-agent-preset 声明）、
// skills/、evals/、docs/、README.md、CHANGELOG.md。
//
// 与插件包内置预设的区别：本 bundle 自带 skills/，用多候选表达式解析技能目录，不依赖 dsh-plugin-beyond-simulator。

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasCwdReference, readPresetMeta, stripUnsupportedVariables } from './lib/build.mjs';
import { BUNDLE_PACKAGE, PRESET_DESCRIPTION, PRESET_ID, PRESET_NAME, PRESET_ORDER, ROW_ID } from './lib/identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TREE = resolve(HERE, '..');

function parseArgs(argv) {
  const out = {
    out: null,
    id: PRESET_ID,
    name: PRESET_NAME,
    description: PRESET_DESCRIPTION,
    order: PRESET_ORDER,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') out.out = resolve(argv[++i]);
    else if (a === '--id') out.id = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--description') out.description = argv[++i];
    else if (a === '--order') out.order = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!out.out) throw new Error('--out <directory> is required');
  if (!/^[a-z0-9-]+$/.test(out.id)) throw new Error('--id must be lowercase letters, digits and hyphens');
  return out;
}

// 技能目录解析：bundle 可能被装进 profile 的 node_modules，也可能就地引用，三种候选都试。
export const BUNDLE_SKILLS_EXPR = [
  "(()=>{",
  "const p=process.getBuiltinModule('node:path'),f=process.getBuiltinModule('node:fs'),u=process.getBuiltinModule('node:url');",
  "const r=process.getBuiltinModule('node:module').createRequire(baseUrl);",
  "const c=[];",
  `try{c.push(p.join(p.dirname(r.resolve(${JSON.stringify(`${BUNDLE_PACKAGE}/package.json`)})),'skills'))}catch{}`,
  "try{c.push(p.join(p.dirname(u.fileURLToPath(baseUrl)),'skills'))}catch{}",
  "try{c.push(u.fileURLToPath(new URL('skills/',baseUrl)))}catch{}",
  "return c.find(x=>f.existsSync(p.join(x,'qxqy-game-studio','SKILL.md')))||c[0]",
  "})()",
].join('');

const SKILL_LINE = /^(\s*)- !!js ".*"$/m;

function indentBlock(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line.length === 0 ? '' : pad + line))
    .join('\n');
}

const args = parseArgs(process.argv.slice(2));
const meta = readPresetMeta(TREE);
let rows = readFileSync(join(TREE, 'agent.cordis.yml'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
if (!SKILL_LINE.test(rows)) throw new Error('agent.cordis.yml has no "!!js" skill path line to rewrite');
rows = rows.replace(SKILL_LINE, (_line, indent) => `${indent}- !!js ${JSON.stringify(BUNDLE_SKILLS_EXPR)}`);

// 严格版 persona：与原预设**同一套语料**，但把"什么才算验证过"的门槛写成显式闸门。
// 保持精简是有意的——严格来自多一次自我证伪，不是来自多一页规则。
// 用 `persona-strict.txt` 整体替换 agent.cordis.yml 里的 prefix 块。
const PERSONA_FILE = join(TREE, 'persona-strict.txt');
if (existsSync(PERSONA_FILE)) {
  let strict = readFileSync(PERSONA_FILE, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  // 防御性剥离：DSH ≥2.0.18 不再注册 `{{cwd}}`，残留会让提示词组装整次失败。
  strict = stripUnsupportedVariables(strict);
  if (hasCwdReference(strict)) {
    throw new Error('persona-strict.txt still references {{cwd}} after sanitizing; DSH >=2.0.18 rejects it');
  }
  const block = /^(\s*)prefix: \|-\n[\s\S]*?(?=^\S)/m;
  const m = rows.match(block);
  if (!m) throw new Error('could not locate the persona prefix block in agent.cordis.yml');
  const indent = m[1] + '  ';
  const indented = strict
    .split('\n')
    .map((line) => (line.length === 0 ? '' : indent + line))
    .join('\n');
  rows = rows.replace(block, `${m[1]}prefix: |-\n${indented}\n`);
}

// 最终自检：整份补丁里不得再出现 {{cwd}}。
if (hasCwdReference(rows)) {
  throw new Error('generated preset still references {{cwd}}; it would fail on DSH >=2.0.18');
}

const patch = [
  '- insert:',
  `    - id: ${ROW_ID}`,
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  `        id: ${args.id}`,
  `        name: ${JSON.stringify(args.name)}`,
  `        description: ${JSON.stringify(args.description)}`,
  `        order: ${args.order}`,
  '        plugins:',
  indentBlock(rows, 10),
  '',
].join('\n');

const pkg = {
  name: BUNDLE_PACKAGE,
  version: '1.0.0',
  private: true,
  type: 'module',
  description: `${meta.name} — 严格版 Agent 预设 bundle`,
  dsh: { bundle: { patch: './cordis.patch.yml' } },
};

if (existsSync(args.out)) rmSync(args.out, { recursive: true, force: true });
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
writeFileSync(join(args.out, 'cordis.patch.yml'), patch, 'utf8');
for (const item of ['skills', 'evals', 'docs', 'README.md', 'CHANGELOG.md']) {
  if (!existsSync(join(TREE, item))) continue;
  cpSync(join(TREE, item), join(args.out, item), { recursive: true });
}
process.stdout.write(`bundle written to ${args.out}\n`);
process.stdout.write(`  preset id: ${args.id}  name: ${args.name}\n`);
process.stdout.write(`  cordis.patch.yml: ${Buffer.byteLength(patch, 'utf8')} bytes\n`);

// 自检：YAML 可解析、声明形状正确、技能目录随包存在。
const { loadYaml } = await import('./lib/build.mjs');
const yaml = await loadYaml();
const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: (value) => String(value) };
const doc = yaml.parse(patch, { customTags: [JS_TAG] });
const row = doc?.[0]?.insert?.[0];
const problems = [];
if (doc?.[0]?.insert?.length !== 1) problems.push('patch must insert exactly one row');
if (row?.id !== ROW_ID) problems.push(`unexpected row id: ${row?.id} (expected ${ROW_ID})`);
if (row?.name !== '@deepseek-ai/dsh-agent-preset') problems.push(`unexpected plugin: ${row?.name}`);
if (row?.config?.id !== args.id) problems.push('config.id mismatch');
if (!Array.isArray(row?.config?.plugins) || row.config.plugins.length < 10) problems.push('config.plugins looks empty');
const skillFile = join(args.out, 'skills', 'qxqy-game-studio', 'SKILL.md');
if (!existsSync(skillFile)) problems.push('skills/qxqy-game-studio/SKILL.md missing from bundle');
const persona = (row?.config?.plugins ?? []).find((r) => r.id === 'persona');
if (!persona?.config?.prefix?.includes('platform-facts')) problems.push('persona prefix does not reference platform-facts');
const skillDir = (row?.config?.plugins ?? []).find((r) => r.id === 'skill-filesystem')?.config?.customSkillDirs?.[0];
if (typeof skillDir !== 'string' || !skillDir.includes('SKILL.md')) problems.push('customSkillDirs does not use the bundle resolver');

if (problems.length) {
  process.stderr.write(`\nself-check FAILED:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(`  self-check passed (${row.config.plugins.length} preset rows, skills present)\n`);
