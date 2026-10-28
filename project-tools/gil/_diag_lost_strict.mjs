// 严格诊断：按【同页 + 文本 + 字号 + 字色】判断是否真丢失，并 dump 缺失记录的结构
import fs from 'node:fs';
import { readGil } from './gilread.mjs';

const [mdPath, newPath, oldPath] = process.argv.slice(2);
function nodesAt(fields, pathArr) {
  let level = fields;
  for (let i = 0; i < pathArr.length; i++) {
    const hits = level.filter((f) => f.field === pathArr[i] && f.sub);
    if (i === pathArr.length - 1) return hits;
    level = hits.flatMap((f) => f.sub);
  }
  return [];
}
function groupOf(rec) { const ns = nodesAt(rec.field.sub, [505, 503, 75]); return ns.length === 1 ? ns[0] : null; }
function infoOf(rec) {
  const grp = groupOf(rec);
  if (!grp) return { text: null };
  const tn = grp.sub.find((f) => f.field === 510 && f.sub);
  const tl = tn && tn.sub.find((f) => f.field === 501 && f.wt === 2);
  const num = (fld) => { const l = grp.sub.find((x) => x.field === fld && x.wt === 0); return l ? Number(l.num) : 0; };
  return { text: tl && tl.payload ? tl.payload.toString('utf8') : null, size: num(512), color: num(504) };
}
const rows = [];
const rx = new RegExp('^\\|\\s*`([^`]+)`\\s*\\|\\s*(.*?)\\s*\\|\\s*(\\d+)\\s*\\|\\s*`0x([0-9A-Fa-f]{8})`\\s*\\|$');
for (const line of fs.readFileSync(mdPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(rx);
  if (!m) continue;
  rows.push({ name: m[1], text: m[2].replaceAll('\\|', '|').replaceAll('<br>', '\n'), size: Number(m[3]), color: parseInt(m[4], 16) >>> 0 });
}
const gNew = readGil(newPath); const gOld = readGil(oldPath);
const byNew = new Map(); for (const r of gNew.recs) if (r.name && !byNew.has(r.name)) byNew.set(r.name, r);
const byOld = new Map(); for (const r of gOld.recs) if (r.name && !byOld.has(r.name)) byOld.set(r.name, r);

// 580 每页内 (text|size|color) 集合
const pageKey = (n) => (n.match(/^(td\.[^.]+\.page\.\d+)\./) || [])[1] || '?';
const newPageSet = new Map();
for (const r of gNew.recs) {
  if (!r.name || !r.name.startsWith('td.')) continue;
  const i = infoOf(r);
  if (i.text === null) continue;
  const k = pageKey(r.name) + '|' + i.text.trim() + '|' + i.size + '|' + i.color;
  if (!newPageSet.has(k)) newPageSet.set(k, []);
  newPageSet.get(k).push(r.name);
}
const lost = [], kept = [];
for (const row of rows) {
  const r = byNew.get(row.name);
  if (r && (infoOf(r).text ?? '').trim() === row.text.trim()) { kept.push(row); continue; }
  const k = pageKey(row.name) + '|' + row.text.trim() + '|' + row.size + '|' + row.color;
  const alt = newPageSet.get(k);
  if (alt && alt.length) { kept.push({ ...row, alt }); continue; }
  lost.push(row);
}
console.log('清单 ' + rows.length + '　同名同文本命中 ' + (rows.length - lost.length) + '　★ 真丢失 ' + lost.length);
const byPage = {};
for (const x of lost) { const p = pageKey(x.name); (byPage[p] = byPage[p] || []).push(x); }
for (const [p, arr] of Object.entries(byPage)) console.log('  ' + p + ' × ' + arr.length + ': ' + arr.slice(0, 6).map((x) => x.name.split('.').pop() + '="' + x.text.slice(0, 8) + '"').join(' '));
console.log('');
// 抽样一条丢失记录，打印其 v356 结构与父
for (const x of lost.slice(0, 3)) {
  const ro = byOld.get(x.name);
  if (!ro) { console.log('  ' + x.name + ' 旧档也没有 ✗'); continue; }
  const parent = gOld.recs.find((q) => q.id === ro.parentId);
  const parentName = parent ? parent.name : null;
  console.log('  ' + x.name + '  文本="' + x.text + '"');
  console.log('      旧 id=' + ro.id + '　旧父=' + parentName + '（580 有: ' + (parentName ? byNew.has(parentName) : '?') + '）');
  const top = ro.field.sub.map((f) => '#' + f.field + '/' + f.wt + (f.sub ? '(' + f.sub.length + ')' : ''));
  console.log('      顶层字段: ' + top.slice(0, 16).join(' '));
  const i = infoOf(ro);
  console.log('      旧字号/字色: ' + i.size + ' / 0x' + (i.color >>> 0).toString(16));
}
fs.writeFileSync('_lost-strict.json', JSON.stringify(lost, null, 2), 'utf8');
console.log('  明细: _lost-strict.json');
