#!/usr/bin/env node
// tools/audit/_p0_delete_batch9.mjs —— 第 9 批：C-05 老线索卡兜底（`else` 分支 ≈183 行）
//
// 判据：
//   ① 真机日志（v276/v277）：「网格视窗：**索引基准定为 0**」「找到 clues.grid ✓」
//      ⇒ 网格视窗永远是 on ⇒ `grid_on == true` ⇒ **`else` 分支一次都不执行**；
//   ② 布局计划里仍残留 **48 个 `clue.*`**（`clue.1` / `clue.1.face` / `clue.1.backrop1/2` …）
//      —— 它们正是真机每局那行「规划里有 40 个控件是【已知不需要】」的来源；
//   ③ 用户指令：「老计划里到目前还没实现的都不需要保留了」。
//   ⚠️ `clues.bg` / `clues.grid` 是**活的**（线索区自己的控件），不在本批范围。
//   ⚠️ `is_legacy_clue_id`（一份名单）与「发完再扫一遍」的第二道闸**保留**：
//      它们是**防回归的哨兵**（万一以后有人在守卫外面又 push 一个 `clue.*`）。
//
// 用法：node tools/audit/_p0_delete_batch9.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLY = process.argv.includes('--apply');
const UI = path.join(ROOT, 'lua', 'ui_controller.lua');
const raw = fs.readFileSync(UI, 'utf8');
const CRLF = (raw.match(/\r\n/g) || []).length > (raw.match(/(?<!\r)\n/g) || []).length;
let src = raw.replace(/\r\n/g, '\n');

const GLUE = 'self:_grid_log("giveway", "网格视窗：老的一套线索控件**整段不进规划**';
const MARK = '  end   -- ← 老一套线索控件到此为止：网格视窗在用时**整段跳过**（见上面那道守卫的长注释）';

const g = src.indexOf(GLUE);
const elseIdx = src.indexOf('\n  else\n', g);
const markIdx = src.indexOf(MARK);
const ok = g > 0 && elseIdx > g && markIdx > elseIdx && src.split(MARK).length === 2;
const lines = ok ? src.slice(elseIdx, markIdx + MARK.length).split('\n').length : 0;
console.log(`[${ok ? 'OK' : '✗'}] ui_controller · 老线索卡 else 分支　${lines} 行`);

// 反向保险：确认这段里确实含 clue.* 的 push，且不含 clues.bg/clues.grid
const span = ok ? src.slice(elseIdx, markIdx) : '';
const hasCluePush = /id = "clue\." \.\. i/.test(span);
const noLiveClues = !/clues\.(bg|grid|knob)/.test(span);
console.log(`[${hasCluePush ? 'OK' : '✗'}] 区间里确实是 id = "clue." .. i 那套`);
console.log(`[${noLiveClues ? 'OK' : '✗'}] 区间里没有误伤 clues.bg / clues.grid`);
if (!(ok && hasCluePush && noLiveClues)) { console.error('\n✗ 预检不通过 ⇒ 一个字节都不写'); process.exit(1); }

const REPL = [
  '',
  '  end   -- ★ 2026-10-20（优化组 · C 类清理）：**`else` 分支（老线索卡兜底）已删除** ✗✓',
  '        --   判据：真机日志 v276/v277「网格视窗：索引基准定为 0」「找到 clues.grid ✓」⇒ `grid_on` 恒真，',
  '        --     这段 `else` 一次都不执行；而布局计划里仍残留 **48 个 `clue.*`**',
  '        --     （就是每局那行「规划里有 40 个控件是【已知不需要】」的来源）。',
  '        --   用户指令：「老计划里到目前还没实现的都不需要保留了」⇒ 删。',
  '        --   ⚠️ `clues.bg` / `clues.grid` 是活的，**没动**；下面的「发完再扫一遍」第二道闸也**保留**',
  '        --      （它是防回归哨兵：万一以后有人在守卫外面又 push 一个 `clue.*`，会被当场剔除 ✓）',
  '        --   ⚠️ 要恢复旧卡片请从 git 历史取，**别**把 `else` 分支直接搬回来 ——',
  '        --      它每帧按名字抓手柄会撞到"已回收的列表项"（当年那个每帧抛错的老 bug）✗',
].join('\n');

if (!APPLY) {
  console.log(`\n将删除 ${lines} 行，替换为 ${REPL.split('\n').length} 行墓碑注释`);
  console.log('（DRY：什么都没写。要真删请加 --apply）');
  process.exit(0);
}

const out = src.slice(0, elseIdx) + REPL + src.slice(markIdx + MARK.length);
fs.writeFileSync(UI, CRLF ? out.replace(/\n/g, '\r\n') : out, 'utf8');

// 写后重读核对
const back = fs.readFileSync(UI, 'utf8').replace(/\r\n/g, '\n');
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--'));
const checks = [
  ['不再有 `id = "clue." .. i` 的 push', !code(back).some((l) => l.includes('id = "clue." .. i'))],
  ['不再有 `clue." .. i .. ".face"` 之类', !code(back).some((l) => /id = "clue\." \.\. i \.\. "\.(face|who|what|letter|badge|backrop)/.test(l))],
  ['`clues.grid` 仍在使用', code(back).some((l) => l.includes('clues.grid'))],
  ['`is_legacy_clue_id` 保留（第二道闸/渲染共用）', code(back).some((l) => l.includes('is_legacy_clue_id'))],
  ['`grid_on` 守卫仍在', code(back).some((l) => l.includes('local grid_on = '))],
  ['墓碑注释已写入', back.includes('（老线索卡兜底）已删除')],
];
console.log('\n── 从磁盘重读核对 ──');
let allOk = true;
for (const [label, okk] of checks) { console.log('  ' + (okk ? '✅' : '✗ ') + ' ' + label); if (!okk) allOk = false; }
if (!allOk) { console.error('\n✗ 写盘后核对不通过'); process.exit(1); }
console.log('\n★ 已写盘');
