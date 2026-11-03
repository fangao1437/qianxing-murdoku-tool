// tools/probe_text.mjs —— 找"有文字的文本框/文本视窗"，把 TextConfig（#75）与文字包装（#510）摊开
// 用法：node tools/probe_text.mjs <file.gil> [--max=8] [--id=1073742xxx]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, encodeMsg } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const MAX = Number(argOf('max') || 8);
const ONLY = argOf('id');

const g = readGil(path.resolve(REPO, FILE));
console.log(`${path.basename(g.file)} ${g.src.length}B recs=${g.recs.length}`);

function slotOf(rec, a, b) {
  for (const f of rec.field.sub) {
    if (f.field !== 505 || !f.sub) continue;
    const pA = f.sub.find((x) => x.field === 501 && x.wt === 0);
    const pB = f.sub.find((x) => x.field === 502 && x.wt === 0);
    if (pA && pB && Number(pA.num) === a && Number(pB.num) === b) {
      return f.sub.find((x) => x.field === 503 && x.sub) || null;
    }
  }
  return null;
}
const kindOf = (rec) => {
  const det = slotOf(rec, 2, 15);
  if (!det) return null;
  const d12 = det.sub.find((x) => x.field === 12);
  const s = d12 && d12.sub ? d12.sub.find((x) => x.field === 501 && x.wt === 2) : null;
  return s ? s.payload.toString('utf8') : null;
};
const show = (fields, ind = '') => {
  const out = [];
  for (const f of fields) {
    if (f.wt === 0) out.push(`${ind}#${f.field} = ${f.num}`);
    else if (f.wt === 5) out.push(`${ind}#${f.field} = f32(${f.f})`);
    else if (f.wt === 2) {
      if (f.isText) out.push(`${ind}#${f.field} = "${f.payload.toString('utf8')}" (len ${f.len})`);
      else if (f.sub) { out.push(`${ind}#${f.field} { len=${f.len} }`); out.push(...show(f.sub, ind + '  ')); }
      else out.push(`${ind}#${f.field} = <bin ${f.len}> ${f.payload.toString('hex').slice(0, 60)}`);
    }
  }
  return out;
};

let n = 0;
for (const rec of g.recs) {
  if (ONLY && String(rec.id) !== ONLY) continue;
  const kind = kindOf(rec);
  // ★ 不按 kind 过滤：真实存档里 槽(2,15) 存的是【实例名】不是类型名（类型名只在原型上）
  const det = slotOf(rec, 64, 84) || slotOf(rec, 71, 94);
  if (!det) continue;
  const d75 = det.sub.find((x) => x.field === 75);
  if (!d75 || !d75.sub) continue;
  const d510 = d75.sub.find((x) => x.field === 510);
  const textLen = d510 ? (d510.sub ? d510.len : (d510.payload ? d510.payload.length : 0)) : -1;
  console.log(`\n=== ${rec.id} ${JSON.stringify(rec.name)} kind=${kind} 父=${rec.parentId} 状态=${rec.states.length} #510长度=${textLen} ===`);
  if (n++ < MAX) console.log(show(d75.sub, '  ').join('\n'));
  else console.log('  （超出 --max，只列标题）');
}
console.log(`\n共扫描 ${n} 条文本类记录`);
