// tools/gil/_probe_modal.mjs —— 只读探针：dump `modal` 及其子控件的几何 / 图 id
// 用法：node tools/gil/_probe_modal.mjs <存档.gil> [父控件名=modal]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList, stateBlocks, pairOf, pairValue } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIL = process.argv[2] || path.join(ROOT, '349.gil');
const WANT = process.argv[3] || 'modal';

const g = readGil(GIL);
console.log('存档 ' + path.basename(GIL) + '　记录 ' + g.recs.length + '　maxId=' + g.maxId);

// 图 id：路径 #505/#503/#84 下的 #503 叶子
function nodesAt(fields, p) {
  let level = fields;
  for (let i = 0; i < p.length; i++) {
    const hits = level.filter((f) => f.field === p[i] && f.sub);
    if (i === p.length - 1) return hits;
    level = hits.flatMap((f) => f.sub);
  }
  return [];
}
function imgOf(rec) {
  for (const nd of nodesAt(rec.field.sub, [505, 503, 84])) {
    for (const f of (nd.sub || [])) if (f.field === 503 && f.wt === 0) return Number(f.num);
  }
  return null;
}
function geom(rec) {
  const bl = []; stateBlocks(rec.field.sub, bl);
  if (!bl.length) return null;
  const pos = pairOf(bl[0], 504), siz = pairOf(bl[0], 505);
  return {
    n: bl.length,
    x: pos ? pairValue(pos, 0) : null, y: pos ? pairValue(pos, 1) : null,
    w: siz ? pairValue(siz, 0) : null, h: siz ? pairValue(siz, 1) : null,
  };
}

const parent = g.recs.find((r) => r.name === WANT);
if (!parent) { console.error('✗ 找不到 ' + WANT); process.exit(2); }
console.log('\n【' + WANT + '】 #' + parent.id + '  父=' + parent.parentId + '  几何=' + JSON.stringify(geom(parent)));

const cl = findChildListTop(parent.field.sub);
const ids = cl ? (asIdList(cl.payload, true) || []) : [];
console.log('子控件列表 ' + ids.length + ' 个：');
for (const id of ids) {
  const rec = g.recs.find((r) => r.id === id);
  if (!rec) { console.log('  #' + id + '  ✗ 记录不存在'); continue; }
  const gm = geom(rec) || {};
  console.log('  ' + String(rec.name).padEnd(18) + ' #' + String(rec.id).padEnd(12)
    + ' 图=' + String(imgOf(rec) ?? '—').padEnd(12)
    + ' 偏移=(' + gm.x + ',' + gm.y + ')  尺寸=' + gm.w + '×' + gm.h
    + '  状态块=' + gm.n);
}
