import fs from "node:fs";
const j = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const names = process.argv.slice(3);
const byName = new Map();
let rootNode = null;
(function walk(n, path) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { for (const x of n) walk(x, path); return; }
  if (n.id && n.kind && n.name) byName.set(n.name, n);
  if (n.name === "root" && n.kind === "container") rootNode = rootNode || n;
  for (const k of Object.keys(n)) walk(n[k], path + "/" + k);
})(j);
const H = j.root; // top server container
console.log("holder name:", H.name, H.kind, "children:", (H.children||[]).length);
for (const nm of names) {
  const n = byName.get(nm);
  if (!n) { console.log(nm, "= 不在"); continue; }
  const c = n.children && n.children.find(x => x.name === "label");
  console.log(nm, JSON.stringify({ id: n.id, kind: n.kind, guid: n.guid,
    off: n.transformByPlatform?.KEYBOARD?.offset, size: n.transformByPlatform?.KEYBOARD?.size,
    children: (n.children||[]).map(x => x.name), labelText: c ? c.text : null }));
}
