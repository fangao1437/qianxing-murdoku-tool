import { readGil, pairOf, pairValue, stateBlocks } from "./gilread.mjs";
const g = readGil("554-教程抽屉-v334.gil");
for (const name of ["teach.l1", "teach.l1.page", "teach.l1.btn.prev", "teach.text.l1.title", "teach.text.l1.subtitle", "teach.text.l1.body.1"]) {
  const r = g.recs.find((x) => x.name === name);
  if (!r) { console.log(name, "MISSING"); continue; }
  const bl = [];
  stateBlocks(r.field.sub, bl);
  const ps = [];
  for (const b of bl) { const p = pairOf(b, 504); if (p) ps.push([pairValue(p, 0), pairValue(p, 1)]); }
  console.log(name, "blocks", bl.length, "pos", JSON.stringify(ps));
}
