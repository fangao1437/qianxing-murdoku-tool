// 只读：列出 553 里的官方素材线索（头像 / 面板底 / 箭头 / 叉 / 页标 / 卡片素材）
import path from "node:path";
import { readGil } from "./gilread.mjs";

const g = readGil(path.resolve("553-三屏教程-v333.gil"));
console.log("records", g.recs.length);
const ser = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x));
const want = /portrait|avatar|face|clues\.|teach\.|select\.|board|cell\.1\.1|card|panel|modal|bg$|arrow|close|dot/i;
const rows = [];
for (const r of g.recs) {
  if (typeof r.name !== "string" || !want.test(r.name)) continue;
  const s = r.field && r.field.sub ? ser(r.field.sub) : "";
  const m = s.match(/"imageId":(\d+)/) || s.match(/"assetId":(\d+)/);
  rows.push({ name: r.name, id: r.id, img: m ? m[1] : "" });
}
const pick = (re) => rows.filter((r) => re.test(r.name)).slice(0, 50);
console.log("\n== portrait/face ==");
for (const r of pick(/portrait|avatar|face/i)) console.log(r.name, r.id, r.img);
console.log("\n== teach ==");
for (const r of pick(/^teach\./)) console.log(r.name, r.id, r.img);
console.log("\n== select/clues/bg/panel ==");
for (const r of pick(/select\.|clues\.|bg$|panel|card/i)) console.log(r.name, r.id, r.img);
