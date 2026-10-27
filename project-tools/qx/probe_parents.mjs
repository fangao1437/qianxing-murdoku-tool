// tools/qx/probe_parents.mjs —— 【只读】用存档的扁平 tree[]（带 parentId）回答「谁挂在谁下面」
//
// 为什么不用 root.children：那是嵌套树，模拟器自己也可能与真机不同。
// 扁平 tree[] 带 parentId，是存档里最直接可核对的父子关系。
//
// 跑法：node tools/qx/probe_parents.mjs [存档路径]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const file = process.argv[2] || path.join(root, "sim-save", "murdoku.save.json");

const j = JSON.parse(fs.readFileSync(file, "utf8"));
const tree = j.tree;
if (!Array.isArray(tree)) {
  console.log("没有扁平 tree[]，键：", Object.keys(j).join(","));
  process.exit(0);
}

const byId = new Map();
for (const n of tree) byId.set(n.id, n);

function chain(id) {
  const out = [];
  let cur = id;
  let guard = 0;
  while (cur != null && guard++ < 40) {
    const n = byId.get(cur);
    if (!n) {
      out.push(`<${cur} 不在表里>`);
      break;
    }
    out.push(`${n.name}[${n.kind}${n.guid ? " g" + n.guid : ""}]`);
    cur = n.parentId;
  }
  return out;
}

console.log("== tree[] 大小 ==", tree.length);
console.log("\n== 顶层节点（parentId == null） ==");
for (const n of tree.filter((x) => x.parentId == null)) {
  console.log(`  ${n.name}  kind=${n.kind}  guid=${n.guid}  depth=${n.depth}  子=${n.childCount}`);
}

const WANT = ["assets", "root", "home", "topbar", "clues", "portrait.A", "portrait.V", "tray", "stage", "111", "tpl.cell", "tpl.stage"];
console.log("\n== 关键名字：完整父链（从自己到最顶） ==");
for (const w of WANT) {
  const hits = tree.filter((n) => n.name === w);
  if (!hits.length) {
    console.log(`  ${w.padEnd(12)} → **不在 tree[] 里**`);
    continue;
  }
  for (const h of hits) {
    const c = chain(h.id);
    console.log(`  ${w.padEnd(12)} → ${c.join("  ←  ")}   (depth=${h.depth}, parentId=${h.parentId}, kind=${h.kind})`);
  }
}

// "容器节点" 的直接子控件全列出来 —— 这就是 assets 与 root 的真实相对位置
const wrap = tree.filter((n) => n.name === "容器节点");
console.log("\n== 名为「容器节点」的节点及其直接子控件 ==");
for (const w of wrap) {
  console.log(`  ${w.name}  id=${w.id} guid=${w.guid} 子=${w.childCount}`);
  for (const k of tree.filter((x) => x.parentId === w.id)) {
    console.log(`    - ${String(k.name).padEnd(22)} kind=${String(k.kind).padEnd(10)} guid=${k.guid}  子=${k.childCount}`);
  }
}

// root 的直接子控件
console.log("\n== root 的直接子控件 ==");
for (const r of tree.filter((n) => n.name === "root")) {
  console.log(`  root id=${r.id} guid=${r.guid} 子=${r.childCount}`);
  for (const k of tree.filter((x) => x.parentId === r.id)) {
    console.log(`    - ${String(k.name).padEnd(22)} kind=${String(k.kind).padEnd(10)} guid=${k.guid}  子=${k.childCount}`);
  }
}

// assets 的直接子控件 + 它们的图片字段（控件类图片的 imageId 在 inspector 里）
console.log("\n== assets 的直接子控件 ==");
for (const a of tree.filter((n) => n.name === "assets")) {
  console.log(`  assets id=${a.id} guid=${a.guid} 子=${a.childCount}`);
  for (const k of tree.filter((x) => x.parentId === a.id)) {
    console.log(`    - ${String(k.name).padEnd(22)} kind=${String(k.kind).padEnd(10)} guid=${k.guid}`);
  }
}

// 脚本清单
console.log("\n== 脚本清单 ==");
const scr = j.scripts;
if (Array.isArray(scr)) {
  for (const s of scr) {
    const src = typeof s.source === "string" ? s.source : "";
    console.log(`  ${JSON.stringify({ name: s.name, path: s.path, controlId: s.controlId, mount: s.mount, sourceLen: src.length })}`);
  }
} else console.log("  没有 scripts[]");

console.log("\n== mountTargets（脚本挂载目标） ==");
const mt = j.mountTargets;
if (Array.isArray(mt)) console.log("  " + JSON.stringify(mt).slice(0, 2000));
else console.log("  没有 mountTargets");
