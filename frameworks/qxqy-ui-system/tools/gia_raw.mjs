// tools/gia_raw.mjs — 原始字段转储（调试用）
import fs from 'node:fs';
import * as pb from './pb.mjs';

const IN = process.argv[2];
const bucket = process.argv[3] || 'acc'; // acc | graph
const limit = Number(process.argv[4] || 4);
const buf = fs.readFileSync(IN);
const bodyLen = buf.readUInt32BE(16);
const root = pb.decodeDeep(buf.subarray(20, 20 + bodyLen));
const list = pb.msgs(root, bucket === 'acc' ? 2 : 1);

function show(fields, ind = '') {
  for (const f of fields || []) {
    let v = '';
    if (f.wt === 0) v = String(f.num);
    else if (f.wt === 5) v = String(f.f);
    else if (f.wt === 2) {
      const t = pb.txt([f], f.field);
      v = t != null ? JSON.stringify(t) : `<bin len=${f.len}>`;
    }
    console.log(ind + `#${f.field} wt=${f.wt} ${v}`);
  }
}
for (const [i, u] of list.slice(0, limit).entries()) {
  console.log(`\n=== ${bucket}[${i}] ===`);
  show(u.sub, '  ');
}
