// tools/sim/build_ui.mjs —— 只建树 + 截图（交互回归请用 play_test.mjs）
//
// 前置：lua tools/dump_layout.lua
// 运行：node tools/sim/build_ui.mjs [luaFile]
//
// 坐标语义见 kit.mjs 顶部注释。

import path from 'node:path';
import { makeController, loadPlan, buildProject, textOf, indexTree, dumpJson, shot, WORKSPACE } from './kit.mjs';

const LUA_FILE = process.argv[2] || path.join(WORKSPACE, 'dist', 'client_script.lua');
const plan = loadPlan();
const c = await makeController();

const { errs, made, subs, planIds } = buildProject(c, plan, LUA_FILE);
console.log('计划 ' + plan.nodes.length + ' 项 → 主控件 ' + made + ' + 子控件 ' + subs + '，建树错误 ' + errs.length);
for (const e of errs.slice(0, 20)) console.log('  [ERR] ' + e);
dumpJson('ui-project.json', c.get());

await c.play('start', {});
await c.play('step', { dt: 1 });
const gi = await c.play('get', { inspect: true });
const ri = gi && gi.result ? gi.result : gi;
dumpJson('ui-inspect.json', ri);

console.log('运行树 ' + indexTree(ri).size + ' 个不同名字的节点');
console.log('标题: ' + JSON.stringify(textOf(ri, 'hud.title')));
console.log('进度: ' + JSON.stringify(textOf(ri, 'hud.progress')));
const missing = new Set((ri.logs || []).filter((l) => l.level === 'error')
  .map((l) => (l.text.match(/控件未找到：(\S+)/) || [])[1]).filter(Boolean));
console.log('脚本找不到的、且本来就在计划里的控件: '
  + ([...missing].filter((m) => planIds.has(m)).join(' ') || '(无)'));

console.log('截图 -> ' + await shot(c, 'ui.png'));
await c.play('stop', {});
await c.dispose();
