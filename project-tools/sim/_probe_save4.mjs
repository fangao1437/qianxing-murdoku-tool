import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const byId = new Map();
(function w(n) { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach(w); return; }
  if (n.id && n.kind && n.transformByPlatform) byId.set(n.id, n);
  for (const k of Object.keys(n)) w(n[k]); })(j);
const root = byId.get(j.tree.find(r => r.name === "root").id);
for (const nm of ["home.select", "hex.redo", "select.back", "home.continue"]) {
  const c = root.children.find(x => x.name === nm);
  console.log(nm, JSON.stringify({ state: { un: c.unavailableChildId, hov: c.hoverChildId, pre: c.pressedChildId, sel: c.selectedChildId },
    raycastTarget: c.raycastTarget, interactable: c.interactable, clickAudioId: c.clickAudioId, giaRaw: c.giaRaw,
    keys: Object.keys(c) }, null, 0));
}
// 顶层 boxes 里有没有 1600x900 的控件
const big = [];
for (const b of (j.boxes || [])) if ((b.width||0) * (b.height||0) > 200000) big.push({ id: b.id, name: b.name, kind: b.kind, left: b.left, bottom: b.bottom, w: b.width, h: b.height, visible: b.visible });
console.log("大控件(>200000 px^2):", JSON.stringify(big));
