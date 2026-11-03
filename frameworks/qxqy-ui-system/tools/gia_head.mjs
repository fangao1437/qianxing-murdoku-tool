// tools/gia_head.mjs — 千星 .gia 信封探测：头 5 个大端 u32 / 体 / 尾 4 字节
// 用法：node workspace/qxqy-ui-system/tools/gia_head.mjs "<file.gia>"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pb from './pb.mjs';

const IN = process.argv[2];
if (!IN) {
  console.error('用法: node gia_head.mjs <file.gia>');
  process.exit(2);
}
const buf = fs.readFileSync(IN);
console.log('文件', path.basename(IN), 'bytes =', buf.length);

const u32be = (o) => buf.readUInt32BE(o);
const head = [0, 4, 8, 12, 16].map(u32be);
console.log('头 5 个大端 u32:', head.join(' , '));
console.log('  head[0]=', head[0], ' head[0]+4 =', head[0] + 4, '(= 文件长?', head[0] + 4 === buf.length, ')');
console.log('  head[4]=', head[4], ' 20+head[4] =', 20 + head[4], ' 文件长 =', buf.length, ' ⇒ 差值(tail) =', buf.length - 20 - head[4]);
console.log('尾 8 字节:', [...buf.subarray(buf.length - 8)].map((b) => b.toString(16).padStart(2, '0')).join(' '));

// 从第 20 字节开始解
const bodyStart = 20;
const bodyEnd = bodyStart + head[4];
let body = null;
try {
  body = pb.decodeDeep(buf.subarray(bodyStart, bodyEnd));
  console.log('\n从 offset 20 起可完整解析为 protobuf ✓ 顶层字段数 =', body.length);
} catch (e) {
  console.log('\n从 offset 20 起解析失败:', e.message);
}

if (body) {
  const summary = body.map((f) => ({ field: f.field, wt: f.wt, len: f.len ?? null, children: f.sub ? f.sub.length : null }));
  console.log('顶层字段一览:', JSON.stringify(summary));
  // 顶层 field 1 = Root.graph（repeated GraphUnit）
  const graphs = body.filter((f) => f.field === 1);
  console.log(`\nRoot.graph 条数 = ${graphs.length}`);
  for (const [i, g] of graphs.entries()) {
    const s = g.sub || [];
    const id = pb.msg(s, 1) || pb.tryDecodeMaybe?.(s, 1);
    const name = pb.txt(s, 3);
    const ids = id ? { class: pb.num(id, 2), type: pb.num(id, 3), id: pb.num(id, 4) } : null;
    const ui = pb.msg(s, 19);
    const script = pb.msg(s, 35);
    console.log(
      `  [${i}] name=${JSON.stringify(name)} id=${JSON.stringify(ids)} which=${pb.num(s, 5)} ` +
        `ui=${ui ? `有(${ui.length} 字段)` : '无'} script=${script ? '有' : '无'} 顶层字段=${s.map((f) => f.field).join(',')}`,
    );
  }
  // 其余顶层字段
  for (const f of body) {
    if (f.field === 1) continue;
    console.log(`  其它顶层 field=${f.field} wt=${f.wt} len=${f.len ?? ''} ${f.wt === 2 && f.payload ? JSON.stringify(f.payload.toString('utf8').slice(0, 80)) : ''}`);
  }
}
