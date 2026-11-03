#!/usr/bin/env node
// 验证预设里 customSkillDirs 的 !!js 表达式在真实 profile 下能解析到 skills 目录。
//   node tools/check-skill-path.mjs [--profile <DSH profile 目录>]
// 默认检查 desktop profile。

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  let profile = join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--profile') profile = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return profile;
}

const profile = parseArgs(process.argv.slice(2));
// Loader 在不同层给出的 baseUrl 可能是 profile 目录或补丁文件位置，两种都试。
const bases = [
  pathToFileURL(join(profile, 'cordis.yml')).href,
  pathToFileURL(join(profile) + '/').href,
];
let found = null;
for (const base of bases) {
  try {
    const req = createRequire(base);
    const pkg = req.resolve('dsh-plugin-beyond-simulator/package.json');
    const skills = join(dirname(pkg), 'dsh-plugin', 'presets', 'wonderland-lua-builder', 'skills');
    const marker = join(skills, 'qxqy-game-studio', 'SKILL.md');
    const ok = existsSync(marker);
    process.stdout.write(`base ${base}\n  -> ${skills}\n  qxqy-game-studio/SKILL.md: ${ok ? 'found' : 'MISSING'}\n`);
    if (ok && !found) found = skills;
  } catch (e) {
    process.stdout.write(`base ${base}\n  -> unresolved (${e.code ?? e.message})\n`);
  }
  try {
    const url = new URL('skills/', base);
    const marker = join(new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'qxqy-game-studio', 'SKILL.md');
    process.stdout.write(`  new URL('skills/', base): ${existsSync(marker) ? 'found' : 'MISSING'}\n`);
  } catch {
    /* base 不是文件 URL 时忽略 */
  }
}

if (!found) {
  process.stderr.write('\nFAIL: none of the candidate bases resolved to an existing skills directory\n');
  process.exit(1);
}
process.stdout.write(`\nok: preset skills resolve to ${found}\n`);
