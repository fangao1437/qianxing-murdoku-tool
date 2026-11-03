// tools/probe_worker_schema.mjs — 从模拟器插件 worker.js 提取内嵌的 protobuf 模式文本与 GIA 读取器
import fs from 'node:fs';

const F = process.argv[2];
const KW = process.argv[3] || 'UiControlGroup';
const BEFORE = Number(process.argv[4] || 200);
const AFTER = Number(process.argv[5] || 3000);
const src = fs.readFileSync(F, 'utf8');
let from = 0;
let n = 0;
for (;;) {
  const i = src.indexOf(KW, from);
  if (i < 0) break;
  n++;
  console.log(`\n===== 命中 ${n} @${i} =====`);
  console.log(src.slice(Math.max(0, i - BEFORE), i + AFTER));
  from = i + KW.length;
  if (n >= 3) break;
}
if (!n) console.log('未命中', KW);
