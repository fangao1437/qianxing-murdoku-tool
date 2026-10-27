// tools/gil/_probe_innergids.mjs —— 只读：查**控件内部嵌套的 GUID** 是否两份记录撞号
//
//   背景（2026-10-18）：编辑器报「界面控件…GUID重复」，但按**顶层 `#501`** 查是 0 个重复。
//   推断：`.gil` 的一条控件记录里，**真正的控件 GUID 还在 `#505/#503/#13/#12/#501`** 这个嵌套节点上；
//         而克隆工具若只改了**顶层** `#501`（`bigIdTop` 读的那个），**内层 GUID 会跟"母本"重复** ✗
//
//   用法：node tools/gil/_probe_innergids.mjs <存档.gil>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = process.argv[2] || '403-去things-脚本素材-v258.gil';
const g = readGil(path.isAbsolute(file) ? file : path.join(ROOT, file));

const ID_LO = 10000000, ID_HI = 99_999_999_999;   // 与 gilread 同量级（控件 GUID 都是 1e9 级）

/** 递归收集一条记录里**所有** id 级 varint，带路径 */
function idsOf(fields, out, p = '') {
  for (const f of fields || []) {
    const np = p + '/#' + f.field;
    if (f.wt === 0 && Number(f.num) > ID_LO && Number(f.num) < ID_HI) out.push({ v: Number(f.num), where: np });
    if (f.sub) idsOf(f.sub, out, np);
  }
  return out;
}

const owners = new Map();   // id -> [{name, where}]
const inner = [];           // 记录：内层 GUID（不是顶层那条）
for (const r of g.recs) {
  const all = idsOf(r.field.sub, []);
  if (!all.length) continue;
  for (const h of all) {
    if (!owners.has(h.v)) owners.set(h.v, []);
    owners.get(h.v).push({ name: r.name || ('#' + r.id), where: h.where });
  }
  // 顶层 #501 的路径（`bigIdTop` 认的那条）→ 其余都算"内层"
  const top = all.find((h) => h.where === '/#501');
  const rest = all.filter((h) => h !== top);
  if (rest.length) inner.push({ rec: r.name || ('#' + r.id), ids: rest });
}

const dups = [...owners.entries()].filter(([, list]) => new Set(list.map((x) => x.name)).size > 1);
console.log('文件：' + path.basename(file) + '　记录 ' + g.recs.length);
console.log('每个 id 被 **两条以上记录** 使用的：' + dups.length);
for (const [id, list] of dups.slice(0, 20)) {
  const names = [...new Set(list.map((x) => x.name))];
  console.log('  #' + id + '　' + names.join(' | ')
    + '　路径：' + list.map((x) => x.where).slice(0, 4).join(' , '));
}
console.log('\n带"内层 GUID"的记录 ' + inner.length + ' 条（前 12）：');
for (const r of inner.slice(0, 12)) {
  console.log('  ' + r.rec.padEnd(20) + r.ids.map((x) => x.v + '@' + x.where).join(' , '));
}
