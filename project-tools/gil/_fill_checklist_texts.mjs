// 把 v356 教程文本清单填入最新存档（579 v358），只写新文件
// 用法: node tools/gil/_fill_checklist_texts.mjs <清单.md> <存档.gil> <输出.gil>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readGil, recordsOf } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const [mdPath, inPath, outPath] = process.argv.slice(2);
if (!mdPath || !inPath || !outPath) { console.error('用法: node _fill_checklist_texts.mjs <清单.md> <存档.gil> <输出.gil>'); process.exit(2); }
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function nodesAt(fields, pathArr) {
  let level = fields;
  for (let i = 0; i < pathArr.length; i++) {
    const hits = level.filter((f) => f.field === pathArr[i] && f.sub);
    if (i === pathArr.length - 1) return hits;
    level = hits.flatMap((f) => f.sub);
  }
  return [];
}
function groupOf(rec) {
  const ns = nodesAt(rec.field.sub, [505, 503, 75]);
  return ns.length === 1 ? ns[0] : null;
}
function readText(group) {
  const tn = group.sub.find((f) => f.field === 510 && f.sub);
  const tl = tn && tn.sub.find((f) => f.field === 501 && f.wt === 2);
  return tl && tl.payload ? tl.payload.toString('utf8') : null;
}
function setText(group, text) {
  const buf = Buffer.from(text, 'utf8');
  let p510 = group.sub.find((f) => f.field === 510);
  if (!p510) { p510 = { field: 510, wt: 2, sub: [], payload: Buffer.alloc(0), len: 0, isText: false }; group.sub.push(p510); }
  if (p510.sub == null) p510.sub = [];
  p510.payload = Buffer.alloc(0); p510.len = 0; p510.isText = false;
  let leaf = p510.sub.find((f) => f.field === 501 && f.wt === 2);
  if (!leaf) { leaf = { field: 501, wt: 2, payload: buf, len: buf.length, isText: true, sub: null }; p510.sub.unshift(leaf); }
  else { leaf.payload = buf; leaf.len = buf.length; leaf.isText = true; }
}
function setNum(group, field, value) {
  let f = group.sub.find((x) => x.field === field && x.wt === 0);
  if (!f) { f = { field, wt: 0, num: BigInt(0) }; group.sub.push(f); }
  f.num = BigInt(value >>> 0);
}

// ---------- 解析清单 ----------
const rows = [];
const rx = new RegExp('^\\|\\s*`([^`]+)`\\s*\\|\\s*(.*?)\\s*\\|\\s*(\\d+)\\s*\\|\\s*`0x([0-9A-Fa-f]{8})`\\s*\\|$');
for (const line of fs.readFileSync(mdPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(rx);
  if (!m) continue;
  rows.push({
    name: m[1],
    text: m[2].replaceAll('\\|', '|').replaceAll('<br>', '\n'),
    size: Number(m[3]),
    color: parseInt(m[4], 16) >>> 0,
  });
}
console.log('清单行数: ' + rows.length);

// ---------- 载入存档并填 ----------
const g = readGil(inPath);
const byName = new Map();
for (const r of g.recs) if (r.name) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }

const applied = [], changed = [], missing = [], noGroup = [];
for (const row of rows) {
  const recs = byName.get(row.name);
  if (!recs) { missing.push(row.name); continue; }
  const grp = groupOf(recs[0]);
  if (!grp) { noGroup.push(row.name); continue; }
  const before = readText(grp);
  setText(grp, row.text);
  setNum(grp, 512, row.size);
  setNum(grp, 504, row.color);
  applied.push({ row, before });
  if (before !== row.text) changed.push({ name: row.name, before, after: row.text });
}
console.log('  可填 ' + applied.length + '　其中文本有变化 ' + changed.length);
console.log('  缺记录 ' + missing.length + '　无文本组 ' + noGroup.length);
if (noGroup.length) console.log('  无文本组: ' + noGroup.join(', '));
if (missing.length) {
  const pages = {};
  for (const n of missing) { const m = n.match(/^(td\.[^.]+\.page\.\d+)/); (pages[m ? m[1] : '?'] = pages[m ? m[1] : '?'] || []).push(n); }
  console.log('  缺记录按页: ' + Object.entries(pages).map(([k, v]) => k + '×' + v.length).join('  '));
}

const shaBefore = sha(inPath);
writeGil(g, outPath, {
  label: 'fill-tutorial-texts',
  expectRecs: g.recs.length,
  mustDiffer: changed.length > 0,
  quiet: false,
  assert: (g2) => {
    const recs2 = recordsOf(g2.tree);
    const map2 = new Map();
    for (const r of recs2) if (r.name) map2.set(r.name, r);
    let bad = 0, okText = 0, okSize = 0, okColor = 0;
    for (const { row } of applied) {
      const r = map2.get(row.name);
      const grp = r && groupOf(r);
      const t = grp ? readText(grp) : null;
      const num = (fld) => { const l = grp && grp.sub.find((x) => x.field === fld && x.wt === 0); return l ? Number(l.num) : -1; };
      if (t === row.text) okText++; else { bad++; if (bad <= 5) console.log('    ❌ ' + row.name + ' 文本=' + JSON.stringify(t)); }
      if (num(512) === row.size) okSize++; else { bad++; if (bad <= 5) console.log('    ❌ ' + row.name + ' 字号=' + num(512)); }
      if (num(504) === row.color) okColor++; else { bad++; if (bad <= 5) console.log('    ❌ ' + row.name + ' 字色=0x' + (num(504) >>> 0).toString(16)); }
    }
    console.log('    读回：文本 ' + okText + '/' + applied.length + '　字号 ' + okSize + '　字色 ' + okColor);
    return bad === 0 ? true : '读回不符 ' + bad + ' 项';
  },
});
console.log('  原档 sha 未变: ' + (sha(inPath) === shaBefore ? '✅' : '❌'));
fs.writeFileSync(path.join(path.dirname(outPath), '_fill-report.json'), JSON.stringify({
  base: path.basename(inPath), out: path.basename(outPath),
  total: rows.length, applied: applied.length, changed: changed.length,
  missing, noGroup, changes: changed,
}, null, 2), 'utf8');
console.log('  报告: _fill-report.json');
