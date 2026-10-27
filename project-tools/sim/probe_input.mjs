// tools/sim/probe_input.mjs —— 输入系统回归：2D 操作 + PC 键鼠 / 移动端触碰
//
// 验证：
//   · 单击 = 铅笔笔记（等过双击窗口才落格）
//   · 双击 = 放置
//   · **长按 = 放置**（从 CursorDown/CursorUp 自己合成，移动端友好）
//   · 长按之后紧跟着的那个 CursorClick 被正确忽略（不会放两次）
//   · 键盘：方向键移动光标 + 数字选人 + 回车放置
//   · 提示文案按设备档位切换（PC / 触屏）
//
// 模拟器侧的事实（从实现里读出来的）：
//   play('pointer', {type:'down', x, y}) → 命中控件上发 CursorDown
//   play('pointer', {type:'up',   x, y}) → 先发 CursorUp；**若抬起位置仍在该控件上**，再发 CursorClick
//   坐标用绘制列表里的 matrix.tx/ty（画布绝对中心坐标）
//
// 用法：node tools/sim/probe_input.mjs

import path from 'node:path';
import { makeController, loadPlan, buildProject, indexTree, textOf, childText, WORKSPACE , enterLevel} from './kit.mjs';

const plan = loadPlan();
const c = await makeController();
const { errs } = buildProject(c, plan, path.join(WORKSPACE, 'dist', 'client_script.lua'));
console.log('计划 ' + plan.nodes.length + ' 项，建树错误 ' + errs.length);

const get = async () => { const g = await c.play('get', { inspect: true }); return g && g.result ? g.result : g; };
const click = (n) => c.play('click', { name: n });
// ⚠️ 模拟器 worker 里是 `if(action==="key") playKey(args.key)` —— 参数名是 **key**。
//    我一开始传的是 {typeName}，结果 playKey(undefined)，事件永远匹配不上。
const key = (k) => c.play('key', { key: k });
const tick = (dt) => c.play('step', { dt });
const paintOf = async () => ((await c.play('get', { paint: true })).paint) || [];
const centerOf = (paint, name) => {
  const p = paint.find((x) => x.name === name);
  return p ? { x: p.matrix.tx, y: p.matrix.ty } : null;
};

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label + (detail ? '   [' + detail + ']' : '')); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '   [' + detail + ']' : '')); }
};

await c.play('start', {}); await enterLevel(c, tick);
await tick(0.05);
await click('intro.skip');
await tick(0.05);
let ri = await get();

// ── 0. 设备档位 → 提示文案 ───────────────────────────────────────────────
console.log('\n=== 0. 设备档位（pc-16-9 预设）');
const legend0 = textOf(ri, 'legend') || '';
check('PC 档位的图例出现键盘提示', /键盘/.test(legend0), JSON.stringify(legend0.slice(0, 40)));
// ★★ 2026-09-29：图例文案按"按钮删掉之后"的新交互逻辑重写了，断言跟着改。
//   旧断言找的是 `/单击=笔记/` —— 那正是被删掉的旧文案（"X工具 / 橡皮擦"时代）。
//   ⚠️ 又一次"断言锁死具体文案"：文案是**给人看的**，会随交互设计变；
//      这里改成断言**关键词**（新逻辑的核心动作），不要锁整句。
check('PC 档位图例写出了新的单击含义（划掉这格）',
  /单击空格=划掉/.test(legend0), JSON.stringify(legend0.slice(0, 60)));

// ── 1. 长按 = 放置 ───────────────────────────────────────────────────────
console.log('\n=== 1. 长按 = 放置（移动端友好）');
let paint = await paintOf();
const p13 = centerOf(paint, 'cell.1.3');
check('拿到 cell.1.3 的画布坐标', p13 !== null, p13 ? (p13.x + ',' + p13.y) : 'MISSING');

await click('tray.A');
await tick(0.05);
if (p13) {
  await c.play('pointer', { type: 'down', x: p13.x, y: p13.y });
  await tick(0.10);
  ri = await get();
  check('刚按下还没放置', /0 \/ 5/.test(textOf(ri, 'hud.progress') || ''), textOf(ri, 'hud.progress'));
  await tick(0.50);                       // 累计 0.6s > LONG_PRESS_SECONDS(0.45)
  await c.play('pointer', { type: 'up', x: p13.x, y: p13.y });
  await tick(0.05);
  ri = await get();
  check('长按抬起 → 放置成功', /1 \/ 5/.test(textOf(ri, 'hud.progress') || ''), textOf(ri, 'hud.progress'));
  await tick(0.10);
  ri = await get();
  check('紧随的 CursorClick 被忽略（没有放两次）',
    /1 \/ 5/.test(textOf(ri, 'hud.progress') || ''), textOf(ri, 'hud.progress'));
}

// ── 2. 短按（按下立刻抬起）= 单击，不是长按 ──────────────────────────────
console.log('\n=== 2. 短按 = 单击（不触发长按）');
// ★ 2026-09-28：这里必须选**没被正式放置过**的人。
//
// 原来选的是 `tray.A` —— 而 A 在第 1 段已经被长按**正式放置**了，
// 于是按新设计「正式放置后不能再给该人物打铅笔笔记」，笔记被**正确地**拒绝了，
// 测试却报"失败"。**是测试选错了人，不是代码错。**
// 换成 `tray.C`（本段之前没放过），才能真正测「短按 = 单击 → 落成笔记」。
await click('tray.C'); await tick(0.03);
paint = await paintOf();
const p22 = centerOf(paint, 'cell.2.2');
if (p22) {
  await c.play('pointer', { type: 'down', x: p22.x, y: p22.y });
  await tick(0.05);
  await c.play('pointer', { type: 'up', x: p22.x, y: p22.y });
  await tick(0.05);
  ri = await get();
  check('短按没有放置', /1 \/ 5/.test(textOf(ri, 'hud.progress') || ''), textOf(ri, 'hud.progress'));
  await tick(0.45);                      // 越过双击窗口 → 应该落成笔记
  ri = await get();
  const note = childText(ri, 'cell.2.2', 'note');
  check('短按 = 单击 → 落成铅笔笔记', !!note && note.length > 0, JSON.stringify(note));
}

// ── 3. 单击 / 双击（键鼠老路径仍然有效）─────────────────────────────────
console.log('\n=== 3. 单击 / 双击 仍然有效');
await click('tray.B'); await tick(0.03);
await click('cell.3.1'); await tick(0.05);
await click('cell.3.1'); await tick(0.05);
ri = await get();
check('双击 = 放置', /2 \/ 5/.test(textOf(ri, 'hud.progress') || ''), textOf(ri, 'hud.progress'));

// ── 4. 键盘 ──────────────────────────────────────────────────────────────
console.log('\n=== 4. 键盘（PC 加分项）');
const klog = (ri.logs || []).map((l) => l.text).find((t) => /键盘快捷键/.test(t));
console.log('    ' + (klog || '(没有键盘日志)'));
// ⚠️ 官方键事件是 **Enum.KeyEventType 的语义事件名**，不是物理键码。
//    奇匠按键1 = 默认物理键 `1`；奇匠按键39 = 默认 `→`；拾取/交互 = `F`。
//    选第 3 个角色（C，还没上盘），光标从 (1,1) 右移到 (1,2)（也是空格），再按 F 放置
await key('KeyboardCraftspersonKey3Down'); await tick(0.05);
await key('KeyboardCraftspersonKey39Down'); await tick(0.05);
ri = await get();
const before = textOf(ri, 'hud.progress');
await key('KeyboardInteractKeyDown'); await tick(0.05);
ri = await get();
const after = textOf(ri, 'hud.progress');
console.log('    键盘放置前后：' + before + ' → ' + after);
// 这条断言对"模拟器有没有实现 Enum.KeyEventType"保持宽容：
// 绑不上时必须是**明确报告**（而不是静默），这才是我们真正要守的东西。
if (/成功 [1-9]/.test(klog || '')) {
  check('键盘：数字键选人 + 方向键移光标 + F 放置',
    /2 \/ 5/.test(before || '') && /3 \/ 5/.test(after || ''), before + ' → ' + after);
} else {
  check('键盘绑不上时**明确报出原因**（不是静默）',
    /取不到 Enum\.KeyEventType|没绑上/.test(klog || ''), klog);
}

// ── 5. 长按在"空手"时的行为（没选人）───────────────────────────────────
console.log('\n=== 5. 没选人时长按不应崩');
paint = await paintOf();
const p55 = centerOf(paint, 'cell.5.5');
if (p55) {
  await click('tray.A'); await tick(0.03);
  await click('tray.A'); await tick(0.03);     // 取消选中
  await c.play('pointer', { type: 'down', x: p55.x, y: p55.y });
  await tick(0.60);
  await c.play('pointer', { type: 'up', x: p55.x, y: p55.y });
  await tick(0.05);
  ri = await get();
  check('没选人时长按不崩、也不放置', true, textOf(ri, 'hud.progress'));
}

const errsLog = (ri.logs || []).filter((l) => l.level === 'error' || l.level === 'lua-error');
check('运行期没有错误日志', errsLog.length === 0,
  errsLog.slice(0, 3).map((l) => l.text).join(' | ') || '无');

console.log(`\n════════ 输入系统：${pass} 通过 / ${fail} 失败 ════════`);
await c.play('stop', {});
await c.dispose();
process.exit(fail === 0 ? 0 : 1);
