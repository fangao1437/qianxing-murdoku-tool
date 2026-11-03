// tools/dbg1.mjs
import fs from 'node:fs';
import * as pb from './pb.mjs';
const IN = process.argv[2];
const buf = fs.readFileSync(IN);
const bodyLen = buf.readUInt32BE(16);
const root = pb.decodeDeep(buf.subarray(20, 20 + bodyLen));
const u = pb.msgs(root, 2)[6];
console.log('unit fields:', u.sub.map((f) => f.field));
const uiNode = pb.msg(u.sub, 19);
console.log('uiNode type:', Array.isArray(uiNode) ? 'array' : typeof uiNode, uiNode && Object.keys(uiNode));
const content = uiNode && uiNode.sub ? pb.msg(uiNode.sub, 1) : null;
console.log('content fields:', content ? content.map((f) => f.field) : null);
if (content) {
  console.log('#504 varints:', content.filter((f) => f.field === 504).map((f) => `${f.wt}:${f.num}`));
  console.log('#503:', content.filter((f) => f.field === 503).map((f) => `wt=${f.wt} len=${f.len} sub=${!!f.sub}`));
}
