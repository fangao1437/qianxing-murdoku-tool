#!/usr/bin/env node
/**
 * measure_bundle.mjs —— 量上机负载的构成（只报告，不改文件）
 *
 * 回答三个问题：
 *   ① dist/client_script.lua 里，**注释行/空行**占多少真实字节（注释不参与执行，但会被打进包、随存档下发、读进内存）
 *   ② 每个模块各占多少真实字节（找"肥肉在哪个文件"）
 *   ③ 每个模块里 `print(` 探针行有多少
 *
 * 用法：node tools/audit/measure_bundle.mjs
 *
 * 口径：
 *   · 逐行判定用「剥注释后的同一行是否为空」：剥后为空而原行非空 ⇒ 纯注释行；两者都空 ⇒ 空行；其余 ⇒ 代码行。
 *     这样行内代码 + 行尾注释的行算代码行（正确）。
 *   · 字节一律用 Buffer.byteLength(line, 'utf8') —— 中文字符是 3 字节，不能用 String.length。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(ROOT, 'dist', 'client_script.lua');

/** 剥注释与字符串（保留换行，长度与原文一致）*/
function strip(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const longOpen = (at) => {
    if (src[at] !== '[') return null;
    let j = at + 1;
    while (src[j] === '=') j++;
    if (src[j] !== '[') return null;
    return { level: j - at - 1, len: j - at + 1 };
  };
  while (i < n) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') {
      const lo = longOpen(i + 2);
      if (lo) {
        const close = ']' + '='.repeat(lo.level) + ']';
        const end = src.indexOf(close, i + 2 + lo.len);
        const stop = end < 0 ? n : end + close.length;
        for (let k = i; k < stop; k++) out.push(src[k] === '\n' ? '\n' : ' ');
        i = stop;
        continue;
      }
      while (i < n && src[i] !== '\n') { out.push(' '); i++; }
      continue;
    }
    const lo = longOpen(i);
    if (lo) {
      const close = ']' + '='.repeat(lo.level) + ']';
      const end = src.indexOf(close, i + lo.len);
      const stop = end < 0 ? n : end + close.length;
      for (let k = i; k < stop; k++) out.push(src[k] === '\n' ? '\n' : ' ');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < n && src[j] !== q && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      const stop = Math.min(j + 1, n);
      for (let k = i; k < stop; k++) out.push(src[k] === '\n' ? '\n' : ' ');
      i = stop;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

const bytes = (s) => Buffer.byteLength(s, 'utf8');

function analyze(src, label) {
  const clean = strip(src);
  const raw = src.split('\n');
  const cl = clean.split('\n');
  const acc = { code: { lines: 0, bytes: 0 }, comment: { lines: 0, bytes: 0 }, blank: { lines: 0, bytes: 0 } };
  let printLines = 0;
  for (let k = 0; k < raw.length; k++) {
    const o = raw[k];
    const s = (cl[k] ?? '').trim();
    const b = bytes(o) + 1; // +1 = 换行符
    if (o.trim() === '') acc.blank.lines++, (acc.blank.bytes += b);
    else if (s === '') acc.comment.lines++, (acc.comment.bytes += b);
    else {
      acc.code.lines++, (acc.code.bytes += b);
      if (/\bprint\s*\(/.test(cl[k] ?? '')) printLines++;
    }
  }
  const total = bytes(src);
  if (label) {
    const pct = (v) => ((v / total) * 100).toFixed(1) + '%';
    console.log(`\n=== ${label} ===`);
    console.log(`  真实字节 ${total.toLocaleString()} B · 总行 ${raw.length.toLocaleString()}`);
    console.log(`  代码 ${acc.code.lines.toLocaleString().padStart(6)} 行 ${acc.code.bytes.toLocaleString().padStart(10)} B  ${pct(acc.code.bytes).padStart(6)}`);
    console.log(`  注释 ${acc.comment.lines.toLocaleString().padStart(6)} 行 ${acc.comment.bytes.toLocaleString().padStart(10)} B  ${pct(acc.comment.bytes).padStart(6)}`);
    console.log(`  空行 ${acc.blank.lines.toLocaleString().padStart(6)} 行 ${acc.blank.bytes.toLocaleString().padStart(10)} B  ${pct(acc.blank.bytes).padStart(6)}`);
    console.log(`  含 print( 的代码行：${printLines}`);
  }
  return { ...acc, total, printLines, lines: raw.length };
}

console.log('══════ 上机负载构成测量（真实 UTF-8 字节）══════');
const whole = analyze(fs.readFileSync(DIST, 'utf8'), 'dist/client_script.lua');

const src = fs.readFileSync(DIST, 'utf8');
const marks = [...src.matchAll(/^__M\["([^"]+)"\] = function\(\)$/gm)];
const rows = [];
for (let k = 0; k < marks.length; k++) {
  const start = marks[k].index + marks[k][0].length;
  const end = k + 1 < marks.length ? marks[k + 1].index : src.length;
  const r = analyze(src.slice(start, end));
  rows.push({ name: marks[k][1], ...r });
}
rows.sort((a, b) => b.total - a.total);
const tot = rows.reduce((s, r) => s + r.total, 0);
console.log('\n=== 分模块（按打包器 __M["name"] 切段；字节 = 模块正文，不含模块加载器）===');
console.log(
  '  ' + '模块'.padEnd(22) + '字节'.padStart(10) + '占比'.padStart(7) + '注释占比'.padStart(9) + '行数'.padStart(7) + 'print行'.padStart(8)
);
for (const r of rows) {
  console.log('  ' + r.name.padEnd(22) + String(r.total).padStart(10) +
    ((r.total / tot) * 100).toFixed(1).padStart(6) + '%' +
    ((r.comment.bytes / r.total) * 100).toFixed(1).padStart(8) + '%' +
    String(r.lines).padStart(7) + String(r.printLines).padStart(8));
}
console.log('  ' + '模块正文合计'.padEnd(22) + String(tot).padStart(10) + `  （占整包 ${((tot / whole.total) * 100).toFixed(1)}%）`);
