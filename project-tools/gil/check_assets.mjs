// tools/gil/check_assets.mjs —— **素材齐了没有？**
//
// 为什么要有它：美术改造的 ⑤/⑥ 卡在"等素材"。素材放进 `.gil` 的 `assets` 之后，
// 得有人告诉你**齐没齐、缺哪个** —— 总不能靠人肉比对控件名。
//
// 做法：
//   ① `lua tools/list_required_assets.lua` 吐出"该有哪些"（**从关卡数据推导**，不是手抄）
//   ② 读 `.gil` 里 `assets` 容器的子控件名 = "实际有哪些"
//   ③ 差集 = 缺的
//
// ⚠️ 报告分两类，**不要混为一谈**：
//   · **关卡数据里已经在用的**（`portrait.*` / `obj.*`）—— 缺了会影响显示，要盯
//   · **界面用的一次性素材**（`btn.hex` / `icon.*`）—— 缺了只是"还没配美术"，
//     属于**预期内的待办**，不该当成错误刷屏
//
// 用法：
//   node tools/gil/check_assets.mjs [--gil=完整界面47-标签不重叠.gil] [--strict] [--warn-only]
//     --strict     把"界面一次性素材"也算成失败（用于"素材都齐了"之后的守门）
//     --warn-only  **只报告，永远退出 0**（接进 check_all 时用这个）
//
//   ⚠️ 为什么默认要有 `--warn-only` 这条路：现在 `obj.*` 家具素材**还没做**，
//     那是**预期内的待办**，不该让 `check_all` 变红 —— 否则真出错时就被淹没了。
//     素材齐了之后，把 check_all 里那一步的 `--warn-only` 去掉即可变成守门。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const STRICT = argv.includes('--strict');
const WARN_ONLY = argv.includes('--warn-only');

// 默认拿最新的「完整界面NN」存档
function latestGil() {
  const all = fs.readdirSync(ROOT).filter((f) => /^完整界面\d+.*\.gil$/.test(f));
  if (all.length === 0) return null;
  all.sort((a, b) => {
    const na = Number((a.match(/^完整界面(\d+)/) || [])[1] || 0);
    const nb = Number((b.match(/^完整界面(\d+)/) || [])[1] || 0);
    return nb - na;
  });
  return path.join(ROOT, all[0]);
}
const GIL = argOf('gil') ? path.join(ROOT, argOf('gil')) : latestGil();
if (!GIL || !fs.existsSync(GIL)) { console.error('❌ 找不到存档（用 --gil= 指定）'); process.exit(3); }

// ① 该有哪些（Lua 侧推导）
const luaExe = process.env.LUA_EXE || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Lua', 'bin', 'lua.exe');
let required = [];
try {
  const out = execFileSync(luaExe, ['tools/list_required_assets.lua'], { cwd: ROOT, encoding: 'utf8' });
  required = JSON.parse(out.trim()).required || [];
} catch (e) {
  console.error('❌ 跑 list_required_assets.lua 失败：' + e.message);
  process.exit(3);
}

// ② 实际有哪些：`assets` 容器的子控件名
const g = readGil(GIL);
const assets = g.byName.get('assets');
const have = new Set();
if (assets) {
  const cl = findChildListTop(assets.field.sub);
  const kids = cl ? (asIdList(cl.payload, true) || []) : [];
  const byId = new Map(g.recs.map((r) => [r.id, r]));
  for (const id of kids) {
    const r = byId.get(id);
    if (r && r.name) have.add(r.name);
  }
}

// ③ 差集，并按"两类"分开报
const INTERFACE_ONLY = /^(btn\.|icon\.)/;
const missing = required.filter((n) => !have.has(n));
const missData = missing.filter((n) => !INTERFACE_ONLY.test(n));   // 关卡在用的
const missUi = missing.filter((n) => INTERFACE_ONLY.test(n));      // 界面待办

console.log('  存档 ' + path.basename(GIL) + '   assets 里现有 ' + have.size + ' 个素材');
console.log('  关卡数据需要 ' + required.filter((n) => !INTERFACE_ONLY.test(n)).length
  + ' 个，界面一次性素材 ' + required.filter((n) => INTERFACE_ONLY.test(n)).length + ' 个');
if (have.size) console.log('  现有：' + [...have].sort().join(' '));

if (missData.length) {
  console.log('\n  ⚠️ 关卡数据里已经在用、但 assets 里还没有的（' + missData.length + ' 个）：');
  console.log('    ' + missData.join('  '));
  console.log('    ⇒ 这些会影响显示：家具图标按名字查不到就**隐藏**（不会出白块，但也看不到图）。');
} else {
  console.log('\n  ✅ 关卡数据需要的素材**都在**。');
}

if (missUi.length) {
  console.log('\n  ⏳ 界面一次性素材（**预期内的待办**，等美术）：');
  console.log('    ' + missUi.join('  '));
  console.log('    ⇒ 名字已定死（见 docs/美术素材待办对照表.md），素材一到按名字放进去即可。');
} else {
  console.log('\n  ✅ 界面一次性素材也齐了。');
}

// 退出码：只有"关卡在用的缺了"才算失败；--strict 时界面素材也算
const bad = missData.length + (STRICT ? missUi.length : 0);
console.log('\n  ' + (bad === 0 ? '★ 素材自检通过' + (missUi.length ? '（界面素材还有 ' + missUi.length + ' 个待办）' : '')
  : '⚠️ 有 ' + bad + ' 个素材缺失（美术待办，见 docs/美术素材待办对照表.md）'));
if (WARN_ONLY) { console.log('  （--warn-only：只报告，不影响 check_all 结果）'); process.exit(0); }
process.exit(bad === 0 ? 0 : 4);
