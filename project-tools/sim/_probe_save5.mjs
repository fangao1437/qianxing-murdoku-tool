import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const byId = new Map();
(function w(n) { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach(w); return; }
  if (n.id && n.kind && n.transformByPlatform) byId.set(n.id, n);
  for (const k of Object.keys(n)) w(n[k]); })(j);
const root = byId.get(j.tree.find(r => r.name === "root").id);
const btns = ["hex.back","hex.redo","home.select","home.continue","home.shop","home.bag","select.back","select.prev","select.next","select.card.1","obj.desk"];
for (const nm of btns) {
  const c = root.children.find(x => x.name === nm) || byId.get((j.tree.find(r=>r.name===nm)||{}).id);
  if (!c) { console.log(nm, "不在 root 下"); continue; }
  console.log(nm.padEnd(15), "guids:", (c.children||[]).map(ch => ch.name + "=" + ch.guid).join(" "), " | state ->", c.selectedChildId);
}
// 全局：guid -> 名字
console.log("\n所有 bg 图片控件的 imageId：");
(function w(n) { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach(w); return; }
  if (n.kind === "image" && n.name === "bg") console.log("  ", (n.id||"?"), "guid", n.guid, "imageId", n.imageId, "color", n.imageColor, "size", JSON.stringify(n.transformByPlatform?.KEYBOARD?.size));
  for (const k of Object.keys(n)) w(n[k]); })(j.root);
