#!/usr/bin/env node
/**
 * sabotage_check.mjs —— ★ 破坏性验证：故意把"棋盘接线"改坏，确认**回归会红**。
 *
 * 为什么必须做 ✗：绿灯只证明"现在没红"✓ —— ★ **不证明"坏掉会被抓到"** ✗
 *   （★ 本项目的独立复核者就抓到过一次"破坏没生效 ⇒ 5 套假绿" ✓）
 *
 * 做法 ✓：备份 → 改一处 → 跑指定套件 → **逐字节还原** → 核对 sha256 ✓
 * 判据 ✓：每一类破坏都**至少有一套变红** ✓；还原后**全部回到绿** ✓
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO = 'D:/新建文件夹/miHoYo Launcher/qianxing-murdoku';
const SRC = REPO + '/lua/ui_controller.lua';
const LUA = process.env.LOCALAPPDATA + '/Programs/Lua/bin/lua.exe';
const BAK = REPO + '/.sabotage_bak.lua';

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const suiteRed = (t) => {
  try { execFileSync(LUA, ['tests/' + t + '.lua'], { cwd: REPO, stdio: 'pipe' }); return false; }
  catch { return true; }
};

const SUITES = ['board_wiring_e2e', 'cell_mark_letter', 'row_letter_map', 'row_letter_stability', 'clue_slots', 'selection_residue'];
// ★★★★★★★★ 2026-10-15 **新增 `select_hit_visible`** ✗✓✓（★ 破坏 L 需要它 ✓）
//
//   ★★★ 为什么必须加 ✗：★ 破坏 L 加进去之后**报了"无人抓"** ✗ ——
//     ★ 而那不是"用例写得不对" ✓ ★ 是**用例压根不在这个名单里** ✓✓
//     ⇒ ★★ 表现与"没有检查守着"**一模一样** ✓（★ H/I 那轮的洞就是这个形状 ✓）
//   ★ 教训 ✓：★ **新加一条破坏时，必须同时确认"守着它的那套在 `SUITES` 里"** ✗
//     ★ 否则破坏项**永远报无人抓** ✓ 而人会以为是用例的问题 ✓
SUITES.push('select_hit_visible');
// ★★★★★★★★ 2026-10-15 **再加 `settle_button`** ✗✓✓（破坏 M 需要它 ✓）
//   ★ 教训与上一条一模一样 ✓：★ **新破坏必须同时确认"守着它的那套在名单里"** ✗
//     ★ 否则破坏项报"无人抓" ✓ 而人会去查用例 ✗ —— ★ 其实是用例**根本没跑** ✓
SUITES.push('settle_button');
// ★★★★★★★★ 2026-10-15 **这一套测的是【打包产物】，不是源码** ✗✓✓
//
//   ★★★ 为什么必须单独列出来 ✗：★ `tests/grid_cost.lua` 读的是
//     `dist/client_script.lua`（★ 默认参数 ✓ 见它的 §前置 ✓）
//   ★★ 而破坏是改**源码**的 ⇒ ★ **不重新打包 ⇒ 它测的还是旧包** ✓✓
//     ⇒ ★★ 表现就是把破坏**静默放过** ✗ —— ★ 正是 P7 里"破坏没到达被测代码"那一条 ✓
//   ★ 判据出处 ✓：★ 我第一次跑 `I` 就是"无人抓" ✓ ★ 重新打包之后立刻变红 ✓（实测过 ✓）
//   ⇒ ★ 所以这一类套件跑之前**必须先打包** ✓
const BUNDLED_SUITES = ['grid_cost'];
const bundleOnce = () => {
  try { execFileSync(LUA, ['tools/bundle_client_script.lua'], { cwd: REPO, stdio: 'pipe' }); return true; }
  catch { return false; }
};

const original = fs.readFileSync(SRC, 'utf8');
fs.writeFileSync(BAK, original, 'utf8');
const origSha = sha(SRC);

// 每一类破坏：{ 名字, 找什么, 换成什么 }
const sabotages = [
  // ★★ 2026-10-11 锚点更新 ✗✓ —— ★ 原来指的是 `local _key = tonumber(_pid) or _pid` ✓
  //   ★ 而**那一行在 v186 已经删掉了** ✗（★ 它正是"先到先得"那段"吃掉 D/E"的元凶 ✓）
  //   ★★ 于是这条破坏**静默失效** ✓ ⇒ ★ 报"破坏未生效" ✓
  //     ⇒ ★ 这个工具**自己发现了自己过期** ✓（★ 值得表扬的设计 ✓ 不是静默放过 ✓）
  //   ⇒ ★ 改成钉**现在那一行写入** ✓（★ 行号才是键 ✓）
  ['A 写侧 letter 键改错（行号 +100）',
    'Controller._row_letter[_pid] = tostring(_lt)',
    'Controller._row_letter[(_pid or 0) + 100] = tostring(_lt)'],
  ['B 写侧 face 键改错（行号 +100）',
    'local _key_face = _rowno',
    'local _key_face = (_rowno or 0) + 100'],
  ['C 查侧 棋子→行号 改错（+1）',
    'local n = Controller._pos_of_piece(Controller._piece_core, id)',
    'local n = (Controller._pos_of_piece(Controller._piece_core, id) or 0) + 1'],
  ['D letter_of 退回字符串键（主路失效）',
    '  return m[n] or m[tostring(n)]',
    '  return m[tostring(n)]'],
  ['E 换关不清棋子表（留下上一关的）',
    '    Controller._piece_core = nil\n    Controller._piece_id_cache = nil',
    '    -- (去掉清理)'],
  ['F 不补那一趟（`_row_need` 恒按 _grid_in_refresh）',
    '  local _row_need = (self._grid_in_refresh == true)\n  if not _row_need then\n    local m0 = rawget(Controller, "_row_letter")\n    _row_need = (type(m0) ~= "table") or (m0[pos] == nil)\n  end',
    '  local _row_need = (self._grid_in_refresh == true)'],
  ['G 补那一趟改成"整张表非空就算"（按行判退化成按表判）',
    '_row_need = (type(m0) ~= "table") or (m0[pos] == nil)',
    '_row_need = (type(m0) ~= "table") or (next(m0) == nil)'],
  // ★★★★★★★★ 2026-10-15 **新增：选中残留那一类** ✗✓✓
  //
  //   ★★★ 用户报的（★ 原话 ✓）：「**放置 v 后选择了 d，一不小心把 v 取消了，
  //     点出来的标记是 v 的，但显示选择的 d，此时再长按放置，放的会是 v**」✓
  //   ★★ 根因 ✓：★ 卡片高亮原来是**独立的一份状态** ✗
  //     ⇒ ★ "选中变了但不是点卡片改的"（★ 拿起棋子 ✓）⇒ ★ 高亮**留在原地** ✓✓
  //   ★ 修法 ✓：★ 高亮降级成**派生值** ✓（★ 唯一写点 = `_sync_clue_focus` ✓）
  //   ⇒ ★★ 这一条破坏 = **让那个派生恒等于"上一次的值"** ✗
  //     ⇒ ★ 高亮**再也不跟着选中走** ✓ ⇒ ★ `selection_residue` 必须变红 ✓✓
  //   ★ 判据出处 ✓：`tests/selection_residue.lua`
  //     （★ 它在**修复前**的代码上是 6 红 ✓ —— ★ 已实测 ✓ 能红能绿 ✓）
  ['H 选中残留：卡片高亮不再跟着 `core.selected` 派生',
    'local want = ((pos ~= nil) and pos > 0) and pos or nil',
    'local want = rawget(self, "_clue_sel_pos")'],
  // ★★★★★★★★ 2026-10-15 **新增：让"高亮"恒亮 / 恒灭（★ 打掉 P3 的反向半边）** ✗✓✓
  //
  //   ★★★ 为什么必须单独破坏这一下 ✗：
  //     ★ H 那条只能让**派生值**错 ✗ —— ★ 而 `grid_cost` 的 K 段是**自己推 `focused_clue`** ✓
  //       （★ 它直接调 `_on_grid_item_click` ✓）⇒ ★ 两条路径碰不到一起 ✓✓
  //     ★★ 所以"样式到底有没有被算成 `clue.focus`"这件事**没人打得到** ✗
  //   ⇒ ★ 把规划里那一行**钉死成 `clue`** ✓ —— ★ 也就是"**永远不高亮**" ✓
  //     ★ 一个"永不高亮"的实现 ⇒ ★ `grid_cost` 的 K 段必须红 ✓✓（P3 反向半边 ✓）
  ['I 高亮恒灭：规划里那一条永不取 `clue.focus`',
    'local style = (self.focused_clue == i) and "clue.focus"',
    'local style = false and "clue.focus"'],
  // ★★★★★★★★ 2026-10-15（第二轮）**新增：把【真机那条】高亮打断** ✗✓✓
  //
  //   ★★★ 为什么要它 ✗（★ 这一条正对"第一轮没修好"的那个洞 ✓）：
  //     ★ H 与 I 打的全是**老卡片**那条路 ✓（★ 只有模拟器/老路径会走 ✓）
  //     ★★ 而真机 `_grid_state == "on"` ⇒ ★ 老卡片不进规划 ✓
  //       ⇒ ★★ **真机那条高亮【没有任何破坏能打到】** ✓✓
  //     ★★★ 这就是第一轮"6 红 → 0 红"却真机没修好的**工具侧根因** ✓
  //   ⇒ ★ 这一条破坏 = ★ **让判据恒假** ✓ ⇒ ★ 高亮永远不画 ✓
  //     ★ `selection_residue` 第 6/7 节**必须红** ✓（★ 实测过 ✓）
  ['J 真机路高亮恒灭：列表项 `backrop1` 永不点亮',
    'local want_on = ((want ~= nil) and want == pos)',
    'local want_on = false and ((want ~= nil) and want == pos)'],
  // ★★★★★★★★ 2026-10-15（第三轮）**新增：把"取消放置 ⇄ 选中"的捆绑加回去** ✗✓✓
  //
  //   ★★★ 为什么这一条最重要 ✗（★ 它是用户点破的**根因** ✓）：
  //     ★ 用户原话 ✓：「**取消操作确实捆绑选中，也就是我取消 a 放置的同时又重新选了 a，
  //       把取消放置和选中的联系切断就行**」✓✓
  //   ★★ 前两轮我都在这条上游打补丁 ✗（高亮错了就修高亮 ✓）
  //     ★★ 而**根因是这一行**：★ 拿起棋子时 `self.selected = self.grid[r][c]` ✓
  //       ⇒ ★ 屏幕亮 D ✗ 而选中变成 V ⇒ ★ **再长按放 V** ✓✓
  //   ⇒ ★ 这一条破坏 = ★ **把那一行加回去** ✓ ⇒ ★ `selection_residue` 与 `selftest` **都必须红** ✓
  //   ★ 注意 ✓：★ 它打在 **`lua/murdoku_core.lua`** ✗（★ 不是默认那个文件 ✓）
  //     ★★ 这正是本轮把工具扩成"可指定文件"的原因 ✓（★ 否则这条**打不到** ✓）
  ['K 把「拿起棋子顺手把人选上」的捆绑加回去',
    '    return do_clear(self, r, c, true), nil\n  end\n  -- ★★ 2026-09-28 改',
    '    self.selected = self.grid[r][c]\n    return do_clear(self, r, c, true), nil\n  end\n  -- ★★ 2026-09-28 改',
    'lua/murdoku_core.lua'],
  // ★★★★★★★★ 2026-10-15（真机截图那一轮）**新增：把选关屏的命中层重新藏起来** ✗✓✓
  //
  //   ★★★ 用户原话 ✓：「**左右箭头没加上去，功能也没换绑到新的方块上**」✗
  //     ★ 真机截图里 4 张卡**位置全对** ✓ 但**点了没反应** ✓
  //   ★★ 根因 ✓：★ `apply_screen_hide` 主页/选关那一支的 `PREFIX` 里有 **`"hit."`** ✗
  //     ★ 它本来是给**关卡内**那七颗 `hit.*` 用的 ✓
  //       ⇒ ★★ 却**同时命中选关屏自己的 `hit.select.*`** ✗ ⇒ 命中层被逐帧藏掉 ✓
  //   ★★★ 这一条为什么**必须有** ✗：★ 命中层**本来就是隐形的** ✓
  //     ⇒ ★ "被藏了"与"正常隐藏"在屏幕上**长得一模一样** ✓
  //     ⇒ ★ 唯一可观察差异 = **点击有没有反应** ✓ ⇒ 没有专门用例 ⇒ 只能靠玩家发现 ✓
  //   ⇒ ★ 这一条破坏 = ★ **把那颗前缀加回去** ✓ ⇒ ★ `select_hit_visible` **必须变红** ✓
  ['L 选关屏命中层又被「hit.」前缀吃掉（点了没反应）',
    '    PREFIX = { "clue.", "hud.", "room.label.", "tray.", "action.", "hex.",\n               "selbtn.", "tpl.",',
    '    PREFIX = { "clue.", "hud.", "room.label.", "tray.", "action.", "hex.", "hit.",\n               "selbtn.", "tpl.",'],
  // ★★★★★★★★ 2026-10-15（同一晚第二轮）**新增：让「结算」顺手把存档也写了** ✗✓✓
  //
  //   ★★ 用户要求 ✓：「**不接存档线，只接结算**」✓
  //   ★★★ 为什么必须专门破坏这一条 ✗：★ 这件事**在屏幕上完全看不出来** ✓
  //     · 点了**都有反应** ✓（结算信号照发 ✓）
  //     · 差别只在**存档有没有被写** ✗ —— ★ 没有任何视觉差异 ✓
  //     ⇒ ★ 没有用例守着 ⇒ ★ 将来谁把两个分支合并了**没人会发现** ✓✓
  //   ⇒ ★ 这一条破坏 = ★ **在结算之后补一次 `on_save()`** ✓
  //     ⇒ ★ `tests/settle_button.lua` §3 的"on_save 一次都没被调"**必须变红** ✓
  ['M 「结算」按钮顺手把存档也写了（违反"不接存档线"）',
    '    if self.opts.on_settle_only then self.opts.on_settle_only() end',
    '    if self.opts.on_settle_only then self.opts.on_settle_only() end\n    if self.opts.on_save then self.opts.on_save() end'],
];

let allGood = true;
// ★★★★★★★★ 2026-10-11 **锚点匹配要容忍 CRLF** ✗✓✓（★ 两个破坏静默失效过一次 ✓）
//
//   ★★★ 症状 ✓：★ E 与 F 报「**没匹配上（破坏未生效）**」✗
//     ★★ 而它们要找的代码**明明就在源码里** ✓ —— ★ 我逐行核过 ✓
//   ★ 根因 ✓：★ **本项目源码是 CRLF** ✗ ★ 而脚本里的跨行锚点写的是 `\n`（LF）✓
//     ⇒ ★ 多行锚点**永远匹配不上** ✓✓
//   ★★ 值得表扬 ✓：★ 这个工具**没有静默放过** ✗ —— ★ 它明说"没匹配上" ✓
//     ★ 这正是"**破坏必须确认到位**"那条纪律 ✓（★ 长按那轮我踩过同一个坑 ✓）
//   ⇒ ★ 修法 ✓：★ **把"源码"与"锚点"都归一成 LF 再比** ✗ ——
//     ★ 改完写盘时**统一用 LF** ✓ ★ 反正 Lua 不在乎 ✓（★ 还原时有原始字节 ✓）
const originalLF = original.replace(/\r\n/g, '\n');

// ★★★★★★★★ 2026-10-15 **破坏要能打在【别的文件】上** ✗✓✓（★ 本轮扩的 ✓）
//
//   ★★★ 为什么必须扩 ✗：★ 原来这个工具**只会改 `lua/ui_controller.lua`** ✗
//     ★★ 而本轮的根因在 **`lua/murdoku_core.lua`** ✓
//       （★ "拿起棋子顺手把人选上" 那一行 ✓ 用户点破的正是它 ✓）
//     ⇒ ★ 不改工具 ⇒ ★ **根因那一行【打不到】** ✓ ⇒ ★ 又是一条无人守的契约 ✓✓
//   ★★ 判据 ✓：★ 每个破坏项第 4 个元素写**相对仓库的路径** ✓
//     ★ 省略 ⇒ 默认还是 `lua/ui_controller.lua` ✓（★ 老项目一个都不用改 ✓）
//   ★ 还原 ✓：★ 按**路径**各存一份原始字节 ✓ ★ 每轮破坏后逐文件验 sha ✓✓
const snapshots = new Map();
function snapshotOf(rel) {
  if (!snapshots.has(rel)) {
    const abs = REPO + '/' + rel;
    snapshots.set(rel, { abs, text: fs.readFileSync(abs, 'utf8'), sha: sha(abs) });
  }
  return snapshots.get(rel);
}
function restoreAll() {
  let ok = true;
  for (const s of snapshots.values()) {
    let restored = false;
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(s.abs, s.text, 'utf8');
      if (sha(s.abs) === s.sha) { restored = true; break; }
    }
    if (!restored) ok = false;
  }
  return ok;
}
const LEFTOVER = /\b(?:and|if)\s+false\b/;

for (const [name, find, repl, relIn] of sabotages) {
  const rel = relIn || 'lua/ui_controller.lua';
  const snap = snapshotOf(rel);
  const baseLF = snap.text.replace(/\r\n/g, '\n');
  const patched = baseLF.split(find).join(repl);
  if (patched === baseLF) { console.log(`  ⚠️ ${name}：没匹配上（破坏未生效）`); allGood = false; continue; }
  fs.writeFileSync(snap.abs, patched, 'utf8');
  // ★★ 先打包，再跑"读产物"的那几套 ✗（★ 否则破坏根本到不了被测代码 ✓ P7 ✓）
  const bundled = bundleOnce();
  if (!bundled) console.log('  ⚠️ 打包失败 —— 读产物的那几套本轮结果不可信 ✗');
  const red = SUITES.filter(suiteRed).concat(bundled ? BUNDLED_SUITES.filter(suiteRed) : []);
  const restored = restoreAll();
  // ★ 还原之后**必须再打一次包** ✗ —— ★ 否则 `dist/` 里留着"被破坏过的产物" ✓✓
  //   （★ 后续别的套件/交付会拿到那份坏包 —— ★ 这与"源码留破坏"一样危险 ✓）
  const rebundled = bundleOnce();
  if (!restored || !rebundled) allGood = false;
  const caught = red.length > 0;
  console.log(`  ${caught ? '✅' : '❌'} ${name}　→ 变红：${caught ? red.join(', ') : '（无人抓 ✗）'}　还原=${restored}　重打包=${rebundled}`);
  if (!caught || !restored) allGood = false;
}

// ★ 收尾自检 ✓：**所有被碰过的文件**都不许留下"永假"痕迹 ✗
let leftovers = [];
for (const s of snapshots.values()) {
  if (!fs.existsSync(s.abs)) continue;
  const lines = fs.readFileSync(s.abs, 'utf8').split(/\r?\n/)
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => LEFTOVER.test(l))
    .map(([n, l]) => [s.abs, n, l]);
  leftovers = leftovers.concat(lines);
}
if (leftovers.length > 0) {
  console.error('\n✗✗ 源码里**还留着破坏痕迹** ✗ —— 这一轮的结果**全部作废** ✓');
  leftovers.slice(0, 6).forEach(([f, n, l]) => console.error(`    ${f.split('/').pop()}:${n}: ${l.trim()}`));
  console.error('   ★ 修法：git checkout -- <该文件>　然后重跑 ✓');
  allGood = false;
}

fs.unlinkSync(BAK);
const allMatch = [...snapshots.values()].every((s) => sha(s.abs) === s.sha);
console.log(`\n最终 sha256 与原始一致（全部 ${snapshots.size} 个被碰过的文件）：${allMatch}`);
console.log(`源码里没有残留破坏痕迹：${leftovers.length === 0}`);
console.log(allGood ? '✅ 全部破坏被抓 + 全部还原成功 + 源码干净' : '❌ 有破坏没被抓 / 还原失败 / 源码有残留');
process.exit(allGood ? 0 : 1);
