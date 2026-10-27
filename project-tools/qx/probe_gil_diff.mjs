// tools/qx/probe_gil_diff.mjs —— 【只读】把 .gil 里两条控件记录的**结构形状**逐字段比对
//
// 想回答的问题：`assets` 在 .gil 里和 `home`/`modal` **真的完全同构吗**？
//   若同构 ⇒ 编辑器侧数据没问题 ⇒ 真机差异只能来自"运行时/保存流程/激活位"；
//   若不同构 ⇒ 差异就在那个字段上（很可能就是"是不是客户端控件"的判据）。
//
// 比对口径：只比"结构形状"= 递归的 (字段号, wire type) 序列（**不看数值**），
//   因为数值本来就该不同（位置/尺寸/图片 id 都不一样）。这也避免了"值不同就报差异"的噪声。
//
// 只读：readGil 只解析；本脚本不 pack、不写盘。
//
// 跑法：node tools/qx/probe_gil_diff.mjs [gil] [名字A] [名字B]

import { readGil } from "../gil/gilread.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "..", "..");

const argv = process.argv.slice(2);
const gilName = argv[0] || "222-调色板-修正.gil";
const nameA = argv[1] || "assets";
const nameB = argv[2] || "home";
const file = path.isAbsolute(gilName) ? gilName : path.join(project, gilName);
if (!fs.existsSync(file)) { console.log("找不到：", file); process.exit(1); }

const g = readGil(file);
console.log("== 文件 ==", path.basename(file), " 记录数 =", g.recs.length);

// 把一条记录压成"结构形状"字符串序列（含路径），便于逐行 diff
function shape(fields, prefix, out) {
  for (const f of fields) {
    const tag = `${prefix}/${f.field}:${f.wt}`;
    out.push(tag);
    if (f.sub) shape(f.sub, tag, out);
  }
  return out;
}

function recShape(rec) {
  const out = [];
  shape(rec.field.sub, "", out);
  // 顶层字段顺序也重要，单独记一行
  return out;
}

function pick(name) {
  const r = g.recs.find((x) => String(x.name || "") === name);
  if (!r) { console.log(`  ✗ 记录里没有 ${name}`); process.exit(2); }
  return r;
}

const A = pick(nameA), B = pick(nameB);
const sa = recShape(A), sb = recShape(B);

console.log(`\n== 记录概览 ==`);
for (const [r, s] of [[A, sa], [B, sb]]) {
  const ids = (r.childList ? (r.childList.payload.length / 2) : 0);
  console.log(`  ${String(r.name).padEnd(10)} id=${String(r.id).padEnd(11)} 结构节点数=${String(s.length).padEnd(5)} `
    + `states=${r.states.length}  顶层字段=[${r.field.sub.map((f) => f.field + ":" + f.wt).join(" ")}]  names=${JSON.stringify(r.names)}`);
}

console.log(`\n== 顶层字段顺序是否一致 ==`);
const topA = A.field.sub.map((f) => `${f.field}:${f.wt}`).join(" ");
const topB = B.field.sub.map((f) => `${f.field}:${f.wt}`).join(" ");
console.log(`  ${nameA}: ${topA}`);
console.log(`  ${nameB}: ${topB}`);
console.log(`  ${topA === topB ? "★ 完全一致 ✓（同构）" : "✗ 不一致"}`);

// 逐条收集"只在一侧出现"的结构路径
const setA = new Set(sa), setB = new Set(sb);
const onlyA = sa.filter((x) => !setB.has(x));
const onlyB = sb.filter((x) => !setA.has(x));

console.log(`\n== 结构 diff（只按"路径:wireType"比，不看数值）==`);
console.log(`  只在 ${nameA} 里出现的结构路径：${onlyA.length} 条`);
for (const x of onlyA.slice(0, 40)) console.log("    + " + x);
console.log(`  只在 ${nameB} 里出现的结构路径：${onlyB.length} 条`);
for (const x of onlyB.slice(0, 40)) console.log("    - " + x);

console.log(`\n== 同名结构路径的**出现次数**是否一致 ==`);
const cnt = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return m; };
const ca = cnt(sa), cb = cnt(sb);
const keys = new Set([...ca.keys(), ...cb.keys()]);
let mismatch = 0;
for (const k of [...keys].sort()) {
  const a = ca.get(k) || 0, b = cb.get(k) || 0;
  if (a !== b) { mismatch++; console.log(`    ✗ ${k}  ${nameA}×${a}  ${nameB}×${b}`); }
}
if (mismatch === 0) console.log(`  ★ 所有结构路径的出现次数都一致 ⇒ 两条记录**同构** ✓`);

console.log(`\n== 结论 ==`);
if (onlyA.length === 0 && onlyB.length === 0 && mismatch === 0) {
  console.log(`  ★ ${nameA} 与 ${nameB} **结构完全同构**（只是数值不同）`);
  console.log(`    ⇒ 编辑器侧数据看不出"assets 特殊" ⇒ 真机差异不在这条记录的**结构**上。`);
} else {
  console.log(`  ✗ 两条记录结构不同 ⇒ 差异就在上面列出的那几条路径上（这是要查的字段）。`);
}
