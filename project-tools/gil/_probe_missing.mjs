// 清单里缺的记录：按页统计 + 看档里 svg/txt 命名
import fs from 'node:fs';
import { readGil } from './gilread.mjs';

const md = fs.readFileSync(process.argv[2], 'utf8');
const cl = new Set();
const rx = new RegExp('^\\|\\s*`([^`]+)`\\s*\\|');
for (const l of md.split(/\r?\n/)) { const m = l.match(rx); if (m) cl.add(m[1]); }

const g = readGil(process.argv[3]);
const names = new Set(g.recs.map((r) => r.name).filter(Boolean));
const miss = [...cl].filter((n) => !names.has(n));
console.log('  清单 ' + cl.size + ' 条，缺 ' + miss.length + ' 条');
const byPage = {};
for (const n of miss) {
  const m = n.match(/^(td\.[^.]+\.page\.\d+)\.(.+)$/);
  const k = m ? m[1] : '?';
  (byPage[k] = byPage[k] || []).push(m ? m[2] : n);
}
for (const k of Object.keys(byPage)) console.log('  ' + k + ' 缺 ' + byPage[k].length + ' 个: ' + byPage[k].slice(0, 10).join(', '));

for (const page of ['td.home.page.1', 'td.l1.page.1']) {
  const have = [...names].filter((n) => n.startsWith(page + '.')).map((n) => n.slice(page.length + 1)).filter((x) => /^(svg|txt|text)\./.test(x));
  have.sort((a, b) => (+a.split('.')[1] || 0) - (+b.split('.')[1] || 0));
  console.log('  档里 ' + page + ' 的 svg/txt 共 ' + have.length + ' 个: ' + have.slice(0, 24).join(', '));
}
// 额外：清单抽一行看它是否在档里、对应哪页
console.log('  样例缺失: ' + miss.slice(0, 4).join(' / '));
