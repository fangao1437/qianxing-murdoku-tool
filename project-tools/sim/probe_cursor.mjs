// tools/sim/probe_cursor.mjs —— 验证「脚本能不能自己打开容器的显示常驻光标」
//
// 背景（详见 docs/环境问题-诊断记录.md 门控 ②）：
//   真机上点不动界面，头号原因是控件的祖先容器没打开 `showCursor`（编辑器里的
//   「显示常驻光标」）。正常要手勾 —— 如果 Lua 侧允许写这个字段，
//   `Adapter:enable_cursor()` 就能自己搞定，少一个最容易漏的手工步骤。
//
// 做法：建 UI 时**故意不打开** showCursor（模拟真机默认状态），
//       然后看脚本能不能救活点击。
//
// 用法：node tools/sim/probe_cursor.mjs

import path from 'node:path';
import { makeController, loadPlan, buildProject, indexTree, textOf, visibleOf, WORKSPACE } from './kit.mjs';

const plan = loadPlan();
const c = await makeController();

console.log('=== 建 UI：**故意不打开** showCursor（模拟真机默认）');
const { errs } = buildProject(c, plan, path.join(WORKSPACE, 'dist', 'client_script.lua'),
  { showCursor: false });
console.log('    建树错误 ' + errs.length);

const get = async () => { const g = await c.play('get', { inspect: true }); return g && g.result ? g.result : g; };
const click = (n) => c.play('click', { name: n });
const tick = (dt) => c.play('step', { dt });

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label + (detail ? '   [' + detail + ']' : '')); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '   [' + detail + ']' : '')); }
};

await c.play('start', {});
await tick(0.05);
let ri = await get();

const infos = (ri.logs || []).filter((l) => l.level !== 'error').map((l) => l.text);
const autoLine = infos.find((t) => t.includes('显示常驻光标'));
console.log('\n=== 脚本自述');
for (const t of infos) console.log('    ' + t);

check('脚本尝试自动打开「显示常驻光标」', !!autoLine, autoLine || '(没有这条日志)');
check('Lua 侧确实写得进去这个字段', !!autoLine && /已由脚本打开 [1-9]/.test(autoLine),
  '若失败说明真机也写不了，必须手勾');

// ── 关键：点击到底能不能到脚本 ──────────────────────────────────────────
console.log('\n=== 关键验证：点击能否到达脚本');
await click('intro.skip'); await tick(0.05);
ri = await get();
check('「跳过教程」按钮生效（证明点击通道是通的）', visibleOf(ri, 'intro') === false,
  'intro.visible=' + visibleOf(ri, 'intro'));

// ★★ 2026-10-05 原来点的是 `tray.A` —— 那是**已经死掉的旧入口** ✗
//
//   2026-10-02 头像并进线索卡之后，`build_layout` 里 `local n_tray = 0`
//   （见 lua/ui_controller.lua 里 `tray` 那段注释）⇒ `for i = 1, n_tray` **一次都不跑**
//   ⇒ 规划里**一个 `tray.*` 控件都没有**（实测 `tray.*` = 0 个 ✓）
//   ⇒ `click('tray.A')` 点了等于没点 ⇒ 后面那个"双击放置"必然红 ✗（`13/13` 里唯一那条 ✓）。
//
//   现在点**线索卡上的头像** —— 它是全屏唯一的头像，也是 `suspect` 事件唯一的来源 ✓
//   （`clue.<i>.face` 带 `event = { action = "suspect", id = <角色id> }` ✓）。
//
//   ⚠️ 为什么是 `clue.1.face`：本探针 `loadPlan()` 读的是**全关卡并集**
//      `tools/sim/out/layout-plan.json`，而计划里只保留 `action`、**不保留 `event.id`**
//      （见 `layout_plan()` 那段注释）⇒ 计划文本里查不到"第 1 张卡是谁" ✗。
//      在**默认关卡** `selftest_theft_5x5`（`levels.init` 的 LIST 第一项 = 开局那一关 ✓）里，
//      `clue.1` 是「医生 在 第3行第2列」⇒ 头像 id = **B** ✓（实测 `clue.1.face → event.id=B` ✓）。
//   ⚠️ 改关卡顺序 / 改第一关线索顺序都会让这个 id 变 —— 那时这里要跟着改 ✓
//      （找不到控件时 `click` 不会静默成功，下面那条"双击放置"会当场红 ✓ 不会骗人 ✓）
//   ⚠️ 前置：`tools/sim/out/layout-plan.json` 必须是**重新生成过**的
//      （`lua tools/dump_layout.lua` ✓）—— 旧计划里 `clue.1.face` 没有 `action`，
//      点下去不会派发 `suspect` ⇒ 又是"点了没反应" ✗
await click('clue.1.face'); await tick(0.03);
await click('cell.1.3'); await tick(0.03);
await click('cell.1.3'); await tick(0.05);
ri = await get();
const progress = textOf(ri, 'hud.progress');
check('双击放置生效（证明整个交互链路是通的）', /1 \/ 5/.test(progress || ''), progress);

console.log(`\n════════ 结论：${pass} 通过 / ${fail} 失败 ════════`);
if (fail === 0) {
  console.log('脚本能自己打开 showCursor —— 真机上「显示常驻光标」这一项**不需要你手动勾**。');
} else {
  console.log('脚本打不开 showCursor —— 真机上**必须手动勾选**容器的「显示常驻光标」。');
}
await c.play('stop', {});
await c.dispose();
process.exit(fail === 0 ? 0 : 1);
