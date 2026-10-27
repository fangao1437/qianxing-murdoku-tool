// tools/gil/check_names.mjs —— **对账**：脚本需要的控件名 vs 生成存档里实际有的
//
// 为什么需要这一步：Lua 脚本是按**名字**找控件的（`find` / `sub` / cfg 里的字面量）。
// 名字对不上 → 游戏里报"找不到控件"，而离线看不出来。所以导入前先对一遍账。
//
// 检查三件事：
//   ① 规划里 101 个非 cell.* 的名字，是否都在存档里；
//   ② 存档里多出来的（不算错，仅报告：原型、模板内部控件属正常）；
//   ③ cfg 点名的容器 + `tpl.cell` 的子控件（脚本运行时靠这些名字复制格子）。
//
// 用法：node tools/gil/check_names.mjs [存档.gil]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIL = process.argv[2] || path.join(ROOT, '完整界面.gil');
const PLAN = path.join(ROOT, 'tools', 'sim', 'out', 'layout-plan.json');
// ★ 2026-10-07 新增 `--only=`：把"要对账的规划名字"限定在前缀范围内（`名字*` = 前缀）。
//   为什么需要它：规划是**全关卡并集**（369 个节点），而"只加弹窗"这类交付**故意**只建 19 个
//   ⇒ 全局口径必然报 ~300 个缺失，那个数字没有意义、也没法当闸门。
//   范围口径才是真闸门：`--only=modal` ⇒ "本批该有的 modal 家族一个都不缺"。
//   用法：node tools/gil/check_names.mjs 209-弹窗.gil --only=modal
const onlyArg = (process.argv.find((s) => s.startsWith('--only=')) || '').slice(7);
const ONLY = onlyArg.split(',').map((s) => s.trim()).filter(Boolean);
const onlyBy = (id) => ONLY.length === 0 || ONLY.some((pat) => pat.endsWith('*') ? id.startsWith(pat.slice(0, -1)) : id === pat);

if (!fs.existsSync(GIL)) { console.error('缺存档：' + GIL); process.exit(1); }
if (!fs.existsSync(PLAN)) { console.error('缺规划：' + PLAN); process.exit(1); }

// 名字直接从存档里现算，**不要经过任何中间文件**（PowerShell 重定向会写成 UTF-16）
const gilNames = readGil(GIL).names;

const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const planAll = plan.nodes.map((n) => n.id);
const planCell = planAll.filter((s) => /^cell\./.test(s));
const planKeep = planAll.filter((s) => !/^cell\./.test(s) && onlyBy(s));

console.log('存档：' + path.basename(GIL));
console.log('  存档里的控件名 ' + gilNames.size + ' 个');
console.log('规划 ' + planAll.length + ' 个（其中 cell.* ' + planCell.length + ' 个由脚本运行时生成）');
console.log('  要对账的非 cell 名字 ' + planKeep.length + ' 个'
  + (ONLY.length ? '（★ --only=' + ONLY.join(',') + ' 范围内）' : '') + '\n');

// ★★★★★ 2026-10-09 **改成【分类报告】** ✗✓（用户 2026-10-09：「不必严格按计划，只要结果」✓）
//
//   ★ 改之前的毛病 ✗：它把**三类完全不同**的东西都算进 `missing`：
//       ① 规划要、存档没有，但**脚本会自己建**（`hex.*` / `hit.*` ✓ 14 个）
//       ② 规划要、存档没有，但**已被换代**（`clue.*` 139 个 —— 网格视窗在运行时造列表项 ✓）
//       ③ 规划要、存档没有，**而且真的没人建**（`select.*` / `ruler.*` / `room.*` / `obj.*` / `intro.*`）
//     ⇒ 于是它**永远报 281 项缺失、永远红** ⇒ **等于没有闸门** ✗
//       （实测：`223` / `224` / `225` / `226` / `227` **五份报的数完全一样** ✓）
//   ★ 现在怎么改 ✓：**分类** + 只把"真缺"当判据 ✓
//     · `AUTO` —— **从脚本源码里读** `auto_create_only` ✓（不硬编码 ⇒ 不会漂移 ✓）
//     · `SUPERSEDED` —— `clue.*` 家族，且存档里**有网格视窗**（`clues.grid`）⇒ 换代成立 ✓
//     · `REAL` —— 剩下的 = **真的没人建** ✓ ← ★ 只有这一类该让人管 ✓
//
//   新增开关：`--strict` ⇒ 真缺也算失败（默认只报告 —— 用户已确认"界面就是现在这些" ✓）

// ── 脚本会自动创建的白名单：**从源码读**，不硬编码 ✓ ─────────────────────
//   ★ 2026-10-09：`hex.*` / `hit.*` **已经搬进存档**（用户拍板「搬 1」✓
//     产物 `230-图标搬进存档.gil`，搬法见 `tools/gil/gen_icons.mjs` ✓）
//     ⇒ 那份白名单**已从 `entry_client_script.lua` 整段删除** ✓
//     ⇒ 这段现在读不到东西 ⇒ `AUTO` 为空 ✓ **这是对的**（确实没有控件由脚本自动建了 ✓）
//   ⚠️ 所以下面的 🟢 计数为 0 时**不要**当成"读失败" —— 它反映的是现状 ✓
const AUTO_SRC = (() => {
  const p = path.join(ROOT, 'lua', 'entry_client_script.lua');
  if (!fs.existsSync(p)) return { set: new Set(), found: false };
  const m = fs.readFileSync(p, 'utf8').match(/auto_create_only\s*=\s*\{([\s\S]*?)\n\s*\}/);
  if (!m) return { set: new Set(), found: false };
  return { set: new Set([...m[1].matchAll(/\["([^"]+)"\]/g)].map((x) => x[1])), found: true };
})();
const AUTO = AUTO_SRC.set;
const AUTO_RETIRED = !AUTO_SRC.found;   // 白名单已被移除 ⇒ 🟢 恒 0 是正常的 ✓

// ── 已被换代：网格视窗在运行时造列表项 ⇒ `clue.<n>` 家族不必手摆 ✓ ────────
//   ⚠️ 前提是**存档里真有网格视窗** ✓（没有就不能这么判 ✓ 否则会掩盖真缺 ✓）
const hasGrid = gilNames.has('clues.grid');
const isSuperseded = (id) => hasGrid && /^clue\.\d/.test(id);

// ① 规划需要但存档缺失 —— **分类**
const missing = planKeep.filter((s) => !gilNames.has(s));
const auto = [], superseded = [], real = [];
for (const s of missing) {
  if (AUTO.has(s)) auto.push(s);
  else if (isSuperseded(s)) superseded.push(s);
  else real.push(s);
}
const byPrefix = (arr) => {
  const m = new Map();
  for (const s of arr) {
    const k = s.includes('.') ? s.split('.')[0] : s;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v).join('  ');
};

console.log('① 规划需要但存档里【缺失】共 ' + missing.length + ' 个 —— **按性质分三类**：\n');
console.log('   🟢 脚本会自动建  ' + String(auto.length).padStart(3) + ' 个'
  + (AUTO_RETIRED
    ? '（★ 脚本里**已无**自动创建白名单 ⇒ 恒为 0，**这是正常的** ✓）'
    : '（白名单读自 `lua/entry_client_script.lua`）' + (auto.length ? '：' + byPrefix(auto) : '')));
console.log('   🔵 已被换代      ' + String(superseded.length).padStart(3) + ' 个'
  + '（网格视窗运行时造列表项）' + (superseded.length ? '：' + byPrefix(superseded) : '')
  + (hasGrid ? '' : '   ⚠️ 存档里没有 `clues.grid` ⇒ 本类**不成立**，已全部计入"真缺" ✓'));
console.log('   🔴 真缺          ' + String(real.length).padStart(3) + ' 个'
  + '  ← ★ **只有这一类需要人管**' + (real.length ? '：' + byPrefix(real) : ''));
for (const s of real.slice(0, 60)) console.log('        ✗ ' + s);
if (real.length > 60) console.log('        …… 还有 ' + (real.length - 60) + ' 个');
if (missing.length !== real.length) {
  console.log('\n   ⓘ 旧版把这 ' + (missing.length - real.length)
    + ' 个（🟢 + 🔵）也算成"缺失" ⇒ 恒定 281 项、**永远红** ⇒ 闸门失效 ✗ 现在分开 ✓');
}

// ② 存档多出来的
const extra = [...gilNames].filter((s) => !planAll.includes(s)).sort();
console.log('\n② 存档多出来的 ' + extra.length + ' 个（原型 / 模板内部控件属正常）：');
console.log('     ' + (extra.join(', ') || '（无）'));

// ③ 脚本【运行必须】的名字 + 模板子控件
//
// ★★★★★ 2026-10-09 **这份清单也过期了，拆成两半** ✗✓
//   实测（`227`）：它原来报 5 个 ❌ —— `board` / `tray` / `proto.btn` / `proto.text` / `text`
//   ⇒ ★ **这 5 个都不是"运行必须"** ✓：
//     · `board` —— 已退休 ✓（`main.lua` 里那条"就绪判定要看 `board`"的**死引用早就删了** ✓
//       真机与模拟器**两边都找不到它** ✓ 见 `main.lua:705` 那段的注释 ✓）
//     · `tray` —— 2026-10-02 用户定稿「**头像卡并进滚动线索卡**」⇒ **按设计退休** ✓
//       容器壳都不建了（存档里 `tray` 记录 0 条 ✓）
//     · `proto.btn` / `proto.text` —— 旧原型名，现在的模板走 `cfg.cells.prefab` + `tpl.cell` ✓
//     · `text` —— 格子模板里的**可选**文字子控件 ✓
//       （`cfg.cells.push_text` 就是为"将来配了才恢复"留的口子 ✓ 现在没配 ⇒ 不该算缺 ✓）
//   ⇒ ★ 拆开 ✓：`NEED_CFG` = **真·运行必须**（缺了要红 ✓）；
//     `NEED_CFG_RETIRED` = **已退休/可选**（只报告 ✓ 缺了不红 ✓）
//     这样这道闸门才回到"**缺了就是脚本要报错**"的本意 ✓
const NEED_CFG = ['root', 'tpl.cell',
  'face', 'note', 'x',
  'wall.up', 'wall.down', 'wall.left', 'wall.right',
  'door.up', 'door.down', 'door.left', 'door.right'];
const NEED_CFG_RETIRED = ['board', 'tray', 'proto.btn', 'proto.text', 'text'];
console.log('\n③ 脚本运行【必须】的名字 / 模板子控件（' + NEED_CFG.length + ' 个）：');
const bad3 = NEED_CFG.filter((s) => {
  const ok = gilNames.has(s);
  console.log('     ' + (ok ? '✅' : '❌') + ' ' + s);
  return !ok;
});
console.log('   ⓘ 已退休 / 可选（' + NEED_CFG_RETIRED.length + ' 个，缺了**不红**）：');
for (const s of NEED_CFG_RETIRED) {
  console.log('     ' + (gilNames.has(s) ? '✅' : '— ') + ' ' + s);
}

// ④ 运行时生成的格子名不该出现在存档里 —— 但 `cell.1.1` **例外**：
//    它是模板画布里的"模板根"（`tpl.cell` 引用的就是它，cfg.cells.prefab 指向它），
//    是作者手搭的，不是运行时生成的。第一版把它当误报，这里按"有没有 content 子控件"区分。
const g = readGil(GIL);
const tplRootIds = new Set(g.recs.filter((r) => /^cell\.1\.1$/.test(r.name || '')).map((r) => r.id));
const runtimeCellsInSave = [...gilNames].filter((s) => /^cell\.\d/.test(s) && s !== 'cell.1.1');
const tplOk = tplRootIds.size > 0;
console.log('\n④ 运行时格子名不该出现在存档里：' + (runtimeCellsInSave.length ? runtimeCellsInSave.join(', ') + ' ⚠️' : '无 ✅'));
console.log('   模板根 `cell.1.1`（作者手搭、`tpl.cell` 引用的那套）：' + (tplOk ? '存在 ✅ #' + [...tplRootIds].join(', #') : '不存在 ⚠️'));

// ★★★★★ 2026-10-09 **判据改成"真缺"** ✗✓
//   ★ 旧版 ✗：`fatal = missing.length + …` ⇒ **把 🟢 自动建 / 🔵 已换代也算进去** ⇒ 恒定 281 ⇒ 永远红 ✗
//   ★ 新版 ✓：
//     · **默认**只把 ③（cfg 点名的全局清单）当致命 —— 那是"脚本运行**必须**有的名字" ✓
//       （`missing` 里那 281 个**不是**运行的硬需求：🟢 脚本自己建 ✓ 🔵 已换代 ✓
//        剩下的 🔴 是"功能没做"，属于**用户已确认本期不做**的范围 ✓ ⇒ 不该红 ✓）
//     · `--strict` ⇒ 连 🔴 真缺也算失败 ✓（想做"补齐界面"那一轮时用它 ✓）
const STRICT = process.argv.includes('--strict');
const fatal = (STRICT ? real.length : 0) + (ONLY.length ? 0 : bad3.length);
if (ONLY.length && bad3.length) {
  console.log('\n   ⓘ 范围模式（--only=' + ONLY.join(',') + '）：③ 里缺的 ' + bad3.length
    + ' 个不在本批范围，不计入闸门');
}
console.log('\n' + (fatal === 0
  ? '★ 对账通过：脚本【运行必须】的名字全部存在' + (ONLY.length ? '（范围 ' + ONLY.join(',') + '）' : '')
    + (real.length ? '；另有 ' + real.length + ' 个 🔴 真缺属"本期不做"，不计入 ✓（--strict 可查）' : '')
  : '❌ 对账失败：' + fatal + ' 个名字缺失 —— 导入后脚本会报"找不到控件"，先修这个'));
process.exit(fatal === 0 ? 0 : 2);
