// tools/gil/probe.mjs —— 千星关卡存档（.gil）格式可行性探测
//
// 背景（2026-09-27）：用户在千星里发现了「导入存档」功能，问能不能**直接生成存档文件**
// 来省掉手搭 101 个控件的活。本地磁盘上就有真存档：
//   %LOCALAPPDATA%Low\miHoYo\原神\BeyondLocal\<uid>\Beyond_Local_Save_Level\<关卡id>\<关卡id>.gil
// 实测：**没有压缩**，文件里能直接看到 UTF-8 中文与控件名（cell/board/root/prefab…），
// 且 `08 82 80 80 80 04` 是标准 protobuf varint（解出 = 关卡 ID）。
//
// 这个脚本干一件事：**不用 schema** 把 protobuf 线格式解析成树，
// 找出 "cell.1.1" 所在的记录，看能不能识别出「名字 / 父级 / 位置 / 尺寸」这些字段。
// 能识别 → "克隆一条记录 + 改字段"的路可行（比从零构造安全得多）。
//
// 用法：node tools/gil/probe.mjs [文件路径] [要找的字符串]

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA + 'Low', 'miHoYo', '原神', 'BeyondLocal', '153793556', 'Beyond_Local_Save_Level')
  : '.';
const file = process.argv[2] || findDefaultGil();
const needle = process.argv[3] || 'cell.1.1';

function findDefaultGil() {
  if (!fs.existsSync(DEFAULT_DIR)) return null;
  for (const d of fs.readdirSync(DEFAULT_DIR)) {
    const p = path.join(DEFAULT_DIR, d);
    if (fs.statSync(p).isDirectory()) {
      const g = fs.readdirSync(p).find((f) => f.endsWith('.gil'));
      if (g) return path.join(p, g);
    }
  }
  const g = fs.readdirSync(DEFAULT_DIR).find((f) => f.endsWith('.gil'));
  return g ? path.join(DEFAULT_DIR, g) : null;
}

if (!file || !fs.existsSync(file)) {
  console.error('找不到 .gil 文件，请把路径作为第一个参数传进来');
  process.exit(1);
}

const buf = fs.readFileSync(file);
console.log('文件：' + file);
console.log('大小：' + buf.length + ' 字节');

// ── 外层头 ────────────────────────────────────────────────────────────────
// 实测结构： [u32 总长][u32 1][u32 806][u32 2][u32 体长][protobuf 体]
const HEAD = 20;
const hdr = [];
for (let i = 0; i < 5; i++) hdr.push(buf.readUInt32BE(i * 4));
console.log('外层头（大端 u32 ×5）：' + hdr.join(', '));
console.log('  → 第 1 个 = ' + hdr[0] + '（文件大小 ' + buf.length + '，差 ' + (buf.length - hdr[0]) + '）');
console.log('  → 第 5 个 = ' + hdr[4] + '（= 第1个 - 20？ ' + (hdr[0] - 20) + '）');

// ── 通用 protobuf 线格式解析（无 schema）──────────────────────────────────
const WT = { 0: 'varint', 1: 'fixed64', 2: 'len', 5: 'fixed32' };

function readVarint(b, p) {
  let r = 0, s = 0, n = 0;
  while (p < b.length) {
    const x = b[p++]; n++;
    r += (x & 0x7f) * Math.pow(2, s);
    if ((x & 0x80) === 0) return { v: r, p, n };
    s += 7;
    if (n > 10) return null;
  }
  return null;
}

// 尝试把一个字节串解析成 protobuf 消息；返回 null 表示"不像消息"
function tryMessage(b, start, end, depth) {
  const out = [];
  let p = start;
  let ok = 0, bad = 0;
  while (p < end) {
    const t = readVarint(b, p);
    if (!t || t.v === 0) return null;
    const field = Math.floor(t.v / 8), wt = t.v % 8;
    p = t.p;
    if (wt === 0) {
      const v = readVarint(b, p);
      if (!v) return null;
      p = v.p;
      out.push({ field, wt, value: v.v });
      ok++;
    } else if (wt === 2) {
      const l = readVarint(b, p);
      if (!l) return null;
      p = l.p;
      if (p + l.v > end) return null;
      const slice = b.subarray(p, p + l.v);
      p += l.v;
      // 先当字符串试试（UTF-8 且可打印比例高）
      let asStr = null;
      try {
        const s = slice.toString('utf8');
        if (!s.includes('\ufffd') && /^[\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\r\n\t]*$/.test(s) && s.length > 0) {
          asStr = s;
        }
      } catch { /* 忽略 */ }
      let asMsg = null;
      if (asStr === null && depth < 12 && slice.length >= 2) {
        asMsg = tryMessage(slice, 0, slice.length, depth + 1);
      }
      out.push({ field, wt, len: l.v, str: asStr, msg: asMsg, raw: slice });
      ok++;
    } else if (wt === 5) {
      p += 4; if (p > end) return null;
      out.push({ field, wt, value: '(fixed32)' }); ok++;
    } else if (wt === 1) {
      p += 8; if (p > end) return null;
      out.push({ field, wt, value: '(fixed64)' }); ok++;
    } else {
      return null;      // 未知 wire type → 不像消息
    }
    if (out.length > 200000) return null;
  }
  return ok > 0 && p === end ? out : (out.length ? out : null);
}

// ── 找 needle 的位置 ──────────────────────────────────────────────────────
const needleBuf = Buffer.from(needle, 'utf8');
const hits = [];
let from = 0;
while (true) {
  const i = buf.indexOf(needleBuf, from);
  if (i < 0) break;
  hits.push(i);
  from = i + 1;
  if (hits.length > 40) break;
}
console.log('\n"' + needle + '" 出现 ' + hits.length + ' 次，偏移：' + hits.slice(0, 12).join(', ')
  + (hits.length > 12 ? ' …' : ''));

if (hits.length === 0) process.exit(0);

// ── 在 needle 周围向上找"最外层的、能完整解析的消息" ──────────────────────
// 做法：从 needle 往前扫，找每个 0x12/0x0a 之类的长度前缀起点，试解析；
//       取"起点最早且长度能覆盖 needle"的那个。
const target = hits[0];
console.log('\n以第 1 个偏移 ' + target + ' 为目标，向前找可解析的记录边界…');

let best = null;
for (let back = 2; back <= 64 && target - back >= HEAD; back++) {
  const start = target - back;
  const t = readVarint(buf, start);
  if (!t || t.v % 8 !== 2) continue;
  const l = readVarint(buf, t.p);
  if (!l) continue;
  const msgStart = l.p, msgEnd = msgStart + l.v;
  if (msgEnd <= target) continue;
  if (msgEnd > buf.length) continue;
  const m = tryMessage(buf, msgStart, msgEnd, 0);
  if (m && m.length > 0) {
    const size = msgEnd - start;
    if (best === null || size > best.size) {
      best = { start, size, field: Math.floor(t.v / 8), msg: m, msgStart, msgEnd };
    }
  }
}

if (best === null) {
  console.log('  没找到能解析的记录边界 —— 可能需要先确定外层是否还有一层包装。');
  process.exit(0);
}

console.log('  找到记录：外层字段号 ' + best.field + '，从偏移 ' + best.start + ' 起，共 ' + best.size + ' 字节');

function render(msg, indent, maxItems) {
  const lines = [];
  for (const f of msg.slice(0, maxItems)) {
    const pad = ' '.repeat(indent);
    if (f.wt === 0) lines.push(pad + '#' + f.field + ' varint = ' + f.value);
    else if (f.wt === 2 && f.str !== null) lines.push(pad + '#' + f.field + ' str[' + f.len + '] = ' + JSON.stringify(f.str));
    else if (f.wt === 2 && f.msg !== null) {
      lines.push(pad + '#' + f.field + ' msg[' + f.len + '] {');
      lines.push(...render(f.msg, indent + 2, maxItems));
      lines.push(pad + '}');
    } else if (f.wt === 2) {
      lines.push(pad + '#' + f.field + ' bytes[' + f.len + '] = ' + f.raw.subarray(0, 24).toString('hex'));
    } else {
      lines.push(pad + '#' + f.field + ' ' + WT[f.wt] + ' ' + f.value);
    }
    if (lines.length > 400) { lines.push(pad + '…（截断）'); break; }
  }
  return lines;
}

console.log('\n记录内容（缩进 = 嵌套层级）：');
console.log(render(best.msg, 2, 40).join('\n'));
