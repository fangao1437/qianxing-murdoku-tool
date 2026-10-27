// tools/gil/tree.mjs —— 把 .gil 的 protobuf 体解析成**整棵树**，再按字符串定位记录
//
// 上一版（probe.mjs）证明了：文件没有压缩、就是 protobuf 线格式，
// 而且能看到形如
//     #12 msg { #501 str = "cell.1.1" }
//     #501 varint = 2
//     #502 varint = 15
// 的**通用属性包**记录（字段号 501/502/…）。
//
// 这一版干两件事：
//   ① 从外层头之后整体解析成一棵树（能解析到哪算哪，不假设只有一层）；
//   ② 找到包含指定字符串的**最内层"够大"的记录**并完整打印 ——
//      目标是识别出「名字 / 父级 / 位置 / 尺寸 / 模板索引」分别落在哪个字段号上。
//
// 用法：node tools/gil/tree.mjs [文件] [要找的字符串] [最少字段数]

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
const needle = process.argv[3] || 'tpl.cell';
const minFields = Number(process.argv[4] || 6);
const buf = fs.readFileSync(file);
console.log('文件：' + file + '（' + buf.length + ' 字节）');

const HEAD = 20;

function readVarint(b, p) {
  let r = 0, s = 0, n = 0;
  while (p < b.length) {
    const x = b[p++]; n++;
    r += (x & 0x7f) * Math.pow(2, s);
    if ((x & 0x80) === 0) return { v: r, p };
    s += 7;
    if (n > 10) return null;
  }
  return null;
}

// 把一个区间解析成字段列表；失败返回 null
function parseMsg(b, start, end, depth) {
  const out = [];
  let p = start;
  while (p < end) {
    const t = readVarint(b, p);
    if (!t || t.v === 0) return null;
    const field = Math.floor(t.v / 8), wt = t.v % 8;
    p = t.p;
    if (wt === 0) {
      const v = readVarint(b, p);
      if (!v) return null;
      p = v.p;
      if (v.v > Number.MAX_SAFE_INTEGER) return null;
      out.push({ field, wt, num: v.v, start: p, end: p });
    } else if (wt === 2) {
      const l = readVarint(b, p);
      if (!l) return null;
      p = l.p;
      if (p + l.v > end) return null;
      const s0 = p, s1 = p + l.v;
      p = s1;
      const slice = b.subarray(s0, s1);
      let str = null;
      let bad = 0;
      for (let i = 0; i < slice.length; i++) {
        const c = slice[i];
        if (c < 0x09 || (c > 0x0d && c < 0x20)) bad++;
      }
      if (bad === 0 && slice.length > 0) {
        str = slice.toString('utf8');
        if (str.includes('\ufffd')) str = null;
      }
      let sub = null;
      if (str === null && depth < 14 && slice.length >= 2) sub = parseMsg(b, s0, s1, depth + 1);
      out.push({ field, wt, len: l.v, str, sub, start: s0, end: s1, raw: slice });
    } else if (wt === 5) {
      if (p + 4 > end) return null;
      out.push({ field, wt, num: b.readFloatLE(p), start: p, end: p + 4 });
      p += 4;
    } else if (wt === 1) {
      if (p + 8 > end) return null;
      out.push({ field, wt, num: Number(b.readBigInt64LE(p)), dbl: b.readDoubleLE(p), start: p, end: p + 8 });
      p += 8;
    } else {
      return null;
    }
    if (out.length > 500000) return null;
  }
  return p === end ? out : null;
}

const body = buf.subarray(HEAD);
const root = parseMsg(buf, HEAD, buf.length, 0);
console.log('整体解析：' + (root ? '成功，顶层 ' + root.length + ' 个字段' : '**失败**（顶层可能不是单个消息）'));

// ── 在树里找 needle，收集所有"包含它"的节点（连同字段数）──────────────────
const found = [];
function walk(fields, pathStr, depth) {
  for (const f of fields) {
    if (f.wt !== 2) continue;
    const here = pathStr + '/' + f.field;
    if (f.str !== null && f.str.includes(needle)) {
      found.push({ path: here, len: f.len, str: f.str, node: null, fields: 0 });
    }
    if (f.sub !== null) {
      const before = found.length;
      walk(f.sub, here, depth + 1);
      // 记录"这个节点下面有没有命中"
      if (found.length > before) {
        for (let i = before; i < found.length; i++) found[i].ancestors = (found[i].ancestors || []).concat([{ path: here, fields: f.sub.length, node: f.sub }]);
      }
    }
  }
}
if (root) walk(root, '', 0);

console.log('找到 ' + found.length + ' 处包含 "' + needle + '" 的字符串');
if (found.length === 0) process.exit(0);

// 取第 1 处，打印它的祖先链（从最外层到最内层），挑字段数 ≥ minFields 的最大者
const first = found[0];
const chain = (first.ancestors || []).slice().reverse();   // 外层 → 内层
console.log('\n祖先链（外 → 内）：');
for (const a of chain) console.log('  ' + a.path + '  字段数=' + a.fields);

const big = chain.filter((a) => a.fields >= minFields);
const target = big.length ? big[big.length - 1] : (chain[chain.length - 1] || null);
if (target === null) { console.log('没有可打印的祖先节点'); process.exit(0); }

console.log('\n===== 打印 ' + target.path + '（字段数 ' + target.fields + '）=====');
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
    } else if (f.wt === 2) lines.push(pad + '#' + f.field + ' bytes[' + f.len + '] = ' + f.raw.subarray(0, 20).toString('hex'));
    else lines.push(pad + '#' + f.field + ' = ' + f.num + (f.dbl !== undefined ? ' (double ' + f.dbl + ')' : ''));
    if (lines.length > 600) { lines.push(pad + '… 截断'); break; }
  }
  return lines;
}
console.log(dump(target.node, 0, 200).join('\n'));

// ── 顺便统计：这个节点里出现过的所有字符串（看能认出哪些"属性名"）────────
const strs = new Map();
function collect(fields) {
  for (const f of fields) {
    if (f.wt === 2 && f.str !== null && f.str.length < 60) strs.set(f.str, (strs.get(f.str) || 0) + 1);
    if (f.sub !== null) collect(f.sub);
  }
}
collect(target.node);
console.log('\n该节点里出现过的字符串（前 60 个）：');
[...strs.entries()].slice(0, 60).forEach(([s, n]) => console.log('  ×' + n + '  ' + JSON.stringify(s)));
