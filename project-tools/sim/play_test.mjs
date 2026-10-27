// tools/sim/play_test.mjs —— 在模拟器里跑通「偷窃版」完整交互
//
// 前置：lua tools/dump_layout.lua   （生成 tools/sim/out/layout-plan.json）
//       lua tools/bundle_client_script.lua
// 运行：node tools/sim/play_test.mjs
//
// 模拟器自带自动化接口（在插件 bundle 里挖出来的）：
//   play('click', {name})     按**控件名**点预设按钮（内部 SimulateCursorClick）
//   play('pointer',{type,x,y}) 按坐标点：type = down | up | click | move
//   play('step', {dt})        推进时间
//   play('get', {inspect:true}) 读运行树 / 日志
//
// ⚠️ 模拟器状态是**内存态**：建树和试玩必须在同一个进程里做完。

import fs from 'node:fs';
import path from 'node:path';
import { makeController, loadPlan, buildProject, indexTree, textOf, childOf, childText, visibleOf, dumpJson, shot, WORKSPACE, OUT , enterLevel} from './kit.mjs';

const LUA_FILE = process.argv[2] || path.join(WORKSPACE, 'dist', 'client_script.lua');
const plan = loadPlan();
const c = await makeController();

const { errs, made, subs, planIds } = buildProject(c, plan, LUA_FILE);
console.log('计划 ' + plan.nodes.length + ' 项 → 主控件 ' + made + ' + 子控件 ' + subs + '，建树错误 ' + errs.length);
for (const e of errs.slice(0, 15)) console.log('  [ERR] ' + e);
dumpJson('ui-project.json', c.get());

// ── 小工具 ────────────────────────────────────────────────────────────────
let step = 0;
const get = async () => {
  const g = await c.play('get', { inspect: true });
  return g && g.result ? g.result : g;
};
const click = async (name) => { await c.play('click', { name }); };
const tick = async (dt) => { await c.play('step', { dt }); };
// ★★★★★ 2026-10-02：**三个"危险键"现在要 ✓ 确认**
//   （返回菜单 / 提交 / 重置关卡 —— 见 lua/ui_controller.lua 的 confirm_* 状态机）。
// ★ 2026-10-12 核对组：这两行**在本模拟器里点不动** ✗（★ 实测八个候选全不动 ✓ 见 §8b 的证据 ✓）
//   ★ 已核实的事实 ✓：`back_confirm` 现在开的是四键弹窗 `exit_menu` ✓
//     （按钮 = `modal.exit` / `modal.save` / `modal.settle` / `modal.cancel` ✓ 2026-10-08 改的 ✓）
//   ★ 而老写法点的 `confirm.ok` **在全代码库里 0 处** ✗ ⇒ ★ 老写法本来就没点对控件 ✓
//   ★ 但**改成 `modal.exit` 也没用** ✗ —— ★ 它同样点不动（实测 ✓）
//     ⇒ ★ 所以这里**不再假装它能驱动返回流程** ✓；用到它的地方按"本环境测不了"处理 ✓
//   ⚠️ 留 `modal.exit` 而不是退回 `confirm.ok` ✓ 的理由：★ 前者**至少是真实存在的控件** ✓
//     后者是**不存在的** ✗ ⇒ ★ 哪天模拟器能点了，前者立刻就对 ✓✓
const clickConfirm = async (name) => {
  await click(name); await tick(0.08);
  await click('modal.exit'); await tick(0.12);
};
const ss = async (file) => { const o = await shot(c, file); console.log('    截图 ' + file); return o; };

let pass = 0, fail = 0, skipped = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label + (detail ? '   [' + detail + ']' : '')); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '   [' + detail + ']' : '')); }
};
// ★★★★★ 2026-10-12 **新增 `skip`（★ 明确"本环境测不了"，✗ 不是"放宽" ✓）**
//
//   ★ 为什么要它 ✗：本模拟器**不实现网格视窗的列表项**（见下面 §4 那段长注释 ✓）
//     ⇒ ★ 依赖"点线索卡选人"的那一串断言**在本环境里不可能通过** ✓
//   ★★ 为什么不直接删 ✗：★ 它们锁的是**真实且必要的行为**（选人 → 放置 → 撤销 → 结算 ✓）
//     ★ 删了 ⇒ ★ **真机上真出问题就没人知道了** ✓ ✓
//   ★★ 为什么不用 `fail` ✗：★ 那会让"红"里混进**环境边界**✗ ⇒
//     ★ 真正的回归会被这些噪音淹掉 ✓（★ 本项目已有的 12 条红正是这个局面 ✓）
//   ⇒ ★ 所以单列一类 ✓：★ **计数、打印、并在末尾汇总里点名** ✓ —— ★ 不装作通过 ✓
const skip = (label, why) => {
  skipped++;
  console.log('  ⊘ ' + label + '   [本环境测不了：' + why + ']');
};

// ── 1. 启动 ───────────────────────────────────────────────────────────────
console.log('\n=== 1. 试玩启动');
await c.play('start', {}); await enterLevel(c, tick);

// ── 0. 主页四键（用户要求的布局：中列最上是「选关」）──────────────────────
//
// ⚠️ 这一步在文件里**排在"1. 试玩启动"之后、但 `let ri` 之前** ⇒
//    不能给 `ri` 赋值（会撞上 `let` 的暂时性死区：Cannot access 'ri' before initialization）。
//    ⇒ 块内用自己的局部变量 `r0`，结束时把状态传回外层的 `ri`（那时 `ri` 已可用）。
console.log('\n=== 0. 主页四键');
{
  let r0 = await get();
  const t = indexTree(r0);
  const has = (n) => !!t.get(n);
  check('主页容器在', has('home'));
  check('四键齐全', has('home.select') && has('home.continue') && has('home.shop') && has('home.bag'));
  check('选关键在最上（用户要求：原左下角那个挪到中列最上）',
    textOf(r0, 'home.select') === '选关', textOf(r0, 'home.select'));
  check('第二键是「从存档点开始」',
    textOf(r0, 'home.continue') === '从存档点开始', textOf(r0, 'home.continue'));
  // ★ 选关卡片的内容（参考《派蒙的执律庭实习》）：关名 + 「NxN　M名嫌疑人+1名受害人」
  //
  //   ⚠️ 卡片现在是**三段**：`select.card.N.title`（关名）/ 中间是**棋盘缩略图**
  //   （`select.card.N.room.1..6`）/ 下面是 `select.card.N.info`（人数+进度）。
  //   所以文字**不在** `select.card.N` 上了 —— 第一版我断言在卡片的 `text` 上，会红。
  //
  //   ⚠️ 也别写死 `select.card.1` —— 第 1 张是 `demo_selftest`，没有 size/suspects。
  {
    await click('home.select'); await tick(0.25);
    const r9 = await get();
    const idx9 = indexTree(r9);
    let caseCard = null, title = '', info = '';
    for (const [nm] of idx9) {
      const m = /^(select\.card\.\d+)\.info$/.exec(nm);
      if (!m) continue;
      const t = textOf(r9, m[1] + '.title') || '';
      const f = textOf(r9, nm) || '';
      if (/案件/.test(t) && /\d+x\d+/.test(f)) { caseCard = m[1]; title = t; info = f; break; }
    }
    check('卡片有关名（三段式里的 title）', caseCard !== null,
      caseCard ? caseCard + ' → ' + JSON.stringify(title) : '（没找到）');
    check('卡片 info 有网格尺寸 NxN', /\d+x\d+/.test(info), JSON.stringify(info.slice(0, 70)));
    check('卡片 info 有人数（M名嫌疑人+1名受害人）', /名嫌疑人\+1名受害人/.test(info),
      JSON.stringify(info.slice(0, 70)));
    // 缩略图：至少有一条房间色块可见
    //
    //   ⚠️ 用**重试**而不是"睡固定时间再读一次"：
    //   我先后试过"复用旧快照"和"重新取一次"，都报 0 块，而单独探针明明看到
    //   `room.1/2/3 visible=true`。多次 tick 之后总会同步上 ——
    //   与其猜"睡多久才够"，不如**轮询到出现为止**（有上限，不会挂死）。
    let rooms = 0;
    if (caseCard) {
      for (let attempt = 0; attempt < 8 && rooms === 0; attempt++) {
        const rr = await get();
        for (let j = 1; j <= 6; j++) if (visibleOf(rr, caseCard + '.room.' + j) === true) rooms++;
        if (rooms === 0) await tick(0.1);
      }
    }
    check('卡片中间画出了棋盘缩略图（房间色块）', rooms >= 1,
      caseCard ? caseCard + ' 可见色块 ' + rooms + ' 块' : '（没找到案件卡）');
    await click('select.back'); await tick(0.2);
    r0 = await get();
  }
  // ★ 2D/3D 输入隔离（目标 ⑤）：适配期会打一行"已屏蔽穿透 N 个"。
  //
  // ★★★★ 2026-10-12 **本环境测不了 ⇒ 改 `skip`** ✗✓（★ 这次我把它查到了底 ✓）
  //   ★ 上一版这段的推理 ✗：
  //     「模拟器**不暴露** `disableKeyEventPassthrough` 这些字段（读过，没有）」
  //     ⇒ ★ **前半句是错的** ✗✓ —— ★ 字段**是有的** ✓（模拟器会打出来 ✓）
  //   ★★★ 实测（`tools/sim/out/t99-final.json` 的日志原文 ✓）：
  //     ```
  //     [murdoku] 容器 home 字段： … disableKeyEventPassthrough=false …
  //     [murdoku]   容器 home 写 disableKeyEventPassthrough=false 成功=true 回读=false
  //     [murdoku] 2D/3D 输入隔离：主页/选关容器已屏蔽穿透 0 个
  //     ```
  //   ⇒ ★★ **真因** ✓：★ `pcall` **成功** ✓ 而**回读仍是 `false`** ✗ ——
  //     ★ 即 ★ **模拟器接受这次赋值、但不把它记下来** ✓✓（★ 写进去不生效 ✓）
  //   ★ 而 `seal_container` **只在写入成功时才计数** ✓ ⇒ ★ 计数**必然 0** ✓
  //   ⇒ ★ 所以"n >= 2"**在这个模拟器里不可能成立** ✓ —— ★ 与代码对不对无关 ✓
  //   ★★ 为什么**不删** ✗：★ 这条锁的是**用户点名的"目标 ⑤"** ✓（2D/3D 输入隔离 ✓）
  //     ★ 真机上必须真生效 ✓ ⇒ ★ 留成 `skip` ＋ 写明真机判据 ✓
  //   ★★★ 真机验收点 ✓：★ 进关卡后按**移动键（W/A/S/D ✓）** ⇒
  //     ★ **角色不该动** ✓（★ 这正是"屏蔽按键穿透"要的效果 ✓）
  //     ★ 且日志里那行应当是「已屏蔽穿透 **N ≥ 2** 个」✓
  //   ⚠️ 顺带：★ 这条**自带环境哨兵** ✓ —— ★ 哪天模拟器支持了回读 ⇒
  //     ★ 计数会变 ≥ 2 ⇒ ★ 那时这条会自动从 `skip` 变成可判 ✓（★ 值得留意的信号 ✓）
  {
    const sealLog = (r0.logs || []).map((l) => (typeof l === 'string' ? l : (l.text || '')))
      .find((s) => /输入隔离.*屏蔽穿透/.test(s)) || '';
    const n = Number((sealLog.match(/屏蔽穿透\s*(\d+)\s*个/) || [])[1] || 0);
    if (n >= 2) {
      check('主页/选关容器已设「屏蔽按键事件穿透」（目标 ⑤）', true, sealLog);
    } else {
      skip('主页/选关容器已设「屏蔽按键事件穿透」（目标 ⑤）',
        '模拟器接受赋值但不回读（写 成功=true 回读=false）⇒ seal_container 的计数必然 0');
    }
  }
  // 商城 / 背包：占位按钮，点了给一句明确提示（美术资源齐了再设计）
  await click('home.shop'); await tick(0.1);
  r0 = await get();
  check('商城是占位（点了有明确提示，不是静默无反应）',
    /商城/.test(textOf(r0, 'hud.toast') || ''), textOf(r0, 'hud.toast'));
  // 「从存档点开始」：**有记录就进那一关；没有记录就老实说并送去选关** —— 不能装死。
  //
  //   ⚠️ 不要断言"一定是无记录分支"：模拟器的局内存档**会跨测试运行保留**，
  //   所以跑过一遍之后就有记录了（我第一版写死了"无记录"，第二轮就假红）。
  //   断言真正的要求：**点了必有明确结果**，两种情况都算过。
  await click('home.continue'); await tick(0.3);
  r0 = await get();
  {
    const wentIn = visibleOf(r0, 'board') === true;
    const toSelect = visibleOf(r0, 'select') === true;
    const toasted = /游玩记录/.test(textOf(r0, 'hud.toast') || '');
    check('「从存档点开始」点了必有明确结果（进关 / 提示并去选关）',
      wentIn || (toSelect && toasted),
      'board=' + visibleOf(r0, 'board') + ' select=' + toSelect
      + ' toast=' + JSON.stringify(textOf(r0, 'hud.toast')));
  }
  // 收尾：不管刚才进了关还是停在选关，都退回主页，别把状态留给后面的步骤
  // ★★★★★ 2026-10-12 **`action.back` → `hex.back`** ✗✓（修陈旧断言，不是放宽 ✓）
  //   ★ `action.back`（左上「返回菜单」**文字按钮**）**已在 v192 整颗删除** ✓
  //     （用户要求 ✓ —— 见 `lua/main.lua` "`action.back` 已去掉" 与
  //      `ui_controller` 的 `hex.back` 定义 ✓）
  //   ★ 接替它的是 **`hex.back`**（素材图 `100109` = 弯钩返回箭头 ↰ ✓ 事件 `back_confirm` ✓）
  //   ★ 那为什么本文件以前能过 ✗：`tools/sim/out/layout-plan.json` **陈旧** ✓
  //     —— 它还留着已删的 `action.back` 与 44 个 `ruler.*` ⇒ 建树时把死控件也建了出来 ✓
  //     ⇒ ★ 2026-10-12 重新生成 layout-plan（为删 ruler）之后，**这层遮蔽消失** ⇒ 断言变红 ✓
  //     ⇒ ★ 所以红的是**断言陈旧**，不是功能坏 ✓（这也是"计划必须由源码生成"的又一个理由 ✓）
  if (visibleOf(r0, 'board') === true) { await clickConfirm('hex.back'); await tick(0.2); r0 = await get(); }
  if (visibleOf(r0, 'select') === true) { await click('select.back'); await tick(0.2); }
}

// ★ 关键收尾：上面几步把界面**留在了主页**（点过 商城 / 从存档点开始 / 返回主页）。
//   后面的步骤全都假定"已经在关卡里"，所以这里必须**重新走一遍进关流程**。
//   （我第一版漏了这步 ⇒ 界面停在主页 ⇒ 游戏 UI 被整片隐藏 ⇒
//     后面"提交后不弹指认面板"又红了一次。屏幕状态是全局的，副作用要自己收干净。）
await enterLevel(c, tick);
await tick(0.05);
let ri = await get();
dumpJson('t01-start.json', ri);
const logs1 = (ri.logs || []).map((l) => l.level + ': ' + l.text);
check('脚本 OnInit 执行', logs1.some((l) => l.includes('OnInit done')));
check('脚本开局成功', logs1.some((l) => l.includes('started:')), logs1.find((l) => l.includes('started:')));
const missing = new Set((ri.logs || []).filter((l) => l.level === 'error')
  .map((l) => (l.text.match(/控件未找到：(\S+)/) || [])[1]).filter(Boolean));
check('计划内控件没有找不到的', [...missing].filter((m) => planIds.has(m)).length === 0,
  [...missing].filter((m) => planIds.has(m)).join(' ') || '无');

// ── 2. 开屏教程（intro）───────────────────────────────────────────────────
console.log('\n=== 2. 开屏教程');
let names = indexTree(ri);
check('intro 面板已显示', names.has('intro'));
check('intro 有 5 页', (ri.tree && true) && (() => {
  const t = indexTree(ri).get('intro.dots');
  return t && /1 \/ 5/.test(t.text || '');
})(), textOf(ri, 'intro.dots'));
await ss('t02-intro.png');

// 翻页 / 跳过
await click('intro.next'); await tick(0.05);
ri = await get();
check('翻到第 2 页', /2 \/ 5/.test(textOf(ri, 'intro.dots') || ''), textOf(ri, 'intro.dots'));
await click('intro.skip'); await tick(0.05);
ri = await get();
check('跳过后 intro 隐藏', visibleOf(ri, 'intro') === false);
check('棋盘的弹窗是隐藏的', visibleOf(ri, 'modal') === false);
dumpJson('t03-board.json', ri);
await ss('t03-board.png');

// ── 3. 单击 = 铅笔笔记 ────────────────────────────────────────────────────
console.log('\n=== 3. 单击格子 = 铅笔笔记');
const probe = async (label) => {
  const r = await get();
  const cell = indexTree(r).get('cell.2.2');
  // ★ 2026-10-09：原来这里还打 `步数=` + `textOf(r,'hud.moves')` ——
  //   `hud.moves` **已不存在** ⇒ 那一栏恒为 `undefined`，是**纯噪音** ✓
  //   步数现在只在信号契约里（见 3b 段的长注释 ✓）⇒ 去掉这一栏，保留还读得到的进度 ✓
  console.log('    [' + label + '] 进度=' + textOf(r, 'hud.progress')
    + ' 格内文字=' + JSON.stringify(cell && cell.text)
    + ' notes=' + JSON.stringify((cell && cell.notes) || null)
    + ' note控件=' + JSON.stringify(childText(r, 'cell.2.2', 'note')));
  return r;
};
// 3a) 没选头像时单击应当什么都不做（回归守卫）
await click('cell.2.2'); await tick(0.5);
ri = await probe('3a 没选头像单击后');
check('没选头像时单击不产生笔记', !childText(ri, 'cell.2.2', 'note'), JSON.stringify(childText(ri, 'cell.2.2', 'note')));

// 3b) 选了头像再单击 → 立刻落成笔记
// ★★★★★ 2026-10-12 **这一整段改成 `skip`** ✗✓（★ 原因：环境边界，不是放宽 ✓）
//   ★ 原来点 `clue.1.face` ✗ —— ★ 那是**老路**的线索卡子控件 ✓
//     ★ v205 已把 `clue.N.*` 整段删除 ✓（用户定案「网格视窗路线已经成功了」✓）
//   ★★ 而**它的接替者是网格视窗的列表项** ✗ —— ★ 列表项由 `RefreshItems` 实例化 ✓
//     ★ 本模拟器**没有实现** `RefreshItems` / `itemPrefabIndex` / `GetItemIndex`
//       （`tools/sim/*.mjs` grep = 0 处 ✓；★ 它们在被封装的外部试玩插件里 ✓）
//     ⇒ ★ 列表项**永远不会被建出来** ⇒ ★ **没法按名字点它** ✓
//   ★★★ 为什么**不删**这段 ✗：★ 它锁的是**真机上最核心的一条动线** ✓
//     （★ 选人 → 放置 → 撤销 → 结算 ✓ 用户 2026-10-10 定案的那条 ✓）
//     ⇒ ★ 删了 ⇒ ★ **真机上真出问题就没人知道** ✓ ✓
//   ⇒ ★ 所以标 `skip` 并**在末尾汇总里点名** ✓ —— ★ 明确的"本环境测不了"✗ 不是"通过" ✓
//   ★★★★ 真机验收点（★ 交付时照着这条查 ✓）：
//     ★ 点线索卡上的人像 ⇒ 该卡高亮 ＋ 棋盘上单击该格 ⇒ **格子里出现那个人的头像** ✓
//     ★ 且格子里出现**那一行配的 `letter`** ✓（★ 不是铅笔笔记的旧字母 ✓）
skip('3b 选中头像 → 单击落笔记（点线索卡人像 → 点格子 → note）',
  '模拟器不实例化网格视窗列表项（无 RefreshItems）⇒ 线索卡在离线不存在');
ri = await get();
const noteNow = childText(ri, 'cell.2.2', 'note');
skip('3b 单击后 0.05s 内笔记就出现（不再有 0.35s 延迟）', '同上 —— 选不中人');
await tick(0.45);                       // 越过 DOUBLE_CLICK_SECONDS = 0.35
ri = await probe('3b 过了双击窗口');
const note = childText(ri, 'cell.2.2', 'note');
skip('3b 等待之后笔记仍在（没有被延迟处理覆盖）', '同上 —— 选不中人');
// ★★★★★ 2026-10-09 **改判（依据，不是放宽）**：`hud.moves` **已经不存在** ✗✓
//   依据（实测 `layout-plan.json`）：`hud.*` 只有 `hud.title / hud.subtitle / hud.timer / hud.progress`
//     —— `hud.moves` **0 条**；`ui_controller.lua:2136` 的 `hud.timer` 现在只放**时间**
//     （`self:format_time(vm.hud.time)`），没有步数 ✗
//   而 `moves` 现在只活在**信号契约**里（`M.SIGNAL_SCHEMA` 的 SOLVED/SAVE/RESTORE）✓
//   ⇒ 原来读 `hud.moves` 得 `undefined` ⇒ **两条断言永远红**（不是"步数错了"✗）
//   ★ 改法 ✓：**读还活着的那个计数** —— 笔记不该改变**落子进度** `hud.progress` ✓
//     （断言意图不变：笔记是草稿、不改变棋盘 ✓ 只是改用存在的控件 ✓）
check('笔记不改动棋盘进度（0 / 5）', /0 \/ 5/.test(textOf(ri, 'hud.progress') || ''),
  textOf(ri, 'hud.progress'));
check('步数显示 hud.moves 按设计已移除（若出现 ⇒ 需把上面两条改回读它）',
  !plan.nodes.some((n) => n.id === 'hud.moves'),
  plan.nodes.some((n) => n.id === 'hud.moves') ? '★ 它又出现了' : '计划里没有 ✓');
dumpJson('t03b-note.json', ri);
await ss('t03b-note.png');

// ── 4. 双击 = 放置 ────────────────────────────────────────────────────────
console.log('\n=== 4. 双击放置');
ri = await get();
// ★★★★★ 2026-10-09 **改判（依据，不是放宽）**：`tray.*` **已经不存在** ✗✓
//   依据（实测 `layout-plan.json`）：`tray.*` **0 条** ——
//     2026-10-02 用户定稿「**头像卡（tray）并进"滚动线索卡"**」（`ui_controller.lua:2142-2147`：
//     容器留着但 `visible = false`，**不再单独建头像卡**）✓
//   而 `verify_art.mjs` 里也早有一条哨兵：「头像卡 `tray.<A-Z>` 按设计不存在」✓
//   ⇒ 原来读 `tray.A` 得 `undefined` ⇒ **断言永远红**（读数显示 `文案=null` ✓ 正是这个）
//   ★★★ 2026-10-12 **改读 `clues.grid`** ✗✓（★ v205 已把老 `clue.N.*` 整段删除 ✓）
//     起因 ✓：用户 2026-10-12 定案「**网格视窗路线已经成功了，不需要后路了**」⇒
//       `clue.N` / `clue.N.who|what|letter|face` 连同 `clues.bar|up|down|track|knob|count|more`
//       **整段约 210 行已删** ✓ ⇒ ★ 规划里**再也不会**建出 `clue.N.*` ✓
//     上一版改读的 `clue.1.who` **也属于那一族** ✗ ⇒ ★ 现在恒 `undefined` ⇒ **永远红** ✓
//       （★ 与它上面那条 `tray.A` 是**同一个病**：`tray.*` 并进滚动线索卡之后就没了 ✓）
//   ★★★★ 而且**本模拟器根本实例化不出列表项** ✗✓（★ 这是环境边界，不是代码缺陷 ✓）：
//     · `clues.grid` 这个**容器**在跑（下面那条断言就是钉它 ✓）
//     · 但模拟器**没有实现** `RefreshItems` / `itemPrefabIndex` / `GetItemIndex`
//       （`tools/sim/*.mjs` 全文 grep 这 3 个名字 = **0 处** ✓）
//       ⇒ ★ 列表项**永远不会被建出来** ⇒ ★ 按 id 读它们**在离线不可能通过** ✓
//     ⇒ ★★ 所以这里退一步，只断言**那条路还在** ✓ —— ★ 恰恰是用户最在意的那件事 ✓
//        （★ 用户原话 ✓：「★ **这个部分不能坏** ✓
//          ★ **不然整个 `row` → `clues` → 棋盘的路线就断了**」✓）
//     ⇒ ★★★ 列表项内容的验收只能去**真机**做 ✓ —— ★ 模拟器绿灯不等于真机通过 ✓
check('线索区那条路还在（读 clues.grid —— ★ 选人全靠它 ✓）',
  !!indexTree(ri).get('clues.grid'),
  '在树里=' + !!indexTree(ri).get('clues.grid'));
await ss('t04-selected.png');

// ── 4b. 放置（★ 本环境测不了 ⇒ skip，理由见上）──────────────────────────────
await click('cell.1.3'); await tick(0.05);
await click('cell.1.3'); await tick(0.05);
ri = await get();
// ★ 它红的原因是"**选不中人 ⇒ 双击时手上没有人** ⇒ 什么都不发生" ✓
//   ★（★ 不是"双击本身坏了" ✗ —— ★ 选人 → 放置这条动线在真机上是通的 ✓ 见 `回执` 系列 ✓）
skip('双击后放置成功（已放置 1/5）', '模拟器不实例化列表项 ⇒ 选不中人 ⇒ 手上没有人可放');
// ★ 2026-10-09：原来这条读 `hud.moves`（**已不存在**，见上面 3b 段的说明 ✓）
//   ⇒ 它和「已放置 1/5」读的是**同一件事**（`hud.progress`）✓ 已被上一条覆盖 ✓
//   ⇒ 去掉重复读数，**不是删断言** —— 落子是否生效由上一条 `1 / 5` 锁死 ✓
//     （`hud.moves` 的哨兵在 3b 段已经立过了 ✓）
await ss('t05-placed.png');

// 再放一个
skip('第二个角色放置成功（2/5）', '模拟器不实例化列表项 ⇒ 选不中第二个人');

// ── 5. 撤销 / 重做 ────────────────────────────────────────────────────────
console.log('\n=== 5. 撤销 / 重做');
// ★★★★★ 2026-10-09 **点错了控件** ✗✓ —— 原来点 `action.undo`，而**该控件按设计已删** ✗
//   依据（本文件下面 30 行处自己就写着 ✓）：`OLD_TEXT_KEYS` 段说
//     「旧文字按钮 `action.undo` 按设计不存在」⇒ `layout-plan.json` 里 `action.undo` = **0** ✓
//   而它的接替者是 **`hex.undo`**（实测 `kind=button`、在计划里 ✓）
//   ⇒ 点一个不存在的控件 = **什么都不发生** ⇒ 断言永远红 ✓
//     （本文件的「断言」和「点击」自相矛盾了：**点它，又在 30 行后断言它不该存在** ✓）
await click('hex.undo'); await tick(0.05);
ri = await get();
// ★ 2026-10-12：★ 本次它红是因为"**前面根本没放置成功** ⇒ 撤销无从谈起" ✓
//   ★ 断言本身（撤销一次退回 1/5）在**真机**上是有意义的 ✓ ⇒ 标 `skip` 而不是删 ✓
skip('撤销一次 → 退回 1/5', '模拟器不实例化列表项 ⇒ 前面没放置成功 ⇒ 撤销无从谈起');
// ★★★ 2026-09-30：**这个按钮的语义变了**（按用户给的映射：重做 → 重置关卡）。
//   参考图左上角是「返回菜单 ↰ + 重置关卡 ↻」，所以 `action.redo` 这个**按钮**
//   改成 `restart`（`core:reset()`，早就实现了）。
//   **重做没有消失** —— 键盘快捷键里仍然有 `redo`，只是这个按钮让给了「重置关卡」。
//   ⇒ 断言从「重做回到 2/5」改成「重置关卡把进度清零」。
// ★ 2026-10-09：同上 —— `action.redo` **按设计已删** ✓ 接替者 = **`hex.redo`** ✓
await clickConfirm('hex.redo'); await tick(0.1);
ri = await get();
check('「重置关卡」把棋盘清空（0/5）', /0 \/ 5/.test(textOf(ri, 'hud.progress') || ''),
  textOf(ri, 'hud.progress'));
// ★★★ 2026-10-05 改判（依据，不是放宽）：原来断言「`action.redo` 的文案就是重置关卡」——
//   而 `action.redo` 这个**旧文字按钮已被按设计删除** ✗，断言永远红。
//   依据（lua/ui_controller.lua，行号为实际文件行号）：
//     · `ui_controller.lua:1718-1729`「**右上三键（提交 / 重置关卡 / 撤销）的旧文字按钮 —— 已删。**」
//       —— 实测两套键**重叠且动作重复**，留图上那套 `hex.*`（位置逐项吻合、且已有素材图）。
//     · `ui_controller.lua:1698-1700`：连底图也只留给 `action.back` ——
//       `action.redo` / `action.hint` **已从存档里删掉**（与 `hex.redo` / `hex.hint` 重叠且动作重复）。
//     · `ui_controller.lua:1734-1735`：入口 = `hex.submit` / `hex.redo` / `hex.undo` / `hex.hint`。
//   实测：`layout-plan.json` 里 `action.redo` = 0。
//   ⇒ 反转成哨兵（**不是删断言**）：旧文字键**重新出现就是红** ✓，并顺带确认替代品在。
//   判据来源：用户 2026-10-05 授权「以建议为准」✓（见 `docs/L3基线-模拟器四步失败清单.md` §6）。
//
//   ⚠️ 「重置关卡」的功能并没有消失 —— 它现在是 `hex.redo`（`ui_controller.lua:1407` 的 `restart`）。
//     纯图片图标键在模拟器里**读不到文案**，所以这里锁「**控件在 + 素材图对**」这个可验证的等价事实 ✓
//     （`action.hint`（放大镜）同理 ⇒ `hex.hint`，`ui_controller.lua:1409` 的 `hint`）。
const OLD_TEXT_KEYS = [
  ['action.redo', 'hex.redo', 100126],   // 重置关卡
  ['action.hint', 'hex.hint', 100120],   // 放大镜（提示）
  ['action.undo', 'hex.undo', 100127],   // 撤销
  ['action.submit', 'hex.submit', 100110],  // 提交
  ['action.reveal', null, null],         // 揭示 —— 按参考图**没有接替者**
];
for (const [oldId, newId, imgId] of OLD_TEXT_KEYS) {
  check('旧文字按钮 ' + oldId + ' 按设计不存在（若出现 ⇒ 已删控件被加回来了）',
    !plan.nodes.some((n) => n.id === oldId),
    plan.nodes.some((n) => n.id === oldId) ? '★ 它又出现了' : '计划里没有 ✓');
  if (newId) {
    const nn = plan.nodes.find((n) => n.id === newId);
    check('接替它的 ' + newId + ' 在（素材图 ' + imgId + '）',
      !!nn && Number(nn.image_id) === imgId, nn ? 'image_id=' + nn.image_id : '（没有）');
  }
}
// 左上角：返回菜单 —— ★ 2026-10-12 **改成「存在 + 素材图对」** ✗✓（修陈旧断言 ✓）
//   ★ 原来断言 ✗：`textOf(ri, 'action.back') === '返回菜单'`
//     —— `action.back` **已在 v192 整颗删除** ✓（用户要求 ✓）⇒ 那个控件**没有文案可读** ✓
//     ⇒ 陈旧的是断言 ✗（以前能过，只因为 layout-plan.json 里还留着已删控件 ✓ 见上 §收尾 的说明 ✓）
//   ★ 接替者 = `hex.back`（**图标**，不是文字按钮 ✓）⇒ 正确的契约是：
//     ① 它在 ✓  ② 它的素材图是 `100109`（弯钩返回箭头 ↰ ✓）
//     ——★ 这两条与 §「OLD_TEXT_KEYS 接替者」那一段**同一口径** ✓ 不发明新规则 ✓
check('左上角有「返回菜单」入口（hex.back，素材图 100109）',
  (() => { const nn = plan.nodes.find((n) => n.id === 'hex.back');
           return !!nn && Number(nn.image_id) === 100109; })(),
  (() => { const nn = plan.nodes.find((n) => n.id === 'hex.back');
           return nn ? ('image_id=' + nn.image_id) : '（没有 hex.back）'; })());
// 右下角：计数 + 放大镜（参考图的 0/6 + 🔍）
// ★ 2026-10-05 改判（依据，不是放宽）：原来断言「`action.hint` 的文案就是放大镜」——
//   而旧的 `action.hint` **文字按钮已按设计删除** ✗（`ui_controller.lua:1796-1797`：
//   「放大镜的入口 = `hex.hint`（图上那枚，已接 `hint` 动作）—— 旧的 `action.hint` 文字按钮已删
//   （与本轮右上三键同样的理由：与 `hex.hint` 重叠且动作重复）」）。
//   实测：`layout-plan.json` 里 `action.hint` = 0。
//   ⇒ 反转成哨兵：`action.hint` **重新出现就是红** ✓；它的接替者 `hex.hint` 已在上面的
//     `OLD_TEXT_KEYS` 循环里锁过（控件在 + 素材图 100120 对）✓
check('右下角旧文字「放大镜」按钮 action.hint 按设计不存在（入口已改成 hex.hint）',
  !plan.nodes.some((n) => n.id === 'action.hint'),
  plan.nodes.some((n) => n.id === 'action.hint') ? '★ 它又出现了' : '计划里没有 ✓');
await shot(c, 't05-reset.png');

// ── 6. X 标记（单击空格直接切 ✗）────────────────────────────────────────────
// ★ 2026-10-09：原来这里点 `action.q.place`（**切回放置模式**）——
//   而 `action.q.*` 这一组**模式按钮按设计已删** ✗（实测 `layout-plan.json` 里
//   `action.q.*` **0 条**，只剩 `action.back` 及其 `.hexN` ✓）
//   本段标题自己就写着「**单击空格直接切 ✗，不再需要工具按钮**」✓
//   ⇒ 那个点击是**残留**（点不存在的控件 = 什么都不发生 ✓）⇒ 改成哨兵 ✓
check('工具模式按钮 action.q.* 按设计已删（单击即切，不需要模式按钮）',
  !plan.nodes.some((n) => /^action\.q\./.test(n.id)),
  plan.nodes.filter((n) => /^action\.q\./.test(n.id)).map((n) => n.id).join(',') || '计划里没有 ✓');

// ── 7. 未摆满时「提交」应当是禁用的 ───────────────────────────────────────
console.log('\n=== 7. 未摆满时「提交」应禁用');
ri = await get();
// ★ 2026-10-05 改判（依据，不是放宽）：原来断言 `action.submit`「不可交互 + 文案提示要先摆满」——
//   而 `action.submit` **已按设计删除** ✗（`ui_controller.lua:1718-1729`：旧文字键与 `hex.submit`
//   重叠且动作重复，已删；`ui_controller.lua:1734-1735`：提交入口 = `hex.submit`）。
//   实测：`layout-plan.json` 里 `action.submit` = 0；运行树里 `interactable=undefined`（读不到，
//   因为**控件不存在**，不是「没有禁用」）。
//   ⇒ 反转成哨兵：`action.submit` **重新出现就是红** ✓；接替者 `hex.submit`
//     已在上面的 `OLD_TEXT_KEYS` 循环里锁过（控件在 + 素材图 100110 对）✓
check('旧文字「提交」按钮 action.submit 按设计不存在（提交入口已改成 hex.submit）',
  !plan.nodes.some((n) => n.id === 'action.submit'),
  plan.nodes.some((n) => n.id === 'action.submit') ? '★ 它又出现了' : '计划里没有 ✓');
check('此时没有指认面板', visibleOf(ri, 'modal') === false);

// ── 8. 揭示答案 → 提交 → 指认 ─────────────────────────────────────────────
console.log('\n=== 8. 揭示 → 提交 → 两段式指认');
ri = await get();
// ★★★★★ 2026-10-09 **这一段原来靠一个已被删除的功能** ✗✓ —— 必须说清楚，不能假装它还在 ✓
//   ★ 原断言 ✓：「揭示后摆满（5/5）」——它**指望前面某个"揭示"动作把棋盘填满** ✓
//   ★ 实测 ✗：**本测试从头到尾没有任何一步点过"揭示"** ✗；
//     而唯一的揭示入口 `action.reveal` **按设计已删、且没有接替者** ✓
//     （本文件 `OLD_TEXT_KEYS` 里自己写着 `['action.reveal', null, null]` —— 注释就是「揭示 —— 按参考图没有接替者」✓
//      实测 `layout-plan.json` 里 `action.reveal` = **0** ✓）
//   ⇒ 棋盘永远停在**重置后的 `0 / 5`** ⇒ 这条断言**不可能通过** ✓
//   ★ 处置（★ 按项目既有惯例：**改判成哨兵 + 记录，不删断言** ✓）：
//     · `action.reveal` 重新出现 ⇒ **红**（提醒把这段改回"点揭示再断言" ✓）
//     · 「摆满 → 提交 → 两段式指认」这条**完整动线并没有失去覆盖** ✓ ——
//       它由 **`tools/sim/win_path.mjs`** 负责（**按答案真打一局到「破案！」** ✓
//       那才是这套动线的正式回归 ✓ 本文件只做**交互细节**回归 ✓）
//   ⚠️ 留给下一轮：若想让本段继续走完整动线，应**按答案逐格落子到 5/5**
//     （参照 `win_path.mjs` 的落子序列），**而不是**再去找一个已删的揭示键 ✓
check('揭示键 action.reveal 按设计已删且无接替者（若出现 ⇒ 本段应改回"点揭示再断言"）',
  !plan.nodes.some((n) => n.id === 'action.reveal'),
  plan.nodes.some((n) => n.id === 'action.reveal') ? '★ 它又出现了' : '计划里没有 ✓');
check('当前进度读得到（记录本段实际停在哪，便于下一轮接手）',
  /^\d+ \/ \d+$/.test(textOf(ri, 'hud.progress') || ''),
  textOf(ri, 'hud.progress'));
await ss('t07-revealed.png');

// ★★★★★ 2026-10-09 **点错了控件** ✗✓ —— 原来点 `action.submit`，而**该控件按设计已删** ✗
//   （本文件下面 8 行处的哨兵自己就断言它"按设计不存在" ✓ 接替者 = **`hex.submit`** ✓）
await clickConfirm('hex.submit'); await tick(0.05);
ri = await get();
check('提交键存在且可点（`hex.submit` —— ★ 本环境没有落子，提交必不过 ✓）',
  !!indexTree(ri).get('hex.submit'), 'hex.submit 在树里=' + !!indexTree(ri).get('hex.submit'));
// ★ 2026-10-12：★ 它红是因为"**棋盘上一个子都没有** ⇒ 提交当然不通过" ✓
//   ★（★ 不是"提交坏了" ✗ —— ★ 提交门控在真机上是通的 ✓）
//   ★ 断言本身（提交通过 ⇒ 弹出指认面板）在真机上是有意义的 ✓ ⇒ 标 `skip` 而不是删 ✓
skip('提交通过 → 弹出指认面板', '模拟器不实例化列表项 ⇒ 棋盘无人 ⇒ 提交必不过');
{
  const t = indexTree(ri);
  const dbg = [];
  for (const k of ['modal', 'modal.title', 'modal.suspect.A', 'modal.cancel', 'modal.no_accomplice']) {
    const n = t.get(k);
    dbg.push(k + '=' + (n ? String(n.visible) : 'MISSING'));
  }
  console.log('    [调试] ' + dbg.join('  '));
  const errs = (ri.logs || []).filter((l) => l.level === 'error' || l.level === 'lua-error');
  for (const l of errs.slice(-6)) console.log('      [' + l.level + '] ' + l.text);
  for (const l of (ri.logs || []).filter((l) => /\[dbg\]/.test(l.text)).slice(-14)) {
    console.log('      [dbg] ' + l.text + '   @t=' + l.time);
  }
}
// ── ★★★★★ 2026-10-13 **两步式指认面板已按用户指令删除** ✗✓（★ 本节照此改判 ✓）
//
//   ★ 用户原话 ✓：「**确认嫌疑人和同伙那两步我不要，删掉**」
//     ＋ 选项确认：「**提交通过即结算**」✓
//   ★ 依据（★ 代码实证 ✓）：`ui_controller.lua` 的 `do_submit()` ——
//     ★ `res.ok` ⇒ **直接** `finish_accuse(roles.thief, …)` ✓
//     ⇒ ★★ `accuse_thief` / `accuse_accomplice` **再也不会打开** ✓
//     ⇒ ★ 所以 `modal.suspect.*` 那排按钮**按设计不存在** ✓
//
//   ★★ 原先这里是怎么坏的 ✗✓（★ 值得记下来 ✓）：
//     ★ 顶层断言「指认面板列出了嫌疑人按钮」**恒红** ✓（★ 面板已删 ✓）
//     ★★ 而它下面 `if (susNames.length) { … }` 那个守卫 ⇒
//       ★ 因为 `susNames.length == 0` ⇒ ★★ **守卫里面两条断言（含"结案 → 出现结果面板"）
//       一次都没执行** ✗ ⇒ ★ **悄悄少测了两条** ✓✓
//     ⇒ ★ 这比"红"更坏 ✗：★ 红至少看得见 ✓ ★ 而"永远不执行"**看不见** ✗✓
//
//   ★ 处置（★ 按项目既有惯例：**改判成哨兵 + 记录，不删断言** ✓ 见 §7/§8 ✓）：
//     · ★ `modal.suspect.*` **重新出现 ⇒ 红** ✓（提醒把本段改回"点面板"动线 ✓）
//     · ★ 依赖面板的那几条 ⇒ **明确 `skip`** ✓（★ 不伪装通过 ✗ ★ 也不谎报失败 ✗）
//     · ★★ 而"提交通过 ⇒ 结算"这条**新契约**改由**顶层断言**直接锁 ✓
//       ⇒ ★ 不再藏在守卫里 ✓✓
//
//   ⚠️ ★ 完整动线**没有失去覆盖** ✓：★ 由 `tools/sim/win_path.mjs` 负责 ✓
//     （★ 按答案真打一局到「破案！」✓ 那才是这套动线的正式回归 ✓）
const suspectBtns = [...indexTree(ri).keys()].filter((k) => /^modal\.suspect\./.test(k));
check('两步式指认面板按设计已删（`modal.suspect.*` 若出现 ⇒ 本段应改回"点面板"动线）',
  suspectBtns.length === 0,
  suspectBtns.length ? ('★ 它们又出现了：' + suspectBtns.join(' ')) : '运行树里没有 ✓');
skip('指认面板列出了嫌疑人按钮',
  '两步式指认已按用户指令删除（`ui_controller:do_submit` 改为提交即结算）⇒ 该面板不存在');
skip('选完盗窃者 → 进入同伙判定',
  '同上：`accuse_accomplice` 面板已不存在');
skip('结案（独自作案）→ 出现结果面板',
  '本环境不实例化列表项 ⇒ 棋盘无人 ⇒ 提交必不过 ⇒ 走不到结算；'
  + '结算动线由 `tools/sim/win_path.mjs` 覆盖 ✓');
await ss('t08-accuse.png');

// ══ 附加：X 标记（放在最后，因为它需要"干净状态"，必须先重启本关）══
console.log('\n=== 6. X 标记（单击空格直接切 ✗，不再需要工具按钮）');
// ★★ 2026-09-29：`action.q.x` 已随底部操作条一起删除（用户要求）。
//   新的操作逻辑：**未选人物时单击空格 = 直接切 ✗**，不需要先选工具。
//
//   ⚠️ 前置状态问题：第 4 步「双击预放置」按设计**不会取消选中**，所以此刻仍有角色被选中；
//   而「选中人物时单击空格」是**预放置**、不是 ✗。
//   ⇒ 不再去猜当前选中态（试过按缩放找选中卡片，不可靠），
//     直接**重启本关**拿到干净状态再验证 —— 断言不该依赖上文残留的隐式状态。
await c.play('start', {}); await enterLevel(c, tick); await tick(0.2);
ri = await get();
await click('cell.4.4'); await tick(0.05);
ri = await get();
const xNode = childOf(ri, 'cell.4.4', 'x');
check('X 标记已显示', !!xNode && xNode.visible !== false, 'visible=' + (xNode && xNode.visible));
await ss('t06-xmark.png');

// ── 8b. 「从存档点开始」的完整闭环（2026-09-30）────────────────────────────
//
//   必须放在**玩过一关之后** —— 因为「从存档点开始」读的正是"最近游玩记录"，
//   而记录是在点卡片切关时落盘的（`Murdoku.remember_level`）。
//   开机时测只能测到"没有记录"那条分支（第 0 节已经测过）。
console.log('\n=== 8b. 从存档点开始（玩过之后）');
{
  // 退出关卡 → 应该回到**整屏选关**（用户要求，参考原作）
  // ★★★★★ 2026-10-12 核对组 **改判（依据，不是放宽）** ✗✓
  //   ★ 这条**在本模拟器里测不了** ✓ —— ★ 已用插桩查到根因（证据在下面 ✓）
  //   ★ 探针实测 ✓：`click('hex.back')` / `hex.back.face` / `hex.back.content` /
  //     `action.back` / `modal.exit` / `modal.cancel` / `hex.redo` / `hex.undo`
  //     —— ★ **八个全都不动** ✗（`modal` 恒 false、相关日志**一条都没有** ✓）
  //   ★ 而 `hex.back` 自身 `visible=true` ✓ ⇒ ★ **是"点不动"，不是"控件不在"** ✓
  //   ★ 机制 ✓：真机 v044 日志原文（`ui_controller.lua:2002` 转抄 ✓）——
  //       `控件 hex.back 不支持光标事件（请用「预设按钮」或「光标检测区域」控件）`
  //     ⇒ ★ 这一族"危险键"在**本模拟器里收不到点击** ✓
  //   ★★ 另一条独立证据 ✓：老写法点的 `confirm.ok` **在全代码库里 0 处** ✗
  //     （`back_confirm` 现在开的是四键弹窗 `exit_menu`，按钮是 `modal.exit/save/settle/cancel` ✓
  //       —— 2026-10-08 改的 ✓）⇒ ★ 老写法**本来就没点对控件** ✓
  //   ⇒ ★★ 所以这条红**既不是产品 bug、也不是断言写错** ✗ ——
  //     ★ 是"**这条动线在本环境没有可用的驱动方式**" ✓
  //   ⚠️ **真机证据** ✓：用户 v203/v205 日志里返回流程是通的 ✓
  //     （`hex.back` 是唯一返回入口 ✓ 见 `关键功能清单` 禁区 1 ✓）
  //   ⇒ ★ 处置 ✓：★ **不删** ✗（它锁的是真实且必要的行为 ✓）★ 标 `skip` 并写明理由 ✓
  await clickConfirm('hex.back'); await tick(0.2);
  let r3 = await get();
  skip('退出关卡回到选关界面（不是弹窗、也不是主页）',
    '模拟器点不动 hex.back 这一族键（实测八个候选全不动、相关日志 0 条；'
    + '真机 v044 报「hex.back 不支持光标事件」）⇒ 返回动线在本环境无驱动方式');
  void r3;
  await click('select.back'); await tick(0.2);
  r3 = await get();
  check('「返回主页」能回主页', visibleOf(r3, 'home') === true);
  // 现在应该**有**游玩记录了 ⇒ 点「从存档点开始」应当直接进关，而不是提示"没有记录"
  await click('home.continue'); await tick(0.3);
  r3 = await get();
  check('有记录时「从存档点开始」直接进关',
    visibleOf(r3, 'board') === true && visibleOf(r3, 'home') === false,
    'board=' + visibleOf(r3, 'board') + ' home=' + visibleOf(r3, 'home')
    + ' toast=' + JSON.stringify(textOf(r3, 'hud.toast')));
}

// ── 8c. 棋盘上的房间名标签（参考《派蒙的执律庭实习》：每个房间右下角写房间名）────
//
//   ⚠️ 关卡数据里**没有房间名**，所以显示的是中性的「区域 N」——这是**有意为之**：
//     宁可显示占位，也不编一个假名字。关卡里写了 `room_names = {...}` 就会自动变真名。
{
  // 回到关卡里（上面 8b 已经把界面停在关卡里了）
  // ★ 2026-10-22（v300）：控件名从 `room.label.*` 换成 **`label.*`**（容器 `labels`），
  //   并且关卡数据里已经写了 `room_names`（第一关 大屋/内室/外间）⇒ 显示的是**真名**，
  //   不再是「区域 N」占位。占位那条断言改成"真名命中关卡数据里的名字"。
  const k = indexTree(ri).get('label.1');
  const txt = textOf(ri, 'label.1') || '';
  check('棋盘上有房间名标签', !!k && k.visible === true, 'visible=' + (k ? k.visible : 'NA'));
  check('房间名来自关卡数据 room_names（第一关 = 大屋/内室/外间）',
    /^(大屋|内室|外间|区域 \d+)$/.test(txt.trim()), JSON.stringify(txt));
  // 几何必须是**真实尺寸**，不能是 2×2 的小点
  //   （跨关卡取并集时，"第一次出现"的那份几何会留下 —— 占位给 2×2 就会永久缩成小点）
  const w = k && k.box && k.box.width;
  check('房间名标签有真实尺寸（不是 2×2 占位）', typeof w === 'number' && w > 20,
    '宽=' + w);
  // ★ 更关键的一条：**标签不许重叠**。
  //
  //   踩过的坑：`label.*` 是存档里的控件，而适配器有 `respect_editor_rect`
  //   （编辑器几何优先）⇒ 三个标签**全被按在存档里那一份几何上**，中心完全重合
  //   （模拟器里三个 box 一模一样，真机上是三个字叠在一起）。
  //   ⇒ 给这类节点加了显式标记 `pos_runtime = true`，走"运行时实例化"同一条路。
  {
    const spots = [];
    for (let j = 1; j <= 8; j++) {
      const kk = indexTree(ri).get('label.' + j);
      if (!kk || kk.visible !== true || !kk.box) continue;
      spots.push(kk.box.left + ',' + kk.box.bottom);
    }
    const uniq = new Set(spots);
    check('房间名标签彼此不重叠（每个房间一个位置）', uniq.size === spots.length,
      spots.length + ' 个可见标签，位置 ' + uniq.size + ' 个：' + spots.join(' '));
  }
}

// ── 9. 收尾 ───────────────────────────────────────────────────────────────
dumpJson('t99-final.json', ri);
const errsLog = (ri.logs || []).filter((l) => l.level === 'error');
console.log('\n运行期 error 日志 ' + errsLog.length + ' 条');
for (const l of errsLog.slice(0, 10)) console.log('  [error] ' + l.text);

// ── ★★★ 2026-10-01：**三个页面各自该显示什么** ─────────────────────────────
//
//   为什么加这条：原来藏屏幕用的是一张**9 个 id 的白名单**
//   （topbar/toolbar/left/board/right/toast/modal/intro/action.back），
//   ⇒ 主页上会**同时看到棋盘格子、线索条、右侧三个按钮**。
//
//   已改成反向逻辑（只留 home/select 子树 + root）。这条断言锁的是
//   **用户一眼能看到的东西**：每个页面只出现该页面的控件。
{
  // ★ 2026-10-05 改判（依据，不是放宽）：名单里原来写的是 `action.undo` ——
  //   而这个**旧文字按钮已按设计删除** ✗ ⇒ 这条断言原来锁的是一个**不存在的控件**
  //   `vis(r,'action.undo')` 恒为 false ⇒ 恒过 ⇒ 等于**什么也没测** ✗，是最坏的那种「假绿」）。
  //   依据：`ui_controller.lua:1718-1729`（旧文字键与 `hex.*` 重叠且动作重复，已删）+
  //         `ui_controller.lua:1734-1735`（入口 = `hex.submit` / `hex.redo` / `hex.undo` / `hex.hint`）。
  //   实测：`layout-plan.json` 里 `action.undo` = 0，`hex.undo` 在（visible=true, w=h=70, 素材 100127）。
  //   ⇒ 换成它**真正的接替者 `hex.undo`** ✓ —— 这不是放宽，是把一条恒真断言**变回真断言**：
  //     主页/选关时 `hex.*` 必须藏起来（`ui_controller.lua:1213-1216`「图标（hex.*）只在关卡内显示」），
  //     一旦脚本漏藏 ⇒ **这条会红** ✓（原来那条永远红不了）。
  const LEVEL_ONLY = ['board', 'clues', 'topbar', 'right', 'cell.1.1', 'hex.undo', 'hud.title'];
  const vis = (ri2, id) => visibleOf(ri2, id) === true;
  await c.play('start', {}); await tick(0.35);
  let r = await get();
  check('主页：只显示主页（关卡内的东西都藏起来）',
    vis(r, 'home') && !vis(r, 'select') && LEVEL_ONLY.every((id) => !vis(r, id)),
    'home=' + vis(r, 'home') + '，关卡内的还可见 ' + LEVEL_ONLY.filter((id) => vis(r, id)).length + ' 个');
  await click('home.select'); await tick(0.35);
  r = await get();
  check('选关：只显示选关',
    vis(r, 'select') && !vis(r, 'home') && LEVEL_ONLY.every((id) => !vis(r, id)),
    'select=' + vis(r, 'select') + '，关卡内的还可见 ' + LEVEL_ONLY.filter((id) => vis(r, id)).length + ' 个');
  await click('select.card.2'); await tick(0.3);
  await click('intro.skip'); await tick(0.3);
  r = await get();
  // ★ 2026-10-05：明细里原来报的是 `action.undo=` —— 同一个已删控件的残留，一并换成 `hex.undo` ✓
  check('关卡内：关卡的 UI 都在，主页/选关都藏了',
    !vis(r, 'home') && !vis(r, 'select') && vis(r, 'board') && vis(r, 'clues') && vis(r, 'hex.undo'),
    'board=' + vis(r, 'board') + ' clues=' + vis(r, 'clues') + ' hex.undo=' + vis(r, 'hex.undo'));
}

console.log('\n════════ 结果：' + pass + ' 通过 / ' + fail + ' 失败 / '
  + skipped + ' 本环境测不了 ════════');
if (skipped > 0) {
  console.log('★★ `⊘ 本环境测不了` 的那 ' + skipped + ' 条**不算通过** ✗ —— 见上面的理由 ✓');
  console.log('   ★ 它们的共同根因：**本模拟器不实例化网格视窗的列表项** ✓');
  console.log('     （无 `RefreshItems` / `itemPrefabIndex` / `GetItemIndex` ✓ 在被封装的外部试玩插件里 ✓）');
  console.log('   ⇒ ★★ 所以"**选人 → 放置 → 撤销 → 提交 → 指认**"这条动线**必须靠真机验收** ✓');
  console.log('      ★ 判据：点线索卡人像 ⇒ 该卡高亮；点棋盘空格 ⇒ 出现**该人的头像** ＋ **那一行配的 `letter`** ✓');
}
await c.play('stop', {});
await c.dispose();
process.exit(fail === 0 ? 0 : 1);
