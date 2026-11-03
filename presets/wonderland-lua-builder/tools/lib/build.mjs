// 预设构建核心：把 agent.cordis.yml + preset.yml 变换成 dsh-plugin/cordis.patch.yml。
// 与上游仓库构建的等价性由 tools/build-patch.mjs --selftest 验证。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// DSH ≥2.0.18 的提示词变量插值只注册 `provider` 与 `model`；`{{cwd}}` 不再由循环提供。
// 组装阶段的严格规则是：任何未注册/无值的引用都会让整次提示词组装失败（报
// `unknown prompt variable "{{cwd}}"`），因此会话无法启动，而不是降级。
// 官方给的处理方式是只删掉那一句、保留其余文本——工作目录本身由 working-directory
// 上下文服务提供，不依赖 persona 里的这句声明。
export const CWD_CLAUSE = /\s*Your working directory is \{\{cwd\}\}\./g;

/** 去掉 persona 文本里会让 DSH ≥2.0.18 组装失败的 `{{cwd}}` 语句。 */
export function stripUnsupportedVariables(text) {
  return text.replace(CWD_CLAUSE, '');
}

/** 文本里是否仍引用 `{{cwd}}`（构建后自检用）。 */
export function hasCwdReference(text) {
  return /\{\{cwd\}\}/.test(text);
}

// preset.yml 只有 name / description 两个单行字段。
export function readPresetMeta(dir) {
  const text = readFileSync(join(dir, 'preset.yml'), 'utf8');
  const field = (key) => {
    const m = text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
    if (!m) throw new Error(`preset.yml is missing "${key}"`);
    return m[1].trim().replace(/^["']|["']$/g, '');
  };
  return { name: field('name'), description: field('description') };
}

// 仓库内写法：skills/ 与 agent.cordis.yml 同目录（上游 pnpm build 会把它改写成包内路径）。
export const REPO_SKILLS =
  "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))";
// 已安装写法：与 dsh-plugin-beyond-simulator 包内预设的 skills 目录一致。
export const INSTALLED_SKILLS =
  "process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('dsh-plugin-beyond-simulator/package.json')), 'dsh-plugin/presets/wonderland-lua-builder/skills')";

const SKILL_LINE = /^(\s*)- !!js ".*"$/m;

export function rewriteSkillsExpression(pluginsYaml, form) {
  const target = form === 'repo' ? REPO_SKILLS : INSTALLED_SKILLS;
  const found = pluginsYaml.match(SKILL_LINE);
  if (!found) throw new Error('agent.cordis.yml has no "!!js" skill path line to rewrite');
  const expr = found[0].trim().replace(/^- !!js "|"$/g, '');
  if (form === 'repo' && expr !== REPO_SKILLS) {
    throw new Error(`--form repo expects the repository expression, found: ${expr}`);
  }
  return pluginsYaml.replace(SKILL_LINE, (_line, indent) => `${indent}- !!js ${JSON.stringify(target)}`);
}

function indentBlock(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => (line.length === 0 ? '' : pad + line))
    .join('\n');
}

export function buildPatch({ source, form = 'installed' }) {
  const meta = readPresetMeta(source);
  const raw = readFileSync(join(source, 'agent.cordis.yml'), 'utf8').replace(/\r\n/g, '\n');
  // 防御性剥离：即使上游 agent.cordis.yml 仍带着 `{{cwd}}`，生成的补丁也不会再引用它。
  const sanitized = stripUnsupportedVariables(raw.replace(/\n+$/, ''));
  if (hasCwdReference(sanitized)) {
    throw new Error('agent.cordis.yml still references {{cwd}} after sanitizing; DSH ≥2.0.18 rejects it');
  }
  const plugins = rewriteSkillsExpression(sanitized, form);
  const disabled = JSON.stringify(
    "(()=>{try{process.getBuiltinModule('node:module').createRequire(process.argv[1]).resolve('@deepseek-ai/dsh-agent-preset');return false}catch{return true}})()",
  );
  return [
    '- insert:',
    '    - id: qxqy-simulator',
    '      name: dsh-plugin-beyond-simulator',
    '    - id: qxqy-simulator-skill',
    '      name: dsh-plugin-beyond-simulator/skill',
    '    - id: qxqy-simulator-preset-legacy',
    '      name: dsh-plugin-beyond-simulator/preset',
    '    - id: qxqy-simulator-preset',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    `      disabled: !!js ${disabled}`,
    '      config:',
    '        id: wonderland-lua-builder',
    `        name: ${JSON.stringify(meta.name)}`,
    `        description: ${JSON.stringify(meta.description)}`,
    '        plugins:',
    indentBlock(plugins, 10),
    '',
  ].join('\n');
}

// 载入 YAML 解析器：优先工作区/node_modules，其次 DSH 安装目录（本机无工作区依赖时）。
export async function loadYaml() {
  const { createRequire } = await import('node:module');
  const { existsSync } = await import('node:fs');
  const candidates = [
    process.env.DSH_APP_NODE_MODULES,
    'C:/Users/18182/AppData/Local/Programs/DSH Desktop/resources/app/node_modules',
  ].filter(Boolean);
  for (const dir of candidates) {
    if (!existsSync(join(dir, 'yaml', 'package.json'))) continue;
    const req = createRequire(join(dir, 'noop.js'));
    const mod = await import(new URL(`file://${req.resolve('yaml').replace(/\\/g, '/')}`).href);
    return mod.default ?? mod;
  }
  throw new Error('yaml parser not found; set DSH_APP_NODE_MODULES to a directory containing the "yaml" package');
}
