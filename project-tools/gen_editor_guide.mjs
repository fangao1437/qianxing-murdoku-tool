// tools/gen_editor_guide.mjs —— 由 layout-plan.json 生成真机编辑器搭建指南
//
// 前置：lua tools/dump_layout.lua
// 运行：node tools/gen_editor_guide.mjs [输出路径]
//
// 生成的表格里「位置(中心)」那一列就是编辑器「位置 X, Y」要填的值。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.SIM_WORKSPACE || 'D:\\新建文件夹\\miHoYo Launcher\\qianxing-murdoku';
const OUT = process.argv[2] || path.join(ROOT, 'docs', '控件坐标表-1600x900.md');
const PLAN_FILE = path.join(ROOT, 'tools', 'sim', 'out', 'layout-plan.json');

if (!fs.existsSync(PLAN_FILE)) {
  console.error('找不到 ' + PLAN_FILE + '，请先跑：lua tools/dump_layout.lua');
  process.exit(1);
}

// 陈旧检查：布局计划必须比 lua/ 下任何源文件都新，否则会生成一份过期的坐标表 ——
// 这种"假绿"最难发现（指南看着正常，其实和代码已经不一致了）。
const planTime = fs.statSync(PLAN_FILE).mtimeMs;
const walk = (dir) => {
  let newest = 0, who = null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = walk(p);
      if (sub.newest > newest) { newest = sub.newest; who = sub.who; }
    } else if (e.name.endsWith('.lua')) {
      const t = fs.statSync(p).mtimeMs;
      if (t > newest) { newest = t; who = p; }
    }
  }
  return { newest, who };
};
const src = walk(path.join(ROOT, 'lua'));
if (src.newest > planTime) {
  console.error('布局计划已过期：' + path.relative(ROOT, src.who) + ' 比它新。');
  console.error('请先跑：lua tools/dump_layout.lua');
  process.exit(1);
}

const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
if (!plan.scope) {
  console.error('布局计划是旧格式（缺少 scope 字段），请重跑：lua tools/dump_layout.lua');
  process.exit(1);
}

const KIND_CN = { container: '容器节点', panel: '容器节点', text: '文本框', button: '预设按钮', image: '图片', cursor: '光标检测区域' };
const byId = new Map(plan.nodes.map((n) => [n.id, n]));

// ── 分组规则（顺序即建树顺序）────────────────────────────────────────────
const GROUPS = [
  ['容器（先建这些）', (n) => n.kind === 'container' || n.kind === 'panel'],
  ['顶栏 topbar', (n) => n.parent === 'topbar'],
  ['头像卡 tray', (n) => n.parent === 'tray'],
  ['线索 clues / 图例 legend', (n) => n.parent === 'clues' || n.id === 'legend'],
  ['棋盘 board + 坐标尺', (n) => n.parent === 'board' && /^ruler\./.test(n.id)],
  // ⚠️ 这一组**不用手摆**！脚本会用「客户端控件模板 + 模板引用控件」在运行时
  //    自动生成并摆正（2026-09-26 真机实测：25/25 成功）。
  //    坐标列出来只是"万一你要手摆"的参考，以及给模板里的那个格子定尺寸。
  ['棋盘格（不必手摆，脚本按模板生成）', (n) => /^cell\.\d+\.\d+$/.test(n.id)],
  ['右侧信息栏 right', (n) => n.parent === 'right'],
  ['底部操作条 actions', (n) => n.parent === 'actions'],
  ['开屏教程 intro.*', (n) => n.parent === 'intro'],
  ['弹窗 modal.*', (n) => n.parent === 'modal'],
];

const used = new Set();
const groups = GROUPS.map(([title, pred]) => {
  const rows = plan.nodes.filter((n) => !used.has(n.id) && pred(n) && (used.add(n.id), true));
  return { title, rows };
}).filter((g) => g.rows.length > 0);

const row = (n) => '| `' + n.id + '` | ' + (KIND_CN[n.kind] || n.kind) + ' | `' + (n.parent || '画布') + '` | '
  + '**' + n.cx + ', ' + n.cy + '** | ' + n.w + ' × ' + n.h + ' | '
  + (n.visible === false ? '隐藏' : '显示') + ' | '
  + (n.text ? '`' + String(n.text).replace(/\|/g, '\\|').replace(/\n/g, '⏎').slice(0, 40) + '`' : '')
  + (n.style ? ' ' + n.style : '') + ' |';

const H = [];
H.push('# 控件坐标表（画布 1600×900）· 自动生成');
H.push('');
H.push('> ⚠️ **本文件是自动生成的，不要手改。**');
H.push('> 数据源 = `lua/ui_controller.lua` 的 `M.LAYOUT` + `Controller:layout_plan()`。');
H.push('> 重新生成：`lua tools/dump_layout.lua` → `node tools/gen_editor_guide.mjs`。');
H.push('');
H.push('| 项 | 值 |');
H.push('|---|---|');
H.push('| 覆盖范围 | ' + (plan.scope === 'all' ? '**所有已登记关卡**（取并集）' : '`' + plan.scope + '`') + ' |');
H.push('| 关卡 | ' + (plan.levels || []).map((l) => '`' + l.id + '`（' + l.rows + '×' + l.cols + '）').join('、') + ' |');
H.push('| 最大棋盘 | ' + plan.max_rows + ' × ' + plan.max_cols + ' → 编辑器按这个尺寸建够格子 |');
H.push('| 设计空间 | ' + plan.design.width + ' × ' + plan.design.height + '（左上原点、Y 向下，写代码用） |');
H.push('| **画布空间** | **' + plan.canvas.width + ' × ' + plan.canvas.height + '**（左下原点、Y 向上，编辑器用） |');
H.push('| 缩放 | ' + plan.scale.toFixed(6) + '（= 1600/1920 = 5/6） |');
H.push('| 控件总数 | ' + plan.count + ' |');
H.push('');
H.push('> **棋盘和头像卡都是自适应的**：');
H.push('> · 格子边长 = 可用边长 ÷ N；');
H.push('> · 头像卡的列数 = max(3, ⌈人数 ÷ 2⌉)（保证永远只占 2 行）。');
H.push('>');
H.push('> 所以下面这些控件的坐标取的是「**最挤的那一关**」（人数最多 / 棋盘最大）的几何 ——');
H.push('> 编辑器按这一份静态摆好即可；跑小关卡时脚本会在运行时**重新摆正**');
H.push('> （`Adapter:ensure_cells` 管格子，`Adapter:apply_tray_layout` 管头像卡）。');
H.push('> 一套编辑器布局通吃 5×5 / 6×6 / 7×7 与人数的各种组合。');
H.push('>');
H.push('> 两套算法（编辑器布局 vs 运行时重算）的一致性由 `tests/ui_math.lua` 守着，');
H.push('> 它还检查「头像卡不会溢出容器压住线索」。');
H.push('');
// ── ★ 最重要的一条：格子不用手摆 ──────────────────────────────────────────
H.push('> ## ⭐ 先说结论：**下面那 49 个格子，你不用手摆。**');
H.push('>');
H.push('> 2026-09-26 真机实测通过：脚本用「**客户端控件模板 + 模板引用控件**」在运行时');
H.push('> 自动生成并摆正所有格子 ——');
H.push('> ```');
H.push('> [murdoku] 格子模板索引 1073741876（来自 cfg.cells.prefab）可用；缺 24 个格子，开始补建');
H.push('> [murdoku] 棋盘格子：25 / 25 存在（本次新建 23 个，模板索引 1073741876）');
H.push('> ```');
H.push('>');
H.push('> **编辑器里只需要一个格子**（一个「模板引用控件」，引用那张客户端控件模板），');
H.push('> 剩下 48 个由脚本生成。**关卡尺寸变了（5×5 ↔ 7×7）也完全不用动编辑器** ——');
H.push('> `ensure_cells(rows, cols)` 每次开局按当前关卡补建并摆正，多余的自动隐藏。');
H.push('>');
H.push('> 完整步骤见下方 **第 5 节**。**格子那一组坐标因此只是"万一要手摆"的参考。**');
H.push('');
H.push('---');
H.push('');
H.push('## 0. 照着填就行（三条规则）');
H.push('');
H.push('1. **画布 1600×900，原点在左下角，Y 轴向上。**');
H.push('2. 每个控件的**锚点**选「自定义」，Min = Max = `0.5, 0.5`，**中心(pivot) = `0.5, 0.5`**。');
H.push('3. 于是「位置 X, Y」= 控件**中心点**的绝对坐标，**跟父级无关**，');
H.push('   下表「位置(中心)」那一列**直接照抄**即可。子控件也不用换算，同样是绝对坐标。');
H.push('');
H.push('> 官方 API 文档（`mhtakr07vej4` 1317~1322 行）另有一套语义：');
H.push('> `Get/SetAnchoredPosition` 在没有父层级时以画布左下为原点，**有父层级时是与父层级中心的相对偏移**。');
H.push('> 那是**脚本运行时**用的，跟编辑器「位置」输入框不是一回事。');
H.push('> 本工程的脚本用的就是运行时那套（见 `engine_adapter_qianxing.lua` 的 `cell_offset`）。');
H.push('');
H.push('---');
H.push('');
H.push('## 1. 三道必开的门控（少一道就"什么都没发生"）');
H.push('');
H.push('### 门控 ① 客户端控件容器：**激活 + 可见**');
H.push('客户端控件必须放进「客户端控件容器」里。容器没激活或没可见 → 控件销毁、脚本停。');
H.push('官方原文（4 篇教程都有这句）：*客户端控件容器需要处于激活且可见状态*。');
H.push('');
H.push('### 门控 ② 容器要打开**「显示常驻光标」**');
H.push('这是 2026-09-26 在模拟器实现里挖出来、并在真机症状上对得上的一条：');
H.push('模拟器的派发条件是');
H.push('');
H.push('```js');
H.push('cursorEventsEnabled(t) {');
H.push('  for (let i = t; i; i = i.parent)');
H.push('    if (i.kind === "container" && i.showCursor === true) return true;');
H.push('  return false;');
H.push('}');
H.push('```');
H.push('');
H.push('也就是：**控件只要有一个祖先容器打开了 `showCursor`（编辑器里的「显示常驻光标」），');
H.push('光标事件才会派发**。不打开的话，界面画得再对，点哪儿都没反应。');
H.push('');
H.push('> 对应到工程里：容器控件的属性里勾上**「显示常驻光标」**。');
H.push('> 建议在**最外层那个容器**上勾一次，整棵树都生效。');
H.push('');
H.push('### 门控 ③ 脚本必须在 `OnInit` 里调 `script:EnableUpdate(true)`');
H.push('客户端脚本默认**不参与逐帧更新**（`updateEnabled = false`），运行时会直接跳过它的 `OnUpdate`：');
H.push('');
H.push('```js');
H.push('runScriptPhase(t, i) {');
H.push('  ... !(t === "OnUpdate" && !n.updateEnabled) && this.callGlobalDt(r, t, i)');
H.push('}');
H.push('```');
H.push('');
H.push('不开的后果非常隐蔽：`OnInit` / `OnStart` 都正常跑、日志也正常，');
H.push('但 `OnUpdate` **一次都不执行** —— 计时不动、单击的铅笔笔记永远落不了格、');
H.push('等待控件就绪的惰性重试也不会发生。');
H.push('本工程的 `entry_client_script.lua` 里已经写了（见 `enable_update()`），**不要删**。');
H.push('');
H.push('### 另外：文本显示需要奇匠等级');
H.push('官方教程注明：**文本显示需要达到特定奇匠等级解锁【自定义文本外显】**。');
H.push('等级不够时文本框不显示内容 —— 界面其它部分（按钮、图片）不受影响。');
H.push('');
H.push('---');
H.push('');
H.push('## 2. 建树顺序');
H.push('');
H.push('父级必须先存在。按下表从上到下建，同一行内父级在前：');
H.push('');
H.push('| # | 控件名 | 类型 | 父级 | 位置(中心) | 大小 | 初始 | 文案/样式 |');
H.push('|---|---|---|---|---|---|---|---|');
for (const g of groups) {
  H.push('| | **' + g.title + '** | | | | | | |');
  for (const n of g.rows) H.push('| ' + (plan.nodes.indexOf(n) + 1) + ' ' + row(n).slice(1));
}
H.push('');
H.push('---');
H.push('');
H.push('## 3. 每格/每张头像卡上还要挂的子控件');
H.push('');
H.push('这几个子控件**必须叫固定的名字**，脚本是按名字找的（`parent:GetChild("note")`）：');
H.push('');
H.push('### 3.1 每个格子 `cell.<r>.<c>` 三个子控件');
H.push('');
H.push('| 子控件名 | 类型 | 位置(中心) | 大小 | 初始 | 作用 |');
H.push('|---|---|---|---|---|---|');
H.push('| `face` | 图片 | **跟所在格子完全相同** | ' + plan.nodes.find((n) => /^cell\.1\.1$/.test(n.id)).w + ' × ' + plan.nodes.find((n) => /^cell\.1\.1$/.test(n.id)).h + ' | 显示 | 格面/头像图。脚本用 `SetImage` 换图 |');
H.push('| `note` | 文本框 | 同上 | ' + (plan.nodes.find((n) => /^cell\.1\.1$/.test(n.id)).w - 8) + ' × 36 | 隐藏 | 铅笔笔记（单击留下的草稿） |');
H.push('| `x` | 图片 | 同上 | ' + plan.nodes.find((n) => /^cell\.1\.1$/.test(n.id)).w + ' × ' + plan.nodes.find((n) => /^cell\.1\.1$/.test(n.id)).h + ' | 隐藏 | X 标记（"这格不可能是任何人"） |');
H.push('');
H.push('然后把 `face` **拖到格子的「默认」状态节点**上（也建议挂到悬停/按下/不可用）——');
H.push('官方说明：**预设按钮的外观来自它状态节点引用的子控件**，只改按钮自己看不出来。');
H.push('');
H.push('### 3.2 每张头像卡 `tray.<id>` 两个子控件');
H.push('');
H.push('| 子控件名 | 类型 | 位置(中心) | 大小 | 作用 |');
H.push('|---|---|---|---|---|');
H.push('| `face` | 图片 | **跟所在头像卡完全相同** | 与卡同 | 头像图 |');
H.push('| `text` | 文本框 | 同上 | 与卡同 | 角色名。脚本没有 `SetText`，只能写 `.text` 字段 |');
H.push('');
H.push('### 3.3 其它预设按钮');
H.push('每个按钮都建议加一个居中的子控件 `text`（文本框），并把它挂到状态节点上。');
H.push('脚本写按钮文字时优先写按钮自己的 `.text`，没有才去找子控件 `text`。');
H.push('');
H.push('---');
H.push('');
H.push('## 4. 状态可见性（这些控件一直存在，靠 visible 开关）');
H.push('');
H.push('**重要**：`intro.*` 和 `modal.*` 在编辑器里要**一直建出来**，不要等到用时再建。');
H.push('脚本关闭弹窗时只是把编辑器里手摆的控件**藏起来**，不会销毁它');
H.push('（旧版本会真销毁，导致指认面板第二次再也出不来 —— 已修）。');
H.push('');
H.push('| 控件 | 出现在这些状态 | 初始 |');
H.push('|---|---|---|');
for (const n of plan.nodes) {
  if (!n.states || n.states.length <= 1) continue;
  H.push('| `' + n.id + '` | ' + n.states.join(' / ') + ' | ' + (n.visible === false ? '隐藏' : '显示') + ' |');
}
H.push('');
H.push('---');
H.push('');
H.push('## 5. ⭐ 格子**不用手摆** —— 一个模板 + 一个「模板引用控件」就够了');
H.push('');
H.push('> **2026-09-26 真机实测通过**：`格子模板索引 1073741876 可用；缺 24 个格子，开始补建` /');
H.push('> `棋盘格子：25 / 25 存在（本次新建 23 个，模板索引 1073741876）`');
H.push('');
H.push('### 5.0 ⭐ 推荐：**纯模板模式**（编辑器里一个真格子都不建）');
H.push('');
H.push('最省控件的做法：**`board` 下只放一个 `tpl.cell`（模板引用控件），不建任何 `cell.*`。**');
H.push('格子全部由脚本生成 —— 编辑器里跟格子有关的控件**只有 1 个**。');
H.push('');
H.push('| 项 | 纯模板模式 | 传统手摆 |');
H.push('|---|---|---|');
H.push('| 编辑器里的格子控件 | **1 个**（`tpl.cell`） | 49 个 |');
H.push('| 关卡尺寸变化 | **完全不用动编辑器** | 要重摆 |');
H.push('| 副本外观来源 | **完全取自模板快照** | 各自配 |');
H.push('');
H.push('这个模式下有三件事按"正常"处理（脚本会明确说出来，不会误报）：');
H.push('');
H.push('1. 没有参照格子（`cell.1.1`）→ 体检打「**纯模板模式**」并跳过格子那段体检，**不报"找不到控件"**；');
H.push('2. 不做图片盖章（`_cells_stamp` 需要参照格子）→ 所以**副本外观完全取决于模板快照**，');
H.push('   模板里没配底图就重新存一次模板；');
H.push('3. 缺格子数 = 全部（`rows×cols`），首次开局会一次性生成 25 / 36 / 49 个。');
H.push('');
H.push('> `tpl.cell` 会被 `hide_unlisted` 自动隐藏，**不会显示在界面上**，位置大小随意。');
H.push('');
H.push('### 5.1 三步（**关键是第 ② 步**）');
H.push('');
H.push('| # | 做什么 |');
H.push('|---|---|');
H.push('| ① | **界面控件组管理 → 界面控件组库 → 客户端控件模板** →【添加客户端控件】→ 加一个「预设按钮」→ 在里面配好底图 + `face`/`note`/`x` 子控件 + 把 `face` 拖到「默认」状态节点 → **存为模板** |');
H.push('| ② | 在容器画布里新建一个「**模板引用控件**」，让它**引用**刚存的模板 |');
H.push('| ③ | 把它命名为 **`cell.1.1`**，然后**点击它记下「控件模板索引 ID」** |');
H.push('');
H.push('> ### ⚠️ 第 ② 步是最容易错的一步');
H.push('> **不能用模板"新建控件"，必须用「模板引用控件」去"引用"模板。**');
H.push('> 这一步是真机试出来的 —— 官方文档给了入口与约束，但**没说这两件事要串起来**。');
H.push('');
H.push('拿到 ID 之后二选一：');
H.push('');
H.push('- **路线 A（已采用，最稳）**：填进 `lua/entry_client_script.lua` 的 `cfg.cells.prefab`，重新打包同步。');
H.push('  本工程当前是 `1073741876`。日志里会看到 `cfg.cells.prefab = … ← 显式配置`。');
H.push('- **路线 B**：什么都不填，靠脚本**扫全树**自动发现（`cfg.cells.auto_scan`，默认开）。');
H.push('');
H.push('### 5.2 试玩时看这三行');
H.push('');
H.push('```');
H.push('[murdoku]   cfg.cells.prefab = 1073741876   ← **显式配置**，脚本会最先试它');
H.push('[murdoku] 格子模板索引 1073741876（来自 cfg.cells.prefab）可用；缺 24 个格子，开始补建');
H.push('[murdoku] 棋盘格子：25 / 25 存在（本次新建 23 个，模板索引 1073741876）');
H.push('```');
H.push('');
H.push('> `棋盘格子：X / Y 存在` 是**唯一可靠的"成了没有"信号** —— 副本可能因为模板快照里');
H.push('> 没配美术而完全透明，光看画面分不出「没生成」和「生成了但看不见」。');
H.push('>');
H.push('> 新建数比缺格数少 1 是正常的：脚本会**先用第一个候选"试造"一个**来验证索引可用，');
H.push('> 那个试造出来的会**直接当成第一个缺的格子收下**（不浪费）。');
H.push('');
H.push('### 5.3 为什么「右键另存为模板」不行');
H.push('');
H.push('官方《客户端控件和客户端脚本的定义》的硬约束：');
H.push('');
H.push('> 除**客户端控件容器画布中的客户端控件**以及**客户端控件模板中的控件**外，其他控件均为**服务器控件**，');
H.push('> **服务器控件的模板索引无法被客户端脚本调用**。');
H.push('');
H.push('实测过的三种索引：');
H.push('');
H.push('| 索引来源 | 结果 |');
H.push('|---|---|');
H.push('| `1073741848` 内置「预设按钮」基础模板 | ❌ 返回 nil |');
H.push('| `1073741864` **右键**「另存为模板」得到的 | ❌ 也返回 nil |');
H.push('| `1073741876` 客户端控件模板 + **模板引用控件** | ✅ **成功，25 / 25** |');
H.push('');
H.push('### 5.4 ⚠️ 一个很容易踩的坑：**引用控件占着 `cell.1.1` 这个名字**');
H.push('');
H.push('真机 17:17 / 17:23 截图 + 日志：`cell.1.1` 的 `prefabIndex` **正好等于**');
H.push('`cfg.cells.prefab` —— 说明它**就是那个模板引用控件本身**，不是格子。后果：');
H.push('');
H.push('- 它被算成"已存在" → 缺格子数少 1 → **那一格永远不会被生成**；');
H.push('- 引用控件渲染不出格子副本 → 截图里 (1,1) 看着是**空的**（"第一个格子没造出来"）。');
H.push('');
H.push('日志里的判据就两个数字，一眼可辨：');
H.push('');
H.push('```');
H.push('缺 24 个格子      ← ❌ 说明有 1 格是"编辑器里的控件"，没被生成');
H.push('缺 25 个格子      ← ✅ 全部由脚本生成');
H.push('```');
H.push('');
H.push('**脚本现在会自动处理**（不用你改编辑器）：');
H.push('');
H.push('1. 发现某个 `cell.<r>.<c>` 位置的控件**是编辑器手摆的**、且索引 == `cfg.cells.prefab`');
H.push('   → 把它**改名让位**（`__tpl_ref_cell.1.1`）并隐藏；');
H.push('2. 所有模板引用控件（`tpl.cell` 等约定名）**显式隐藏**；');
H.push('3. 于是那一格变成"缺"，脚本**在那一格真的生成副本**。');
H.push('');
H.push('> 为什么不能直接"同名覆盖"：两个控件都叫 `cell.1.1` 的话，`find` 会取到编辑器那个，');
H.push('> 点击和渲染全打到错的对象上。所以必须**先改名让位**。');
H.push('>');
H.push('> 顺带一个实测结论：**关掉 `tpl.cell` 的「初始激活」不影响脚本**（日志完全一致）——');
H.push('> 但**补不上 (1,1) 那个洞**，因为洞是 `cell.1.1` 造成的，不是 `tpl.cell`。');
H.push('');
H.push('### 5.4.1 ⚠️ 两个索引字段**不是一回事**（官方原文）');
H.push('');
H.push('| 类 | 字段 | 访问 | 官方说明 |');
H.push('|---|---|---|---|');
H.push('| `ClientUIBaseControl`（**所有**控件的基类） | `prefabIndex` | 只读 | 控件模板索引（**这个控件本身**是哪个模板的实例） |');
H.push('| `ClientUIReferenceControl`（**模板引用控件**，只有这一个字段） | `referencedPrefabIndex` | 只读 | **引用**控件模板索引 |');
H.push('');
H.push('所以：**判断「模板引用控件引用了哪张模板」要读 `referencedPrefabIndex`，不是 `prefabIndex`。**');
H.push('脚本两个都读、两个都打进日志（`ref=` 那一栏），不会再混。');
H.push('');
H.push('> `active` 也是**只读**，官方写着「true 时控件可见且挂载脚本逻辑运行，false 时控件不可见且脚本逻辑停止运行」。');
H.push('> 也就是**可见性由 `active` 参与决定，而脚本改不了它** ——');
H.push('> 所以脚本改用**把模板引用控件挪出画布**（位置 200000,200000 + 缩成 0 尺寸），');
H.push('> 这样不管可见性怎么算，它都不可能盖住任何一个格子。');
H.push('> 你在编辑器里关掉它的「初始激活」也可以，两者不冲突。');
H.push('');
H.push('### 5.5 关卡切换：**编辑器完全不用动**');
H.push('');
H.push('`ensure_cells(rows, cols)` 每次开局都按**当前关卡**的尺寸补建并摆正：');
H.push('');
H.push('- 5×5 → 7×7：补建缺的格子；');
H.push('- 7×7 → 5×5：多余的格子由 `hide_unlisted` / 渲染差集**自动隐藏**，不用删。');
H.push('');
H.push('所以一套编辑器布局（**一个格子 + 一张模板**）通吃所有尺寸。');
H.push('');
H.push('### 5.6 对手摆的兼容');
H.push('');
H.push('编辑器里**已经摆好的格子脚本不会动**（只摆正位置），只补缺的那些。');
H.push('所以「手摆一半 + 生成一半」也可以；全部手摆完整时脚本检测到"格子齐全"');
H.push('会直接跳过生成。');
H.push('');
H.push('> ⚠️ 模板是**存下来那一刻的快照**。之后又给模板里的格子加底图/子控件，');
H.push('> **必须重新存一次模板**，否则生成的副本会缺东西（看着像"没生成"）。');
H.push('');
H.push('---');
H.push('');
H.push('## 6. 脚本挂载');
H.push('');
H.push('1. `lua tools/bundle_client_script.lua` → 产出 `dist/client_script.lua`（7 个模块打成 1 个文件）。');
H.push('2. 千星沙箱 → 客户端脚本资源管理器 → 新建脚本映射，指向 `dist/client_script.lua`。');
H.push('3. 选中一个客户端控件（任意一个，比如 `root` 容器）→「脚本」页签 → 添加脚本 → 选这个映射。');
H.push('4. 如果面板显示「暂无引用」：右键脚本记录 →【修改引用路径】→ 双击 `client_script.lua`。');
H.push('5. 界面布局必须被**职业**引用一次才会在游玩中生效（官方硬性要求）。');
H.push('');
H.push('---');
H.push('');
H.push('## 7. 本表是怎么来的（可复现）');
H.push('');
H.push('```powershell');
H.push('$lua = "$env:LOCALAPPDATA\\Programs\\Lua\\bin\\lua.exe"');
H.push('& $lua tools\\dump_layout.lua          # 1920×1080 设计空间 → 1600×900 画布空间，导出 JSON');
H.push('node tools\\gen_editor_guide.mjs      # 本文件');
H.push('node tools\\sim\\play_test.mjs          # 在模拟器里把整套交互跑一遍（27 项断言）');
H.push('```');
H.push('');

fs.writeFileSync(OUT, H.join('\n'), 'utf8');
console.log('生成 ' + OUT);
console.log('  控件 ' + plan.count + ' 个，分组 ' + groups.length + ' 组');
