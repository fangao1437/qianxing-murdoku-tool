// 探针：定位"改了内存却写不进文件"的真因
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IN = path.resolve(ROOT, process.argv[2] || '249-占位项改前两项-v111.gil');
const g = readGil(IN);
console.log('记录数 =', g.recs.length, ' tree 顶层字段数 =', g.tree.length);

const tpl = g.recs.find((r) => r.name === 'clue');
console.log('tpl =', tpl.name, '#' + tpl.id);

const o = []; stateBlocks(tpl.field.sub, o);
console.log('stateBlocks =', o.length);
const before = pairOf(o[0], 504);
console.log('before.sub =', before.sub.map((x) => `#${x.field}/wt${x.wt}`).join(' '));
console.log('值 =', pairValue(before, 0), pairValue(before, 1));

// ① 从 tree 找 `before` 的路径，逐层打印：字段号 / sub 是否 null / 是否 503
const pathArr = [];
let found = false;
(function walk(fs, arr) {
  for (const f of fs) {
    if (f === before) { pathArr.push(...arr, f); found = true; return; }
    if (f.sub) { arr.push(f); walk(f.sub, arr); arr.pop(); if (found) return; }
  }
})(g.tree, []);
console.log('\n② 从 tree 到 before 的路径（' + pathArr.length + ' 层）found=' + found);
pathArr.forEach((f, i) => {
  const tag = f.field === 503 ? '  ★★ #503 ⇒ encodeMsg 强制用 payload！' : '';
  console.log(`   [${i}] #${f.field} wt${f.wt} sub=${f.sub ? f.sub.length + '子' : 'null'} payload=${f.payload ? f.payload.length + 'B' : '-'}${tag}`);
});

// ③ 改值前/后分别编码整棵树，比对
const enc0 = encodeMsg(g.tree);
for (const f of before.sub) { if (f.field === 501 || f.field === 502) f.f = 0; }
console.log('\n③ 改值后 pairValue =', pairValue(before, 0), pairValue(before, 1));
const enc1 = encodeMsg(g.tree);
console.log('   enc0 =', enc0.length, 'B  enc1 =', enc1.length, 'B  equal =', enc0.equals(enc1));
console.log('   原始 body 长度 =', g.hdr[4]);
const src = g.src.subarray(20, 20 + g.hdr[4]);
console.log('   enc0 === 原始 body ? ', enc0.equals(src));

// ④ 受影响的祖先：哪个祖先决定了输出
if (!enc0.equals(enc1)) {
  let i = 0; while (i < enc0.length && i < enc1.length && enc0[i] === enc1[i]) i++;
  console.log('   首个差异偏移 =', i);
}
