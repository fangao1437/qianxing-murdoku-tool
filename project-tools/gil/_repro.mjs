// tools/gil/_repro.mjs —— 最小复现：改一个值，存，重读，并检查"我改的对象在不在 tree 里"
import fs from 'node:fs';
import { readGil, encodeMsg, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const FILE = process.argv[2] || '249-占位项改前两项-v111.gil';
const g = readGil(FILE);
const clue = g.recs.find((r) => r.name === 'clue');
console.log('  clue #' + clue.id + '  recs 数 ' + g.recs.length);

// ★ ① 收集 tree 里【所有对象】的集合（用身份 ✓）
const inTree = new Set();
const collect = (arr) => { if (!Array.isArray(arr)) return; for (const f of arr) { inTree.add(f); if (f.sub) collect(f.sub); } };
collect(g.tree);
console.log('  g.tree 里的对象总数: ' + inTree.size);

// ★ ② 看 clue 记录的对象在不在 tree 里
console.log('  clue.field 在 tree 里? ' + (inTree.has(clue.field) ? '✅ 是' : '❌ 否'));
const blocks = stateBlocks(clue.field.sub, []);
console.log('  #505 块 ' + blocks.length + ' 个；块[0] 在 tree 里? ' + (inTree.has(blocks[0]) ? '✅ 是' : '❌ 否'));
const p = pairOf(blocks[0], 504);
console.log('  块[0] 的 #504 对在 tree 里? ' + (p && inTree.has(p) ? '✅ 是' : '❌ 否'));
if (p) {
  console.log('  #504 的子: ' + (p.sub || []).map((x) => '#' + x.field + '(wt' + x.wt + ')' + (x.wt === 5 ? '=' + x.f : '')).join(' '));
  console.log('  两个叶子在 tree 里? ' + (p.sub || []).map((x) => inTree.has(x) ? '是' : '否').join(','));
}

// ★ ③ 改值 → 存 → 重读
const want = 0;
let changed = 0;
for (const b of blocks) {
  const q = pairOf(b, 504);
  if (!q) continue;
  for (const leaf of (q.sub || [])) if (leaf.wt === 5 && (leaf.field === 501 || leaf.field === 502)) { leaf.f = want; changed++; }
}
console.log('  ★ 改了 ' + changed + ' 个叶子 → ' + want);
const body = encodeMsg(g.tree);
console.log('  ★ 编码后体长 ' + body.length + '（原体长 ' + (g.bodyEnd - 20) + '）');
const out = g.pack(body);
fs.writeFileSync('_repro_out.gil', out);
console.log('  ★ 输出 ' + out.length + ' 字节；与输入相同? ' + (out.length === g.src.length ? '是（★ 可疑 ✗）' : '否 ✓'));

const g2 = readGil('_repro_out.gil');
const c2 = g2.recs.find((r) => r.name === 'clue');
const b2 = stateBlocks(c2.field.sub, []);
const p2 = pairOf(b2[0], 504);
console.log('  ★ 重读: (' + pairValue(p2, 0) + ', ' + pairValue(p2, 1) + ')');
