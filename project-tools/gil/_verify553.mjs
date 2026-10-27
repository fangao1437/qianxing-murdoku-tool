// 临时校验：内嵌脚本是否包含教程内容 / 标记 / teach 控件（只读，不改档）
import path from "node:path";
import { readGil } from "./gilread.mjs";
import { findScriptLeaf, markerOf } from "./gilwrite.mjs";

const file = process.argv[2] || "555-教程卡面-v335.gil";
const g = readGil(path.resolve(file));
console.log("file:", file, "records:", g.recs.length, "maxId:", g.maxId);
const leaf = findScriptLeaf(g);
if (!leaf) { console.log("NO SCRIPT LEAF"); process.exit(1); }
const txt = leaf.buf.toString("utf8");
console.log("script chars:", txt.length, "marker:", markerOf(leaf.buf));
for (const key of ["玩法总览", "轻点＝笔记", "双击＝预放置", "线索卡底板", "M.CONTENT", "卡 1（值班保安）", "已确定：B→(2,2)"]) {
  console.log(key, txt.includes(key) ? "FOUND" : "MISS");
}
const teach = g.recs.filter((r) => typeof r.name === "string" && (r.name === "teach" || r.name.startsWith("teach.")));
console.log("teach controls:", teach.length);
for (const n of ["teach.home.clue", "teach.l1.clue", "teach.l2.clue"]) {
  const r = g.recs.find((x) => x.name === n);
  console.log(n, r ? "OK id=" + r.id : "MISSING");
}
