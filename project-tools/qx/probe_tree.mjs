// tools/qx/probe_tree.mjs —— 【只读】把模拟器存档里的控件树层级 + 脚本清单打印出来
//
// 用途：回答「assets 到底挂在谁下面」「有哪些脚本被挂载」这两个结构问题。
// 绝不写盘：只 fs.readFileSync + console.log。
//
// 跑法：node tools/qx/probe_tree.mjs [存档路径]
// 默认：sim-save/murdoku.save.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const file = process.argv[2] || path.join(root, "sim-save", "murdoku.save.json");

const raw = fs.readFileSync(file, "utf8");
const j = JSON.parse(raw);

console.log("== 文件 ==");
console.log(file, "  ", raw.length, "字节");
console.log("\n== 顶层键 ==");
console.log(Object.keys(j).join(", "));

// ---- 找嵌套的控件树（哪个对象带 children 且看起来是控件）----
function looksLikeControl(n) {
  return n && typeof n === "object" && (typeof n.name === "string" || Array.isArray(n.children));
}
function findTrees(obj, pathStr, out, depth) {
  if (depth > 4 || obj == null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    if (obj.length && looksLikeControl(obj[0])) out.push({ path: pathStr, arr: obj });
    return;
  }
  for (const k of Object.keys(obj)) {
    findTrees(obj[k], pathStr ? pathStr + "." + k : k, out, depth + 1);
  }
}

const trees = [];
findTrees(j, "", trees, 0);
console.log("\n== 候选控件树 ==");
for (const t of trees) console.log("  ", t.path, "→ 顶层节点", t.arr.length, "个");

const chosen = trees.find((t) => t.path.includes("children") || t.arr.length <= 8) || trees[0];
if (!chosen) {
  console.log("没找到控件树，退出。");
  process.exit(0);
}
console.log("\n== 采用 ==", chosen.path);

// ---- 打印层级（深度上限，避免刷屏）----
let total = 0;
const WANT = new Set(["assets", "root", "home", "topbar", "clues", "portrait.A", "portrait.V", "tray", "stage", "111"]);
const hits = [];

function walk(n, prefix, depth) {
  total++;
  const nm = n.name === undefined ? "(无名)" : String(n.name);
  const kind = n.kind || n.type || "?";
  const box = n.box ? ` [${n.box.left},${n.box.bottom} ${n.box.width}x${n.box.height}]` : "";
  const flags = ` vis=${n.visible} act=${n.active} aih=${n.activeInHierarchy}`;
  if (depth <= 3) {
    console.log("  ".repeat(depth) + `- ${nm}  (${kind})${flags}${box}  子=${(n.children || []).length}`);
  }
  hits.push({ path: prefix + "/" + nm, depth, kind, id: n.id, authoringId: n.authoringId, box: n.box, flags });
  for (const c of n.children || []) walk(c, prefix + "/" + nm, depth + 1);
}
for (const r of chosen.arr) walk(r, "", 0);

console.log("\n== 全树节点数 ==", total);

// ---- 逐个关心的名字：打印完整路径链 ----
function chainOf(target) {
  const res = [];
  function dfs(n, chain) {
    const nm = String(n.name);
    const c2 = [...chain, nm];
    if (nm === target) res.push(c2);
    for (const k of n.children || []) dfs(k, c2);
  }
  for (const r of chosen.arr) dfs(r, []);
  return res;
}
console.log("\n== 关键名字的完整路径（从树顶算起）==");
for (const w of WANT) {
  const chains = chainOf(w);
  if (!chains.length) {
    console.log(`  ${w.padEnd(12)} → **不在树里**`);
  } else {
    for (const c of chains) console.log(`  ${w.padEnd(12)} → ${c.join(" / ")}   (深度 ${c.length - 1})`);
  }
}

// ---- assets 的父级是谁 ----
console.log("\n== assets 的父链 ==");
const a = hits.filter((h) => h.path.endsWith("/assets"));
for (const h of a) console.log("  ", h.path, " 深度", h.depth, " kind", h.kind, " id", h.id, " authoringId", h.authoringId);
console.log("\n== root 出现的所有位置 ==");
for (const h of hits.filter((x) => x.path.endsWith("/root"))) {
  console.log("  ", h.path, " 深度", h.depth, " kind", h.kind, " authoringId", h.authoringId);
}

// ---- 脚本清单 ----
console.log("\n== 脚本清单（存档 scripts[]）==");
const scr = j.scripts || j.script || (j.clientAsset && j.clientAsset.scripts);
if (Array.isArray(scr)) {
  for (const s of scr) {
    const src = typeof s.source === "string" ? s.source : "";
    console.log(
      `  name=${s.name}  path=${s.path}  mount=${s.mountControlName || s.controlName || s.controlId || s.host || "?"}  sourceLen=${src.length}`
    );
  }
} else {
  console.log("  找不到 scripts[]（键名：", Object.keys(j).join(","), "）");
}

// ---- 是否存在 111 ----
console.log("\n== 名字含 '111' 的节点 ==");
const n111 = hits.filter((h) => h.path.includes("111"));
console.log(n111.length ? n111.map((h) => h.path).join("\n") : "  （无）");
