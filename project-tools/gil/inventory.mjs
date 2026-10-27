// tools/gil/inventory.mjs —— 清点 .gil 里的**客户端控件清单**
//
// 目的（2026-09-27，用户确认开始做"直接生成存档"）：
//   要生成布局，先得知道两件事：
//     ① 现有存档里**有哪些控件**（哪些能当克隆原型）；
//     ② **父子关系**怎么表达 —— 是靠某个"有序 ID 列表"，还是记录里有 parent 字段。
//
// 做法：把体解析成字段树，找出所有"控件记录"（同时含 控件ID + 类型名字符串 + 四套状态几何），
//       逐个打印：ID / 类型 / 记录里出现的所有短字符串 / 四套状态的位置与尺寸。
//
// 用法：node tools/gil/inventory.mjs [文件]

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
const buf = fs.readFileSync(file);
const HEAD = 20;
const hdr = []; for (let i = 0; i < 5; i++) hdr.push(buf.readUInt32BE(i * 4));
const END = HEAD + hdr[4];
console.log('文件：' + path.basename(file) + '（' + buf.length + ' 字节）体区间 [20, ' + END + ')');

function readVarint(b, p, lim) {
  let r = 0n, s = 0n, n = 0;
  const end = lim === undefined ? b.length : lim;
  while (p < end) {
    const x = b[p++]; n++;
    r |= BigInt(x & 0x7f) << s;
    if ((x & 0x80) === 0) return { v: r, p };
    s += 7n;
    if (n > 10) return null;
  }
  return null;
}
function parse(b, start, end, depth) {
  const out = [];
  let p = start;
  while (p < end) {
    const fs0 = p;
    const t = readVarint(b, p, end);
    if (!t || t.v === 0n) return null;
    const field = Number(t.v >> 3n), wt = Number(t.v & 7n);
    if (field === 0) return null;
    p = t.p;
    if (wt === 0) {
      const v = readVarint(b, p, end); if (!v) return null; p = v.p;
      out.push({ field, wt, num: v.v, raw: b.subarray(fs0, p) });
    } else if (wt === 2) {
      const l = readVarint(b, p, end); if (!l) return null;
      const s0 = l.p, s1 = s0 + Number(l.v);
      if (s1 > end) return null;
      p = s1;
      const pay = b.subarray(s0, s1);
      let bad = 0;
      for (let i = 0; i < pay.length; i++) { const c = pay[i]; if (c < 9 || (c > 13 && c < 32)) bad++; }
      const isText = bad === 0 && pay.length > 0 && !pay.toString('utf8').includes('\ufffd');
      let sub = null;
      if (!isText && depth < 18 && pay.length >= 2) sub = parse(b, s0, s1, depth + 1);
      out.push({ field, wt, len: Number(l.v), payload: pay, isText, sub, raw: b.subarray(fs0, p) });
    } else if (wt === 5) { if (p + 4 > end) return null; out.push({ field, wt, num: b.readFloatLE(p), raw: b.subarray(fs0, p + 4) }); p += 4; }
    else if (wt === 1) { if (p + 8 > end) return null; out.push({ field, wt, raw: b.subarray(fs0, p + 8) }); p += 8; }
    else return null;
  }
  return p === end ? out : null;
}

const tree = parse(buf, HEAD, END, 0);
if (!tree) { console.error('体解析失败'); process.exit(2); }

// ── 收集所有字符串字段（含路径），用来判断"哪些是控件名"────────────────────
const strings = [];
function walk(fields, pathStr) {
  for (const f of fields) {
    const here = pathStr + '/' + f.field;
    if (f.wt === 2 && f.isText && f.len <= 64) strings.push({ path: here, s: f.payload.toString('utf8'), len: f.len });
    if (f.sub) walk(f.sub, here);
  }
}
walk(tree, '');

console.log('\n全部短字符串（' + strings.length + ' 个），按值去重后：');
const byVal = new Map();
for (const s of strings) byVal.set(s.s, (byVal.get(s.s) || 0) + 1);
const list = [...byVal.entries()].sort((a, b) => b[1] - a[1]);
for (const [v, n] of list.slice(0, 80)) console.log('  ×' + String(n).padStart(3) + '  ' + JSON.stringify(v));
if (list.length > 80) console.log('  … 还有 ' + (list.length - 80) + ' 种');
