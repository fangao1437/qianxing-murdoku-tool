// 一次性生成教程棋盘内容物：格子 + 头像（克隆图片控件，父亲挂到 teach.<t>）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readGil, encodeMsg, cloneField, findChildListTop, asIdList, setChildList,
  stateBlocks, pairOf, setPair, bigIds, textsOf,
} from "./gilread.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const P = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const IN = P(process.argv[2] || "558-教程宽版-v338.gil");
const OUT = P(process.argv[3] || "_tmp-board.gil");

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
  const proto = byName.get(protoName);
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
  if (!cl) {
    cl = { field: 503, wt: 2, sub: [], payload: Buffer.alloc(0), len: 0, s1: 0 };
    parent.field.sub.push(cl);
  }
  const ids = (asIdList(cl.payload, true) || []).map(Number);
  ids.push(nid);
  setChildList(cl, ids);

  byName.set(newName, { name: newName, id: nid, field: cf, parentId: parent.id });
  return nid;
}

const LEVELS = [
  { tag: "l1", rows: 5, cols: 5, pitch: 84, size: 80, av: 64,
    grid: ["00011", "00011", "00011", "22221", "22221"],
    avatars: [["A", 3, 1, "face.1.1"], ["B", 2, 2, "face.1.2"], ["C", 5, 4, "face.1.3"], ["D", 1, 3, "face.1.4"], ["V", 4, 5, "face.1.5"]] },
  { tag: "l2", rows: 6, cols: 6, pitch: 68, size: 64, av: 52,
    grid: ["000011", "000011", "000011", "222331", "222333", "222233"],
    avatars: [["A", 5, 2, "face.2.1"], ["B", 1, 1, "face.2.2"], ["C", 4, 5, "face.2.3"], ["D", 2, 4, "face.2.4"], ["E", 6, 3, "face.2.5"], ["V", 3, 6, "face.2.6"]] },
];

const boardCX = 1100, boardCY = 460;
let made = 0;
for (const L of LEVELS) {
  const protoCell = "teach." + L.tag + ".clue";
  const protoRoot = "teach." + L.tag;
  for (let r = 0; r < L.rows; r++) {
    for (let c = 0; c < L.cols; c++) {
      const cx = boardCX + (c + 1 - (L.cols + 1) / 2) * L.pitch;
      const cy = boardCY + (r + 1 - (L.rows + 1) / 2) * L.pitch;
      cloneOne(protoCell, protoRoot, protoRoot + ".board." + (r + 1) + "." + (c + 1), L.size, L.size, cx - 800, 450 - cy);
      made++;
    }
  }
  for (const [who, r, c, faceProto] of L.avatars) {
    const cx = boardCX + (c - (L.cols + 1) / 2) * L.pitch;
    const cy = boardCY + (r - (L.rows + 1) / 2) * L.pitch;
    cloneOne(faceProto, protoRoot, protoRoot + ".av." + who, L.av, L.av, cx - 800, 450 - cy);
    made++;
  }
}

fs.writeFileSync(OUT, g.pack(encodeMsg(g.tree)));
console.log("made", made, "controls; records", g.recs.length + made, "maxId", maxId.toString());
console.log("wrote", path.basename(OUT), fs.statSync(OUT).size);
