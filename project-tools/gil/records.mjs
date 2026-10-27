// tools/gil/records.mjs —— 找出 .gil 里**每条控件记录的字节范围**及其关键字段
//
// 这是"生成存档"的必要中间产物：只有知道「一条控件记录从哪到哪、里面哪个是名字/ID/位置/尺寸」，
// 才能克隆它并改字段。
//
// 做法：体已经能整棵解析（roundtrip.mjs 证明了字节级可还原）。
//   在树里找**最小的、包含"类型名"字符串的子树** —— 那些就是控件记录。
//   对每条记录打印：字节范围、长度、控件 ID、类型名、记录内出现的实例名、四套状态的位置与尺寸。
//
// 用法：node tools/gil/records.mjs [文件]

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
      out.push({ field, wt, num: v.v, s0: fs0, s1: p });
    } else if (wt === 2) {
      const l = readVarint(b, p, end); if (!l) return null;
      const bs = l.p, be = bs + Number(l.v);
      if (be > end) return null;
      p = be;
      const pay = b.subarray(bs, be);
      let bad = 0;
      for (let i = 0; i < pay.length; i++) { const c = pay[i]; if (c < 9 || (c > 13 && c < 32)) bad++; }
      const isText = bad === 0 && pay.length > 0 && !pay.toString('utf8').includes('\ufffd');
      let sub = null;
      if (!isText && depth < 18 && pay.length >= 2) sub = parse(b, bs, be, depth + 1);
      out.push({ field, wt, len: Number(l.v), payload: pay, isText, sub, s0: fs0, s1: p, bs, be });
    } else if (wt === 5) { if (p + 4 > end) return null; out.push({ field, wt, f: b.readFloatLE(p), s0: fs0, s1: p + 4 }); p += 4; }
    else if (wt === 1) { if (p + 8 > end) return null; out.push({ field, wt, s0: fs0, s1: p + 8 }); p += 8; }
    else return null;
  }
  return p === end ? out : null;
}

const tree = parse(buf, HEAD, END, 0);
if (!tree) { console.error('体解析失败'); process.exit(2); }

const TYPE_NAMES = new Set(['客户端控件容器', '容器节点', '交互按钮', '文本框', '图片', '文本视窗',
  '光标检测区域', '网格视窗', '按键提示', '模板引用控件', '界面动效', '全屏动效']);

function collectStrings(fields, out) {
  for (const f of fields) {
    if (f.wt === 2 && f.isText && f.len <= 64) out.push(f.s0 <= undefined ? '' : f.payload.toString('utf8'));
    if (f.sub) collectStrings(f.sub, out);
  }
}

// ── 找**控件记录**：判据不是"含类型名"（那只找到 11~26 字节的属性值记录），
//    而是「含 ≥2 组几何对 {#501 float, #502 float}」+「含 >1000000 的 #501 varint（控件ID）」。
//    为什么：控件记录是**引用**类型名属性值的，字符串不在它里面。
function geomPairs(fields, out, depth) {
  for (const f of fields) {
    if (f.sub && f.sub.length === 2 && f.sub[0].wt === 5 && f.sub[1].wt === 5) out.push([f.sub[0].f, f.sub[1].f]);
    if (f.sub) geomPairs(f.sub, out, depth + 1);
  }
  return out;
}
function bigIds(fields, out) {
  for (const f of fields) {
    if (f.wt === 0 && f.field === 501 && f.num > 1000000n && f.num < 4294967296n) out.push(Number(f.num));
    if (f.sub) bigIds(f.sub, out);
  }
  return out;
}
function anyStrings(fields, out) {
  for (const f of fields) {
    if (f.wt === 2 && f.isText && f.len <= 64) out.push(f.payload.toString('utf8'));
    if (f.sub) anyStrings(f.sub, out);
  }
  return out;
}

const records = [];
function walk(fields) {
  for (const f of fields) {
    if (!f.sub) continue;
    const g = geomPairs(f.sub, []);
    const ids = bigIds(f.sub, []);
    if (g.length >= 2 && ids.length >= 1) {
      // 只记"最小"的：如果子节点里还有满足同样条件的，就往下走
      let deeper = 0;
      for (const c of f.sub) {
        if (!c.sub) continue;
        if (geomPairs(c.sub, []).length >= 2 && bigIds(c.sub, []).length >= 1) deeper++;
      }
      if (deeper === 0) {
        const strs = anyStrings(f.sub, []);
        records.push({
          s0: f.s0, s1: f.s1, size: f.s1 - f.s0, field: f.field,
          ids: ids.slice(0, 4),
          geom: g,
          strs: [...new Set(strs)].slice(0, 8),
        });
      }
    }
    walk(f.sub);
  }
}
walk(tree);

records.sort((a, b) => a.s0 - b.s0);
console.log('文件：' + path.basename(file) + '   找到 ' + records.length + ' 条候选控件记录\n');
console.log('序  字节范围                长度   外层字段  控件ID               几何对(前4)                              记录内字符串');
for (let i = 0; i < records.length; i++) {
  const r = records[i];
  const g = r.geom.slice(0, 4).map(([a, b]) => '(' + a.toFixed(0) + ',' + b.toFixed(0) + ')').join(' ');
  console.log(String(i + 1).padStart(2) + '  ' + String(r.s0).padStart(7) + '..' + String(r.s1).padStart(7)
    + '  ' + String(r.size).padStart(6) + '  #' + String(r.field).padStart(3)
    + '  ' + String(r.ids[0]).padStart(11)
    + '  ' + g.padEnd(40)
    + '  ' + (r.strs.join(' ') || '-'));
}
