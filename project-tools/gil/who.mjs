// tools/gil/who.mjs —— 打印活动画布的**控件父子关系**，用来回答"放谁下面"
//
// 用 records.mjs 同样的判据找控件记录，然后对每条打印：
//   控件ID / 父ID / 名字槽字符串 / 记录内其它字符串 / 四状态的(位置,尺寸)
// 这样一眼能看出 `root` 是谁、`board` 挂在谁下面、`tpl.cell` 在哪。

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

function rv(b, p, lim) { let r = 0n, s = 0n, n = 0; const e = lim || b.length; while (p < e) { const x = b[p++]; n++; r |= BigInt(x & 0x7f) << s; if (!(x & 0x80)) return { v: r, p }; s += 7n; if (n > 10) return null; } return null; }
function parse(b, from, to, d) {
  const out = []; let p = from;
  while (p < to) {
    const s0 = p; const t = rv(b, p, to); if (!t || t.v === 0n) return null;
    const field = Number(t.v >> 3n), wt = Number(t.v & 7n); if (!field) return null; p = t.p;
    if (wt === 0) { const v = rv(b, p, to); if (!v) return null; p = v.p; out.push({ field, wt, num: v.v, s0, s1: p }); }
    else if (wt === 2) {
      const l = rv(b, p, to); if (!l) return null; const bs = l.p, be = bs + Number(l.v); if (be > to) return null; p = be;
      const pay = b.subarray(bs, be); let bad = 0;
      for (let i = 0; i < pay.length; i++) { const c = pay[i]; if (c < 9 || (c > 13 && c < 32)) bad++; }
      const isText = bad === 0 && pay.length > 0 && !pay.toString('utf8').includes('\ufffd');
      let sub = null; if (!isText && d < 18 && pay.length >= 2) sub = parse(b, bs, be, d + 1);
      out.push({ field, wt, len: Number(l.v), payload: pay, isText, sub, s0, s1: p });
    } else if (wt === 5) { if (p + 4 > to) return null; out.push({ field, wt, f: b.readFloatLE(p), s0, s1: p + 4 }); p += 4; }
    else if (wt === 1) { if (p + 8 > to) return null; out.push({ field, wt, s0, s1: p + 8 }); p += 8; }
    else return null;
  }
  return p === to ? out : null;
}
const tree = parse(buf, HEAD, END, 0);
if (!tree) { console.error('体解析失败'); process.exit(2); }

const gp = (fs2, o) => { for (const f of fs2) { if (f.sub && f.sub.length === 2 && f.sub[0].wt === 5 && f.sub[1].wt === 5) o.push({ node: f, a: f.sub[0].f, b2: f.sub[1].f }); if (f.sub) gp(f.sub, o); } return o; };
const bi = (fs2, o) => { for (const f of fs2) { if (f.wt === 0 && f.field === 501 && f.num > 1000000n && f.num < 4294967296n) o.push(f); if (f.sub) bi(f.sub, o); } return o; };
const tx = (fs2, o) => { for (const f of fs2) { if (f.wt === 2 && f.isText && f.len <= 64) o.push(f.payload.toString('utf8')); if (f.sub) tx(f.sub, o); } return o; };

const recs = [];
(function walk(fields) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]; if (!f.sub) continue;
    if (gp(f.sub, []).length >= 2 && bi(f.sub, []).length >= 1) {
      let deeper = 0;
      for (const c of f.sub) if (c.sub && gp(c.sub, []).length >= 2 && bi(c.sub, []).length >= 1) deeper++;
      if (deeper === 0) {
        const id = Number(bi(f.sub, [])[0].num);
        let parent = null;
        (function s2(fs2) { for (const g of fs2) { if (g.wt === 0 && g.field === 504 && parent === null) parent = Number(g.num); if (g.sub) s2(g.sub); } })(f.sub);
        const g = gp(f.sub, []);
        const pos = g.filter((x) => x.node.field === 504).map((x) => [x.a, x.b2]);
        const size = g.filter((x) => x.node.field === 505).map((x) => [x.a, x.b2]);
        recs.push({ s0: f.s0, s1: f.s1, id, parent, strs: tx(f.sub, []), pos, size });
        continue;
      }
    }
    walk(f.sub);
  }
})(tree);

recs.sort((a, b) => a.s0 - b.s0);
const byId = new Map(recs.map((r) => [r.id, r]));
const nameOf = (r) => {
  if (!r) return '(未知)';
  const t = r.strs;
  return t.join(' / ') || '(无名)';
};
console.log('文件：' + path.basename(file) + '   控件记录 ' + recs.length + ' 条\n');
console.log('序  字节范围              控件ID        父ID          名字                        位置(首状态)      尺寸(首状态)   父名字');
for (let i = 0; i < recs.length; i++) {
  const r = recs[i];
  const p = byId.get(r.parent);
  console.log(String(i + 1).padStart(2) + '  '
    + (r.s0 + '..' + r.s1).padEnd(18)
    + String(r.id).padStart(12) + '  '
    + String(r.parent === null ? '—' : r.parent).padStart(12) + '  '
    + nameOf(r).padEnd(28)
    + (r.pos[0] ? ('(' + r.pos[0][0].toFixed(0) + ',' + r.pos[0][1].toFixed(0) + ')').padEnd(18) : '—'.padEnd(18))
    + (r.size[0] ? (r.size[0][0].toFixed(0) + '×' + r.size[0][1].toFixed(0)).padEnd(14) : '—'.padEnd(14))
    + (p ? nameOf(p) : '—'));
}
console.log('\n有名字的记录里，`root` 出现在：');
for (const r of recs) if (r.strs.includes('root')) console.log('  #' + r.id + ' @' + r.s0 + '  父=' + r.parent + ' 字符串=' + r.strs.join(' / '));
console.log('`board` 出现在：');
for (const r of recs) if (r.strs.includes('board')) console.log('  #' + r.id + ' @' + r.s0 + '  父=' + r.parent + ' 字符串=' + r.strs.join(' / '));
