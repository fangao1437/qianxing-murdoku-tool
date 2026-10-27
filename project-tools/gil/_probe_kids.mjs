// tools/gil/_probe_kids.mjs —— 只读：列出某个父控件的直接子控件（名字 / id / 类型 / 它自己有几个子控件）
//   ★ 用途：找"没有子控件的容器"当克隆原型（`win` 就是这么挑出来的 ✓）
// 用法：node tools/gil/_probe_kids.mjs <存档.gil> <父名>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2], pname = process.argv[3];
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kids = (r) => {
  const cl = findChildListTop(r.field.sub);
  return cl ? (asIdList(cl.payload, true) || []).map((i) => byId.get(Number(i))).filter(Boolean) : [];
};
const p = g.recs.find((r) => r.name === pname);
if (!p) { console.log('✗ 找不到父控件 ' + pname); process.exit(1); }
const ks = kids(p);
console.log('父 ' + pname + ' #' + p.id + '　直接子控件 ' + ks.length + ' 个：');
for (const k of ks) {
  const nk = kids(k).length;
  console.log('  ' + k.name.padEnd(20) + '#' + k.id + '　状态块 ' + (k.states ? k.states.length : '?')
    + '　它自己的子控件 ' + nk + (nk === 0 ? '  ← 可用作克隆原型（无子）' : ''));
}
