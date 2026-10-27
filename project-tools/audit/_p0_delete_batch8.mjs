#!/usr/bin/env node
// tools/audit/_p0_delete_batch8.mjs —— 第 8 批：B 类结案探针 `diagnose_cell` + `diagnose_template`
//
// 判据（真机日志 v274/v276 直接给的结案证据）：
//   · `diagnose_cell`：日志「===== 格子体检：cell.1.1 =====」→ 全部 ✅ → 「**这一格配好了**」；
//   · `diagnose_template`：日志「结论（实测）：**生成成功了** —— 用模板索引 1073741876 建了 25 个格子」。
//   ⇒ 两者都是"搭界面阶段的体检"，结论已落 docs `真机搭建与运行指南` / `API-四方对照`；
//     现在每局仍各跑一次、打 30+ 行，属于「结案探针」。
//
// ⚠️ **保留** `diagnose_overlap`（用户点名"不能删"，见 tests/overlap_diag_once.lua 头注）
//     与 `diagnose_grid`（受 `Murdoku.DIAG` 门控，entry_smoke 有专门用例）。
//   ⇒ `diagnose_grid` 的开关原来挂在 `adapter._cell_diagnosed` 上（由 diagnose_cell 置位），
//     本批把那半个条件去掉，只留 `Murdoku.DIAG` 闸 ⇒ 行为不变（DIAG 默认 false）。
//
// 用法：node tools/audit/_p0_delete_batch8.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const AD = path.join(ROOT, 'lua', 'engine_adapter_qianxing.lua');
const MAIN = path.join(ROOT, 'lua', 'main.lua');
const ENTRY = path.join(ROOT, 'lua', 'entry_client_script.lua');
const TEST = path.join(ROOT, 'tests', 'perframe_throttle.lua');

const EOL = {};
function readNorm(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const crlf = (raw.match(/\r\n/g) || []).length, lf = (raw.match(/(?<!\r)\n/g) || []).length;
  EOL[p] = crlf > lf ? '\r\n' : '\n';
  return raw.replace(/\r\n/g, '\n');
}
const writeBack = (p, t) => fs.writeFileSync(p, EOL[p] === '\r\n' ? t.replace(/\n/g, '\r\n') : t, 'utf8');
const F = { [AD]: readNorm(AD), [MAIN]: readNorm(MAIN), [ENTRY]: readNorm(ENTRY), [TEST]: readNorm(TEST) };

const TOMB_AD = [
  '-- ★ 2026-10-18（优化组 · B 类清理）：`Adapter:diagnose_template` 与 `Adapter:diagnose_cell`',
  '--   （**合计 354 行**，含两段说明区）**已删除** ✗✓',
  '--   判据（真机日志给的结案证据，不需要再猜）：',
  '--     · `diagnose_cell`：v274/v276 日志「格子体检：cell.1.1」→ **每一项都 ✅** →',
  '--       「结论：**这一格配好了**（底图 + face/note/x + 状态节点 + 射线 + 门控②都过）」；',
  '--     · `diagnose_template`：「结论（实测）：**生成成功了** —— 用模板索引 1073741876',
  '--       建了 25 个格子，棋盘 25 格齐全」。',
  '--   ⇒ 它们是"搭界面阶段"的一次性体检，结论已落 docs（`真机搭建与运行指南` / `API-四方对照`）；',
  '--     留在上机包里每局要打 30+ 行 ⇒ 按"结案探针"清掉 ✓',
  '--   ⚠️ **保留** `diagnose_overlap`（用户点名不能删）与 `diagnose_grid`（`Murdoku.DIAG` 门控 + 有用例）',
  '',
].join('\n');

const TOMB_MAIN = [
  '  -- ★ 2026-10-18（优化组 · B 类清理）：**参照格子体检（diagnose_cell / diagnose_template）调用删除** ✗✓',
  '  --   结案证据见真机日志：「这一格配好了」/「生成成功了 —— 建了 25 个格子」。',
  '  --   下面的 `diagnose_grid` 仍在，但它的闸从「`_cell_diagnosed` + DIAG」简化成**只看 DIAG** ✓',
  '',
].join('\n');

const TOMB_ENTRY = [
  '    -- ★ 2026-10-18（优化组 · B 类清理）：`diagnose_cell` 配置项**已删除**',
  '    --   （配套的适配层体检函数与 main 的调用一起删；结案证据见真机日志「这一格配好了」）',
  '',
].join('\n');

/** 按行区间删（1-based start；endExclusive 行） */
const CUT_SPECS = [
  { f: AD, tag: 'diagnose_template + diagnose_cell（354 行含说明区）', startAnchor: '-- ════════════════════════════════════════════════════════════════════════', occurrencesBefore: 1, untilAnchor: 'function Adapter:forget_events_of(id)', repl: TOMB_AD },
];

// ── 精确按锚点算区间：diagnose_template 的说明区起 → forget_events_of 之前 ──
const ad = F[AD];
const tplHdr = ad.indexOf('function Adapter:diagnose_template()');
const cellHdr = ad.indexOf('function Adapter:diagnose_cell(id)');
const nextFn = ad.indexOf('function Adapter:forget_events_of(id)');
// 说明区起点：从 diagnose_template 往前找第一条 ═ 分隔线所在段的开头
const sepIdx = ad.lastIndexOf('\n-- ════', tplHdr);
const spanStart = sepIdx >= 0 ? sepIdx + 1 : tplHdr;
const spanEnd = nextFn;
const spanLines = ad.slice(spanStart, spanEnd).split('\n').length;
const okAd = tplHdr > 0 && cellHdr > tplHdr && nextFn > cellHdr && ad.split('function Adapter:diagnose_template()').length === 2 && ad.split('function Adapter:diagnose_cell(id)').length === 2;
console.log(`[${okAd ? 'OK' : '✗'}] adapter · diagnose_template + diagnose_cell　${spanLines} 行`);

// main：删 819-831 那段（以注释 ③ 起，到 `Murdoku.render(true)` 前）
const mainStart = F[MAIN].indexOf('  -- ③ 参照格子体检：把「cell.1.1 到底配好了没有」一次性讲清楚。');
const mainEnd = F[MAIN].indexOf('\n  Murdoku.render(true)', mainStart);
const okMain = mainStart > 0 && mainEnd > mainStart;
console.log(`[${okMain ? 'OK' : '✗'}] main · diagnose_cell/template 调用块　${okMain ? F[MAIN].slice(mainStart, mainEnd).split('\n').length : 0} 行`);

// main：diagnose_grid 的闸去掉 `_cell_diagnosed`
const GATE_OLD = '  if adapter.diagnose_cell ~= nil and adapter._cell_diagnosed and adapter.diagnose_grid ~= nil\n     and adapter.cfg and adapter.cfg.diagnose_grid ~= false then';
const GATE_NEW = '  -- ★ 2026-10-18：原来这里还要 `adapter._cell_diagnosed`（由 diagnose_cell 置位）⇒ 那个体检已删，\n  --   闸只留 `Murdoku.DIAG`（真正的调用在下面 `if Murdoku.DIAG then`）✓ 行为不变。\n  if adapter.diagnose_grid ~= nil and adapter.cfg and adapter.cfg.diagnose_grid ~= false then';
const okGate = F[MAIN].split(GATE_OLD).length === 2;
console.log(`[${okGate ? 'OK' : '✗'}] main · diagnose_grid 闸简化　命中 ${F[MAIN].split(GATE_OLD).length - 1} 次`);

// entry：删 diagnose_cell 配置（连同上面两行注释）
const ENT_OLD = '    -- ★ 参照格子体检（cell.1.1）：把"类型/射线/子控件/图片来源/光标门控"逐条读出来\n    --   并给 ✅/❌ 与修法。搭界面阶段非常有用，**每个会话只打一次**。\n    --   界面搭完、验收通过之后可以改成 false 让日志干净些。\n    diagnose_cell = true,\n';
const okEnt = F[ENTRY].split(ENT_OLD).length === 2;
console.log(`[${okEnt ? 'OK' : '✗'}] entry · diagnose_cell 配置　命中 ${F[ENTRY].split(ENT_OLD).length - 1} 次`);

// test：名单里去掉两个已删方法
const TEST_OLD = '    "diagnose_overlap", "diagnose_cell", "diagnose_grid", "diagnose_template",';
const TEST_NEW = '    -- ★ 2026-10-18：`diagnose_cell` / `diagnose_template` 已按"结案探针"删除 ⇒ 从名单里拿掉\n    "diagnose_overlap", "diagnose_grid",';
const okTest = F[TEST].split(TEST_OLD).length === 2;
console.log(`[${okTest ? 'OK' : '✗'}] perframe_throttle · 方法名单　命中 ${F[TEST].split(TEST_OLD).length - 1} 次`);

if (!(okAd && okMain && okGate && okEnt && okTest)) { console.error('\n✗ 预检不通过 ⇒ 一个字节都不写'); process.exit(1); }

// 应用（各文件独立）
F[AD] = ad.slice(0, spanStart) + TOMB_AD + ad.slice(spanEnd);
F[MAIN] = F[MAIN].slice(0, mainStart) + TOMB_MAIN + F[MAIN].slice(mainEnd + 1);
F[MAIN] = F[MAIN].replace(GATE_OLD, GATE_NEW);
F[ENTRY] = F[ENTRY].replace(ENT_OLD, TOMB_ENTRY);
F[TEST] = F[TEST].replace(TEST_OLD, TEST_NEW);

for (const f of [AD, MAIN, ENTRY, TEST]) console.log(`${path.basename(f)} → ${F[f].split('\n').length} 行`);
if (!APPLY) { console.log('\n（DRY：什么都没写。要真删请加 --apply）'); process.exit(0); }
for (const f of [AD, MAIN, ENTRY, TEST]) writeBack(f, F[f]);

// 写后重读核对
const rd = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--'));
const a2 = rd(AD), m2 = rd(MAIN), e2 = rd(ENTRY), t2 = rd(TEST);
const checks = [
  ['adapter: 无 diagnose_cell 定义', !code(a2).some((l) => l.includes('function Adapter:diagnose_cell'))],
  ['adapter: 无 diagnose_template 定义', !code(a2).some((l) => l.includes('function Adapter:diagnose_template'))],
  ['adapter: diagnose_overlap 仍在（用户点名保留）', code(a2).some((l) => l.includes('function Adapter:diagnose_overlap'))],
  ['adapter: diagnose_grid 仍在', code(a2).some((l) => l.includes('function Adapter:diagnose_grid'))],
  ['main: 不再调 diagnose_cell/template', !code(m2).some((l) => /diagnose_(cell|template)\(/.test(l))],
  ['main: diagnose_grid 闸已简化', code(m2).some((l) => l.trim() === 'if adapter.diagnose_grid ~= nil and adapter.cfg and adapter.cfg.diagnose_grid ~= false then')],
  ['entry: 无 diagnose_cell 配置', !code(e2).some((l) => l.includes('diagnose_cell'))],
  ['test: 名单已更新', !code(t2).some((l) => l.includes('"diagnose_cell"')) && code(t2).some((l) => l.includes('"diagnose_overlap"'))],
];
console.log('\n── 从磁盘重读核对 ──');
let allOk = true;
for (const [label, ok] of checks) { console.log('  ' + (ok ? '✅' : '✗ ') + ' ' + label); if (!ok) allOk = false; }
if (!allOk) { console.error('\n✗ 写盘后核对不通过'); process.exit(1); }
console.log('\n★ 已写盘');
