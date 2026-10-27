#!/usr/bin/env node
/**
 * dump_rec.mjs —— 只读：把一个控件记录**整棵字段树**打出来（含状态块）。
 * 用法：node tools/gil/dump_rec.mjs <存档.gil> <控件名或 #id 或 id>
 */
import { readGil } from './gilread.mjs';

const [file, key] = process.argv.slice(2);
if (!file || !key) {
  console.error('用法: node tools/gil/dump_rec.mjs <存档.gil> <控件名|id>');
  process.exit(2);
}
const G = readGil(file);
let rec = G.byName.get(key);
if (!rec && /^\d+$/.test(key)) rec = G.recs.find((r) => r.id === Number(key));
if (!rec && key.startsWith('#')) rec = G.recs.find((r) => r.id === Number(key.slice(1)));
if (!rec) {
  console.error('找不到控件：' + key);
  process.exit(3);
}

function dump(fields, depth, path) {
  for (const f of fields) {
    const p = path ? path + '/' + f.field : String(f.field);
    const pad = '  '.repeat(depth);
    if (f.wt === 0) {
      console.log(`${pad}#${f.field} varint = ${f.num}`);
    } else if (f.wt === 1) {
      console.log(`${pad}#${f.field} fixed64 = ${f.num}`);
    } else if (f.wt === 2) {
      if (f.isText) {
        console.log(`${pad}#${f.field} text(${f.len}) = ${JSON.stringify(f.payload.toString('utf8'))}`);
      } else if (Array.isArray(f.sub) && f.sub.length) {
        console.log(`${pad}#${f.field} msg {`);
        dump(f.sub, depth + 1, p);
        console.log(`${pad}}`);
      } else {
        const pay = f.payload || Buffer.alloc(0);
        console.log(`${pad}#${f.field} bytes(${pay.length}) = ${pay.length ? pay.toString('hex').slice(0, 80) : '(空)'}`);
      }
    } else {
      console.log(`${pad}#${f.field} wt=${f.wt}`);
    }
  }
}

console.log(`记录 ${rec.name}  #${rec.id}  父=${rec.parentId}  状态块=${(rec.states || []).length}`);
dump(rec.field.sub, 0, '');
