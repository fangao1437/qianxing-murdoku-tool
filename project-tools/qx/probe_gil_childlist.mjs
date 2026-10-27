// tools/qx/probe_gil_childlist.mjs —— 【只读】用**权威方向**核对父子：谁的「顶层子列表」里含某个 id
//
// 为什么不用 rec.parentId：gilread.mjs 自己写着它是
//   「记录里第一个 varint 形式的 #504」—— 这是**启发式**，可能命中嵌套里的巧合字段
//   （task-1 明确警告过："这个 gil 的层级不能按字段号下钻"）。
// 而 rec.childList = findChildListTop(...)（只认记录顶层、payload 能整段解析成 ID 列表）
//   才是"引擎自己写的子控件列表" ⇒ 用它做反向查询是可核对的。
//
// 只读：readGil 只解析；本脚本不调用 pack / 不写盘。
//
// 跑法：node tools/qx/probe_gil_childlist.mjs [gil] [目标名字...]

import { readGil, asIdList } from "../gil/gilread.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "..", "..");

const argv = process.argv.slice(2);
const gilName = argv[0] || "222-调色板-修正.gil";
const targets = argv.length > 1 ? argv.slice(1) : ["assets", "root", "home", "portrait.V", "111", "clues", "stage"];
const file = path.isAbsolute(gilName) ? gilName : path.join(project, gilName);
if (!fs.existsSync(file)) { console.log("找不到：", file); process.exit(1); }

const g = readGil(file);
console.log("== 文件 ==", path.basename(file), " 记录数 =", g.recs.length, " 最大 id =", g.maxId);
console.log("== 记录数最多的 holder 是否就是 recHolder ==", g.recs.filter((r) => r.holder === g.recHolder).length, "/", g.recs.length);

// 建一张"谁的子列表里有我"的反查表
const parentOf = new Map(); // 子id -> [父记录...]
for (const r of g.recs) {
  if (!r.childList) continue;
  const ids = asIdList(r.childList.payload, true) || [];
  for (const id of ids) {
    if (!parentOf.has(id)) parentOf.set(id, []);
    parentOf.get(id).push(r);
  }
}
const byId = new Map(g.recs.map((r) => [r.id, r]));

console.log("\n== 关键名字：由「谁的子列表含我」推出的父 ==");
for (const nm of targets) {
  const hits = g.recs.filter((r) => String(r.name || "") === nm);
  if (!hits.length) { console.log(`  ${nm.padEnd(12)} → **不存在这个名字**`); continue; }
  for (const h of hits) {
    const ps = parentOf.get(h.id) || [];
    const childIds = h.childList ? (asIdList(h.childList.payload, true) || []) : null;
    console.log(
      `  ${nm.padEnd(12)} id=${String(h.id).padEnd(11)} 子列表=${childIds === null ? "无顶层列表" : childIds.length + " 个"}`
      + `  父(权威)=${ps.length ? ps.map((p) => `${p.name}(id=${p.id})`).join(" + ") : "**没有任何记录的子列表含它**"}`
    );
    if (h.parentId != null) {
      const hp = byId.get(h.parentId);
      const agree = ps.some((p) => p.id === h.parentId);
      console.log(`  ${" ".repeat(12)} 启发式 parentId=${h.parentId}(${hp ? hp.name : "不在表"}) 与权威${agree ? "一致 ✓" : "**不一致 ✗**"}`);
    }
    if (childIds && childIds.length) {
      console.log(`  ${" ".repeat(12)} 它的子：` + childIds.map((c) => (byId.get(c) || {}).name || `?${c}`).join(" / "));
    }
  }
}

console.log("\n== 各名字的记录 id 一览（看谁是新加的） ==");
for (const nm of targets) {
  const hits = g.recs.filter((r) => String(r.name || "") === nm);
  for (const h of hits) console.log(`  ${String(h.id).padEnd(11)}  ${nm}`);
}

console.log("\n== 顶层（无人认领为子）的记录 ==");
for (const r of g.recs) {
  const ps = parentOf.get(r.id) || [];
  if (ps.length === 0) console.log(`  id=${String(r.id).padEnd(11)} name=${r.name} parentId=${r.parentId} 子=${r.childList ? (asIdList(r.childList.payload, true) || []).length : "无"}`);
}

console.log("\n== assets 记录的结构剖面（和 root/home 对比） ==");
for (const nm of ["assets", "home", "root", "modal"]) {
  const r = g.recs.find((x) => String(x.name || "") === nm);
  if (!r) continue;
  const top = r.field.sub;
  console.log(`  ${nm}: 顶层字段号 = [${top.map((f) => f.field + (f.wt === 2 ? ":m" : f.wt === 0 ? ":v" : ":" + f.wt)).join(" ")}]`);
  console.log(`     #503(子列表)? ${r.childList ? "有，len=" + r.childList.len : "**无**"}   states(状态块)=${r.states.length}   names=${JSON.stringify(r.names)}`);
}
