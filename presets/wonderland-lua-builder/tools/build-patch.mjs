#!/usr/bin/env node
// 由 agent.cordis.yml + preset.yml 生成 dsh-plugin/cordis.patch.yml 的预设注册项。
//
// 用法：
//   node tools/build-patch.mjs                                   # 写到 ./cordis.patch.yml（installed 形式）
//   node tools/build-patch.mjs --form repo                       # 保留仓库内的 skills 解析表达式
//   node tools/build-patch.mjs --source <dir> --selftest <file>   # 用原始配置重建并与已安装补丁逐字节比对
//
// --selftest 用来证明本地变换与上游 pnpm build 的产物一致。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPatch } from './lib/build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TREE = resolve(HERE, '..');

function parseArgs(argv) {
  const out = { form: 'installed', out: null, source: TREE, selftest: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--form') out.form = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--source') out.source = resolve(argv[++i]);
    else if (a === '--selftest') out.selftest = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!['installed', 'repo'].includes(out.form)) throw new Error('--form must be installed|repo');
  return out;
}

const args = parseArgs(process.argv.slice(2));
const generated = buildPatch({ source: args.source, form: args.form });
const outFile = args.out ? resolve(args.out) : join(TREE, 'cordis.patch.yml');
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, generated, 'utf8');
process.stdout.write(
  `generated ${outFile} (${Buffer.byteLength(generated, 'utf8')} bytes, form=${args.form})\n`,
);

if (args.selftest) {
  const expected = readFileSync(args.selftest, 'utf8').replace(/\r\n/g, '\n');
  if (expected === generated) {
    process.stdout.write('selftest: identical to the installed patch\n');
  } else {
    const a = expected.split('\n');
    const b = generated.split('\n');
    const lines = [];
    for (let i = 0; i < Math.max(a.length, b.length) && lines.length < 8; i += 1) {
      if (a[i] !== b[i]) {
        lines.push(
          `  line ${i + 1}\n    installed: ${JSON.stringify(a[i])}\n    generated: ${JSON.stringify(b[i])}`,
        );
      }
    }
    process.stderr.write(`selftest FAILED against ${args.selftest}\n${lines.join('\n')}\n`);
    process.exit(1);
  }
}
