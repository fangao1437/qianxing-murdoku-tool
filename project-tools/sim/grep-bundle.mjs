// tools/sim/grep-bundle.mjs —— 在插件 bundle 里检索关键词并打印上下文
// 用法：node tools/sim/grep-bundle.mjs <关键词1> [关键词2 ...]
import fs from 'node:fs';

const FILE = process.env.SIM_BUNDLE
  || 'C:/Users/18182/.dsh/profiles/web/node_modules/dsh-plugin-beyond-simulator/dsh-plugin/dist/index.js';

const s = fs.readFileSync(FILE, 'utf8');
console.log('bundle: ' + FILE + '  (' + s.length + ' 字符)');

const keys = process.argv.slice(2);
const before = Number(process.env.SIM_CTX_BEFORE || 300);
const after = Number(process.env.SIM_CTX_AFTER || 500);
const maxHits = Number(process.env.SIM_MAX_HITS || 3);

for (const key of keys) {
  let i = -1, n = 0;
  while ((i = s.indexOf(key, i + 1)) !== -1 && n < maxHits) {
    n++;
    console.log(`\n=== 「${key}」 #${n} @${i}`);
    console.log(s.slice(Math.max(0, i - before), i + after).replace(/\s+/g, ' '));
  }
  if (n === 0) console.log(`\n=== 「${key}」 未找到`);
}
