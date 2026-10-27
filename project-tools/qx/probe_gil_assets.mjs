// tools/qx/probe_gil_assets.mjs —— 【只读】在真机导出的 .gil 里核对 assets / root / portrait.* 的父子关系
//
// 只读：readGil 只解析、不写盘。绝不产出新 .gil。
//
// 跑法：node tools/qx/probe_gil_assets.mjs [gil 文件名]

import { readGil } from "../gil/gilread.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "..", "..");

const want = process.argv[2] || "222-调色板-修正.gil";
const file = path.isAbsolute(want) ? want : path.join(project, want);
if (!fs.existsSync(file)) {
  console.log("找不到文件：", file);
  process.exit(1);
}

const g = readGil(file);
console.log("== 文件 ==", path.basename(file), " 记录数 =", g.recs.length);

const byId = new Map(g.recs.map((r) => [r.id, r]));

function chain(id) {
  const out = [];
  let cur = id;
  let guard = 0;
  while (cur != null && guard++ < 40) {
    const r = byId.get(cur);
    if (!r) {
      out.push(`<id ${cur} 不在记录表>`);
      break;
    }
    out.push(`${r.name || "(无名)"}[id=${r.id}]`);
    cur = r.parentId;
  }
  return out;
}

const NAMES = ["assets", "root", "home", "topbar", "clues", "stage", "tray", "111", "容器节点"];
console.log("\n== 关键名字的父链（自己 → 顶） ==");
for (const n of NAMES) {
  const hits = g.recs.filter((r) => String(r.name || "") === n);
  if (!hits.length) {
    console.log(`  ${n.padEnd(10)} → **记录里没有这个名字**`);
    continue;
  }
  for (const h of hits) {
    console.log(`  ${n.padEnd(10)} → ${chain(h.id).join("  ←  ")}`);
  }
}

console.log("\n== 名字含 portrait / assets 的记录 ==");
for (const r of g.recs.filter((x) => /portrait|assets/i.test(String(x.name || "")))) {
  const p = byId.get(r.parentId);
  console.log(`  ${String(r.name).padEnd(16)} id=${String(r.id).padEnd(10)} 父id=${r.parentId} 父名=${p ? p.name : "(无/不在表)"}`);
}

// root 的直接子控件
const roots = g.recs.filter((r) => String(r.name || "") === "root");
console.log("\n== root 的直接子控件 ==");
for (const rt of roots) {
  const kids = g.recs.filter((r) => r.parentId === rt.id);
  console.log(`  root id=${rt.id}  直接子控件 ${kids.length} 个：`);
  console.log("    " + kids.map((k) => k.name || "(无名)").join(" / "));
}
