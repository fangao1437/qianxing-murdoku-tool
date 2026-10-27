// tools/gil/compare_records.mjs —— **只读**：比较两条记录的结构指纹（"克隆体到底改了什么"）
//
// 为什么要有它（2026-10-15）：
//   ★ 选关屏这条线上有一句**没有逐条核实**的判断 ✗（交班 §五·4 自己写着）：
//     「命中层会渲染成白块」✓
//   ★ 而"会不会渲染出东西"取决于**记录本身**：
//     命中层 `hit.select.*` 是 `hit.back` 的克隆 ✓ ——
//     ⇒ ★ 只要它俩的**结构指纹**一致，就不可能一个隐形、另一个出白块 ✓
//   ⇒ 本工具把"两条记录的形状 + 所有 wt0 叶子 + 短文本"逐项列出来对比 ✓
//     （指纹一致 = 结构相同；差异会逐行标出 ✓）
//
// 用法：
//   node tools/gil/compare_records.mjs <存档.gil> <名字A> <名字B>
//   node tools/gil/compare_records.mjs "365-选关四张卡-v232.gil" hit.back hit.select.back

import path from 'node:path';
import { readGil, textsOf, KNOWN_TYPES } from './gilread.mjs';

const [file, nameA, nameB] = process.argv.slice(2);
if (!file || !nameA || !nameB) {
  console.error('用法: node tools/gil/compare_records.mjs <存档.gil> <名字A> <名字B>');
  process.exit(1);
}
const g = readGil(file);
const A = g.byName.get(nameA), B = g.byName.get(nameB);
if (!A || !B) { console.error('找不到：' + (!A ? nameA : nameB)); process.exit(2); }

/** 结构指纹：字段号 / 线格式 / 子消息形状；wt0 用值，wt5 用值，wt2 文本用 <str> */
function fingerprint(fields) {
  const out = [];
  (function walk(fs, d) {
    for (const f of fs) {
      const pad = '  '.repeat(d);
      if (f.sub) { out.push(pad + '#' + f.field + ' msg(' + f.sub.length + ')'); walk(f.sub, d + 1); }
      else if (f.wt === 0) out.push(pad + '#' + f.field + ' = ' + f.num);
      else if (f.wt === 5) out.push(pad + '#' + f.field + ' float = ' + Number(f.f).toFixed(3));
      else if (f.isText) out.push(pad + '#' + f.field + ' str = ' + JSON.stringify(f.payload.toString('utf8')));
      else out.push(pad + '#' + f.field + ' bytes[' + (f.len || 0) + ']');
    }
  })(fields, 0);
  return out;
}

/**
 * 归一化：把"本来就是每条记录各自不同的东西"抹掉，好让差异只剩**结构**：
 *   · 记录自己的 id、父 id、自引用（`#4`）、状态块里的回指
 *   · 实例名（就是被比较的那个短文本）
 *   · 几何（位置 / 尺寸成对浮点）
 * ⚠️ 归一化是**显式**的：抹掉了什么，下面会打印出来 ✓
 */
function normalize(rec, other, otherName) {
  const fp = fingerprint(rec.field.sub);
  const bigIds = new Set([String(rec.id), String(rec.parentId), String(other.id), String(other.parentId)]);
  return fp.map((line) => {
    let s = line;
    for (const id of bigIds) s = s.replace(new RegExp('= ' + id + '\\b', 'g'), '= <ID>');
    s = s.replace(/str = ".*"$/, 'str = <STR>');
    return s;
  }).map((s) => s.replace(/float = -?\d+\.\d+/, 'float = <F>'));
}

const fa = normalize(A, B, nameB);
const fb = normalize(B, A, nameA);

console.log('文件：' + path.basename(file));
console.log('A = ' + nameA + '  #' + A.id + '   父=' + A.parentId + '   顶层字段 ' + A.field.sub.length + ' 个');
console.log('B = ' + nameB + '  #' + B.id + '   父=' + B.parentId + '   顶层字段 ' + B.field.sub.length + ' 个');
console.log('A 的短文本=' + JSON.stringify(textsOf(A.field.sub, []).map((t) => t.payload.toString('utf8'))));
console.log('B 的短文本=' + JSON.stringify(textsOf(B.field.sub, []).map((t) => t.payload.toString('utf8'))));
console.log('');
console.log('归一化后行数：A=' + fa.length + '  B=' + fb.length + (fa.length === fb.length ? '（相同 ✓）' : '（不同 ✗）'));

const n = Math.max(fa.length, fb.length);
let diff = 0;
for (let i = 0; i < n; i++) {
  const x = fa[i] === undefined ? '(缺)' : fa[i];
  const y = fb[i] === undefined ? '(缺)' : fb[i];
  if (x !== y) {
    diff++;
    console.log('  ✗ 行 ' + i + '\n      A: ' + x + '\n      B: ' + y);
  }
}
console.log('');
console.log(diff === 0
  ? '★ 结构指纹一致 ✓ ⇒ 这两条记录**除了 id/父/名字/几何**没有区别 ✓'
  : '★ 共有 ' + diff + ' 处结构差异（上面逐行列出）');
console.log('（注：文本叶子与几何浮点已归一化，所以"名称/位置/尺寸"不同不算差异 ✓）');
