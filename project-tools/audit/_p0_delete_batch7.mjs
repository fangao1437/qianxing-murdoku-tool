#!/usr/bin/env node
// tools/audit/_p0_delete_batch7.mjs —— 第 7 批：删掉 `Adapter:apply_tray_layout`（110 行）
//   并把其中唯一还活着的「按钮底图上色」提成独立入口 `Adapter:apply_btn_art()`。
//
// 判据：
//   ① 头像卡容器 `tray` 已在第 6 批从布局计划里删除；`Controller:tray_layout_canvas` 也一起删了
//      ⇒ 全仓**没有任何调用点**（第 6 批同时删掉了 main.lua 里的调用）；
//   ② 它每局唯一能干的事就是打一行「找不到头像卡容器（cfg.tray_parent，默认 tray）」；
//   ③ 真机日志 v274 确认：那行每局都在，除此之外一无所出。
//   ⚠️ **不删** `_tray_btn_art`（缺陷 1 修的开关就在它里面）—— 给它换一个合法入口。
//
// 用法：node tools/audit/_p0_delete_batch7.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const AD = path.join(ROOT, 'lua', 'engine_adapter_qianxing.lua');
const MAIN = path.join(ROOT, 'lua', 'main.lua');
const TEST = path.join(ROOT, 'tests', 'btn_art_gate.lua');

const EOL = {};
function readNorm(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = (raw.match(/\r\n/g) || []).length, lf = (raw.match(/(?<!\r)\n/g) || []).length;
  EOL[p] = crlf > lf ? '\r\n' : '\n';
  return raw.replace(/\r\n/g, '\n');
}
const writeBack = (p, t) => fs.writeFileSync(p, EOL[p] === '\r\n' ? t.replace(/\n/g, '\r\n') : t, 'utf8');
const files = { [AD]: readNorm(AD), [MAIN]: readNorm(MAIN), [TEST]: readNorm(TEST) };

// ── ① 适配层：整个函数换成新入口 ──
const REPL_FN = [
  '-- ★ 2026-10-18（优化组 · C 类清理）：`Adapter:apply_tray_layout`（**110 行**）**已删除** ✗✓',
  '--   判据：① 头像卡容器 `tray` 已按用户指令从布局计划里删除，`Controller:tray_layout_canvas`',
  '--           也在同一批删掉 ⇒ **全仓没有任何调用点**；',
  '--        ② 它每局唯一能干的事就是打一行「找不到头像卡容器（cfg.tray_parent，默认 tray）」；',
  '--        ③ 真机日志（v274）确认：那行每局都在，除此之外一无所出。',
  '--   ⚠️ 里面**唯一还活着**的是「按钮底图上色」那段（**缺陷 1** 修的就是它的开关）⇒',
  '--      提成独立入口 `Adapter:apply_btn_art()`，**仍然受 `cfg.btn_art == true` 控制**（默认关），',
  '--      由 `main.lua` 在设好 `cfg.btn_list` 之后调一次 ✓',
  'function Adapter:apply_btn_art()',
  '  -- ★ 缺陷 1 的行为不变：**默认关闭**（`cfg.btn_art` 默认 nil）；要实验时显式传 true。',
  '  --   ⚠️ 判据：`grep -c "_tray_btn_art(moved" lua/engine_adapter_qianxing.lua` == 1',
  '  if self.cfg.btn_art ~= true or print == nil then return 0 end',
  '  local names = self.cfg.btn_list or {}',
  '  local done, miss = 0, 0',
  '  return self:_tray_btn_art(0, names, done, miss)',
  'end',
].join('\n');

// ── ② main.lua：在设好 btn_list 之后调用新入口 ──
const MAIN_OLD = '      if print then print("[murdoku] 上色名单（来自规划）：" .. #list .. " 个按钮") end\n';
const MAIN_NEW = MAIN_OLD + [
  '      -- ★ 2026-10-18（优化组）：按钮上色是 **opt-in**（`cfg.btn_art = true` 才跑）——',
  '      --   入口从原来的 `apply_tray_layout` 改成独立方法 `apply_btn_art`（那个函数已删）✓',
  '      pcall(function() if adapter.apply_btn_art then adapter:apply_btn_art() end end)',
  '',
].join('\n');

// ── ③ 回归夹具：调用改成新入口 ──
const TEST_OLD_LINES = [
  'local EMPTY_LAYOUT = { tray_cx = 0, tray_cy = 0, items = {} }',
  'a:apply_tray_layout(EMPTY_LAYOUT)',
  'local okCall, errCall = pcall(function() a:apply_tray_layout(EMPTY_LAYOUT) end)',
];

// 预检 ①：函数区间的起止
const ad = files[AD];
const fnStart = ad.indexOf('function Adapter:apply_tray_layout(layout)');
const fnEndAnchor = '\n-- ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★\n-- ★★ 2026-10-12 **【已删除】`Adapter:apply_ruler_layout` 整段**';
const fnEnd = ad.indexOf(fnEndAnchor, fnStart);
const fnSpan = fnStart >= 0 && fnEnd > fnStart ? [fnStart, fnEnd] : null;
const fnLines = fnSpan ? ad.slice(fnSpan[0], fnSpan[1]).split('\n').length : 0;
console.log(`[${fnSpan && ad.split('function Adapter:apply_tray_layout').length === 2 ? 'OK' : '✗'}] adapter · apply_tray_layout 整段　${fnLines} 行`);

// 预检 ②③
const mainN = files[MAIN].split(MAIN_OLD).length - 1;
const testN = files[TEST].split('a:apply_tray_layout(EMPTY_LAYOUT)').length - 1;
console.log(`[${mainN === 1 ? 'OK' : '✗'}] main.lua · btn_list 之后插入调用点　命中 ${mainN} 次`);
console.log(`[${testN >= 1 ? 'OK' : '✗'}] btn_art_gate · 调用点替换　命中 ${testN} 次`);
if (!fnSpan || ad.split('function Adapter:apply_tray_layout').length !== 2 || mainN !== 1 || testN < 1) {
  console.error('\n✗ 预检不通过 ⇒ 一个字节都不写'); process.exit(1);
}

// 应用
files[AD] = ad.slice(0, fnSpan[0]) + REPL_FN + ad.slice(fnSpan[1]);
files[MAIN] = files[MAIN].replace(MAIN_OLD, MAIN_NEW);
files[TEST] = files[TEST]
  .replace(/local EMPTY_LAYOUT = \{ tray_cx = 0, tray_cy = 0, items = \{\} \}\n/, '')
  .replace(/a:apply_tray_layout\(EMPTY_LAYOUT\)/g, 'a:apply_btn_art()')
  .replace(/pcall\(function\(\) a:apply_btn_art\(\) end\)/g, 'pcall(function() a:apply_btn_art() end)');

for (const f of [AD, MAIN, TEST]) console.log(`${path.basename(f)} → ${files[f].split('\n').length} 行`);
if (!APPLY) { console.log('\n（DRY：什么都没写。要真删请加 --apply）'); process.exit(0); }

for (const f of [AD, MAIN, TEST]) writeBack(f, files[f]);

// 写后重读核对
const ad2 = fs.readFileSync(AD, 'utf8').replace(/\r\n/g, '\n');
const mn2 = fs.readFileSync(MAIN, 'utf8').replace(/\r\n/g, '\n');
const ts2 = fs.readFileSync(TEST, 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--'));
const checks = [
  ['adapter: 无 apply_tray_layout 定义', !code(ad2).some((l) => l.includes('apply_tray_layout'))],
  ['adapter: 有 apply_btn_art 定义', code(ad2).some((l) => l.includes('function Adapter:apply_btn_art'))],
  ['adapter: `_tray_btn_art` 仍在（缺陷 1 的开关不能一起删）', code(ad2).some((l) => l.includes('function Adapter:_tray_btn_art'))],
  ['adapter: 调用点恰好 1 处', code(ad2).filter((l) => l.includes('_tray_btn_art(0, names')).length === 1],
  ['main: 调用了 apply_btn_art', code(mn2).some((l) => l.includes('adapter:apply_btn_art()'))],
  ['test: 改用 apply_btn_art', code(ts2).some((l) => l.includes('a:apply_btn_art()'))],
  ['test: 不再调 apply_tray_layout', !code(ts2).some((l) => l.includes('apply_tray_layout'))],
];
console.log('\n── 从磁盘重读核对 ──');
let allOk = true;
for (const [label, ok] of checks) { console.log('  ' + (ok ? '✅' : '✗ ') + ' ' + label); if (!ok) allOk = false; }
if (!allOk) { console.error('\n✗ 写盘后核对不通过'); process.exit(1); }
console.log('\n★ 已写盘');
