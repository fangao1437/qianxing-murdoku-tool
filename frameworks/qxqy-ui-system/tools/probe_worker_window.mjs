// tools/probe_worker_window.mjs — 打印插件 worker.js 的字符窗口（按绝对偏移）
import fs from 'node:fs';
const [, , F, START, END] = process.argv;
const src = fs.readFileSync(F, 'utf8');
const s = Math.max(0, Number(START));
const e = Math.min(src.length, Number(END));
process.stdout.write(src.slice(s, e));
