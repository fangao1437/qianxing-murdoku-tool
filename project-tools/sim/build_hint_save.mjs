// tools/sim/build_hint_save.mjs —— 用 layout-plan 建整棵树 ⇒ 存成**可被 qxqy_studio_load 拉取的存档**
//
//   用途：给「线索卡位置提示」这一轮取模拟器证据（选中卡片 ⇒ 棋盘出现半透明浅蓝高亮）。
//   前置：lua tools/dump_layout.lua        （生成 tools/sim/out/layout-plan.json）
//         lua tools/bundle_client_script.lua（生成 dist/client_script.lua）
//   运行：node tools/sim/build_hint_save.mjs
//
//   ★ 为什么不用 build_ui.mjs：它只 dump `ui-project.json`（这是"快照"不是"存档"）✗
//     `saveArchive()` 写的是 `{format:"qxqy-simulator-save", version:4, assets:{server,client,scripts}}`
//     ⇒ 那才是 `qxqy_studio_load` 认的存档 ✓
import path from 'node:path';
import { makeController, loadPlan, buildProject, WORKSPACE } from './kit.mjs';

const LUA_FILE = path.join(WORKSPACE, 'dist', 'client_script.lua');
const OUT_REL = 'sim-save/hint-v255.save.json';   // 相对 WORKSPACE（= qianxing-murdoku）

const plan = loadPlan();
const c = await makeController();
const { errs, made, subs, planIds } = buildProject(c, plan, LUA_FILE);
console.log('计划 ' + plan.nodes.length + ' 项 → 主控件 ' + made + ' + 子控件 ' + subs
  + '，建树错误 ' + errs.length);
for (const e of errs.slice(0, 20)) console.log('  [ERR] ' + e);

const saved = await c.saveArchive(OUT_REL);
console.log('存档已写 → ' + path.join(WORKSPACE, OUT_REL));
console.log('  bytes=' + saved.bytes + ' revision=' + saved.revision + ' name=' + saved.name);
await c.dispose();
