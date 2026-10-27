import { readGil, findChildListTop, asIdList } from './gilread.mjs';
import fs from 'node:fs';
const f = fs.existsSync('215-灰白卡基准.gil') ? '215-灰白卡基准.gil' : '214灰白.gil';
const g = readGil(f);
console.log('  基准存档 = ' + f + '（记录 ' + g.recs.length + '）');
const byId = new Map(g.recs.map((r) => [r.id, r]));
const kids = (r) => { const l = findChildListTop(r.field.sub); return l ? (asIdList(l.payload, true) || []) : []; };
// 打印三层树（名字 + 子数）
function dump(r, depth) {
  const k = kids(r);
  console.log('  ' + '  '.repeat(depth) + (r.name || '(无名)') + '  id=' + r.id + (k.length ? '  [' + k.length + '子]' : ''));
  if (depth >= 2) return;
  for (const c of k) { const cr = byId.get(c); if (cr) dump(cr, depth + 1); }
}
for (const r of g.recs.filter((x) => x.parentId === undefined || x.parentId === null || !byId.has(x.parentId))) dump(r, 0);
console.log('  ★ 疑似素材控件（名字含 portrait/badge/tray/asset/face/头像）：');
for (const r of g.recs) {
  const n = String(r.name || '');
  if (/portrait|badge|tray|asset|face/i.test(n)) {
    const p = byId.get(r.parentId);
    console.log('    ' + n + '  父=' + (p ? p.name : r.parentId));
  }
}