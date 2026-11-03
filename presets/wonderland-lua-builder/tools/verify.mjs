#!/usr/bin/env node
// 预设结构自检：YAML 可解析、内容合同齐备、文档内部链接可达、规模在预算内。
//   node tools/verify.mjs
// 退出码非 0 表示有需要修的问题。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPatch, loadYaml } from './lib/build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TREE = resolve(HERE, '..');
const SKILL = join(TREE, 'skills', 'qxqy-game-studio');
const problems = [];
const notes = [];
const ok = (msg) => notes.push(`ok    ${msg}`);
const bad = (msg) => problems.push(`FAIL  ${msg}`);

const yaml = await loadYaml();
// `!!js` 是 Loader 方言，不是标准 YAML：声明为字符串标量以消除解析告警，结构校验仍然生效。
const JS_SCALAR_TAG = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value) => String(value),
};
const YAML_OPTS = { customTags: [JS_SCALAR_TAG] };
const parseYaml = (text) => yaml.parse(text, YAML_OPTS);

// 1. 组合文件
try {
  const doc = parseYaml(readFileSync(join(TREE, 'agent.cordis.yml'), 'utf8'));
  if (!Array.isArray(doc)) throw new Error('top level is not a list');
  ok(`agent.cordis.yml parses (${doc.length} rows)`);
  const persona = doc.find((r) => r && r.id === 'persona');
  const prefix = (persona && persona.config && persona.config.prefix) || '';
  if (prefix.length < 2000) bad(`persona prefix looks too short (${prefix.length} chars)`);
  else ok(`persona prefix ${prefix.length} chars, ~${Math.round(prefix.length / 3.5)} tokens`);
  if (prefix.length > 9000) bad('persona prefix is very long; move detail into references');
  for (const token of ['qxqy-game-studio', 'platform-facts', 'mobile-16-9', 'Red', 'real device']) {
    if (!prefix.includes(token)) bad(`persona prefix is missing required token: ${token}`);
  }
  const group = doc.find((r) => r && r.id === 'planning');
  const section = (group && group.config && group.config[0] && group.config[0].config && group.config[0].config.section) || '';
  if (!section.includes('exit evidence')) bad('plan-mode section does not require exit evidence');
  if (!section.includes('platform-facts')) bad('plan-mode section does not reference platform-facts');
  if (!section.includes('rollback')) bad('plan-mode section does not require rollback points');
} catch (e) {
  bad(`agent.cordis.yml: ${e.message}`);
}

// 2. 生成的补丁能被 YAML 解析（Loader 也要读它），且 persona 文本与源文件一致
let patchPersona = '';
try {
  const patch = buildPatch({ source: TREE, form: 'installed' });
  const doc = parseYaml(patch);
  const rows = (doc && doc[0] && doc[0].insert) || [];
  if (rows.length !== 4) bad(`generated patch has ${rows.length} rows, expected 4`);
  const preset = rows.find((r) => r.id === 'qxqy-simulator-preset');
  const plugins = preset && preset.config && preset.config.plugins;
  if (!plugins || !plugins.length) bad('generated patch has no preset plugins list');
  else {
    patchPersona = (plugins.find((r) => r.id === 'persona') || {}).config?.prefix || '';
    ok(`generated patch parses (${plugins.length} preset rows, ${Buffer.byteLength(patch, 'utf8')} bytes)`);
  }
} catch (e) {
  bad(`generated patch: ${e.message}`);
}

// 3. 步骤文档齐备且非空壳
const required = [
  'SKILL.md',
  'references/workflow.md',
  'references/platform-facts.md',
  'references/01-game-design.md',
  'references/02-test-cases.md',
  'references/03-html-prototype.md',
  'references/04-art-assets.md',
  'references/05-lua-implementation.md',
  'references/06-simulator-testing.md',
  'references/07-device-validation.md',
];
for (const rel of required) {
  const path = join(SKILL, rel);
  if (!existsSync(path)) bad(`missing ${rel}`);
  else {
    const size = statSync(path).size;
    if (size < 1200) bad(`${rel} looks like a stub (${size} bytes)`);
    else ok(`${rel} ${size} bytes`);
  }
}
for (const rel of ['preset.yml', 'README.md', 'CHANGELOG.md', 'evals/agent-behavior.md']) {
  if (!existsSync(join(TREE, rel))) bad(`missing ${rel}`);
}

// 4. persona 文本在源文件与生成的补丁之间必须一致（缩进/块标量不被破坏）
if (patchPersona) {
  const sourcePersona = parseYaml(readFileSync(join(TREE, 'agent.cordis.yml'), 'utf8')).find((r) => r.id === 'persona').config.prefix;
  if (sourcePersona.trimEnd() !== patchPersona.trimEnd()) {
    bad('persona text differs between agent.cordis.yml and the generated patch');
  } else {
    ok('persona text survives the patch generation unchanged');
  }
}

// 5. Markdown 内部链接可达
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}
const files = [...walk(SKILL), join(TREE, 'README.md'), join(TREE, 'CHANGELOG.md'), join(TREE, 'evals', 'agent-behavior.md')];
let links = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const rel = target.split('#')[0];
    if (!rel) continue;
    links += 1;
    if (!existsSync(resolve(dirname(file), rel))) {
      bad(`${file.slice(TREE.length + 1)} links to missing ${target}`);
    }
  }
}
ok(`checked ${links} relative links in ${files.length} markdown files`);

// 6. 关键平台事实必须在位（官方 11 类控件清单与预览限制的表述）
const facts = readFileSync(join(SKILL, 'references', 'platform-facts.md'), 'utf8');
for (const token of ['文本框', '文本视窗', '预设按钮', '光标检测区域', '网格视窗', '模板引用控件', '界面动效', '全屏动效', '预览限制']) {
  if (!facts.includes(token)) bad(`platform-facts.md is missing required fact/token: ${token}`);
}
if (!/没有\s*`?progress`?/.test(facts)) bad('platform-facts.md must state that there is no progress control type');

process.stdout.write(`${notes.join('\n')}\n`);
if (problems.length) {
  process.stderr.write(`\n${problems.join('\n')}\n${problems.length} problem(s)\n`);
  process.exit(1);
}
process.stdout.write('\nverify: all checks passed\n');
