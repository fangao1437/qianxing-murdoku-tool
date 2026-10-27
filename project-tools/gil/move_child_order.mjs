// tools/gil/move_child_order.mjs —— 把某条记录在它父级的**子控件列表**里挪到指定位置
//
// 为什么需要它（2026-10-15 真机判决）：
//   ★ `settle.btn` 在 `root` 的子列表里是**最后一个（第 73/74 位）** ✗
//   ★ 真机现象：点 (654,112) —— 离它真正的矩形（画布 158,79.6 / 217×60）很远 —— 仍然命中它 ✗
//   ★ 我在模拟器上复现到同一件事：点任意位置都命中 `settle.btn` ✓
//   ⇒ ★★ 判据：**引擎在"这一点没有别的可点控件"时会回退到【最后一个】子控件** ✓
//   ⇒ 修法：把它挪到**第一位** ✓ ⇒ 那个回退目标就变成别人（或干脆没有），它自己靠真实矩形吃点击 ✓
//
// ⚠️ 只改父级子列表里的**顺序** ✓ —— 不碰几何、不碰状态块、不碰任何其它字段 ✓
//
// 用法：
//   node tools/gil/move_child_order.mjs --in=<in.gil> --out=<out.gil> --name=settle.btn --to=first|last|<n>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList, setChildList } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };

const IN = argOf('in'), OUT = argOf('out'), NAME = argOf('name'), TO = argOf('to') || 'first';
if (!IN || !OUT || !NAME) {
  console.error('用法: node tools/gil/move_child_order.mjs --in=<in.gil> --out=<out.gil> --name=<控件名> [--to=first|last|<n>]');
  process.exit(1);
}

const g = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
const rec = g.byName.get(NAME);
if (!rec) { console.error('❌ 找不到控件 ' + NAME); process.exit(2); }
const byId = new Map(g.recs.map((r) => [r.id, r]));
const parent = rec.parentId !== null ? byId.get(rec.parentId) : null;
if (!parent) { console.error('❌ ' + NAME + ' 没有父记录（父 id = ' + rec.parentId + '）'); process.exit(3); }

const cl = findChildListTop(parent.field.sub);
if (!cl) { console.error('❌ 父 ' + parent.name + ' 顶层没有子控件列表'); process.exit(4); }
const ids = (asIdList(cl.payload, true) || []).map(Number);
const from = ids.indexOf(rec.id);
if (from < 0) { console.error('❌ ' + NAME + ' 不在父 ' + parent.name + ' 的子列表里'); process.exit(5); }

let to;
if (TO === 'first') to = 0;
else if (TO === 'last') to = ids.length - 1;
else { to = Number(TO); if (!Number.isFinite(to)) { console.error('❌ --to 只能是 first / last / 一个整数'); process.exit(6); } }
to = Math.max(0, Math.min(ids.length - 1, to));

console.log('父 ' + parent.name + '（子控件 ' + ids.length + ' 个）');
console.log('  ' + NAME + ' 现在第 ' + from + ' 位 → 目标第 ' + to + ' 位');
if (from === to) { console.log('（已经在目标位置 ✓ 不写文件）'); process.exit(0); }

const next = ids.slice();
next.splice(from, 1);
next.splice(to, 0, rec.id);
setChildList(cl, next);

const rep = writeGil(g, path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), {
  label: '子控件顺序：' + NAME + ' → 第 ' + to + ' 位',
  assert: (g2) => {
    const bad = [];
    const p2 = g2.byName.get(parent.name);
    const ids2 = (asIdList(findChildListTop(p2.field.sub).payload, true) || []).map(Number);
    const r2 = g2.byName.get(NAME);
    const at = ids2.indexOf(r2.id);
    if (at !== to) bad.push(NAME + ' 回读在第 ' + at + ' 位，期望第 ' + to + ' 位');
    if (ids2.length !== ids.length) bad.push('子控件数量变了：' + ids.length + ' → ' + ids2.length);
    // ★ 几何不许动 ✓：逐条比对四个状态块的位置对与尺寸对
    const pairs = (r) => r.states.map((b) => {
      const f = (n) => { const p = b.sub.find((x) => x.field === n); if (!p) return null;
        const v = (k) => { const q = p.sub.find((y) => y.field === k); return q && q.wt === 5 ? q.f : null; };
        return [v(501), v(502)]; };
      return JSON.stringify([f(504), f(505)]);
    }).join('|');
    const a1 = pairs(g.byName.get(NAME)), a2 = pairs(r2);
    if (a1 !== a2) bad.push('几何被改动了 ✗（' + a1 + ' → ' + a2 + '）');
    return bad.length ? bad.join('；') : true;
  },
});
console.log('  输出：' + path.basename(OUT) + '（' + rep.bytes + ' 字节，记录 ' + rep.recs + ' 条，字段差异 ' + rep.diffs + ' 处）');
