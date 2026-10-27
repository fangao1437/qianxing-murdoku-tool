import fs from "node:fs";
const SRC = process.argv[2], OUT = process.argv[3], MODE = process.argv[4] || "noray";
const j = JSON.parse(fs.readFileSync(SRC, "utf8"));
const byId = new Map();
(function w(n){if(!n||typeof n!=="object")return;if(Array.isArray(n)){n.forEach(w);return;}
  if(n.id&&n.kind&&n.transformByPlatform)byId.set(n.id,n);for(const k of Object.keys(n))w(n[k]);})(j);
const root = byId.get(j.tree.find(r=>r.name==="root").id);
const b = root.children.find(c=>c.name==="settle.btn");
if (MODE === "noray") b.raycastTarget = false;
if (MODE === "invisible") b.visible = false;
if (MODE === "both") { b.raycastTarget = false; b.visible = false; }
j.version = (j.version||1)+1;
fs.writeFileSync(OUT, JSON.stringify(j));
console.log(MODE + " → raycastTarget=" + b.raycastTarget + " visible=" + b.visible);
