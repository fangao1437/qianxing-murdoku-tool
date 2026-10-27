#!/usr/bin/env node
/**
 * proto_strip_comments.mjs —— 「打包时剥注释」的**可行性原型**（只写临时文件，不碰仓库）
 *
 * 回答一个问题，且只用实测回答：
 *   把 dist/client_script.lua 里的**注释**去掉（字符串一字不动），产出还能不能被 Lua 5.3 正常编译？
 *
 * 口径：
 *   · 只删注释：行注释 `-- …` 删到行尾（保留换行）；长注释 `--[[ … ]]` / `--[=[ … ]=]` 整段换成**一个空格**
 *   · 字符串（`"…"` `'…'` 以及长字符串 `[[…]]`）**原样保留** —— 这是本原型唯一的技术风险点
 *   · 每段注释换成单个空格而不是空串，避免两个标识符被粘在一起
 *   · **不写仓库内任何文件**；产物落在 $env:TEMP
 *
 * 用法：node tools/audit/proto_strip_comments.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'dist', 'client_script.lua');
const OUT = path.join(os.tmpdir(), 'murdoku_client_script_nocomment.lua');

function stripComments(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let removed = 0;
  const longOpen = (at) => {
    if (src[at] !== '[') return null;
    let j = at + 1;
    while (src[j] === '=') j++;
    if (src[j] !== '[') return null;
    return { level: j - at - 1, len: j - at + 1 };
  };
  while (i < n) {
    const c = src[i];
    // 行注释
    if (c === '-' && src[i + 1] === '-') {
      const lo = longOpen(i + 2);
      if (lo) {
        const close = ']' + '='.repeat(lo.level) + ']';
        const end = src.indexOf(close, i + 2 + lo.len);
        const stop = end < 0 ? n : end + close.length;
        removed += stop - i;
        out.push(' '); // 单空格代替整段注释
        i = stop;
        continue;
      }
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      removed += j - i;
      i = j; // 换行留给下一轮原样输出
      continue;
    }
    // 长字符串：原样保留
    const lo = longOpen(i);
    if (lo) {
      const close = ']' + '='.repeat(lo.level) + ']';
      const end = src.indexOf(close, i + lo.len);
      const stop = end < 0 ? n : end + close.length;
      out.push(src.slice(i, stop));
      i = stop;
      continue;
    }
    // 短字符串：原样保留（含转义）
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        if (src[j] === '\n') break; // 未闭合（容错）
        j++;
      }
      out.push(src.slice(i, j));
      i = j;
      continue;
    }
    out.push(c);
    i++;
  }
  return { text: out.join(''), removed };
}

const src = fs.readFileSync(SRC, 'utf8');
const { text, removed } = stripComments(src);
fs.writeFileSync(OUT, text, 'utf8');
const b0 = Buffer.byteLength(src, 'utf8');
const b1 = Buffer.byteLength(text, 'utf8');
console.log('══════ 剥注释原型 ══════');
console.log(`输入：${SRC}`);
console.log(`输出：${OUT}`);
console.log(`原大小 ${b0.toLocaleString()} B → 剥注释后 ${b1.toLocaleString()} B`);
console.log(`减少 ${(b0 - b1).toLocaleString()} B（${(((b0 - b1) / b0) * 100).toFixed(1)}%）`);
console.log(`删掉的注释字符 ${removed.toLocaleString()}`);
console.log('');
console.log('下一步（手工跑，判据是"能编译 + 能执行"）：');
console.log(`  node tools/lua53check/check.cjs "${OUT}" --run`);
