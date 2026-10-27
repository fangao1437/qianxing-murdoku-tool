// 把 teach.* 全部控件的几何按比例缩小（围绕各自父级中心）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readGil, encodeMsg, stateBlocks, pairOf, pairValue, setPair } from "./gilread.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const IN = P(process.argv[2]);
const OUT = P(process.argv[3]);
const K = Number(process.argv[4] || 0.94);
const g = readGil(IN);
let n = 0;
for (const r of g.recs) {
  if (typeof r.name !== "string" || !r.name.startsWith("teach") || r.name === "teach") continue;
  const bl = [];
  stateBlocks(r.field.sub, bl);
  for (const b of bl) {
    const p = pairOf(b, 504);
    if (p) setPair(p, Math.round(pairValue(p, 0) * K), Math.round(pairValue(p, 1) * K));
    const s = pairOf(b, 505);
    if (s) setPair(s, Math.max(1, Math.round(pairValue(s, 0) * K)), Math.max(1, Math.round(pairValue(s, 1) * K)));
  }
  n++;
}
fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
console.log("scaled", n, "controls by", K, "->", path.basename(OUT));
