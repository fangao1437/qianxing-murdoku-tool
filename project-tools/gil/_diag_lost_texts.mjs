// 诊断：580 里到底少了哪些【文本内容】
// 用法: node tools/gil/_diag_lost_texts.mjs <清单.md> <新档.gil> <旧档v356.gil>
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
function textOf(rec) {
  const grp = groupOf(rec);
  if (!grp) return null;
  const tn = grp.sub.find((f) => f.field === 510 && f.sub);
  const tl = tn && tn.sub.find((f) => f.field === 501 && f.wt === 2);
  return tl && tl.payload ? tl.payload.toString('utf8') : null;
}

// 清单
const rows = [];
const rx = new RegExp('^\\|\\s*`([^`]+)`\\s*\\|\\s*(.*?)\\s*\\|\\s*(\\d+)\\s*\\|\\s*`0x([0-9A-Fa-f]{8})`\\s*\\|$');
for (const line of fs.readFileSync(mdPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(rx);
  if (!m) continue;
  rows.push({ name: m[1], text: m[2].replaceAll('\\|', '|').replaceAll('<br>', '\n') });
}

const gNew = readGil(newPath);
const gOld = readGil(oldPath);
const byNew = new Map(); for (const r of gNew.recs) if (r.name && !byNew.has(r.name)) byNew.set(r.name, r);
const byOld = new Map(); for (const r of gOld.recs) if (r.name && !byOld.has(r.name)) byOld.set(r.name, r);

// 580 里所有 td.* 文本（内容集合）
const newTexts = new Set();
const newByTrim = new Map();
for (const r of gNew.recs) {
  if (!r.name || !r.name.startsWith('td.')) continue;
  const t = textOf(r);
  if (t === null) continue;
  newTexts.add(t);
  const k = t.trim();
  if (!newByTrim.has(k)) newByTrim.set(k, []);
  newByTrim.get(k).push(r.name);
}

const lost = [], lostByPage = {};
let absentFromNew = 0, absentFromOld = 0;
const oldParents = new Map();
for (const row of rows) {
  const rn = byNew.get(row.name);
  const hasNew = rn ? (textOf(rn) ?? '').trim() === row.text.trim() : false;
  if (hasNew) continue;
  // 名字缺失/文本不符 —— 判断内容是否在 580 别处
  const alt = newByTrim.get(row.text.trim());
  const ro = byOld.get(row.name);
  if (!ro) { absentFromOld++; continue; }
  absentFromNew++;
  const parent = ro.parentId != null ? gOld.recs.find((x) => x.id === ro.parentId) : null;
  const parentName = parent ? parent.name : null;
  const parentInNew = parentName ? byNew.has(parentName) : null;
  const page = (row.name.match(/^(td\.[^.]+\.page\.\d+)/) || [])[1] || '?';
  lost.push({
    name: row.name, text: row.text, page,
    oldId: ro.id, oldParent: parentName, parentInNew,
    altNames: alt || null,
  });
  lostByPage[page] = (lostByPage[page] || 0) + 1;
}

console.log('清单 ' + rows.length + ' 条　580 记录 ' + gNew.recs.length + '　v356 记录 ' + gOld.recs.length);
console.log('  名字或文本对不上：' + absentFromNew + ' 条（★ 其中内容在 580 别处出现过的：'
  + lost.filter((x) => x.altNames).length + ' 条）');
console.log('  按页：' + Object.entries(lostByPage).map(([k, v]) => k.slice(4) + '×' + v).join('  '));
console.log('');
const withAlt = lost.filter((x) => x.altNames);
const noAlt = lost.filter((x) => !x.altNames);
console.log('★ 真丢失（580 里找不到同内容）: ' + noAlt.length + ' 条');
for (const x of noAlt.slice(0, 12)) console.log('  • ' + x.name + '  "' + x.text + '"　旧父=' + x.oldParent + '（新档有父:' + x.parentInNew + '）');
console.log('');
console.log('★ 内容已在 580 别处（可能是改名/迁移）: ' + withAlt.length + ' 条');
for (const x of withAlt.slice(0, 12)) console.log('  • ' + x.name + '  "' + x.text + '" → 580 中的 ' + x.altNames.slice(0, 3).join(', '));
console.log('');
console.log('旧父名分布: ' + JSON.stringify([...new Set(noAlt.map((x) => x.oldParent))].slice(0, 10)));

fs.writeFileSync('_lost-report.json', JSON.stringify({ lost, noAlt, withAlt }, null, 2), 'utf8');
console.log('  明细: _lost-report.json');
