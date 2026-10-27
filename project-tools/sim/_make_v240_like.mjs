// tools/sim/_make_v240_like.mjs —— 把 v215 存档改造成"v240 那样"：在 root 末尾追加 settle.btn
// （几何取自 371-结算按钮-v240.gil：pos[-642,-380] size[217x60]；子控件 bg/label 与原存档按钮同构）
import fs from "node:fs";

const SRC = process.argv[2];
const OUT = process.argv[3];
const j = JSON.parse(fs.readFileSync(SRC, "utf8"));
const byId = new Map();
(function w(n) { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach(w); return; }
  if (n.id && n.kind && n.transformByPlatform) byId.set(n.id, n);
  for (const k of Object.keys(n)) w(n[k]); })(j);
const root = byId.get(j.tree.find(r => r.name === "root").id);

// 用 home.select 当原型（连 text/bg/label 三个子控件一起）
const proto = root.children.find(c => c.name === "home.select");
const clone = JSON.parse(JSON.stringify(proto));
let n = 900000;
const reid = (o) => { o.id = "x" + (n++); return o; };
reid(clone);
if (clone.children) for (const c of clone.children) reid(c);
clone.name = "settle.btn";
clone.visible = true;
clone.transformByPlatform.KEYBOARD.offset = { x: -642, y: -380 };
clone.transformByPlatform.KEYBOARD.size = { x: 217, y: 60 };
for (const ch of (clone.children || [])) {
  ch.transformByPlatform.KEYBOARD.offset = { x: 0, y: 0 };
  ch.transformByPlatform.KEYBOARD.size = { x: ch.name === "label" ? 197 : 217, y: ch.name === "label" ? 20 : 60 };
  if (ch.name === "label") ch.text = "结算";
  if (ch.name === "text") { ch.text = "结算"; ch.transformByPlatform.KEYBOARD.size = { x: 217, y: 60 }; }
}
root.children.push(clone);
// tree 也加一行
j.tree.push({ id: clone.id, guid: 0, kind: "button", name: "settle.btn", label: "预设按钮", depth: 3,
  parentId: root.id, ancestorIds: [j.tree[0].id, j.tree[1].id, root.id], siblingIndex: root.children.length - 1,
  siblingCount: root.children.length, templateId: j.tree[0].id, childCount: (clone.children||[]).length, incomplete: false });
for (const c of (clone.children || [])) {
  j.tree.push({ id: c.id, guid: 0, kind: c.kind, name: c.name, label: c.kind === "image" ? "图片" : "文本框",
    depth: 4, parentId: clone.id, ancestorIds: [j.tree[0].id, j.tree[1].id, root.id, clone.id],
    siblingIndex: 0, siblingCount: (clone.children||[]).length, templateId: j.tree[0].id, childCount: 0, incomplete: false });
}
j.version = (j.version || 1) + 1;
fs.writeFileSync(OUT, JSON.stringify(j));
console.log("写出 " + OUT + "  root 子控件 " + root.children.length + " 个，追加 settle.btn#" + clone.id);
