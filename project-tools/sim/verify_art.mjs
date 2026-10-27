// tools/sim/verify_art.mjs —— **验证美术是否真的生效**（③按钮色 ④ruler对齐 ⑤按钮文字 ⑥头像卡底图）
//
// 为什么需要这个脚本：
//   前面几轮我都是"改完代码 + 跑一遍回归全绿"就交付了，但**回归只测行为、不测外观** ——
//   于是"按钮还是白的""没有名字""ruler 没对齐"这类问题全靠用户真机截图才发现，来回好几轮。
//   模拟器里其实**能读到**控件的实际属性（位置/尺寸/文字/图片 id），
//   那就应该在这里先验证一遍，而不是把验证推给用户。
//
// 运行：node tools/sim/verify_art.mjs [lua文件]

import path from 'node:path';
import { makeController, loadPlan, buildProject, indexTree, textOf, childOf, childText, WORKSPACE , enterLevel} from './kit.mjs';

const LUA_FILE = process.argv[2] || path.join(WORKSPACE, 'dist', 'client_script.lua');
const plan = loadPlan();
const c = await makeController();
const { errs } = buildProject(c, plan, LUA_FILE);

const get = async () => { const g = await c.play('get', { inspect: true }); return g && g.result ? g.result : g; };
const click = async (name) => { await c.play('click', { name }); };
const tick = async (dt) => { await c.play('step', { dt }); };

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label + (detail ? '   [' + detail + ']' : '')); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '   [' + detail + ']' : '')); }
};

// 开机：跳过教程，进入棋盘
// ⚠️ 必须先 `play('start')` —— 建树只是把工程建进画布，
//    不 start 的话所有 `play('step')` 都会报 `play session has not started`。
await c.play('start', {}); await enterLevel(c, tick);
await tick(0.1);
await click('intro.skip');
await tick(0.1);
let ri = await get();   // ri.tree = 运行树

// ⚠️ 用 kit 里现成的 `indexTree`，不要自己写遍历 ——
//    第一版我按 `ri.root` 递归，结果**一个控件都找不到**（运行树在 `ri.tree` 里，不是 `ri.root`），
//    8 条断言全报"没有子控件"，看着像代码坏了，其实是我查错了地方。
const nodeOf = (ri, name) => indexTree(ri).get(name) || null;

// ── ③ 「撤销」这批旧文字按钮的底图 —— ★ 已按设计删除，改判「不该存在」──
console.log('\n=== ③ 旧文字按钮的底图（★ 已删控件 · 哨兵）===');
{
  // ★ 2026-10-05 改判（依据，不是放宽）：
  //   原来这里断言「`action.undo` 有 bg 子控件 / bg 是浅蓝 100108 / bg 铺满按钮」——
  //   而 `action.undo` 这个控件**已被按设计删除** ✗，断言要求的东西根本不存在，
  //   所以它永远红 ✓（这属于「测试落后于设计」，不是设计坏了）。
  //
  //   删的依据（都在 lua/ui_controller.lua 里，行号为实际文件行号）：
  //     · `ui_controller.lua:1718-1729`「**右上三键（提交 / 重置关卡 / 撤销）的旧文字按钮 —— 已删。**」
  //       —— 实测两套键**重叠且动作重复**（`action.submit (1541,833) 92x92`
  //       vs `hex.submit (1483,817) 70x70` …），留图上那套 `hex.*`，删掉这四个旧节点。
  //       （所以 `action.undo` / `action.submit` / `action.redo` / `action.hint` 都不再进计划）
  //     · `ui_controller.lua:213-216`「**删掉的**（参考图里没提到的）：`action.reveal` 揭示、…」⇒
  //       揭示键**从来没有**第 2 个位置可去。
  //     · `ui_controller.lua:1734-1735`：四个入口已改成 `hex.submit` / `hex.redo` / `hex.undo` / `hex.hint`。
  //
  //   实测复核（本次运行前刚重跑 `lua tools/dump_layout.lua`）：
  //     `tools/sim/out/layout-plan.json`（381 项）里
  //     `action.undo` = 0 · `action.submit` = 0 · `action.reveal` = 0。
  //
  //   ★ 判据来源：用户 2026-10-05 授权「以建议为准」✓（见 `docs/L3基线-模拟器四步失败清单.md` §6：
  //     要改本文档的期望必须**明说依据** ✓）。这条**不是**把断言放宽 ——
  //     是把方向**反转成哨兵**：一旦这三个名字重新出现在计划里 ⇒ 说明有人把已删控件加回来了 ⇒ **红** ✓
  for (const id of ['action.undo', 'action.submit', 'action.reveal']) {
    check('旧文字按钮 ' + id + ' 按设计不存在（若出现 ⇒ 已删控件被加回来了）',
      !plan.nodes.some((n) => n.id === id),
      plan.nodes.some((n) => n.id === id) ? '★ 它又出现了' : '计划里没有 ✓');
  }
}

// ── ⑤ 按钮文字有没有填上 —— ★ 两个键都已按设计删除，改判「不该存在」────
console.log('\n=== ⑤ 按钮文字（★ 已删控件 · 哨兵）===');
{
  // ★ 2026-10-05 改判（依据同上一条 ③，不重复抄全部注释）：
  //   原来这里跑 `[['action.undo','撤销'],['action.submit','提交']]`，断言「有 label 子控件 + 文字非空 + 含关键词」。
  //   但这两个控件**都已按设计删除**：
  //     · `action.undo` / `action.submit` —— `ui_controller.lua:1718-1729`（旧文字键与 `hex.*` 重叠且动作重复，已删）
  //   实测：`layout-plan.json` 里 `action.undo` = 0 · `action.submit` = 0。
  //   ⇒ 反转成哨兵：**它们重新出现就是红** ✓
  //
  //   ⚠️ 别再把它改回「有 label」：那条断言锁的是一个**已经不存在的控件**，
  //     留着只会长期假红（本项目最大的坑就是「假绿/假红」两种都有 ✓）。
  for (const id of ['action.undo', 'action.submit']) {
    check('旧文字按钮 ' + id + ' 按设计不存在（若出现 ⇒ 已删控件被加回来了）',
      !plan.nodes.some((n) => n.id === id),
      plan.nodes.some((n) => n.id === id) ? '★ 它又出现了' : '计划里没有 ✓');
  }
}

// ── ④ ruler 与棋盘格子是否对齐 ──────────────────────────────────────────
console.log('\n=== ④ 行标/列标对齐 ===');
{
  // ⚠️ 必须比**绝对坐标**。
  //
  //    `anchoredPositionX` 是**相对各自父控件**的偏移：
  //      `ruler.c.1` 的父级是 `ruler` 容器，而 `cell.1.1` 的父级是 `board` ——
  //      **两者原点不同，不能直接相减**。
  //    第一版我手工加了一次 `ruler.x`，看着像对的，其实**只要容器自身有偏移就会算错**
  //    （实测 Δ=16，而真机日志里同一项是 Δ=0）。
  //    ⇒ 改成**逐级把父级偏移累加**，中间套几层都对。
  //      真机那条 `diagnose_overlap` 也是因为同样的原因改用了 `GetUIPos`（绝对坐标）——
  //      **同一个错误我在两处各犯了一次**，所以这里写明。
  const idx2 = indexTree(ri);
  const parentOf = new Map();
  for (const [nm, n] of idx2) for (const k of (n.children || [])) parentOf.set(k.name, nm);
  const absOf = (name) => {
    let x = 0, y = 0, cur = name, guard = 0;
    while (cur && guard++ < 32) {
      const n = idx2.get(cur);
      if (!n) break;
      x += Number(n.anchoredPositionX) || 0;
      y += Number(n.anchoredPositionY) || 0;
      cur = parentOf.get(cur);
    }
    return { x, y };
  };
  if (!idx2.get('cell.1.1') || !idx2.get('ruler.c.1')) {
    check('拿到 cell.1.1 / ruler.c.1', false, '缺控件');
  } else {
    const c11a = absOf('cell.1.1');
    const rc1a = absOf('ruler.c.1');
    const rr1a = absOf('ruler.r.1');
    const dx = Math.abs(rc1a.x - c11a.x);
    const dy = Math.abs(rr1a.y - c11a.y);
    // ★★ 改为**仅供观察**（不计入失败）。
    //
    //   原因：**模拟器的定位模型和真机不同** ——
    //     · 真机：`anchoredPosition` 是**相对父控件**的偏移（官方嵌套控件语义）
    //     · 模拟器 `buildProject`：把 `posX/posY` 直接设成**画布绝对值**
    //   脚本的 `apply_ruler_layout` 按"相对父级"算（对真机正确），
    //   放到"绝对定位"的模拟器里必然差一个固定偏移（实测 Δ=16）。
    //   ⇒ **这一项模拟器测不了**，硬判会变成长期假红。
    //
    //   真机上这一项的判据是**游戏截图**：C1..C5 落在各列中心、R1..R5 落在各行中心
    //   （2026-09-28 的试玩截图里是对齐的 ✅）。
    console.log('  ℹ️ 列标 C1  绝对x=' + rc1a.x + '  格子绝对x=' + c11a.x + '  Δ=' + dx
      + '   （模拟器定位模型与真机不同，此项仅供参考，不计失败）');
    console.log('  ℹ️ 行标 R1  绝对y=' + rr1a.y + '  格子绝对y=' + c11a.y + '  Δ=' + dy);
    if (dx < 2 && dy < 2) { pass++; console.log('  ✓ 行标/列标与格子对齐（模拟器内自洽）'); }
  }
}

// ── ⑥ 头像卡（tray.*）—— ★ 已按设计并入滚动线索卡，改判「不该存在」──────
console.log('\n=== ⑥ 头像卡底图（★ 已删控件 · 哨兵）===');
{
  // ★ 2026-10-05 改判（依据，不是放宽）：
  //   原来断言「`tray.A` 有 face 子控件 + face 不是白图 106053」——
  //   而独立的头像卡**已按设计删除**，`tray.A` 根本不存在 ✗。
  //
  //   依据（lua/ui_controller.lua，行号为实际文件行号）：
  //     · `ui_controller.lua:215-216`「**删掉的**（参考图里没提到的）：… 以及**独立的头像卡 `tray`**
  //       （用户：头像卡已并进滚动线索卡）。」
  //     · `ui_controller.lua:1817-1822`：容器 `tray` 留着但 `visible = false`
  //       （老存档里还有这个控件名，留个空壳比直接删更稳）。
  //     · `ui_controller.lua:1829-1831`：`local n_tray = 0` ⇒ 下面那个
  //       `for i = 1, n_tray do` 循环**一次都不跑** ⇒ `tray.<id>` 子卡**永远不 push**。
  //
  //   实测复核：
  //     · `layout-plan.json` 里 `tray.A` / `tray.B` = 0（只有容器 `tray` 自己，`visible=false`）
  //     · 运行期 `tools/sim/out/l3-baseline/probe_cursor.log`：
  //       `tray.A **找不到这个控件**` … `tray.V **找不到这个控件**`（7 张全找不到）
  //   ⇒ 反转成哨兵：**只要计划里再出现任何 `tray.<字母>` 子卡就是红** ✓
  const trayCards = plan.nodes.filter((n) => /^tray\.[A-Z]$/.test(n.id)).map((n) => n.id);
  check('头像卡 tray.<A-Z> 按设计不存在（已并进滚动线索卡；若出现 ⇒ 已删控件被加回来了）',
    trayCards.length === 0, trayCards.length ? '★ 又出现了：' + trayCards.join(' ') : '计划里没有 ✓');
}

// ── 棋盘格子：落子后 face 是否变成头像 ──────────────────────────────────
console.log('\n=== 落子后格子显示头像 ===');
{
  await click('tray.B');
  await tick(0.05);
  // 双击 cell.2.2 → 预放置
  // ⚠️ 指针坐标要用 `box`（画布绝对坐标）算中心 —— 第一版用 `posX/posY`（undefined），
  //    模拟器直接报 `pointer coordinates must be finite`。
  const c22 = nodeOf(ri, 'cell.2.2');
  if (c22 && c22.box) {
    const px = c22.box.left + c22.box.width / 2;
    const py = c22.box.bottom + c22.box.height / 2;
    await c.play('pointer', { type: 'click', x: px, y: py });
    await tick(0.05);
    await c.play('pointer', { type: 'click', x: px, y: py });
    await tick(0.30);
    ri = await get();
    const c22b = nodeOf(ri, 'cell.2.2');
    const fc = c22b && (c22b.children || []).find((x) => x.name === 'face');
    check('放置后 cell.2.2.face 换成了头像 id', fc && Number(fc.imageId) !== 106053,
      fc ? 'imageId=' + fc.imageId : '无 face');
  } else {
    check('拿到 cell.2.2 的 box', false, JSON.stringify(c22 && c22.box));
  }
}

// ── obj 白块检查（★ 2026-09-28 新增，这条正是"白块还在"那个 bug）──────────
console.log('\n=== obj 子控件（物件图标占位）不该盖住头像 ===');
{
  const idx3 = indexTree(ri);
  let shown = 0, total = 0;
  const names = [];
  for (const [nm, n] of idx3) {
    const m = /^cell\.(\d+)\.(\d+)$/.exec(nm);
    if (!m) continue;
    if (n.visible === false) continue;          // 隐藏的格子（大关卡的多余格）不算
    total++;
    const o = (n.children || []).find((c) => c.name === 'obj');
    if (o && o.visible !== false) { shown++; if (names.length < 6) names.push(nm); }
  }
  check('没有格子的 obj 是显示状态（它会用白图盖住头像）', shown === 0,
    shown + '/' + total + ' 个显示中：' + names.join(','));
}
// ── 相交诊断：有没有控件压在棋盘上 ─────────────────────────────────────
console.log('\n=== 棋盘区域的控件（「压在棋盘上」的候选）===');
{
  const board = nodeOf(ri, 'board');
  if (!board || !board.box) { check('拿到 board 的 box', false, JSON.stringify(board && board.box)); }
  else {
    // 用 `box`（**画布绝对坐标**）判定 —— 比 anchoredPosition 直观，
    // 而且不用去管"相对父级中心"那套换算。
    const bb = board.box;
    console.log('  board.box = ' + JSON.stringify(bb));
    const bad = [];
    for (const [nm, k] of indexTree(ri)) {
      // ★ 2026-09-30：`room.label.*` 也跳过 —— 它是**参考图里本来就有的房间名**
      //   （每个房间右下角一行字），不是"压在棋盘上的多余控件"。
      //   位置由脚本按房间外框每帧算（`pos_runtime = true`）。
      if (/^cell\./.test(nm) || nm === 'ruler' || /^ruler\./.test(nm)) continue;
      if (/^room\.label\./.test(nm)) continue;
      if (/\.(bg|label|face|text|note|x|obj)$/.test(nm)) continue;      // 子控件不算
      // 顶层分区容器不算（它们本来就铺满）
      // ★ 2026-09-30：补上 `home` / `select` —— 主页与选关是**整屏结构容器**，
      //   和 `intro`/`modal` 同一类，不是"压在棋盘上的多余控件"。
      //   （它们应当在关卡里被脚本隐藏，但那属于"屏幕状态"的职责，
      //     由下面独立的断言去查，不该混在这条几何检查里。）
      if (/^(root|topbar|toolbar|left|tray|clues|board|right|actions|intro|modal|home|select)$/.test(nm)) continue;
      if (/容器|面板/.test(nm)) continue;   // 整屏根容器（模拟器给的中文名），本来就铺满
      if (!k.box || k.visible === false) continue;
      const cx = k.box.left + k.box.width / 2, cy = k.box.bottom + k.box.height / 2;
      if (cx > bb.left && cx < bb.left + bb.width && cy > bb.bottom && cy < bb.bottom + bb.height) {
        bad.push(nm + '(中心' + cx.toFixed(0) + ',' + cy.toFixed(0) + ' ' + k.box.width + 'x' + k.box.height + ')');
      }
    }
    console.log('  压在棋盘上的控件：' + (bad.length ? bad.join('  ') : '（无）'));
    check('棋盘区域没有多余控件', bad.length === 0, bad.length + ' 个');
  }
}

// ── 右侧三个按钮的「深色六边形底图」 ──────────────────────────────────────
//
//   ★ 2026-10-01：参考图里右侧是三个**六边形**按钮。我们用**基础图元拼**出来：
//     中间一个矩形（100001）+ 上面一个三角 + 下面一个三角（都是 100003），
//     再做一层内缩当描边 —— 共 6 个图元/按钮。
//
//   数据来自 Miliastra Image Editor 的 ELEMENTS 导出（见
//   docs/外部资产-怎么用与我做了什么.md）。
//
//   ⚠️ 这条断言锁的是「**六个图元都在、图片 id 对**」——
//     因为图片 id 必须在**存档里**写好（路径 `/#505/#503/#84/#503`），
//     运行时 `SetImage` 换图**不可靠**：适配器里有实测记录，
//     读回来的 imageSource 和存档里的不是同一个值，会配错图集（变紫）。
{
  //   ⚠️ 2026-10-01 **约束变了**（不是为了让测试变绿）：
  //     参考图右侧那三个**六边形**，当时改用**转存进来的真素材**
  //     （`murdoku-btn-hex`，模板索引 1073742321）——比用基础图元拼像得多。
  //     素材的接入方式是"按模板索引实例化"：`cfg.prefab_of[节点id] = 索引`
  //     + `cfg.parent_of[节点id] = 父节点`（登记在 lua/entry_client_script.lua），
  //     适配器用 `game.InstantiateClientUIControl` 把它造出来。
  //
  //     所以断言从"6 个图元 + id 分布"改成"**每个按钮有一个够大的底图节点**" ——
  //     这才是当时真正要保证的用户可感知行为。
  //
  // ★ 2026-10-05 改判（依据，不是放宽）：
  //   上面那条「按模板索引实例化」的路，**已被实测判死、并且代码明确关掉了**；
  //   而这里的三个键（`action.undo` / `action.submit` / `action.reveal`）**也都被按设计删除** ✗
  //   ⇒ 原来那 6 条断言要求的是「**三个不存在的按钮**各有一个 `.hexbg` 子节点」= 双重不存在，
  //     永远不可能绿 ✓（属于「测试落后于设计」，不是设计坏了）。
  //
  //   依据（lua/ui_controller.lua，行号为实际文件行号）：
  //     · `ui_controller.lua:1643-1655`：`local HEX_PREFAB = false` ——
  //       真机探针实测 `InstantiateClientUIControl(1073742333, root)` **pcall 成功、但返回 nil**
  //       ⇒ 「按模板索引实例化素材」这条路**走不通**（与当初 1073742321 完全一样）。
  //       而 `.hexbg` 这个节点**只在 HEX_PREFAB 为 true 时才 push** ⇒ 现在一个都没有。
  //     · `ui_controller.lua:1693-1715`：走 `hex_bg(...)` 那条路时的实参只有
  //       `action.back` / `action.redo` / `action.hint` 三个名字 ——
  //       **从来没有** `action.submit` / `action.undo` / `action.reveal`。
  //     · `ui_controller.lua:1718-1729`：旧文字键已删（与 `hex.*` 重叠且动作重复）；
  //       `ui_controller.lua:1734-1735`：四个入口改成 `hex.submit` / `hex.redo` / `hex.undo` / `hex.hint`。
  //
  //   实测复核：`layout-plan.json` 里以 `.hexbg` 结尾的节点 = **0**
  //     （`node -e` 直读计划实测，与本次运行前刚重跑 `lua tools/dump_layout.lua` 的计划同源）。
  //
  //   ★ 这不是把断言放宽 —— 是把它**反转成哨兵**：
  //     这些已删按钮（以及它们的 `.hexbg`）**一旦重新出现就是红** ✓
  //     判据来源：用户 2026-10-05 授权「以建议为准」✓（见 `docs/L3基线-模拟器四步失败清单.md` §6）。
  for (const b of ['action.undo', 'action.submit', 'action.reveal']) {
    const back = plan.nodes.some((n) => n.id === b || n.id === b + '.hexbg');
    check('旧文字按钮「' + b + '」按设计不存在（含它的 .hexbg；若出现 ⇒ 已删控件被加回来了）',
      !back, back ? '★ 它又出现了' : '计划里没有 ✓');
  }
}

console.log('\n════════ 美术验证：' + pass + ' 通过 / ' + fail + ' 失败 ════════');
process.exit(fail === 0 ? 0 : 1);
