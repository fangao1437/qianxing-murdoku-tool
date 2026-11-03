// tools/gil_geom_diff.mjs —— 比较两个 .gil 的"控件几何"是否完全相同（只允许 id 段不同）
// 用途：改了 id 分配段之后，证明"树同构、只有 id 变了"，不必重新渲染一遍。
// 用法：node tools/gil_geom_diff.mjs <a.gil> <b.gil>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, pairOf, pairValue } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('用法: node tools/gil_geom_diff.mjs <a.gil> <b.gil>');
  process.exit(2);
}

const key = (file) => {
  const g = readGil(path.resolve(REPO, file));
  const map = new Map();
  for (const rec of g.recs) {
    const parts = [];
    for (const st of rec.states) {
      const v = (n) => {
        const p = pairOf(st, n);
        return p ? `${Math.round(pairValue(p, 0) * 1000) / 1000},${Math.round(pairValue(p, 1) * 1000) / 1000}` : '-';
      };
      parts.push(`a${v(502)}|b${v(503)}|o${v(504)}|s${v(505)}|p${v(506)}`);
    }
    const name = rec.name || `(无名#${rec.id})`;
    const k = `${name}@${rec.parentId == null ? 'root' : 'p'}`;
    const entry = `${parts.join(';')} states=${rec.states.length} kids=${rec.childList ? rec.childList.length : 0}`;
    // 同名多份（模板层重复）也要能对齐：按出现顺序加序号
    let n = 0;
    let kk = k;
    while (map.has(kk)) kk = `${k}#${++n}`;
    map.set(kk, entry);
  }
  return map;
};

const A = key(a);
const B = key(b);
const onlyA = [...A.keys()].filter((k) => !B.has(k));
const onlyB = [...B.keys()].filter((k) => !A.has(k));
const diff = [...A.keys()].filter((k) => B.has(k) && A.get(k) !== B.get(k));

console.log(`A=${path.basename(a)}  记录 ${A.size} 条`);
console.log(`B=${path.basename(b)}  记录 ${B.size} 条`);
console.log(`只在 A：${onlyA.length}   只在 B：${onlyB.length}   几何不同：${diff.length}`);
for (const k of onlyA.slice(0, 6)) console.log('  只A', k);
for (const k of onlyB.slice(0, 6)) console.log('  只B', k);
for (const k of diff.slice(0, 6)) {
  console.log('  不同', k);
  console.log('    A:', A.get(k));
  console.log('    B:', B.get(k));
}
console.log(diff.length === 0 && onlyA.length === 0 && onlyB.length === 0
  ? '★ 两档控件树**逐条同构**（名字/父子/锚点/偏移/尺寸/子列表数量全一致）—— 差异只在 id 值'
  : '⚠ 存在结构或几何差异，需人工看上面的清单');
