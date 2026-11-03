// tools/gia_rec.mjs — 按 guid 深转储单条记录（含未知槽位）
// 用法: node gia_rec.mjs <file.gia> <guid> [maxdepth]
import fs from 'node:fs';
import * as pb from './pb.mjs';

const [, , IN, guidArg, depthArg = '9'] = process.argv;
const GUID = Number(guidArg);
const MAXD = Number(depthArg);
const buf = fs.readFileSync(IN);
const bodyLen = buf.readUInt32BE(16);
const root = pb.decodeDeep(buf.subarray(20, 20 + bodyLen));

function dump(fields, ind = '', d = 0) {
  for (const f of fields || []) {
    const pad = ind + '  '.repeat(d);
    if (f.wt === 0) console.log(`${pad}#${f.field} = ${f.num}`);
    else if (f.wt === 5) console.log(`${pad}#${f.field} = f32(${f.f})`);
    else if (f.wt === 2) {
      const t = pb.txt([f], f.field);
      if (t != null) console.log(`${pad}#${f.field} = ${JSON.stringify(t)}`);
      else if (f.sub && d < MAXD) {
        console.log(`${pad}#${f.field} { len=${f.len} }`);
        dump(f.sub, ind, d + 1);
      } else console.log(`${pad}#${f.field} = <bin len=${f.len}>`);
    }
  }
}
for (const field of [1, 2]) {
  for (const u of pb.msgs(root, field)) {
    const s = u.sub || [];
    const id = pb.num(pb.msg(s, 1) || [], 4);
    if (id !== GUID) continue;
    console.log(`=== guid ${GUID} (Root#${field}) name=${JSON.stringify(pb.txt(s, 3))} which=${pb.num(s, 5)} ===`);
    dump(s);
    process.exit(0);
  }
}
console.log('未找到', GUID);
