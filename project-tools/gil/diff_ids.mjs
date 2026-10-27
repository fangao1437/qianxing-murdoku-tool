// tools/gil/diff_ids.mjs —— 比对两份 .gil 里出现过的数值 id，找出"新增了什么"
//
// 用途（2026-10-02）：用户走完「导入外部资产 → 转存所选资产」之后，要确认
// **素材是否真的进了存档**、以及**它们的 id 是多少**（拿到 id 才能写进控件）。
//
// 用法：node tools/gil/diff_ids.mjs --a=<文件A> --b=<文件B>

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k) => { const h = process.argv.find((s) => s.startsWith('--' + k + '=')); return h ? h.slice(k.length + 3) : null; };
const P = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

const A = P(arg('a')), B = P(arg('b'));
if (!A || !B) { console.error('用法: node tools/gil/diff_ids.mjs --a=<文件A> --b=<文件B>'); process.exit(1); }

/** 把一棵字段树里所有"看起来像 id"的整数收集起来 */
function idsOf(g) {
  const out = new Map();          // id -> 出现次数
  const seen = new Set();
  function walk(fields, depth) {
    if (!fields || depth > 30) return;
    for (const f of fields) {
      if (typeof f.num === 'bigint' && f.num > 1000n && f.num < 2000000000n) {
        const n = Number(f.num);
        out.set(n, (out.get(n) || 0) + 1);
      }
      if (f.sub) walk(f.sub, depth + 1);
    }
  }
  for (const r of g.recs) walk(r.field.sub, 0);
  void seen;
  return out;
}

const a = readGil(A), b = readGil(B);
const ia = idsOf(a), ib = idsOf(b);
console.log('  A = ' + path.basename(A) + '  记录 ' + a.recs.length + '，不同数值 ' + ia.size + ' 个');
console.log('  B = ' + path.basename(B) + '  记录 ' + b.recs.length + '，不同数值 ' + ib.size + ' 个');

const onlyA = [...ia.keys()].filter((k) => !ib.has(k)).sort((x, y) => x - y);
const onlyB = [...ib.keys()].filter((k) => !ia.has(k)).sort((x, y) => x - y);
console.log('');
console.log('  ★ 只在 A 里出现的（= A 新增的）：' + onlyA.length + ' 个');
if (onlyA.length) console.log('    ' + onlyA.slice(0, 60).join(' '));
console.log('  ★ 只在 B 里出现的：' + onlyB.length + ' 个');
if (onlyB.length) console.log('    ' + onlyB.slice(0, 40).join(' '));

// id 分布（按前 3~4 位归类，一眼看出是哪类）
const bucket = (n) => {
  if (n >= 1073741800) return '控件记录 id(1073741xxx)';
  if (n >= 1000000) return '百万级';
  if (n >= 100000) return '十万级(素材?)';
  if (n >= 10000) return '万级';
  return '千级及以下';
};
const group = (arr) => {
  const m = new Map();
  for (const n of arr) { const k = bucket(n); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].map(([k, v]) => k + '×' + v).join('  ');
};
console.log('');
console.log('  A 新增项的分类：' + group(onlyA));
