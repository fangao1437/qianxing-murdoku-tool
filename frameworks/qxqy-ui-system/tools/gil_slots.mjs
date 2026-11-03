// tools/gil_slots.mjs —— 打印某条记录的 Data 槽位 (a,b) → 内层字段 → 值摘要
// 用法：node tools/gil_slots.mjs <file.gil> <id> [<id> ...]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const [file, ...ids] = process.argv.slice(2);
const g = readGil(path.resolve(REPO, file));

const summarize = (fields, depth = 0) => {
  const out = [];
  for (const f of fields || []) {
    if (f.wt === 0) out.push(`#${f.field}=${f.num}`);
    else if (f.wt === 5) out.push(`#${f.field}=f32(${Math.round(f.f * 1000) / 1000})`);
    else if (f.wt === 2) {
      if (f.isText) out.push(`#${f.field}="${f.payload.toString('utf8').slice(0, 24)}"`);
      else if (f.sub && depth < 2) out.push(`#${f.field}{${summarize(f.sub, depth + 1)}}`);
      else out.push(`#${f.field}=<bin${f.len}>`);
    }
  }
  return out.join(' ');
};

for (const idStr of ids) {
  const rec = g.recs.find((r) => r.id === Number(idStr));
  if (!rec) {
    console.log(`(${idStr} 未找到)`);
    continue;
  }
  console.log(`\n=== ${rec.id} name=${JSON.stringify(rec.name)} parent=${rec.parentId} states=${rec.states.length} ===`);
  const dataList = rec.field.sub.filter((f) => f.field === 505);
  for (const d of dataList) {
    const a = d.sub.find((x) => x.field === 501 && x.wt === 0);
    const b = d.sub.find((x) => x.field === 502 && x.wt === 0);
    if (!a || !b) {
      console.log(`  #505 <非槽位> ${summarize(d.sub)}`);
      continue;
    }
    const det = d.sub.find((x) => x.field === 503);
    const inner = det && det.sub ? det.sub.map((x) => x.field).join(',') : '';
    console.log(`  槽(${a.num},${b.num}) inner=[${inner}] ${summarize(d.sub.filter((x) => x !== det && x.field !== 501 && x.field !== 502))}`);
    if (det && det.sub) console.log(`        details: ${summarize(det.sub)}`);
  }
  const st = rec.states[0];
  if (st) console.log(`  首个状态块: ${summarize(st.sub)}`);
}
