// 主卡拆两段文本：body.1 = 线索复述（金色），body.1b = 推导（灰）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readGil, encodeMsg, cloneField, findChildListTop, asIdList, setChildList,
  stateBlocks, pairOf, setPair, bigIds, textsOf,
} from "./gilread.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const IN = P(process.argv[2] || "568-教程真染色-v348.gil");
const OUT = P(process.argv[3] || "_tmp-body1b.gil");

const g = readGil(IN);
const byName = new Map();
for (const r of g.recs) if (typeof r.name === "string") byName.set(r.name, r);
let maxId = BigInt(g.maxId);

function holderOf(id) {
  const stack = [g.tree];
  while (stack.length) {
    const arr = stack.pop();
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (f.sub) {
        if ((bigIds(f.sub, [])[0] || {}).num === BigInt(id)) return { arr, index: i };
        stack.push(f.sub);
      }
    }
  }
  return null;
}

function cloneText(protoName, parentName, newName, w, h, x, y) {
  const proto = byName.get(protoName);
  const parent = byName.get(parentName);
  if (!proto || !parent) throw new Error("missing " + protoName + "/" + parentName);
  const cf = cloneField(proto.field);
  const idLeaf = bigIds(cf.sub, [])[0];
  maxId += 1n;
  const nid = Number(maxId);
  idLeaf.num = maxId;
  const t = textsOf(cf.sub, []).find((q) => q.payload && q.payload.toString("utf8") === proto.name);
  if (!t) throw new Error("no name leaf");
  t.payload = Buffer.from(newName, "utf8");
  t.len = t.payload.length;
  const bl = [];
  stateBlocks(cf.sub, bl);
  for (const b of bl) {
    const s = pairOf(b, 505);
    if (s) setPair(s, w, h);
    const p = pairOf(b, 504);
    if (p) setPair(p, x, y);
  }
  const p504 = cf.sub.find((f) => f.field === 504 && f.wt === 0);
  if (p504) p504.num = BigInt(parent.id);
  const hd = holderOf(proto.id);
  hd.arr.splice(hd.index + 1, 0, cf);
  let cl = findChildListTop(parent.field.sub);
  if (!cl) { cl = { field: 503, wt: 2, sub: [], payload: Buffer.alloc(0), len: 0, s1: 0 }; parent.field.sub.push(cl); }
  const ids = (asIdList(cl.payload, true) || []).map(Number);
  ids.push(nid);
  setChildList(cl, ids);
  byName.set(newName, { name: newName, id: nid, field: cf });
}

for (const t of ["home", "l1", "l2"]) {
  cloneText("teach.text." + t + ".body.1", "teach.text." + t, "teach.text." + t + ".body.1b", 714, 110, -310, 52);
}
fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
console.log("records", g.recs.length + 3);
