// tools/probe_image.mjs —— 找"带 assetId 的图片记录"：打印 slot (73,96) 的 details #84 内层字段
// 用法：node tools/probe_image.mjs <file.gil> [--max=40] [--asset=1]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from '../../../qianxing-murdoku/tools/gil/gilread.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const FILE = argv.find((a) => !a.startsWith('--'));
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const MAX = Number(argOf('max') || 40);
const ONLY_ASSET = argv.includes('--asset');

const g = readGil(path.resolve(REPO, FILE));
console.log(`${path.basename(g.file)} ${g.src.length}B recs=${g.recs.length} maxId=${g.maxId}`);

// slot (a,b) = #505{ #501=a, #502=b, #503 details }
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
const digits = (f) => (f.sub ? `{${f.sub.map((x) => '#' + x.field).join(',')}}` : `<bin${f.len}>`);

// 槽(1,12) 的 details 里 #13/#12/#502 —— 想看清它和 assetId 是不是同一个数
function stateBag502(rec) {
  const det = slotOf(rec, 1, 12);
  if (!det) return '?';
  const d13 = det.sub.find((x) => x.field === 13);
  if (!d13 || !d13.sub) return '?';
  const d12 = d13.sub.find((x) => x.field === 12);
  if (!d12 || !d12.sub) return '?';
  const v = d12.sub.find((x) => x.field === 502 && x.wt === 0);
  return v ? String(v.num) : '(无)';
}

let n = 0, withAsset = 0;
for (const rec of g.recs) {
  const det = slotOf(rec, 73, 96);
  if (!det) continue;
  const d84 = det.sub.find((x) => x.field === 84);
  if (!d84) continue;
  const color = d84.sub ? d84.sub.find((x) => x.field === 502 && x.wt === 0) : null;
  const asset = d84.sub ? d84.sub.find((x) => x.field === 503 && x.wt === 0) : null;
  const has = asset && Number(asset.num) > 0;
  if (has) withAsset++;
  if (ONLY_ASSET && !has) continue;
  if (n++ < MAX) {
    console.log(
      `${String(rec.id).padEnd(11)} name=${JSON.stringify(rec.name)} parent=${rec.parentId} 状态=${rec.states.length}`
      + `  color=${color ? color.num : '(无)'}  assetId=${asset ? asset.num : '✗无'}`
      + `  状态包#502=${stateBag502(rec)}`
      + `  #84=${digits(d84)}  details=${digits(det)}`
    );
  }
}
console.log(`\n带 (73,96)+#84 的记录 ${n} 条；其中 assetId>0 的 ${withAsset} 条`);
