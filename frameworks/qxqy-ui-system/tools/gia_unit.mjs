// tools/gia_unit.mjs — 深转储某个 graph unit / accessory
// 用法: node gia_unit.mjs <file.gia> <acc|graph> <index> [depth]
import fs from 'node:fs';
import * as pb from './pb.mjs';

const [, , IN, bucket = 'acc', idxArg = '2', depthArg = '6'] = process.argv;
const idx = Number(idxArg);
const MAXD = Number(depthArg);
const buf = fs.readFileSync(IN);
const bodyLen = buf.readUInt32BE(16);
const root = pb.decodeDeep(buf.subarray(20, 20 + bodyLen));
const list = pb.msgs(root, bucket === 'acc' ? 2 : 1);
const u = list[idx];
if (!u) {
  console.error('index 越界，共', list.length);
  process.exit(2);
}

function dump(fields, ind = '', d = 0) {
  for (const f of fields || []) {
    const pad = ind + '  '.repeat(d);
    if (f.wt === 0) console.log(`${pad}#${f.field} = ${f.num}`);
    else if (f.wt === 5) console.log(`${pad}#${f.field} = f32(${f.f})`);
    else if (f.wt === 2) {
      const t = pb.txt([f], f.field);
      if (t != null) {
        console.log(`${pad}#${f.field} = ${JSON.stringify(t)}`);
      } else if (f.sub && d < MAXD) {
        console.log(`${pad}#${f.field} { len=${f.len} }`);
        dump(f.sub, ind, d + 1);
      } else {
        console.log(`${pad}#${f.field} = <bin len=${f.len}>`);
      }
    }
  }
}
dump(u.sub);
