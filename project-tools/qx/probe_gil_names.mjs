// tools/qx/probe_gil_names.mjs —— 【只读】扫一批 .gil，看每个档里**有哪些关键控件名**
//
// 用途：把"真机日志里出现过的名字"与"各个 .gil 档里的名字"对齐，
//   判断**那份失败日志到底是哪一版存档测出来的**。
//
//   ★ 动机：真机日志的 `常驻光标回读` 里有 `tray` / `left` / `board` / `intro` / `select`，
//     而当前编辑器截图里 `root` 只有 10 个子控件（assets clues tpl.cell tpl.stage stage home
//     topbar right toolbar modal）—— 如果这些名字在某些档里根本没有，那日志就不是那一版测的。
//
// 只读：readGil 只解析；不 pack、不写盘。
//
// 跑法：node tools/qx/probe_gil_names.mjs [gil1 gil2 ...]（不传则扫一批默认档）

import { readGil } from "../gil/gilread.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "..", "..");

const DEFAULT = [
  "218.1.gil", "219-调色板.gil", "222-调色板-修正.gil",
  "214.3.gil", "217-调色板.gil", "215-灰白卡基准.gil", "208.2-新基准.gil",
];
const files = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT);

// 真机日志里出现过的名字 + 编辑器截图里 root 的 10 个子控件
const WATCH = ["assets", "root", "modal", "clues", "topbar", "home", "stage", "right", "toolbar",
  "tpl.cell", "tpl.stage", "portrait.V", "row.1.1", "left", "tray", "board", "intro", "select", "111"];

console.log("档名".padEnd(26) + "记录数  " + WATCH.map((w) => w.slice(0, 6).padEnd(7)).join(""));
console.log("-".repeat(26 + 8 + WATCH.length * 7));
for (const f of files) {
  const full = path.isAbsolute(f) ? f : path.join(project, f);
  if (!fs.existsSync(full)) { console.log(String(f).padEnd(26) + "（文件不存在）"); continue; }
  let g;
  try { g = readGil(full); } catch (e) { console.log(String(f).padEnd(26) + "解析失败：" + e.message); continue; }
  const have = new Set(g.recs.map((r) => String(r.name || "")));
  const cells = WATCH.map((w) => (have.has(w) ? "  ✓    " : "  ·    "));
  console.log(path.basename(f).padEnd(26) + String(g.recs.length).padEnd(8) + cells.join(""));
}
console.log("\n（✓ = 该档里有这个控件名；· = 没有）");
console.log("★ 读法：若某档**没有 tray/left/board/intro/select**，那份出现了这些名字的真机日志就**不是**这一版测的。");
