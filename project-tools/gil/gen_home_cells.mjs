// 首页棋盘 25 格（同第一关房间色）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readGil, encodeMsg, cloneField, findChildListTop, asIdList, setChildList,
  stateBlocks, pairOf, setPair, bigIds, textsOf,
} from "./gilread.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const IN = P(process.argv[2] || "561-教程修复-v341.gil");
const OUT = P(process.argv[3] || "_tmp-home.gil");

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

function cloneOne(protoName, parentName, newName, w, h, x, y) {
  let proto = byName.get(protoName);
  if (proto == null && protoName.includes("/")) {
    const [pn, cn] = protoName.split("/");
    const par = byName.get(pn);
    if (par) {
      const cl = findChildListTop(par.field.sub);
      const ids = cl ? (asIdList(cl.payload, true) || []) : [];
      proto = ids.map((id) => g.recs.find((r) => r.id === Number(id))).find((r) => r && r.name === cn);
    }
  }
  const parent = byName.get(parentName);
  if (!proto) throw new Error("no proto " + protoName);
  if (!parent) throw new Error("no parent " + parentName);
  if (byName.has(newName)) throw new Error("dup " + newName);
  const cf = cloneField(proto.field);
  const idLeaf = bigIds(cf.sub, [])[0];
  maxId += 1n;
  const nid = Number(maxId);
  idLeaf.num = maxId;
  const t = textsOf(cf.sub, []).find((q) => q.payload && q.payload.toString("utf8") === proto.name);
  if (!t) throw new Error("no name leaf " + protoName);
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
  byName.set(newName, { name: newName, id: nid, field: cf, parentId: parent.id });
}

const grid = ["00011", "00011", "00011", "22221", "22221"];
const pitch = 84, size = 80, cx = 1100, cy = 460;
let made = 0;
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    const x = cx + (c + 1 - 3) * pitch;
    const y = cy + (r + 1 - 3) * pitch;
    cloneOne("teach.home.clue", "teach.home", "teach.home.board." + (r + 1) + "." + (c + 1), size, size, x - 800, 450 - y);
    made++;
  }
}
fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
console.log("made", made, "records", g.recs.length + made);
