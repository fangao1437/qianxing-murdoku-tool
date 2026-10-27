// tools/qx/probe_gil_flags.mjs —— 【只读】把各控件记录 `#505` 状态块里的**标量（varint）叶子**逐个列出来对比
//
// 动机（来自 probe_gil_diff.mjs 的一次实测）：
//   assets 与 home 结构几乎同构，但只有 2 处差异，其中一处是
//     home 有 1 个 `/505/503/14/17/#503` (varint)，而 assets **没有**。
//   ★ protobuf 是**稀疏编码**：值为 0/false 的字段**根本不写** ★
//   ⇒ 「home 有这个字段、assets 没有」很可能就是「home=true、assets=false」。
//   如果那个字段是「初始激活 / 初始可见」之类的开关，这就是 assets 在运行时不见的原因。
//
// 本脚本把这件事**量出来**：对每个名字，逐 `#505` 块列出所有 varint 叶子（路径=值），
// 再把 assets 与基准容器做差集。只读，不 pack、不写盘。
//
// 跑法：node tools/qx/probe_gil_flags.mjs [gil] [基准名]

import { readGil } from "../gil/gilread.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "..", "..");
const argv = process.argv.slice(2);
const gilName = argv[0] || "222-调色板-修正.gil";
const base = argv[1] || "home";
const file = path.isAbsolute(gilName) ? gilName : path.join(project, gilName);
if (!fs.existsSync(file)) { console.log("找不到：", file); process.exit(1); }

const g = readGil(file);
console.log("== 文件 ==", path.basename(file), " 记录数 =", g.recs.length);

// 收集一条记录里、按 `#505` 块分组的 varint 叶子： blocks[i] = [{p:'/503/14/17/503', v:1}, ...]
function varintLeaves(fields, prefix, out) {
  for (const f of fields) {
    const p = prefix + "/" + f.field;
    if (f.wt === 0) out.push({ p, v: Number(f.num) });
    else if (f.sub) varintLeaves(f.sub, p, out);
  }
  return out;
}
function blocksOf(rec) {
  const blocks = [];
  for (const f of rec.field.sub) {
    if (f.field === 505 && f.sub) blocks.push(varintLeaves(f.sub, "", []));
  }
  return blocks;
}
function sigName(rec) { return String(rec.name || "?"); }

const NAMES = ["assets", "home", "modal", "clues", "stage", "topbar", "right", "toolbar", "root", "111", "tpl-container", "murdoku-panel"];

console.log(`\n== 每个控件：逐 #505 块列出 varint 叶子（路径=值）==`);
const sig = new Map();
for (const n of NAMES) {
  const recs = g.recs.filter((r) => sigName(r) === n);
  if (!recs.length) { console.log(`  ${n.padEnd(12)} —— 记录里没有`); continue; }
  for (const r of recs) {
    const blocks = blocksOf(r);
    const flat = [];
    console.log(`  ${n.padEnd(12)} id=${String(r.id).padEnd(11)} #505 块=${blocks.length}`);
    blocks.forEach((b, i) => {
      const s = b.map((x) => `${x.p}=${x.v}`).join(" ");
      console.log(`     块${i}: ${s === "" ? "(无 varint 叶子)" : s}`);
      for (const x of b) flat.push(`块${i}${x.p}=${x.v}`);
    });
    sig.set(n + "#" + r.id, new Set(flat));
  }
}

// ── 与基准容器逐块做差集 ───────────────────────────────────────────────────
const baseRec = g.recs.find((r) => sigName(r) === base);
if (!baseRec) { console.log(`\n找不到基准 ${base}`); process.exit(0); }
const baseSet = sig.get(base + "#" + baseRec.id);

console.log(`\n== 与基准「${base}」的差集 ==`);
for (const n of NAMES) {
  if (n === base) continue;
  const recs = g.recs.filter((r) => sigName(r) === n);
  for (const r of recs) {
    const s = sig.get(n + "#" + r.id);
    if (!s) continue;
    const onlyMe = [...s].filter((x) => !baseSet.has(x));
    const onlyBase = [...baseSet].filter((x) => !s.has(x));
    const same = onlyMe.length === 0 && onlyBase.length === 0;
    console.log(`  ${n.padEnd(12)} id=${String(r.id).padEnd(11)} ${same ? "★ 与基准完全一致" : ""}`);
    if (onlyMe.length) console.log(`      只有它有的: ${onlyMe.join(" | ")}`);
    if (onlyBase.length) console.log(`      只有基准有的: ${onlyBase.join(" | ")}`);
  }
}

// ── 把"只有基准有 / 只有它没有"的那条路径单独拎出来看值 ────────────────────
console.log(`\n== ★ 重点：基准有、assets 没有的那条路径 ==`);
const assetsRec = g.recs.find((r) => sigName(r) === "assets");
if (assetsRec) {
  const as = sig.get("assets#" + assetsRec.id);
  const missing = [...baseSet].filter((x) => !as.has(x));
  if (!missing.length) console.log("  （没有这样的路径 —— assets 与基准在这套口径下一致）");
  for (const m of missing) {
    const p = m.replace(/^块\d+/, "");
    console.log(`  ${m}`);
    // 同名路径在其他容器里是什么值
    const rows = [];
    for (const n of NAMES) {
      for (const r of g.recs.filter((x) => sigName(x) === n)) {
        const s = sig.get(n + "#" + r.id);
        const hit = [...s].find((x) => x.replace(/^块\d+/, "") === p);
        rows.push(`${n}=${hit ? hit.replace(/^块\d+/, "") : "(缺=0/false)"}`);
      }
    }
    console.log(`     → 各控件上这条路径：${rows.join("  ")}`);
  }
}
