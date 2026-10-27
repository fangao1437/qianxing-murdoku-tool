// tools/gil/index_list.mjs —— 找出存档里那些"**纯 ID 列表**"字段
//
// 背景（2026-09-27）：生成器把 3 条新控件记录插进文件后，**文件能重新解析、记录数 +3**，
// 但导入游戏后编辑器里**一个都没多出来** —— 说明"有记录"不等于"被登记"。
// 早先 dump 里出现过一个 `#501 bytes[95]`，内容恰好是一串 varint：
//     ac80808004 c980808004 ca80808004 … = 1073741868, 1073741897, 1073741898 …
// 那**正是控件 ID 列表**。本脚本把所有这类列表找出来，报告位置/长度/包含哪些 ID，
// 以及**目标控件的 ID 在不在里面** —— 用来确认"必须同步更新索引"这个判断。
//
// 用法：node tools/gil/index_list.mjs [文件]

import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2] || path.join(process.cwd(), '存档.gil');
const buf = fs.readFileSync(file);
const HEAD = 20;
const hdr = []; for (let i = 0; i < 5; i++) hdr.push(buf.readUInt32BE(i * 4));
const END = HEAD + hdr[4];
console.log('文件：' + path.basename(file) + '（' + buf.length + ' 字节）');

const ID_LO = 1073000000, ID_HI = 1074200000;

function readVarint(b, p, lim) {
  let r = 0n, s = 0n, n = 0; const e = lim === undefined ? b.length : lim;
  while (p < e) { const x = b[p++]; n++; r |= BigInt(x & 0x7f) << s; if ((x & 0x80) === 0) return { v: r, p }; s += 7n; if (n > 10) return null; }
  return null;
}
function parse(b, from, to, d) {
  const out = []; let p = from;
  while (p < to) {
    const s0 = p; const t = readVarint(b, p, to); if (!t || t.v === 0n) return null;
    const field = Number(t.v >> 3n), wt = Number(t.v & 7n); if (!field) return null; p = t.p;
    if (wt === 0) { const v = readVarint(b, p, to); if (!v) return null; p = v.p; out.push({ field, wt, num: v.v, s0, s1: p, path: [] }); }
    else if (wt === 2) {
      const l = readVarint(b, p, to); if (!l) return null; const bs = l.p, be = bs + Number(l.v); if (be > to) return null; p = be;
      const pay = b.subarray(bs, be); let bad = 0;
      for (let i = 0; i < pay.length; i++) { const c = pay[i]; if (c < 9 || (c > 13 && c < 32)) bad++; }
      const isText = bad === 0 && pay.length > 0 && !pay.toString('utf8').includes('\ufffd');
      let sub = null; if (!isText && d < 18 && pay.length >= 2) sub = parse(b, bs, be, d + 1);
      out.push({ field, wt, len: Number(l.v), payload: pay, isText, sub, s0, s1: p, bs, be });
    } else if (wt === 5) { if (p + 4 > to) return null; out.push({ field, wt, f: b.readFloatLE(p), s0, s1: p + 4 }); p += 4; }
    else if (wt === 1) { if (p + 8 > to) return null; out.push({ field, wt, s0, s1: p + 8 }); p += 8; }
    else return null;
  }
  return p === to ? out : null;
}

const tree = parse(buf, HEAD, END, 0);
if (!tree) { console.error('体解析失败'); process.exit(2); }

// 尝试把一个 payload 解码成"纯 varint 列表"
function asIdList(pay) {
  const ids = []; let p = 0;
  while (p < pay.length) {
    const v = readVarint(pay, p, pay.length);
    if (!v) return null;
    const n = Number(v.v);
    if (n < ID_LO || n > ID_HI) return null;
    ids.push(n); p = v.p;
  }
  return ids.length >= 2 ? ids : null;
}

const lists = [];
(function scan(fields, pathStr) {
  for (const f of fields) {
    const here = pathStr + '/#' + f.field;
    if (f.wt === 2 && f.sub === null && !f.isText && f.payload && f.payload.length >= 4) {
      const ids = asIdList(f.payload);
      if (ids) lists.push({ at: f.s0, field: f.field, path: here, ids, size: f.len });
    }
    if (f.sub) scan(f.sub, here);
  }
})(tree, '');

console.log('\n找到 ' + lists.length + ' 个"纯 ID 列表"字段（≥2 个 ID，全在 ' + ID_LO + '~' + ID_HI + '）\n');
const targets = process.argv.slice(3).map(Number);
console.log('序   偏移     字段   个数   前 8 个 ID' + (targets.length ? '                       目标命中' : ''));
for (let i = 0; i < lists.length; i++) {
  const L = lists[i];
  let hit = '';
  if (targets.length) hit = '  ' + targets.map((t) => t + (L.ids.includes(t) ? '✅' : '❌')).join(' ');
  console.log(String(i + 1).padStart(2) + '  ' + String(L.at).padStart(7) + '  #' + String(L.field).padStart(4)
    + '  ' + String(L.ids.length).padStart(5) + '  ' + L.ids.slice(0, 8).join(', ') + hit);
}
if (lists.length === 0) {
  console.log('  （没有这种"纯 ID 列表" —— 那"新增控件不被识别"就是别的原因）');
  console.log('   提示：也可能是列表里混了别的数字（非 ID），需要放宽判据再看。');
}
