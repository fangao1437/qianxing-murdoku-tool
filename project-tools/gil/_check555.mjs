import { readGil, pairOf, pairValue, stateBlocks } from "./gilread.mjs";
const file = process.argv[2] || "555-教程卡面-v335.gil";
const g = readGil(file);
const names = ["teach.l1", "teach.l1.page", "teach.l1.clue", "teach.l1.btn.prev", "teach.l1.btn.close",
  "teach.text.l1.title", "teach.text.l1.subtitle", "teach.text.l1.body.1", "teach.text.l1.body.2", "teach.text.l1.body.3"];
for (const name of names) {
  const r = g.recs.find((x) => x.name === name);
  if (!r) { console.log(name, "MISSING"); continue; }
  const bl = [];
  stateBlocks(r.field.sub, bl);
  const ps = [];
  for (const b of bl) { const p = pairOf(b, 504); if (p) ps.push([pairValue(p, 0), pairValue(p, 1)]); }
  console.log(name, "blocks", bl.length, "pos", JSON.stringify(ps));
}
