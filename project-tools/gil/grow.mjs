// tools/gil/grow.mjs —— 从"已知的小记录"向上逐层扩大，找出控件的**完整记录**
//
// 为什么这么做：tree.mjs 证明了整个 .gil 体**不是单个 protobuf 消息**（整体解析失败），
// 所以不能自顶向下建树。但我们已经知道：
//   · 文件里有大量长度前缀的记录，且能**局部**解析成功；
//   · 形如  #12 msg { #501 str="cell.1.1" }  #501 varint  #502 varint  的小记录干净可解。
// 于是改成**自底向上生长**：从包住 needle 的最小可解记录出发，
// 在它前面找一个长度前缀，使得「起点更早、覆盖范围更大、且整体仍能解析」——反复直到不能再扩。
//
// 用法：node tools/gil/grow.mjs [文件] [needle] [回看窗口字节]

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.LOCALAPPDATA + 'Low', 'miHoYo', '原神', 'BeyondLocal', '153793556', 'Beyond_Local_Save_Level');
const pick = () => {
  for (const d of fs.readdirSync(DIR)) {
    const p = path.join(DIR, d);
    if (fs.statSync(p).isDirectory()) {
      const g = fs.readdirSync(p).find((f) => f.endsWith('.gil'));
      if (g) return path.join(p, g);
    }
  }
  const g = fs.readdirSync(DIR).find((f) => f.endsWith('.gil'));
  return g ? path.join(DIR, g) : null;
};

const file = process.argv[2] || pick();
const needle = process.argv[3] || 'cell.1.1';
const WINDOW = Number(process.argv[4] || 16384);
const buf = fs.readFileSync(file);
const HEAD = 20;
console.log('文件：' + path.basename(file) + '（' + buf.length + ' 字节）  目标串：' + needle);

function readVarint(b, p, lim) {
  let r = 0, s = 0, n = 0;
  while (p < (lim === undefined ? b.length : lim)) {
    const x = b[p++]; n++;
    r += (x & 0x7f) * Math.pow(2, s);
    if ((x & 0x80) === 0) return { v: r, p };
    s += 7;
    if (n > 6) return null;               // 长度/字段号不会太长
  }
  return null;
}

function parseMsg(b, start, end, depth) {
  const out = [];
  let p = start;
  while (p < end) {
    const t = readVarint(b, p, end);
    if (!t || t.v === 0) return null;
    const field = Math.floor(t.v / 8), wt = t.v % 8;
    if (field === 0 || field > 100000) return null;
    p = t.p;
    if (wt === 0) {
      const v = readVarint(b, p, end);
      if (!v) return null;
      p = v.p;
      out.push({ field, wt, num: v.v });
    } else if (wt === 2) {
      const l = readVarint(b, p, end);
      if (!l) return null;
      p = l.p;
      if (p + l.v > end) return null;
      const s0 = p, s1 = p + l.v;
      p = s1;
      const slice = b.subarray(s0, s1);
      let str = null, bad = 0;
      for (let i = 0; i < slice.length; i++) {
        const c = slice[i];
        if (c < 0x09 || (c > 0x0d && c < 0x20)) bad++;
      }
      if (bad === 0 && slice.length > 0) {
        str = slice.toString('utf8');
        if (str.includes('\ufffd')) str = null;
      }
      let sub = null;
      if (str === null && depth < 12 && slice.length >= 2) sub = parseMsg(b, s0, s1, depth + 1);
      out.push({ field, wt, len: l.v, str, sub, start: s0, end: s1, raw: slice });
    } else if (wt === 5) {
      if (p + 4 > end) return null;
      out.push({ field, wt, num: b.readFloatLE(p) });
      p += 4;
    } else if (wt === 1) {
      if (p + 8 > end) return null;
      out.push({ field, wt, num: Number(buf.readBigInt64LE(p)), dbl: buf.readDoubleLE(p) });
      p += 8;
    } else return null;
    if (out.length > 200000) return null;
  }
  return p === end ? out : null;
}

// 找 needle
const nb = Buffer.from(needle, 'utf8');
const hits = [];
let from = 0;
while (hits.length < 200) {
  const i = buf.indexOf(nb, from);
  if (i < 0) break;
  hits.push(i); from = i + 1;
}
console.log('命中 ' + hits.length + ' 处：' + hits.slice(0, 10).join(', ') + (hits.length > 10 ? ' …' : ''));
if (!hits.length) process.exit(0);

// 起始区域：最小可解记录（含 needle）
const target = hits[0];
let region = null;
for (let back = 2; back <= 32; back++) {
  const s = target - back;
  const t = readVarint(buf, s);
  if (!t || t.v % 8 !== 2 || t.p !== s + 1) continue;
  const l = readVarint(buf, t.p);
  if (!l) continue;
  const e = l.p + l.v;
  if (e <= target || e > buf.length) continue;
  const m = parseMsg(buf, l.p, e, 0);
  if (m && m.length) { region = { start: s, bodyStart: l.p, end: e, msg: m, via: 'len-prefix' }; break; }
}
if (!region) {
  // 退路：把 needle 前后各取一段，直接当作"记录体"试解析
  for (let a = target - 64; a <= target; a++) {
    for (let b2 = target + 8; b2 <= target + 512; b2++) {
      if (b2 > buf.length) break;
      const m = parseMsg(buf, a, b2, 0);
      if (m && m.length >= 3) { region = { start: a, bodyStart: a, end: b2, msg: m, via: 'brute' }; break; }
    }
    if (region) break;
  }
}
if (!region) { console.log('找不到起始可解区域'); process.exit(0); }
console.log('起始区域：偏移 ' + region.start + '..' + region.end + '（' + (region.end - region.start) + ' 字节，' + region.msg.length + ' 字段，' + region.via + '）');

// ── 向上生长 ──────────────────────────────────────────────────────────────
let grew = 0;
for (let round = 0; round < 24; round++) {
  let best = null;
  const lo = Math.max(HEAD, region.start - WINDOW);
  for (let s = region.start - 1; s >= lo; s--) {
    const t = readVarint(buf, s);
    if (!t || t.v % 8 !== 2) continue;
    const field = Math.floor(t.v / 8);
    if (field === 0 || field > 100000) continue;
    const l = readVarint(buf, t.p);
    if (!l) continue;
    const bs = l.p, be = bs + l.v;
    if (be <= region.end && bs >= region.start) { /* 更小，不管 */ }
    if (be < region.end) continue;                 // 必须覆盖住已知区域
    if (bs > region.start) continue;
    if (be > buf.length) continue;
    const m = parseMsg(buf, bs, be, 0);
    if (!m || !m.length) continue;
    const size = be - s;
    if (best === null || size > best.size) best = { start: s, bodyStart: bs, end: be, msg: m, size, field };
  }
  if (best === null || best.size <= (region.end - region.start)) break;
  region = { start: best.start, bodyStart: best.bodyStart, end: best.end, msg: best.msg };
  grew++;
}
console.log('向上生长 ' + grew + ' 层 → 最终区域 偏移 ' + region.start + '..' + region.end
  + '（' + (region.end - region.start) + ' 字节，' + region.msg.length + ' 个字段）');

function dump(fields, indent, limit) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const f of fields.slice(0, limit)) {
    if (f.wt === 0) lines.push(pad + '#' + f.field + ' = ' + f.num);
    else if (f.wt === 2 && f.str !== null) lines.push(pad + '#' + f.field + ' str = ' + JSON.stringify(f.str));
    else if (f.wt === 2 && f.sub !== null) {
      lines.push(pad + '#' + f.field + ' msg[' + f.sub.length + '] {');
      lines.push(...dump(f.sub, indent + 2, limit));
      lines.push(pad + '}');
    } else if (f.wt === 2) lines.push(pad + '#' + f.field + ' bytes[' + f.len + '] = ' + f.raw.subarray(0, 16).toString('hex'));
    else lines.push(pad + '#' + f.field + ' = ' + f.num + (f.dbl !== undefined ? ' (dbl ' + f.dbl + ')' : ''));
    if (lines.length > 800) { lines.push(pad + '… 截断'); break; }
  }
  return lines;
}
console.log('\n===== 记录内容 =====');
console.log(dump(region.msg, 0, 400).join('\n'));
