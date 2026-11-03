// tools/probe_canvas.mjs —— 找"客户端控件容器"(槽 62,82) 并打印它的子列表 / 顶层根记录，判断 UI 树怎么挂
// 用法：node tools/probe_canvas.mjs <file.gil> [--depth=3]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, asIdList, findChildListTop } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const g = readGil(path.resolve(REPO, FILE));
const byId = new Map(g.recs.map((r) => [r.id, r]));

function slotDetails(rec, a, b) {
  for (const f of rec.field.sub) {
    if (f.field !== 505 || !f.sub) continue;
    const pA = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const pB = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (pA && pB && Number(pA.num) === a && Number(pB.num) === b) return f.sub.find((x) => x.field === 503 && x.sub) || null;
  }
  return null;
}
const kidsOf = (rec) => {
  const cl = findChildListTop(rec.field.sub);
  return cl ? (asIdList(cl.payload, true) || []) : null;
};

console.log(`${path.basename(g.file)} ${g.src.length}B recs=${g.recs.length}`);

// 1) 客户端控件容器
const canvases = g.recs.filter((r) => slotDetails(r, 62, 82));
console.log(`\n客户端控件容器(槽 62,82)：${canvases.length} 个`);
for (const c of canvases) {
  const k = kidsOf(c);
  console.log(`  #${c.id} name=${JSON.stringify(c.name)} parent=${c.parentId} 子列表=${k ? '[' + k.join(',') + ']' : 'null'}`);
  for (const id of k || []) {
    const kid = byId.get(id);
    console.log(`      → #${id} ${kid ? JSON.stringify(kid.name) : '(无记录)'}`);
  }
}

// 2) 顶层对象 id 列表（/#9/#501 之类）
console.log('\n顶层字段 #9 的子字段：');
const f9 = g.tree.find((f) => f.field === 9);
if (f9 && f9.sub) {
  for (const f of f9.sub) {
    if (f.field === 501 && f.payload) {
      const ids = asIdList(f.payload, true);
      console.log(`  #501 = ${ids ? ids.length + ' 个 id: [' + ids.join(',') + ']' : '非 id 列表 ' + f.payload.length + 'B'}`);
    } else if (f.field === 502) {
      console.log(`  #502 × ${f.sub ? '有内层' : 'bin' + f.len}`);
    } else {
      console.log(`  #${f.field} wt${f.wt} len=${f.len}`);
    }
  }
} else console.log('  (无 #9)');

// 3) 根记录（无父 / 父不存在）
const roots = g.recs.filter((r) => r.parentId == null || !byId.has(r.parentId));
console.log(`\n根记录 ${roots.length} 个：`);
for (const r of roots.slice(0, 60)) {
  const k = kidsOf(r);
  console.log(`  #${r.id} name=${JSON.stringify(r.name)} parent=${r.parentId} 子列表=${k ? k.length + ' 项' : 'null'}`);
}
