// tools/gil/_probe_select_cards.mjs —— 只读：选关卡片（select.card.*）的几何现状
//   背景（2026-10-18 真机回报）：**选关界面只渲染出一张卡片**。
//   ⇒ 先证明"存档里四条卡片是叠在一起、还是分散的"，再决定怎么修。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '399-贴格-门墙-v256.gil';
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

const cards = g.recs
  .filter((r) => /^select\.card\.\d+$/.test(r.name || ''))
  .sort((a, b) => a.name.localeCompare(b.name));
console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length);
console.log('select.card.N 记录 ' + cards.length + ' 个');
for (const r of cards) {
  const bs = [];
  stateBlocks(r.field.sub, bs);
  const rows = [];
  for (const b of bs) {
    const p = pairOf(b, 504), s = pairOf(b, 505);
    const pv = [pairValue(p, 0), pairValue(p, 1)];   // ★ pairValue 取的是**单个分量**（0→#501 / 1→#502）
    const sv = [pairValue(s, 0), pairValue(s, 1)];
    rows.push(pv.map((x) => Number(x).toFixed(1)).join(',')
      + ' / ' + sv.map((x) => Number(x).toFixed(1)).join('×'));
  }
  console.log('  ' + r.name.padEnd(16) + '#' + r.id + '  父=' + r.parentId
    + '  状态块=' + bs.length + '  ' + rows.slice(0, 3).join('  |  '));
}

const kids = g.recs.filter((r) => /^select\.card\.\d+\./.test(r.name || ''));
console.log('\nselect.card.* 的子控件 ' + kids.length + ' 个：'
  + kids.slice(0, 12).map((k) => k.name + '#' + k.id).join(', '));

const hits = g.recs.filter((r) => /^hit\.select\.card\./.test(r.name || ''));
console.log('hit.select.card.* = ' + hits.length
  + (hits.length ? '　' + hits.map((h) => h.name + '#' + h.id).join(', ') : ''));

// 选关容器本身
const sel = g.recs.filter((r) => r.name === 'select');
for (const s of sel) {
  const kids2 = g.recs.filter((r) => Number(r.parentId) === Number(s.id));
  console.log('\nselect 容器 #' + s.id + '（父 ' + s.parentId + '）子控件 ' + kids2.length + ' 个：'
    + kids2.map((k) => k.name).join(', '));
}
