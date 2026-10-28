// 对比清单与最新存档（只读分析）
import fs from "node:fs";
import path from "node:path";
import { readGil } from "./gilread.mjs";

const MD = process.argv[2];
const GIL = process.argv[3];
const g = readGil(GIL);
const byName = new Map();
for (const r of g.recs) if (r.name) { if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); }

function nodesAt(fields, pathArr) {
  let level = fields;
  for (let i = 0; i < pathArr.length; i++) {
    const hits = level.filter((f) => f.field === pathArr[i] && f.sub);
    if (i === pathArr.length - 1) return hits;
    level = hits.flatMap((f) => f.sub);
  }
  return [];
}
function readOne(rec) {
  const nodes = nodesAt(rec.field.sub, [505, 503, 75]);
  if (nodes.length !== 1) return { err: '文本组 ' + nodes.length + ' 个' };
  const node = nodes[0];
  const tn = node.sub.find((f) => f.field === 510 && f.sub);
  const tl = tn && tn.sub.find((f) => f.field === 501 && f.wt === 2);
  const text = tl && tl.payload ? tl.payload.toString('utf8') : null;
  const num = (field) => { const l = node.sub.find((f) => f.field === field && f.wt === 0); return l ? Number(l.num) : 0; };
  return { text, size: num(512), color: num(504) };
}

// 解析 md 表格
const rows = [];
for (const line of fs.readFileSync(MD, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*(\d+)\s*\|\s*`0x([0-9A-Fa-f]{8})`\s*\|$/);
  if (!m) continue;
  const text = m[2].replaceAll('\\|', '|').replaceAll('<br>', '\n');
  rows.push({ name: m[1], text, size: Number(m[3]), color: parseInt(m[4], 16) >>> 0 });
}
console.log('清单行数: ' + rows.length + '　存档记录: ' + g.recs.length);

const stat = { same: 0, textDiff: 0, sizeOnly: 0, colorOnly: 0, missingRec: 0, noGroup: 0, multiRec: 0 };
const samples = [];
for (const r of rows) {
  const recs = byName.get(r.name);
  if (!recs) { stat.missingRec++; if (samples.length < 20) samples.push({ kind: '缺记录', name: r.name, want: r.text }); continue; }
  if (recs.length > 1) stat.multiRec++;
  const cur = readOne(recs[0]);
  if (cur.err) { stat.noGroup++; if (samples.length < 20) samples.push({ kind: '无文本组', name: r.name, want: r.text, got: cur.err }); continue; }
  const textSame = (cur.text ?? '') === r.text;
  const sizeSame = cur.size === r.size;
  const colorSame = cur.color === r.color;
  if (textSame && sizeSame && colorSame) stat.same++;
  else if (!textSame && sizeSame && colorSame) { stat.textDiff++; if (samples.length < 20) samples.push({ kind: '文本不同', name: r.name, want: r.text, got: cur.text }); }
  else if (textSame && !sizeSame && colorSame) stat.sizeOnly++;
  else if (textSame && sizeSame && !colorSame) stat.colorOnly++;
  else { stat.textDiff++; if (samples.length < 20) samples.push({ kind: '多字段不同', name: r.name, want: r.text + ' /' + r.size + ' /0x' + r.color.toString(16), got: (cur.text ?? '(空)') + ' /' + cur.size + ' /0x' + cur.color.toString(16) }); }
}
console.log('统计: ' + JSON.stringify(stat));
console.log('');
for (const s of samples) console.log('  [' + s.kind + '] ' + s.name + '\n      要填=' + JSON.stringify(s.want) + '\n      现值=' + JSON.stringify(s.got));
