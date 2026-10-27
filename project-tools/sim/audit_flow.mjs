// tools/sim/audit_flow.mjs —— **操作动线审计**（主页 / 选关 / 关卡三处）
//
// 为什么要有它：布局已经盘过了（audit_layout.mjs），但"点进去出不来""切关后状态还在"
// 这类问题**布局审计看不见** —— 它们是**状态机**的问题。
//
//   这一版专门走真实动线，每一步都断言"该看见什么 / 不该看见什么"：
//     ① 主页 → 选关 → 返回主页
//     ② 主页 → 选关 → 卡片 → 关卡
//     ③ 关卡 →「返回列表」→ 选关
//     ④ 选关 → 另一张卡片 → **切关**（不是回到同一关）
//     ⑤ 切关后**状态要重置**（棋盘清空、进度归零、线索回到顶部）
//     ⑥ 关卡 →「重置关卡」→ 停在本关、棋盘清空
//     ⑦ 乱点不崩（连点返回、反复进出）
//
// 用法：node tools/sim/audit_flow.mjs

import path from 'node:path';
import { makeController, loadPlan, buildProject, indexTree, textOf, visibleOf, WORKSPACE } from './kit.mjs';

const c = await makeController();
// ★ 2026-10-09：把 `loadPlan()` 的结果**绑到 `plan`** —— 本轮新加的哨兵要用它
//   （原来只把返回值直接喂给 `buildProject`，没留引用 ⇒ 脚本里没有 `plan` 这个变量 ✓）
const plan = loadPlan();
buildProject(c, plan, path.join(WORKSPACE, 'dist', 'client_script.lua'));

const get = async () => { const g = await c.play('get', { inspect: true }); return g && g.result ? g.result : g; };
const tick = async (dt) => { await c.play('step', { dt }); };
const click = async (n) => { await c.play('click', { name: n }); };

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name + (extra ? '   [' + extra + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   [' + extra + ']' : '')); }
}
/** 等一个小段时间（点击要经过一帧才反映到树上） */
const settle = async (n = 3) => { for (let i = 0; i < n; i++) await tick(0.08); };

/**
 * **点一下 + 等到"页面真的变成 target"**。
 *
 * ★★★ 2026-10-01：为什么不能只 `click` 完 `tick` 固定几帧 ——
 *   单独跑这个脚本是 17/0，但放进 `check_all` 里（前面刚跑完一堆重活）就变成 14/3：
 *   **同一段代码、不同负载下 tick 几帧不够**。猜"睡多久"永远猜不准，
 *   所以改成**轮询到状态真的变了为止**（有上限，不会挂死）。
 */
async function clickUntil(name, want, tries = 24) {
  await click(name);
  for (let i = 0; i < tries; i++) {
    await tick(0.06);
    const cur = where(await get());
    if (cur === want) return cur;
  }
  return where(await get());
}
/** 当前在哪个页面 */
function where(ri) {
  if (visibleOf(ri, 'home') === true) return 'home';
  if (visibleOf(ri, 'select') === true) return 'select';
  if (visibleOf(ri, 'board') === true) return 'level';
  return '?';
}
/** 棋盘上有几个"已放置"的（看每格的 face 有没有图 —— 用 obj/tray 太间接，直接数 cell 的可见 face 文字太多；
 *  改用"提交按钮是否可点"这个间接信号：摆满才能提交） */
const progressText = (ri) => String(textOf(ri, 'hud.progress') || '');
// ★ 2026-10-09 **删掉 `movesText`** ✗✓ —— 它读的 `hud.moves` **已不存在** ✓
//   （实测 `layout-plan.json`：`hud.*` 只有 title/subtitle/timer/progress；
//    `moves` 现在只活在信号契约 `M.SIGNAL_SCHEMA` 里 ✓）
//   留着它只会让"步数归零"那种**恒红**断言继续出现 ✓ ⇒ 两处调用都已改判 ✓
//   （⑤ 改成哨兵、⑥ 改成真读 `hud.progress` —— 见下面两段的说明 ✓）

await c.play('start', {}); await settle();
let ri = await get();

// ① 主页 → 选关 → 返回主页
console.log('\n── ① 主页 ⇄ 选关 ──');
check('开局在主页', where(ri) === 'home', where(ri));
await clickUntil('home.select', 'select');
ri = await get();
check('点「选关」进选关', where(ri) === 'select', where(ri));
await clickUntil('select.back', 'home');
ri = await get();
check('点「返回主页」回主页', where(ri) === 'home', where(ri));

// ② 主页 → 选关 → 卡片 → 关卡
console.log('\n── ② 选关 → 关卡 ──');
await clickUntil('home.select', 'select');
await click('select.card.2'); await settle();
await click('intro.skip'); await settle();
ri = await get();
check('点卡片进关卡（跳过教程后）', where(ri) === 'level', where(ri));
const level1Title = String(textOf(ri, 'hud.title') || '');
check('关卡标题是刚点的那一关', level1Title.length > 0, JSON.stringify(level1Title));

// ③ 关卡 →「返回列表」→ 选关
//
// ★★★★★ 2026-10-05 **改成"像玩家一样操作"** ✗✓（**不是放宽断言** ✗）
//
//   为什么：B2（用户 2026-10-05 批准 ✓ 提交 `27798af` ✓）把 `action.back` 的**派发**改成了
//     「**认领这颗控件的那个节点赢**」✓ ⇒ 那颗按钮现在派发 **`back_confirm`** ✓
//     ⇒ ★ **点一下会先弹 ✓/✗ 确认，不再直接跳转** ✗
//
//   ★ 依据是**单变量实验**（本文件不是猜的 ✓ —— 见 `docs/L3基线-模拟器四步失败清单.md` §7 ✓）：
//     · **B2 之前**（worktree @ `7a9d76a` ✓）：**17 通过 / 0 失败** ✓
//       其中「点返回列表回选关」**一步就到 `select`** ✓ ·「能一路回主页」**只用 1 步** ✓
//     · **B2 之后**：**15 通过 / 2 失败** ✗ —— 停在 `[level]` ✗ · 回主页**用了 7 步** ✗
//     ⇒ ★ 差额**完全归因于 B2** ✓（两棵树只差这一处 ✓）
//
//   ★ 所以断言「**点「返回列表」回选关**」（下一行 ✓）**原样保留** ✓ ——
//     只是把"玩家要点两下"这件事**如实做出来** ✓✓
//   ★ 确认按钮 = **`hex.ok`** ✓（`ui_controller.lua:1434`
//     `{ "hex.ok", 100102, …, "confirm_yes" }` ✓ —— 注释原话「确认卡 ✓ → 执行 pending」✓）
//     ★ 它**在计划里** ✓（计划有 `hex.back/hex.submit/hex.redo/hex.undo/hex.hint/hex.ok/hex.no` ✓）
//   ★ 写法**对 B2 前后都成立** ✓：先点返回 ✓；若没到选关 ⇒ **再点一次 ✓** ✓；
//     最多试 12 轮 ✓ ⇒ ★ **不写死"一定要点两下"** ✗（免得将来又改一次 ✓）
async function backToSelect() {
  for (let i = 0; i < 12; i++) {
    await click('action.back'); await settle();
    let r = await get();
    if (where(r) === 'select') return true;
    // ★ 弹了确认 ⇒ 点 ✓（`hex.ok` = `confirm_yes` ✓）
    if (where(r) === 'level' || where(r) === 'select') {
      await click('hex.ok'); await settle();
      r = await get();
      if (where(r) === 'select') return true;
    }
  }
  return false;
}
console.log('\n── ③ 关卡 → 返回列表 ──');
await backToSelect();
ri = await get();
check('点「返回列表」回选关', where(ri) === 'select', where(ri));

// ④ 选关 → 另一张卡片 → 切关
console.log('\n── ④ 切关 ──');
await click('select.card.3'); await settle();
await click('intro.skip'); await settle();
ri = await get();
check('换一张卡片能进（切关）', where(ri) === 'level', where(ri));
const level2Title = String(textOf(ri, 'hud.title') || '');
check('标题换成了另一关（不是回到原来那关）', level2Title !== level1Title,
  JSON.stringify(level1Title) + ' → ' + JSON.stringify(level2Title));

// ⑤ 切关后状态重置
console.log('\n── ⑤ 切关后状态重置 ──');
// ★★★★★ 2026-10-09 **改判（依据，不是放宽）**：`hud.moves` **已不存在** ✗✓
//   （实测 `layout-plan.json`：`hud.*` 只有 title/subtitle/timer/progress；
//    `ui_controller.lua:2136` 的 `hud.timer` 现在只放时间；`moves` 只在信号契约里 ✓）
//   ⇒ 原来这两条读 `hud.moves` 得 `""` ⇒ **永远红** ✓
//   ★ 改法 ✓：**「归零」这件事由还活着的 `hud.progress` 来锁** ✓
//     下面那条 `新关卡的进度归零` 本来就在 ✓ ⇒ 这里改成**哨兵**（不再重复读同一个事实 ✓）
check('步数显示 hud.moves 按设计已移除（若出现 ⇒ 上面这条应改回读它）',
  !plan.nodes.some((n) => n.id === 'hud.moves'),
  plan.nodes.some((n) => n.id === 'hud.moves') ? '★ 它又出现了' : '计划里没有 ✓');
check('新关卡的进度归零', /0\s*\//.test(progressText(ri)) || progressText(ri) === '',
  JSON.stringify(progressText(ri)));

// ⑥ 「重置关卡」停在本关
console.log('\n── ⑥ 重置关卡 ──');
// ★ 2026-10-09：`action.redo` **按设计已删** ✗（本仓库 `play_test.mjs` 的 `OLD_TEXT_KEYS`
//   自己就断言它"按设计不存在" ✓）⇒ 点它**什么都不发生** ⇒
//   原来那条「仍在本关」是**假绿**（点了没反应当然还在本关 ✗）✓ 接替者 = **`hex.redo`** ✓
await click('hex.redo'); await settle();
ri = await get();
check('点「重置关卡」仍在本关', where(ri) === 'level', where(ri));
check('重置后标题不变（没被送回主页/选关）',
  String(textOf(ri, 'hud.title') || '') === level2Title, JSON.stringify(textOf(ri, 'hud.title')));
// ★ 2026-10-09 **补一条真断言**：原来这里读的是已删的 `hud.moves`（恒 `""` ⇒ 恒红 ✗），
//   而 `重置后进度归零` **从来没被断言过** ✗ ⇒ 现在改成读还活着的 `hud.progress` ✓
//   —— 这比原来**更强**（原来那条根本测不到任何东西 ✓）
check('重置后进度归零', /0\s*\//.test(progressText(ri)),
  JSON.stringify(progressText(ri)));

// ⑦ 乱点不崩（连点返回、反复进出）
console.log('\n── ⑦ 乱点不崩 ──');
for (let i = 0; i < 3; i++) { await click('action.back'); await settle(1); }
await settle();
ri = await get();
check('连点「返回列表」不崩且停在合法页面', ['home', 'select', 'level'].indexOf(where(ri)) >= 0, where(ri));
// 从当前页回到主页（如果不在主页）
//
// ★★★★★ 2026-10-05 **同一件事的第二处** ✗✓（依据同上：B2 让返回变成两段式 ✓ 见文件上方那段）
//   · 旧写法点完 `action.back` **不点确认** ✗ ⇒ 停在 `level` ✗
//   · 且 `guard < 6` 的**上限太小** ✗ —— B2 之后实测**用了 7 步才到主页** ✗（基线 §7 ✓）
//   ⇒ ★ 修法：`level` 时**返回 + 点 ✓ 确认** ✓；上限放宽到 **24** ✓（★ 上限只是防死循环 ✓ 不是判据 ✓）
//   ★ 断言「**能一路回到主页（不存在断头路）**」**原样保留** ✓ —— ★ 它量的仍是"能不能到主页" ✓
let guard = 0;
while (where(ri) !== 'home' && guard++ < 24) {
  if (where(ri) === 'level') {
    await click('action.back'); await settle();
    // ★ 弹了确认 ⇒ 点 ✓（`hex.ok` = `confirm_yes` ✓ `ui_controller.lua:1434` ✓）
    await click('hex.ok');
  } else if (where(ri) === 'select') {
    await click('select.back');
  }
  await settle();
  ri = await get();
}
check('能一路回到主页（不存在断头路）', where(ri) === 'home', '用了 ' + guard + ' 步');
// 反复进出 5 次
for (let i = 0; i < 5; i++) {
  await click('home.select'); await settle(1);
  await click('select.back'); await settle(1);
}
ri = await get();
check('反复进出 5 次后仍在主页', where(ri) === 'home', where(ri));

const errs = (ri.logs || []).filter((l) => l.level === 'error');
check('全程没有 error 级日志', errs.length === 0, errs.length + ' 条: ' + errs.slice(0, 3).map((l) => l.text).join(' | '));

console.log('\n════════ 动线审计：' + pass + ' 通过 / ' + fail + ' 失败 ════════');
await c.play('stop', {});
await c.dispose();
process.exit(fail === 0 ? 0 : 1);
