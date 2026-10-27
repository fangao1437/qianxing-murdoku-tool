// v340：首页 5 块分区卡 + 三套图例行（图标 + 文本）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readGil, encodeMsg, cloneField, findChildListTop, asIdList, setChildList,
  stateBlocks, pairOf, setPair, bigIds, textsOf,
} from "./gilread.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const IN = P(process.argv[2] || "559-教程棋盘-v339.gil");
const OUT = P(process.argv[3] || "_tmp-cards.gil");

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
  if (byName.has(newName)) throw new Error("dup name " + newName);
  const cf = cloneField(proto.field);
  const idLeaf = bigIds(cf.sub, [])[0];
  if (!idLeaf) throw new Error("no id leaf " + protoName);
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
  return nid;
}

const px = (sx) => sx - 800;
const py = (sy) => 450 - sy;

// ── 首页 5 块分区卡 ─────────────────────────────────────────────────────────
const CARDS = [
  { i: 1, cx: 275, cy: 305, w: 370 },
  { i: 2, cx: 665, cy: 305, w: 370 },
  { i: 3, cx: 275, cy: 427, w: 370 },
  { i: 4, cx: 665, cy: 427, w: 370 },
  { i: 5, cx: 470, cy: 549, w: 760 },
];
let made = 0;
for (const C of CARDS) {
  const base = "teach.home.card." + C.i;
  const h = 110;
  const half = C.w / 2;
  cloneOne("teach.home.page/bg", "teach.home", base, C.w, h, px(C.cx), py(C.cy)); made++;
  cloneOne("teach.home.clue", "teach.home", base + ".badge", 30, 30,
    px(C.cx - half + 30), py(C.cy - h / 2 + 26)); made++;
  cloneOne("teach.text.home.body.1", "teach.text.home", "teach.text.home.card." + C.i + ".num", 40, 22,
    px(C.cx - half + 30), py(C.cy - h / 2 + 26)); made++;
  cloneOne("teach.text.home.body.1", "teach.text.home", "teach.text.home.card." + C.i + ".title", C.w - 76, 26,
    px(C.cx + 10), py(C.cy - h / 2 + 28)); made++;
  cloneOne("teach.text.home.body.1", "teach.text.home", "teach.text.home.card." + C.i + ".body", C.w - 76, h - 52,
    px(C.cx + 10), py(C.cy + 8)); made++;
}

// ── 三套图例行：9 行 ×（图标 + 文本）──────────────────────────────────────
const SETS = ["home", "l1", "l2"];
for (const t of SETS) {
  for (let i = 1; i <= 9; i++) {
    const y = 300 + (i - 1) * 30;
    cloneOne("teach." + t + ".clue", "teach." + t, "teach." + t + ".legend." + i + ".icon", 14, 14, px(1332), py(y)); made++;
    cloneOne("teach.text." + t + ".body.1", "teach.text." + t, "teach.text." + t + ".legend." + i, 172, 22, px(1352), py(y)); made++;
  }
}

fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
console.log("made", made, "controls; records", g.recs.length + made, "maxId", maxId.toString());
console.log("wrote", path.basename(OUT), fs.statSync(OUT).size);
