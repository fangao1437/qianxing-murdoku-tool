#!/usr/bin/env node
// 预设自检。检查**判断力与结构**，不检查词汇量。
//
//   node tools/verify.mjs
//
// 为什么这样写：上一版自检断言"某些关键词必须在场"，而这类检查**只能**奖励
// "把词写进去"——它会系统性地把语料推向"多写规则"，而不是"少犯错"。
// 本版改为检查：规则预算、推理姿态是否带触发、事实是否单一权威、
// 关键平台事实是否仍在、prompt 变量是否全部已注册、链接与锚点是否可达。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPatch, loadYaml, stripUnsupportedVariables } from './lib/build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TREE = resolve(HERE, '..');
const SKILL = join(TREE, 'skills', 'qxqy-game-studio');
const REFS = join(SKILL, 'references');
const problems = [];
const notes = [];
const ok = (msg) => notes.push(`ok    ${msg}`);
const bad = (msg) => problems.push(`FAIL  ${msg}`);
const read = (p) => readFileSync(p, 'utf8');

// ── 预算 ────────────────────────────────────────────────────────────────────
// N=80 是实测的"同时生效规则数"硬地板（arXiv 2607.19257，5 个模型全部归零）。
// persona 每轮都进上下文，必须远低于它；语料是查阅手册，可以大，但不能靠"条数"变精准。
const PERSONA_RULE_BUDGET = 40;
const PERSONA_CHAR_BUDGET = 6500;
const CORE_READ_CHAR_BUDGET = 14000; // reasoning-patterns + workflow + platform-facts 必读核心

const yaml = await loadYaml();
// `!!js` 是 Loader 方言，不是标准 YAML：声明为字符串标量以消除解析告警，结构校验仍然生效。
const JS_SCALAR_TAG = { tag: 'tag:yaml.org,2002:js', resolve: (value) => String(value) };
const parseYaml = (text) => yaml.parse(text, { customTags: [JS_SCALAR_TAG] });

// 统计祈使句：编号行、列表项、"必须/不要/禁止/务必"等强指令词
function countDirectives(text) {
  let n = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^(\d+[.、)]|[-*+]\s)/.test(t)) n += 1;
    else if (/(必须|不要|禁止|务必|不得|绝不|一定要)/.test(t)) n += 1;
  }
  return n;
}

// ── 1. 组合文件与 persona 预算 ──────────────────────────────────────────────
let sourcePersona = '';
try {
  const doc = parseYaml(read(join(TREE, 'agent.cordis.yml')));
  if (!Array.isArray(doc)) throw new Error('top level is not a list');
  ok(`agent.cordis.yml parses (${doc.length} rows)`);

  const persona = doc.find((r) => r && r.id === 'persona');
  sourcePersona = (persona && persona.config && persona.config.prefix) || '';
  if (!sourcePersona) throw new Error('no persona prefix found');

  // DSH >=2.0.18 只注册 provider / model；任何未注册变量的引用都会让整次提示词组装
  // 失败，会话无法启动。这是**硬失败**，所以最先拦，并给出确切修法。
  const UNREGISTERED = /\{\{(?!provider\}\}|model\}\})([a-zA-Z_][\w]*)\}\}/g;
  const unregistered = [...sourcePersona.matchAll(UNREGISTERED)].map((m) => m[1]);
  if (unregistered.length) {
    bad(
      `persona references unregistered prompt variables: ${[...new Set(unregistered)].map((v) => `{{${v}}}`).join(', ')}. ` +
        'DSH >=2.0.18 registers only {{provider}} and {{model}}; an unknown reference fails prompt assembly and the session cannot start. ' +
        'For {{cwd}}, delete exactly the sentence "Your working directory is {{cwd}}." and keep the surrounding text ' +
        '(the working directory is supplied by the working-directory context service).',
    );
  } else {
    ok('persona references only registered prompt variables ({{provider}} / {{model}})');
  }

  const rules = countDirectives(sourcePersona);
  if (sourcePersona.length > PERSONA_CHAR_BUDGET) {
    bad(`persona is ${sourcePersona.length} chars, over the ${PERSONA_CHAR_BUDGET} budget`);
  } else {
    ok(`persona ${sourcePersona.length} chars (~${Math.round(sourcePersona.length / 3.2)} tok)`);
  }
  if (rules > PERSONA_RULE_BUDGET) {
    bad(
      `persona carries ~${rules} imperative directives, over the ${PERSONA_RULE_BUDGET} budget; ` +
        'models hit 0% compliance near 80 simultaneous rules, so move detail into references',
    );
  } else {
    ok(`persona ~${rules} imperative directives (budget ${PERSONA_RULE_BUDGET})`);
  }

  // 必读集合：persona 必须把"怎么想"排在"查什么"之前
  for (const token of ['qxqy-game-studio', 'reasoning-patterns', 'platform-facts', 'workflow']) {
    if (!sourcePersona.includes(token)) bad(`persona does not reference ${token}`);
  }
  const iReason = sourcePersona.indexOf('reasoning-patterns');
  const iFacts = sourcePersona.indexOf('platform-facts');
  if (iReason === -1 || iFacts === -1 || iReason > iFacts) {
    bad('persona should name reasoning-patterns before platform-facts');
  } else {
    ok('persona orders reasoning-patterns before platform-facts');
  }
  // 不得把"线性通读 platform-facts"作为指示
  if (/read `references\/platform-facts\.md`[^.]*once/i.test(sourcePersona)) {
    bad('persona still tells the agent to read platform-facts once in full; point at 必读核心 + index instead');
  }

  const group = doc.find((r) => r && r.id === 'planning');
  const section = (group && group.config && group.config[0] && group.config[0].config && group.config[0].config.section) || '';
  if (!section) bad('plan-mode section is missing');
  else {
    if (!/qxqy-game-studio/.test(section)) bad('plan-mode does not tell the agent to load the skill');
    if (!/rollback/.test(section)) bad('plan-mode does not require rollback points');
    if (/Steps 1–4 do not|Steps 1-4 do not/.test(section)) bad('plan-mode restates the removed simulator ban');
    ok(`plan-mode section ${section.length} chars`);
  }
} catch (e) {
  bad(`agent.cordis.yml: ${e.message}`);
}

// ── 2. 生成的补丁可解析，且 persona 与源文件一致 ────────────────────────────
let patchPersona = '';
try {
  const patch = buildPatch({ source: TREE, form: 'installed' });
  const doc = parseYaml(patch);
  const rows = (doc && doc[0] && doc[0].insert) || [];
  if (rows.length !== 4) bad(`generated patch has ${rows.length} rows, expected 4`);
  const plugins = (rows.find((r) => r.id === 'qxqy-simulator-preset') || {}).config?.plugins || [];
  if (!plugins.length) bad('generated patch has no preset plugins list');
  else {
    patchPersona = (plugins.find((r) => r.id === 'persona') || {}).config?.prefix || '';
    ok(`generated patch parses (${plugins.length} preset rows, ${Buffer.byteLength(patch, 'utf8')} bytes)`);
  }
} catch (e) {
  bad(`generated patch: ${e.message}`);
}
if (patchPersona) {
  // 生成补丁时会对 persona 做变量剥离，所以比较前先对源文本施加同一变换，
  // 否则会把"预期的防御性剥离"误报成"源文件与补丁不一致"。
  const expectedPersona = stripUnsupportedVariables(sourcePersona);
  if (expectedPersona.trimEnd() !== patchPersona.trimEnd()) {
    bad('persona text differs between agent.cordis.yml (after variable sanitizing) and the generated patch');
  } else {
    ok('persona text survives patch generation unchanged (after variable sanitizing)');
  }
}

// ── 3. 语料齐备且非空壳 ────────────────────────────────────────────────────
const required = [
  'SKILL.md', 'references/workflow.md', 'references/platform-facts.md',
  'references/reasoning-patterns.md', 'templates/gdd.md',
  ...['01-game-design', '02-test-cases', '03-html-prototype', '04-art-assets',
      '05-lua-implementation', '06-simulator-testing', '07-device-validation']
    .map((s) => `references/${s}.md`),
];
for (const rel of required) {
  const path = join(SKILL, rel);
  if (!existsSync(path)) bad(`missing ${rel}`);
  else if (statSync(path).size < 900) bad(`${rel} looks like a stub (${statSync(path).size} bytes)`);
}
ok(`checked ${required.length} skill files`);

// ── 4. 推理姿态在场，且每条都要说清"触发/代价" ──────────────────────────────
const patterns = read(join(REFS, 'reasoning-patterns.md'));
const PATTERNS = [
  ['P1', '预写推翻条件'], ['P2', '度量先验真'], ['P3', '两向断言'], ['P4', '先分叉再收敛'],
  ['P5', '读回才算写入'], ['P6', '结论即假设'], ['P7', '先证明检查会红'],
  ['P8', '删掉的东西要变成哨兵'], ['P9', '按身份比较'], ['P10', '一次只动一个变量'],
  ['P11', '静默路径要出声'], ['P12', '环境做不到'], ['P13', '一个权威位置'],
  ['P14', '证据有层级'],
];
for (const [id, name] of PATTERNS) {
  if (!patterns.includes(id) || !patterns.includes(name)) bad(`reasoning-patterns.md is missing ${id} ${name}`);
}
// 姿态不得退化成口号：必须给"触发"，且至少多数带"代价"
const triggers = (patterns.match(/\*\*触发\*\*/g) || []).length;
const costs = (patterns.match(/\*\*代价\*\*/g) || []).length;
if (triggers < 10) bad(`reasoning-patterns.md has only ${triggers} 触发标记; patterns without a trigger are slogans`);
else ok(`${PATTERNS.length} patterns; ${triggers} with 触发, ${costs} with concrete 代价`);

// 姿态文件必须是"怎么想"，不能变成又一份平台事实表
if (countDirectives(patterns) > 60) {
  bad(`reasoning-patterns.md has ~${countDirectives(patterns)} directives — it is becoming a rule list`);
}

// ── 5. P13：热点事实只能有一个权威位置 ─────────────────────────────────────
const skillsFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.md')) skillsFiles.push(full);
  }
})(SKILL);

const SINGLE_AUTHORITY = [
  { label: 'click{name} 静默 no-op', re: /名字写错或类型不符会静默 no-op|写错名字或类型不对时\*\*不报错也不生效/ },
  { label: '没有保存工具（完整流程）', re: /工具集里没有"保存"工具|没有"保存"工具/ },
];
for (const { label, re } of SINGLE_AUTHORITY) {
  const hits = skillsFiles.filter((f) => re.test(read(f)));
  if (hits.length > 1) {
    bad(`"${label}" is defined in ${hits.length} files (P13 violation): ` +
        hits.map((f) => f.slice(SKILL.length + 1)).join(', '));
  } else if (hits.length === 1) {
    ok(`"${label}" has a single authority: ${hits[0].slice(SKILL.length + 1)}`);
  }
}

// ── 6. 关键平台事实仍在（只保留"错了要推倒重来"的那批） ────────────────────
const facts = read(join(REFS, 'platform-facts.md'));
const KEY_FACTS = [
  ['root.children 权威', /root\.children/],
  ['tree[].parentId 无效', /parentId[^\n]{0,40}(无效|没有(任何)?效果)/],
  ['内联 source 优先', /source[^\n]{0,30}非空[^\n]{0,40}(内联|优先)/],
  ['没有长按事件', /没有长按事件/],
  ['客户端不能写自定义变量', /不能写自定义变量|不能写[^\n]{0,10}变量/],
  ['只有模板父节点可实例化', /只有存为模板[^\n]{0,20}父节点/],
  ['没有保存工具', /没有"保存"工具/],
  ['真机/模拟器两侧判定', /两边都没有[^\n]{0,20}(才|才是)/],
  ['坐标系两个基准', /原点左下/],
  ['必读核心在文件头部', /必读核心/],
];
for (const [label, re] of KEY_FACTS) {
  if (!re.test(facts)) bad(`platform-facts.md lost a must-not-get-wrong fact: ${label}`);
}
for (const token of ['文本框', '文本视窗', '预设按钮', '光标检测区域', '网格视窗', '模板引用控件', '界面动效', '全屏动效']) {
  if (!facts.includes(token)) bad(`platform-facts.md is missing control type: ${token}`);
}
if (!/没有\s*`?progress`?/.test(facts)) bad('platform-facts.md must state that there is no progress control type');
ok(`verified ${KEY_FACTS.length} must-not-get-wrong facts + 11 control types`);

// ── 7. 不得残留"强制清单/模板先行"的措辞 ───────────────────────────────────
const BANNED = [
  [/逐项给结论/, '「逐项给结论」（强制清单：填格子取代判断）'],
  [/不适用就写"?不适用"?/, '「不适用就写不适用」（强制填表）'],
  [/必须能写成一句/, '「必须能写成一句」（先验句式，剪掉不套用它的玩法）'],
  [/evidence ledger|证据登记表/, '「证据登记表」（仪式化元数据）'],
];
for (const file of skillsFiles) {
  const text = read(file);
  for (const [re, why] of BANNED) {
    if (re.test(text)) bad(`${file.slice(SKILL.length + 1)} still contains ${why}`);
  }
}
ok('no forced-checklist / template-first phrasing remains');

// ── 8. Markdown 相对链接可达 ────────────────────────────────────────────────
const linkFiles = [...skillsFiles, join(TREE, 'README.md'), join(TREE, 'CHANGELOG.md')]
  .filter((f) => existsSync(f));
let links = 0;
for (const file of linkFiles) {
  for (const m of read(file).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
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
ok(`checked ${links} relative links in ${linkFiles.length} markdown files`);

// ── 9. 锚点存在（标题 → slug） ──────────────────────────────────────────────
// 不重实现 GitHub 的 slugger——那是一条会随实现细节漂移的死路。改为**只比较可见文字**：
// 把标题和锚点里的所有非字母数字字符都去掉再比。代价：区分不了 "patch-op" 与 "patchop"，
// 对一个死链检查器来说可以接受。
const anchorKey = (s) => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
let anchors = 0;
for (const file of skillsFiles) {
  const text = read(file);
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s#]*)#([^)\s]+)\)/g)) {
    const [, rel, anchor] = m;
    const target = rel ? resolve(dirname(file), rel) : file;
    if (!existsSync(target)) continue;
    anchors += 1;
    const targetHeadings = new Set(
      [...read(target).matchAll(/^#{1,6}\s+(.+)$/gm)].map((x) => anchorKey(x[1])),
    );
    if (!targetHeadings.has(anchorKey(anchor))) {
      bad(`${file.slice(TREE.length + 1)} → #${anchor} matches no heading in ${target.slice(TREE.length + 1)}`);
    }
  }
}
ok(`checked ${anchors} in-page anchors`);

// ── 10. 必读集合的规模 ─────────────────────────────────────────────────────
try {
  const core = read(join(REFS, 'reasoning-patterns.md')) + read(join(REFS, 'workflow.md'));
  const pf = read(join(REFS, 'platform-facts.md'));
  const idx = pf.indexOf('## 索引');
  const mustRead = core + (idx > 0 ? pf.slice(0, idx) : pf);
  if (mustRead.length > CORE_READ_CHAR_BUDGET) {
    bad(`always-read set is ${mustRead.length} chars, over the ${CORE_READ_CHAR_BUDGET} budget`);
  } else {
    ok(`always-read set ${mustRead.length} chars (~${Math.round(mustRead.length / 2.6)} tok); ` +
       'platform-facts full text is a lookup manual');
  }
} catch (e) {
  bad(`could not measure the always-read set: ${e.message}`);
}

process.stdout.write(`${notes.join('\n')}\n`);
if (problems.length) {
  process.stderr.write(`\n${problems.join('\n')}\n${problems.length} problem(s)\n`);
  process.exit(1);
}
process.stdout.write('\nverify: all checks passed\n');
