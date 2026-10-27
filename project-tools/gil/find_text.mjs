#!/usr/bin/env node
/**
 * find_text.mjs —— 只读：在 `.gil` 里按**文字内容**反查它挂在哪个控件上。
 * 用法：node tools/gil/find_text.mjs <存档.gil> <子串> [子串2 ...]
 */
import { readGil, KNOWN_TYPES } from './gilread.mjs';

const [file, ...needles] = process.argv.slice(2);
if (!file || !needles.length) {
  console.error('用法: node tools/gil/find_text.mjs <存档.gil> <子串> [...]');
  process.exit(2);
}
const G = readGil(file);

// ① 记录顶层 field 的整棵子树 → 记录身份（叶子级归属）
const owner = new Map();
for (const r of G.recs) {
  (function mark(fields) {
    for (const f of fields) {
      owner.set(f, r);
      if (f.sub) mark(f.sub);
    }
  })(r.field.sub);
}

const hits = [];
(function walk(fields, path) {
  for (const f of fields) {
    const p = path ? path + '/' + f.field : String(f.field);
    if (f.wt === 2 && f.isText) {
      const s = f.payload.toString('utf8');
      if (!KNOWN_TYPES.has(s) && needles.some((n) => s.includes(n))) {
        hits.push({ rec: owner.get(f) || null, path: p, s });
      }
    }
    if (f.sub) walk(f.sub, p);
  }
})(G.tree.sub || G.tree, '');

console.log(`命中 ${hits.length} 处：`);
for (const h of hits.slice(0, 80)) {
  console.log(`  ${JSON.stringify(h.s)}  @${h.path}   owner=${h.rec ? '#' + h.rec.id + ' ' + (h.rec.name || '') : '(非控件记录)'}`);
}
