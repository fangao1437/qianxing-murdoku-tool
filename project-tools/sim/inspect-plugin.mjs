// tools/sim/inspect-plugin.mjs —— 在插件 bundle 里定位指定片段
// 用法：node tools/sim/inspect-plugin.mjs <搜索串> [前后字符数]
import fs from 'node:fs';
const F = process.env.SIM_PLUGIN
  || 'C:/Users/18182/.dsh/profiles/web/node_modules/dsh-plugin-beyond-simulator/dsh-plugin/dist/index.js';
const s = fs.readFileSync(F, 'utf8');
const needle = process.argv[2];
const pad = +(process.argv[3] || 700);
if (!needle) { console.error('用法: node inspect-plugin.mjs <搜索串> [pad]'); process.exit(1); }
let i = -1, n = 0;
while ((i = s.indexOf(needle, i + 1)) >= 0 && n < 6) {
  n++;
  console.log('=== 命中 ' + n + ' @ ' + i + ' ===');
  console.log(s.slice(Math.max(0, i - pad), i + pad));
  console.log();
}
if (n === 0) console.log('没找到：' + needle);
