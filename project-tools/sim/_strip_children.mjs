import fs from "node:fs";
const SRC = process.argv[2], OUT = process.argv[3], MODE = process.argv[4] || "onlytext";
const j = JSON.parse(fs.readFileSync(SRC, "utf8"));
const byId = new Map();
(function w(n){if(!n||typeof n!=="object")return;if(Array.isArray(n)){n.forEach(w);return;}
  if(n.id&&n.kind&&n.transformByPlatform)byId.set(n.id,n);for(const k of Object.keys(n))w(n[k]);})(j);
const root = byId.get(j.tree.find(r=>r.name==="root").id);
const b = root.children.find(c=>c.name==="settle.btn");
if (MODE === "onlytext") b.children = b.children.filter(c => c.name === "text");
else if (MODE === "nobg") b.children = b.children.filter(c => c.name !== "bg");
else if (MODE === "nolabel") b.children = b.children.filter(c => c.name !== "label");
// state 引用同步指向 text（否则按钮没状态节点）
const txt = b.children.find(c=>c.name==="text");
if (txt) { b.unavailableChildId = txt.id; b.hoverChildId = txt.id; b.pressedChildId = txt.id; b.selectedChildId = txt.id; }
// tree 行也同步
j.tree = j.tree.filter(r => !(r.parentId === b.id && !b.children.some(c => c.id === r.id)));
j.version = (j.version||1)+1;
fs.writeFileSync(OUT, JSON.stringify(j));
console.log("MODE=" + MODE + " → " + OUT + "  settle.btn 子控件: " + b.children.map(c=>c.name).join(",") + "  状态引用=" + b.selectedChildId);
