import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
// 真正的控件 = 有 id + kind + transformByPlatform
const byId = new Map();
(function w(n) { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach(w); return; }
  if (n.id && n.kind && n.transformByPlatform) byId.set(n.id, n);
  for (const k of Object.keys(n)) w(n[k]); })(j);
const rootTop = j.tree.find(r => r.name === "root");
const root = byId.get(rootTop.id);
console.log("root id", root.id, "kind", root.kind, "children", (root.children||[]).length);
const hs = root.children.find(c => c.name === "home.select");
console.log("home.select:", JSON.stringify({id: hs.id, guid: hs.guid, kind: hs.kind, off: hs.transformByPlatform.KEYBOARD.offset,
  size: hs.transformByPlatform.KEYBOARD.size, children: (hs.children||[]).map(x => ({name:x.name,id:x.id,guid:x.guid,kind:x.kind,
  off:x.transformByPlatform?.KEYBOARD?.offset, size:x.transformByPlatform?.KEYBOARD?.size, text:x.text}))}, null, 1));
const stage = root.children.find(c => c.name === "stage");
console.log("stage:", JSON.stringify({id: stage.id, off: stage.transformByPlatform.KEYBOARD.offset, size: stage.transformByPlatform.KEYBOARD.size, kids:(stage.children||[]).length}));
const cell = (stage.children||[])[0];
console.log("cell.1.1:", JSON.stringify({id: cell.id, guid: cell.guid, kind: cell.kind, off: cell.transformByPlatform.KEYBOARD.offset,
  size: cell.transformByPlatform.KEYBOARD.size, children: (cell.children||[]).map(x => ({name:x.name,guid:x.guid,kind:x.kind,off:x.transformByPlatform?.KEYBOARD?.offset,size:x.transformByPlatform?.KEYBOARD?.size}))}, null, 1));
console.log("root 子控件名单:", (root.children||[]).map(c=>c.name).join(","));
