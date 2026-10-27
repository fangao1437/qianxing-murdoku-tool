// tools/gil/dumpone.mjs —— 把**一条控件记录**按字节偏移完整摊开
//
// 生成器要改四样东西：控件 ID、实例名、几何（位置/尺寸 × 四状态）、父级的子控件列表。
// 所以必须知道它们各自的**精确字节位置**。这个脚本就是把一条记录逐字段打印出来。
//
// 用法：node tools/gil/dumpone.mjs <起始偏移> <结束偏移> [文件]

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

const start = Number(process.argv[2]);
const end = Number(process.argv[3]);
const file = process.argv[4] || pick();
if (!start || !end) { console.error('用法：node tools/gil/dumpone.mjs <起始> <结束> [文件]'); process.exit(1); }
const buf = fs.readFileSync(file);
console.log('文件：' + path.basename(file) + '   记录 [' + start + ', ' + end + ')  ' + (end - start) + ' 字节\n');

function readVarint(b, p, lim) {
  let r = 0n, s = 0n, n = 0;
  const e = lim === undefined ? b.length : lim;
  while (p < e) {
    const x = b[p++]; n++;
    r |= BigInt(x & 0x7f) << s;
    if ((x & 0x80) === 0) return { v: r, p };
    s += 7n;
    if (n > 10) return null;
  }
  return null;
}

function parse(b, from, to, depth) {
  const out = [];
  let p = from;
  while (p < to) {
    const fs0 = p;
    const t = readVarint(b, p, to);
    if (!t || t.v === 0n) return null;
    const field = Number(t.v >> 3n), wt = Number(t.v & 7n);
    if (field === 0) return null;
    p = t.p;
    if (wt === 0) {
      const v = readVarint(b, p, to); if (!v) return null; p = v.p;
      out.push({ field, wt, num: v.v, s0: fs0, s1: p });
    } else if (wt === 2) {
      const l = readVarint(b, p, to); if (!l) return null;
      const bs = l.p, be = bs + Number(l.v);
      if (be > to) return null;
      p = be;
      const pay = b.subarray(bs, be);
      let bad = 0;
      for (let i = 0; i < pay.length; i++) { const c = pay[i]; if (c < 9 || (c > 13 && c < 32)) bad++; }
      const isText = bad === 0 && pay.length > 0 && !pay.toString('utf8').includes('\ufffd');
      let sub = null;
      if (!isText && depth < 18 && pay.length >= 2) sub = parse(b, bs, be, depth + 1);
      out.push({ field, wt, len: Number(l.v), payload: pay, isText, sub, s0: fs0, s1: p, bs, be });
    } else if (wt === 5) { if (p + 4 > to) return null; out.push({ field, wt, f: b.readFloatLE(p), s0: fs0, s1: p + 4 }); p += 4; }
    else if (wt === 1) { if (p + 8 > to) return null; out.push({ field, wt, s0: fs0, s1: p + 8 }); p += 8; }
    else return null;
  }
  return p === to ? out : null;
}

const tree = parse(buf, start, end, 0);
if (!tree) { console.error('该区间解析失败'); process.exit(2); }

function dump(fields, indent, depth) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const f of fields) {
    const at = '@' + String(f.s0).padStart(6) + '  ';
    if (f.wt === 0) lines.push(pad + at + '#' + f.field + ' = ' + f.num);
    else if (f.wt === 2 && f.isText) lines.push(pad + at + '#' + f.field + ' str[' + f.len + '] = ' + JSON.stringify(f.payload.toString('utf8')));
    else if (f.wt === 2 && f.sub) {
      lines.push(pad + at + '#' + f.field + ' msg[' + f.len + '] @' + f.bs + ' {');
      lines.push(...dump(f.sub, indent + 2, depth + 1));
      lines.push(pad + '       }');
    } else if (f.wt === 2) lines.push(pad + at + '#' + f.field + ' bytes[' + f.len + '] = ' + f.payload.subarray(0, 24).toString('hex') + (f.len > 24 ? '…' : ''));
    else if (f.wt === 5) lines.push(pad + at + '#' + f.field + ' float = ' + f.f);
    else lines.push(pad + at + '#' + f.field + ' fixed64');
    if (lines.length > 900) { lines.push(pad + '… 截断'); break; }
  }
  return lines;
}
console.log(dump(tree, 0, 0).join('\n'));

// ── 额外小结：这条记录里"可改的东西"在哪 ─────────────────────────────────
console.log('\n===== 可改项小结 =====');
const ids = new Map(), floats = [], strs = [];
(function scan(fs) {
  for (const f of fs) {
    if (f.wt === 0 && f.num > 1000000n) ids.set(String(f.num), (ids.get(String(f.num)) || 0) + 1);
    if (f.wt === 5) floats.push({ at: f.s0, v: f.f });
    if (f.wt === 2 && f.isText && f.len <= 64) strs.push({ at: f.s0, s: f.payload.toString('utf8') });
    if (f.sub) scan(f.sub);
  }
})(tree);
console.log('  大整数（控件 ID 候选）：');
for (const [v, n] of ids) console.log('    ' + v + '  ×' + n);
console.log('  固定浮点（几何候选，共 ' + floats.length + ' 个）：');
console.log('    ' + floats.map((f) => '@' + f.at + '=' + f.v.toFixed(1)).join('  '));
console.log('  短字符串：');
for (const s of strs) console.log('    @' + s.at + '  ' + JSON.stringify(s.s));
