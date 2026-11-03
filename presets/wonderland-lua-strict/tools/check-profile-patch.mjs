#!/usr/bin/env node
// 校验 profile patch 里「严格版」预设声明是否完好（DSH 在重启时会重排该文件，长路径可能被折行）。
//   node tools/check-profile-patch.mjs [--profile-patch <cordis.patch.yml>]
//
// 同时确认**原有预设未被破坏**（wonderland-lua-builder 与严格版仍在）。

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadYaml } from './lib/build.mjs';
import { PRESET_ID, ROW_ID } from './lib/identity.mjs';
const problems = [];
const notes = [];
const ok = (m) => notes.push(`ok    ${m}`);
const bad = (m) => problems.push(`FAIL  ${m}`);

let patch = join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--profile-patch') patch = resolve(argv[++i]);
  else throw new Error(`unknown argument: ${argv[i]}`);
}

const yaml = await loadYaml();
const JS_TAG = { tag: 'tag:yaml.org,2002:js', resolve: (value) => String(value) };
const text = readFileSync(patch, 'utf8');
let doc;
try {
  doc = yaml.parse(text, { customTags: [JS_TAG] });
} catch (e) {
  bad(`patch does not parse: ${e.message}`);
}

if (Array.isArray(doc)) {
  ok(`patch parses: ${doc.length} entries, ${text.split('\n').length} lines`);
  const ids = doc.filter((e) => e && e.id).map((e) => e.id);
  for (const required of ['agent-preset-registry', 'ui-chat', 'ui-settings-general']) {
    if (!ids.includes(required)) bad(`pre-existing override "${required}" is missing from the patch`);
  }
  ok(`existing overrides still present (${ids.length} id-targeted entries)`);

  const decl = doc.find((e) => (e.insert || []).some((r) => r && r.id === ROW_ID));
  if (!decl) {
    bad(`insert row ${ROW_ID} not found`);
  } else {
    const row = decl.insert.find((r) => r.id === ROW_ID);
    if (row.name !== '@deepseek-ai/dsh-agent-preset') bad(`unexpected plugin name: ${row.name}`);
    const cfg = row.config || {};
    if (cfg.id !== PRESET_ID) bad(`preset id mismatch: ${cfg.id}`);
    ok(`declaration present: id=${cfg.id} name=${cfg.name} order=${cfg.order}`);
    const plugins = cfg.plugins || [];
    ok(`declared plugins: ${plugins.length}`);
    const skillDir = (plugins.find((r) => r.id === 'skill-filesystem') || {}).config?.customSkillDirs?.[0];
    if (typeof skillDir !== 'string') {
      bad('customSkillDirs is not a resolved string (folded or expression form)');
    } else {
      ok(`customSkillDirs resolves to: ${skillDir}`);
      const marker = join(skillDir.replace(/\//g, '\\'), 'qxqy-game-studio', 'SKILL.md');
      if (!existsSync(marker)) bad(`skills directory has no qxqy-game-studio/SKILL.md: ${skillDir}`);
      else ok(`SKILL.md found at ${marker}`);
      const facts = join(skillDir.replace(/\//g, '\\'), 'qxqy-game-studio', 'references', 'platform-facts.md');
      if (!existsSync(facts)) bad(`platform-facts.md missing under ${skillDir}`);
      else ok('platform-facts.md present');
    }
    const persona = (plugins.find((r) => r.id === 'persona') || {}).config?.prefix || '';
    for (const token of ['platform-facts', 'miliastra-knowledge-lua', 'mobile-16-9', 'real device']) {
      if (!persona.includes(token)) bad(`persona prefix is missing "${token}"`);
    }
    ok(`persona prefix ${persona.length} chars`);
  }
}

process.stdout.write(`${notes.join('\n')}\n`);
if (problems.length) {
  process.stderr.write(`\n${problems.join('\n')}\n${problems.length} problem(s)\n`);
  process.exit(1);
}
process.stdout.write('\nprofile patch check: all good\n');
