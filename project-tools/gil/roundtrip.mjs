// tools/gil/roundtrip.mjs —— .gil 的**字节级往返测试**（可行性闸门）
//
// 背景：我已经把存档里的控件格式解出来了（见 docs/千星存档-gil格式.md）：
//   · 每个控件一条 #502 记录，含 ID、类型名（中文）、四套状态几何（位置/尺寸/锚点/中心）；
//   · 你现在这份存档里已经**有容器/按钮/文本框三种原型**，够当克隆模板。
//
// 但要"生成存档给用户导入"，必须先回答一个问题：
//   **把解析出来的模型重新编码回去，能不能得到和原文件一模一样的字节？**
// 能 → 说明模型是完整的，改字段、加记录都可控；
// 不能 → 说明还有没解析出来的东西，硬写会损坏存档。
//
// 做法：解析整棵树（保留每个字段的顺序与类型），用**重新计算的 varint 与长度前缀**
// 自底向上重新序列化，然后和原字节逐字节比较，报出第一个不一致的位置。
//
// 用法：node tools/gil/roundtrip.mjs [文件]

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

// ── varint ────────────────────────────────────────────────────────────────
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
function writeVarint(v) {
  const out = [];
  let x = BigInt(v);
  do {
    let b = Number(x & 0x7fn);
    x >>= 7n;
    if (x > 0n) b |= 0x80;
    out.push(b);
  } while (x > 0n);
  return Buffer.from(out);
}

// ── 解析：每个字段保留「原始字节 + 结构化子节点（若有）」──────────────────
// 关键：同时保存 raw（含 tag+len+payload 的**完整原字节**），
//       以及 sub（若能当消息解析则递归），这样两种重编码都能试。
function parse(b, start, end, depth) {
  const fields = [];
  let p = start;
  while (p < end) {
    const fieldStart = p;
    const t = readVarint(b, p, end);
    if (!t || t.v === 0n) return null;
    const field = Number(t.v >> 3n), wt = Number(t.v & 7n);
    if (field === 0) return null;
    p = t.p;
    if (wt === 0) {
      const v = readVarint(b, p, end);
      if (!v) return null;
      p = v.p;
      fields.push({ field, wt, num: v.v, raw: b.subarray(fieldStart, p) });
    } else if (wt === 2) {
      const l = readVarint(b, p, end);
      if (!l) return null;
      const s0 = l.p, s1 = s0 + Number(l.v);
      if (s1 > end) return null;
      p = s1;
      const payload = b.subarray(s0, s1);
      let bad = 0;
      for (let i = 0; i < payload.length; i++) {
        const c = payload[i];
        if (c < 0x09 || (c > 0x0d && c < 0x20)) bad++;
      }
      const isText = bad === 0 && payload.length > 0 && !payload.toString('utf8').includes('\ufffd');
      let sub = null;
      if (!isText && depth < 16 && payload.length >= 2) sub = parse(b, s0, s1, depth + 1);
      fields.push({ field, wt, len: Number(l.v), raw: b.subarray(fieldStart, p), payload, isText, sub });
    } else if (wt === 5) {
      if (p + 4 > end) return null;
      p += 4;
      fields.push({ field, wt, raw: b.subarray(fieldStart, p) });
    } else if (wt === 1) {
      if (p + 8 > end) return null;
      p += 8;
      fields.push({ field, wt, raw: b.subarray(fieldStart, p) });
    } else return null;
  }
  return p === end ? fields : null;
}

// ── 重新序列化：**不用 raw**，全部重算 tag / varint / 长度前缀 ─────────────
function encode(fields) {
  const parts = [];
  for (const f of fields) {
    parts.push(writeVarint(BigInt(f.field) * 8n + BigInt(f.wt)));
    if (f.wt === 0) parts.push(writeVarint(f.num));
    else if (f.wt === 5 || f.wt === 1) parts.push(f.raw.subarray(f.raw.length - (f.wt === 5 ? 4 : 8)));
    else {
      const body = f.sub !== null ? encode(f.sub) : f.payload;
      parts.push(writeVarint(BigInt(body.length)));
      parts.push(body);
    }
  }
  return Buffer.concat(parts);
}

const body0 = buf.subarray(HEAD);
console.log('文件：' + path.basename(file) + '（' + buf.length + ' 字节，体 ' + body0.length + '）');

// 外层头 5 个大端 u32 给了几个候选长度 —— 逐个试，看哪个能整体解析。
// 实测：第 1 个 = 文件大小 − 4，第 5 个 = 文件大小 − 24。
const hdr = [];
for (let i = 0; i < 5; i++) hdr.push(buf.readUInt32BE(i * 4));
console.log('外层头：' + hdr.join(', ') + '   （文件大小 ' + buf.length + '）');
const cands = [...new Set([hdr[4] + HEAD, hdr[0], hdr[0] + 4, buf.length, buf.length - 4])]
  .filter((e) => e > HEAD && e <= buf.length)
  .sort((a, b) => b - a);

let tree = null, usedEnd = null;
for (const end of cands) {
  const t0 = Date.now();
  const r = parse(buf, HEAD, end, 0);
  console.log('  试 [20, ' + end + ')：' + (r ? '✅ 解析出 ' + r.length + ' 个字段' : '❌ 失败')
    + '（' + (Date.now() - t0) + ' ms）');
  if (r) { tree = r; usedEnd = end; break; }
}
if (tree === null) {
  console.log('\n❌ 所有候选区间都无法整体解析 —— 顶层不是单个消息，需要先确定外层结构。');
  process.exit(2);
}
const body = buf.subarray(HEAD, usedEnd);
console.log('✅ 采用区间 [20, ' + usedEnd + ')：顶层 ' + tree.length + ' 个字段');
if (usedEnd < buf.length) {
  console.log('   尾部剩余 ' + (buf.length - usedEnd) + ' 字节：'
    + buf.subarray(usedEnd).toString('hex'));
}

const re = encode(tree);
console.log('重新编码：' + re.length + ' 字节（原体 ' + body.length + ' 字节）');

let diff = -1;
const n = Math.min(re.length, body.length);
for (let i = 0; i < n; i++) if (re[i] !== body[i]) { diff = i; break; }
if (diff === -1 && re.length === body.length) {
  console.log('\n★★★ 往返成功：重新编码与原始体**逐字节完全一致**');
  console.log('    → 模型是完整的：可以安全地改字段 / 加记录 / 重算长度。');
} else {
  if (diff === -1) diff = n;
  console.log('\n❌ 往返不一致，第一个不同在体偏移 ' + diff + '（文件偏移 ' + (HEAD + diff) + '）');
  console.log('   原始: ' + body.subarray(Math.max(0, diff - 8), diff + 16).toString('hex'));
  console.log('   重编: ' + re.subarray(Math.max(0, diff - 8), diff + 16).toString('hex'));
  console.log('   → 说明还有没解析出来的东西，**不能**直接改写存档。');
}
