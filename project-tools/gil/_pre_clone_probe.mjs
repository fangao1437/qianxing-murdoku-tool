// 克隆前体检：缺失记录的父、子、自引用数、兄弟顺序
import fs from 'node:fs';
import { readGil, bigIds, findChildListTop, asIdList } from './gilread.mjs';

const [newPath, oldPath] = process.argv.slice(2);
const gNew = readGil(newPath); const gOld = readGil(oldPath);
const byNew = new Map(); for (const r of gNew.recs) if (r.name && !byNew.has(r.name)) byNew.set(r.name, r);
const byOld = new Map(); for (const r of gOld.recs) if (r.name && !byOld.has(r.name)) byOld.set(r.name, r);
const byIdNew = new Map(gNew.recs.map((r) => [r.id, r]));

// 从清单收集缺失名字
const mdPath = process.argv[4];
const cl = [];
const rx = new RegExp('^\\|\\s*`([^`]+)`\\s*\\|');
for (const l of fs.readFileSync(mdPath, 'utf8').split(/\r?\n/)) { const m = l.match(rx); if (m) cl.push(m[1]); }
const missing = cl.filter((n) => !byNew.has(n));
console.log('清单 ' + cl.length + '　580 有 ' + (cl.length - missing.length) + '　缺失 ' + missing.length);

let withKids = 0, noParent = 0;
const kidNames = new Set();
for (const n of missing) {
  const ro = byOld.get(n);
  if (!ro) continue;
  const p = gOld.recs.find((x) => x.id === ro.parentId);
  if (!p || !byNew.has(p.name)) noParent++;
  const clf = findChildListTop(ro.field.sub);
  const ids = clf ? (asIdList(clf.payload, true) || []) : [];
  if (ids.length) {
    withKids++;
    for (const id of ids) { const c = gOld.recs.find((x) => x.id === id); if (c) kidNames.add(c.name); }
  }
  // 自引用数
  let selfRefs = 0;
  (function w(fs2) { for (const f of fs2) { if (f.wt === 0 && Number(f.num) === ro.id) selfRefs++; if (f.sub) w(f.sub); } })(ro.field.sub);
  if (n === missing[0] || withKids === 1) console.log('  ' + n + ' 自引用 ' + selfRefs + ' 处　子控件 ' + ids.length + ' 个');
}
console.log('  有子控件的缺失记录: ' + withKids + ' 条');
console.log('  子控件名字（去重前 10）: ' + [...kidNames].slice(0, 10).join(', ') + ' … 共 ' + kidNames.size);
console.log('  父在 580 里不存在: ' + noParent + ' 条');

// 按页看父的子列表长度变化 & 缺失记录的父
const byPage = {};
for (const n of missing) {
  const ro = byOld.get(n);
  const p = ro && gOld.recs.find((x) => x.id === ro.parentId);
  const pn = p ? p.name : '?';
  const clf = p ? findChildListTop(p.field.sub) : null;
  const idsOld = clf ? (asIdList(clf.payload, true) || []).length : 0;
  const pNew = byNew.get(pn);
  const clfN = pNew ? findChildListTop(pNew.field.sub) : null;
  const idsNew = clfN ? (asIdList(clfN.payload, true) || []).length : 0;
  const k = pn;
  if (!byPage[k]) byPage[k] = { missing: 0, oldKids: idsOld, newKids: idsNew };
  byPage[k].missing++;
}
for (const [k, v] of Object.entries(byPage)) console.log('  父 ' + k + '：缺 ' + v.missing + ' 个　子列表 v356=' + v.oldKids + '　v358=' + v.newKids);

// 现有 id 上限与范围
console.log('  580 maxId=' + gNew.maxId + '　ID_HI 内还有 ' + (1074200000 - gNew.maxId) + ' 个空位');
