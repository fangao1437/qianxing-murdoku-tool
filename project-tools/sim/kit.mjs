// tools/sim/kit.mjs —— 模拟器建树公共逻辑
//
// 坐标语义（2026-09-26 标定确认）：
//   模拟器 posX/posY = 控件**中心点**的**画布绝对坐标**（原点左下），
//   父级被完全忽略，pivot/anchor 设置不生效。
//   这与真机编辑器「位置 X, Y」输入框语义**完全一致**（位置=中心点绝对坐标，跟父级无关）。
//   → 同一份 layout-plan.json 既建模拟器、又直接抄进编辑器，不会打架。

import fs from 'node:fs';
import path from 'node:path';
// ★ 2026-10-09：为了 `SIM_ARCHIVE=1`（按真机存档建树）读存档的名字清单 ✓
//   用**静态** import —— `buildProject` 是同步函数，不能在里面 await ✓
import { readGil } from '../gil/gilread.mjs';

export const SIM_PLUGIN = process.env.SIM_PLUGIN
  || 'C:/Users/18182/.dsh/profiles/web/node_modules/dsh-plugin-beyond-simulator/dsh-plugin/dist/index.js';
export const WORKSPACE = process.env.SIM_WORKSPACE
  || 'D:\\新建文件夹\\miHoYo Launcher\\qianxing-murdoku';
export const OUT = path.join(WORKSPACE, 'tools', 'sim', 'out');

export async function makeController() {
  const { SimulatorController } = await import('file://' + SIM_PLUGIN);
  return new SimulatorController(WORKSPACE);
}

export function loadPlan(file = 'layout-plan.json') {
  return JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
}

const KIND = { container: 'container', panel: 'container', text: 'textbox', button: 'button', image: 'image' };

// 把 layout-plan.json 建进「服务端画布」，并把 Lua 脚本挂到客户端模板上。
// opts.showCursor === false 时**故意不打开**「显示常驻光标」，
// 用来验证脚本能否自己打开它（Adapter:enable_cursor）。
export function buildProject(c, plan, luaFile, opts = {}) {
  const errs = [];
  const P = (label, op) => { try { return c.patch(op); } catch (e) { errs.push(label + ' :: ' + e.message); return null; } };

  // ── 1. 客户端模板：只用来承载脚本 ───────────────────────────────────────
  const luaSource = fs.readFileSync(luaFile, 'utf8');
  let p = P('newAsset(template)', { op: 'newAsset', assetType: 'client-control-template' });
  const tplRoot = p.asset.currentTemplateId;
  for (const ch of (((p.root.children || [])[0] || {}).children || []).slice()) P('rm tpl child', { op: 'remove', id: ch.id });
  P('addScript', { op: 'addScript', path: 'client_script.lua', source: luaSource, controlId: tplRoot, controlAsset: 'client' });

  // ── 2. 服务端画布 ───────────────────────────────────────────────────────
  p = P('newAsset(server)', { op: 'newAsset', assetType: 'server-control-template' });
  const canvasRoot = (p.root.children || [])[0];
  for (const ch of (canvasRoot.children || []).slice()) P('rm canvas child', { op: 'remove', id: ch.id });

  // ★★ 关键：模拟器只在「某个祖先容器 showCursor === true」时才派发光标事件：
  //     cursorEventsEnabled(t){ for(let i=t;i;i=i.parent) if(i.kind==="container"&&i.showCursor===!0) return true; return false }
  //     showCursor 就是编辑器里容器的**「显示常驻光标」**开关。
  //     不打开它，所有按钮都是死的 —— 这正是真机上点击一直没反应的原因。
  //
  //     注意：默认**打开**是为了让 UI 回归能测交互；
  //     想验证「脚本能不能自己打开它」（Adapter:enable_cursor），
  //     传 opts.showCursor = false，模拟真机默认（没勾）的状态。
  if (opts.showCursor !== false) {
    P('canvasRoot.showCursor', { op: 'set', id: canvasRoot.id, key: 'showCursor', value: true });
  }

  const idOf = {};
  const add = (name, kind, parentId, box, extra) => {
    const r = P('add ' + name, { op: 'add', kind, name, parentId });
    if (!r) return null;
    const id = r.selectedId;
    const props = { width: box.w, height: box.h, posX: box.cx, posY: box.cy };
    if (kind === 'button') { props.raycastTarget = true; props.interactable = true; }
    // ★★★★★ 2026-10-09 **【已撤回】给容器补"穿透开关"字段 —— 实测无效，不留** ✗✓
    //   我一度在这里加过：
    //       if (kind === 'container') {
    //         props.disableCursorEventPassthrough = false;
    //         props.disableKeyEventPassthrough = false;
    //       }
    //   动机 ✓：适配器的 `seal_container` 写的是 `if c.xxx ~= nil then … = true end`
    //     ⇒ 字段不存在就整条跳过 ⇒ 计数恒 0 ⇒ `play_test` 那条
    //       「主页/选关容器已设「屏蔽按键事件穿透」」**永远红** ✓ 想修掉这个假红 ✓
    //   ★ **实测结论：没用** ✗ —— 改完连跑两套：
    //     · `verify_art`：改前 **11/2 · 439s**，改后 **11/2 · 532s**（同样两条失败）⇒ **零差别** ✓
    //     · `play_test`：`屏蔽穿透` 仍是 **0 个** ✗（假红没修掉）
    //     而建树本身 **`建树错误 0`** ⇒ `set` 没报错、字段确实写进去了 ✓
    //   ⇒ ★ **既没效果、也没被证实有用 ⇒ 不留** ✓
    //     （用户第五轮指示「把不必要的东西裁掉」✓ 项目也讲"不留没验证的东西"✓）
    //   ⇒ ★ **留给以后**：要让模拟器表达这个字段，先得确认
    //     `seal_containers` 究竟有没有找到 `home`/`select`（**可能是 `find` 的事，不是字段的事** ✗）
    //     —— 没定位之前**别继续往 mock 上加字段** ✓
    for (const [k, v] of Object.entries({ ...props, ...(extra || {}) })) P(name + '.' + k, { op: 'set', id, key: k, value: v });
    return id;
  };
  const boxOf = (n) => ({ cx: n.cx, cy: n.cy, w: n.w, h: n.h });

  let made = 0;
  // ★★★★★ 2026-10-09 **重要：模拟器默认建的树，比真机【多两百多个控件】** ✗✓
  //
  //   ★ 事实（实测 ✓）：
  //     · 这里 `for (const n of plan.nodes)` ⇒ **把规划 371 个节点全建出来** ✓
  //     · 而**真机存档只有 88 个名字**（`227` 实测：158 条记录 / 157 个有名字 ✓）
  //     · 且 `cfg.auto_create = false`（`entry_client_script.lua:306`）
  //       ⇒ 脚本**不会**把缺的补上 ✗（只放行 14 个白名单 ✓）
  //     ⇒ ★ **模拟器凭空多出约 283 个控件** ✓
  //
  //   ★ 后果（这就是"模拟器全绿、真机坏"的系统性原因 ✓）：
  //     · 模拟器里 `select` / `intro` / `ruler` / `room` / `obj` **都存在** ⇒
  //       `audit_flow` 报「✓ 进选关 [select]」✗ —— 而**真机上 `select` 根本不存在** ✓
  //     · 同理 `play_test` 的 52/8、`verify_art` 的 11/2 **都不能外推到真机** ✓
  //     · 我前几轮反复被这个骗（"模拟器说好的呀"）✗ 根子就在这里 ✓
  //
  //   ★ 现在怎么改 ✓：加一个**可选**开关 `--archive-faithful`（或环境变量 `SIM_ARCHIVE=1`）——
  //     只建**存档里真有的名字** + **运行时真会生成的家族**（`cell.*` 由脚本实例化 ✓）
  //     ⇒ 模拟器才**像真机** ✓
  //   ⚠️ **默认仍保持原样**（不破坏现有读数 ✓）—— 因为它会让**一大批断言变红**（那是真话 ✓）
  //     要不要切成默认，是个**决策**（见 `接手待办.md`）✓
  const faithful = process.env.SIM_ARCHIVE === '1' || process.argv.includes('--archive-faithful');
  let archiveNames = null, skipped = 0;
  if (faithful) {
    try {
      const gilFile = process.env.SIM_GIL
        || fs.readdirSync(WORKSPACE).filter((f) => /^2\d\d-.*\.gil$/.test(f)).sort().pop();
      archiveNames = readGil(path.resolve(WORKSPACE, gilFile)).names;
      console.log('    [SIM_ARCHIVE] 用存档建树：' + gilFile + '（' + archiveNames.size + ' 个名字）');
    } catch (e) {
      console.log('    [SIM_ARCHIVE] 读不到存档，退回按规划建树：' + e.message);
      archiveNames = null;
    }
  }
  const runtimeGen = (id) => /^cell\.\d/.test(id);     // ★ 脚本运行时真的会造的 ✓
  for (const n of plan.nodes) {
    if (archiveNames && !archiveNames.has(n.id) && !runtimeGen(n.id)) { skipped++; continue; }
    const parentId = (n.parent && idOf[n.parent]) || canvasRoot.id;
    const kind = KIND[n.kind] || 'container';
    const vis = n.visible === false ? { visible: false } : {};
    const id = add(n.id, kind, parentId, n, vis);
    if (!id) continue;
    idOf[n.id] = id;
    made++;
  }
  if (archiveNames) {
    console.log('    [SIM_ARCHIVE] **按存档建树**：建 ' + made + ' 个、跳过规划里存档没有的 '
      + skipped + ' 个（真机也就没有它们 ✓）');
  }

  // ── 3. 子控件（适配层约定）──────────────────────────────────────────────
  //   text 子控件 ← 按钮/文本的显示文字
  //   face 子控件 ← 头像/格子外观（图片）
  //   note 子控件 ← 铅笔笔记（文本）
  //   x    子控件 ← X 标记（图片）
  let subs = 0;
  const addSub = (parentName, childName, kind, box, extra) => {
    const key = parentName + '.' + childName;
    // ★ 控件的**名字**必须就是 childName（"face"/"note"/"x"/"text"），
    //   因为适配层是用 parent:GetChild("note") 找它的。
    //   之前误把名字写成 "cell.2.2.note"，导致笔记和 X 标记永远找不到。
    const id = add(childName, kind, idOf[parentName], box, extra);
    if (id) { idOf[key] = id; subs++; }
    return id;
  };

  for (const n of plan.nodes) {
    if (n.kind === 'button') {
      addSub(n.id, 'text', 'textbox', { cx: n.cx, cy: n.cy, w: n.w, h: n.h },
        { text: n.text || '', fontSize: 18 });
      // 预设按钮的外观来自状态节点引用的子控件
      for (const k of ['selectedChildId', 'hoverChildId', 'pressedChildId', 'unavailableChildId']) {
        P(n.id + '.' + k, { op: 'set', id: idOf[n.id], key: k, value: idOf[n.id + '.text'] });
      }
    }
    if (n.kind === 'text') {
      P(n.id + '.text', { op: 'set', id: idOf[n.id], key: 'text', value: n.text || '' });
      // 线索行数多（最多 18 行），字号要小一点才不挤
      const fs = n.style === 'title' ? 26 : (n.style === 'clue' ? 13 : 16);
      P(n.id + '.fontSize', { op: 'set', id: idOf[n.id], key: 'fontSize', value: fs });
    }
  }

  for (const n of plan.nodes) {
    if (!/^cell\.\d+\.\d+$/.test(n.id)) continue;
    const b = boxOf(n);
    addSub(n.id, 'face', 'image', b, { imageId: 100001 });
    addSub(n.id, 'note', 'textbox', { cx: n.cx, cy: n.cy, w: n.w - 8, h: 34 },
      { text: '', fontSize: 14, visible: false });
    addSub(n.id, 'x', 'image', b, { imageId: 100004, visible: false });
    // ★ 2026-09-28：`obj` 也必须建 —— 真机存档里格子有这个子控件（留给物件图标），
    //   默认 **visible=true + 白图 106053**，而它在 `layer_order` 里排在 `face` **之上**。
    //   模拟器原来没建它，于是「白块盖住头像」这个 bug 在模拟器里**测不出来**，
    //   只能靠用户真机截图发现（来回两轮）。
    //   ⇒ 补齐结构，让 `verify_art` 的 obj 检查真正有效。
    addSub(n.id, 'obj', 'image', { cx: n.cx, cy: n.cy, w: Math.round(n.w * 0.65), h: Math.round(n.h * 0.65) },
      { imageId: 106053, visible: true });
    // ★ 2026-10-17：与 397 存档的模板**逐项同构** —— 提示层 + 四边墙/门
    //   `hint`：用户做的半透明提示层（颜色 0x7F0063D5），脚本**只开关可见性**
    //   `wall.*` / `door.*`：按 `view().cells[r][c].walls/doors` 开关
    addSub(n.id, 'hint', 'image', b, { imageId: 100001, imageColor: 2130731989, visible: true });
    for (const d of ['up', 'down', 'left', 'right']) {
      const wbox = d === 'up' ? { cx: n.cx, cy: n.cy + n.h / 2 - 5, w: n.w, h: 10 }
        : d === 'down' ? { cx: n.cx, cy: n.cy - n.h / 2 + 5, w: n.w, h: 10 }
          : d === 'left' ? { cx: n.cx - n.w / 2 + 5, cy: n.cy, w: 10, h: n.h }
            : { cx: n.cx + n.w / 2 - 5, cy: n.cy, w: 10, h: n.h };
      addSub(n.id, 'wall.' + d, 'image', wbox, { imageId: 100108, imageColor: 4281536672, visible: false });
      addSub(n.id, 'door.' + d, 'image', wbox, { imageId: 100001, imageColor: 4292271642, visible: false });
    }
    for (const k of ['selectedChildId', 'hoverChildId', 'pressedChildId', 'unavailableChildId']) {
      P(n.id + '.' + k, { op: 'set', id: idOf[n.id], key: k, value: idOf[n.id + '.face'] });
    }
  }

  for (const n of plan.nodes) {
    if (!/^tray\.[A-Z]$/.test(n.id)) continue;
    addSub(n.id, 'face', 'image', boxOf(n), { imageId: 100002 });
    // ★ 2026-09-28：头像卡的**名字**子控件必须补上。
    //
    // 真机存档里它叫 `text`（我和 `face` 一起生成的），而模拟器原来只建了 `face` ——
    // 于是适配层写文字时 `sub(id,"text")` 落空，**头像卡的名字一直是规划里的静态文案**
    // （多关并集取的是最后一关，所以显示了 case_003 的"值班保安"）。
    // 表现是 `play_test` 报「头像卡 A 文案正确 ✗」，看着像脚本坏了，
    // 其实是**模拟器和真机存档不同构**。
    addSub(n.id, 'text', 'textbox', { cx: n.cx, cy: n.cy - 32, w: n.w - 4, h: 20 },
      { text: '', fontSize: 14 });
    for (const k of ['selectedChildId', 'hoverChildId', 'pressedChildId']) {
      P(n.id + '.' + k, { op: 'set', id: idOf[n.id], key: k, value: idOf[n.id + '.face'] });
    }
  }

  // ★★ 2026-09-28：**给所有按钮补 `bg` + `label` 子控件，镜像真机存档的结构**。
  //
  // 为什么必须补：这两个子控件是我用 `tools/gil/gen_btn_art.mjs` **写进 .gil** 的，
  //   **不在 `layout-plan.json` 里**。于是模拟器建出来的树**没有它们** ——
  //   结果是「模拟器根本测不了 .gil 层的美术」：
  //   我写了 verify_art.mjs 想验证"按钮有没有底图/名字"，
  //   8 条断言全报"没有子控件"，看着像代码坏了，其实是**模拟器缺件**。
  //
  //   模拟器的价值就在于"能在交付前发现外观问题"，所以它必须和真机存档同构。
  //   这里按真机的实际情况补：`bg`（图片，真机是 100108）+ `label`（文字框）。
  for (const n of plan.nodes) {
    if (n.kind !== 'button' || /^cell\./.test(n.id)) continue;
    // ⚠️ **头像卡不要 `label`** —— 真机存档里头像卡的名字子控件叫 `text`（和 `face` 一起生成的），
    //    只有**其它**按钮才有 `label`。
    //    第一版我对所有按钮都建了 `label`，于是脚本按"先找 label"的优先级把名字写进 `label`，
    //    而 `textOf` 读的是 `text` ⇒ 测出来一直是规划里的静态文案（多关并集取最后一关的
    //    "值班保安"），看着像脚本坏了，其实是**模拟器多建了一个真机没有的控件**。
    //    ⇒ 教训：模拟器要**逐字段**对齐真机存档，多一个少一个都会造成假阳性/假阴性。
    if (!/^tray\./.test(n.id)) {
      addSub(n.id, 'bg', 'image', boxOf(n), { imageId: 100108 });
      addSub(n.id, 'label', 'textbox', { cx: n.cx, cy: n.cy, w: Math.max(20, n.w - 8), h: 20 },
        { text: '', fontSize: 16 });
    }
  }

  // ★★ 2026-09-28：**素材调色板**（真机上由用户在编辑器里建，模拟器里得自己补）。
  //
  // 不补的后果：`resolve_asset("portrait.A")` 找不到 → 打警告
  //   「调色板里没有素材「portrait.A」」→ 三个关卡的通关测试各挂 1 条
  //   （`✗ 运行期没有错误日志`）。
  // 那**不是代码错**，是模拟器环境缺件 —— 但"缺件"这件事本身值得被测出来，
  // 所以这里补上，让模拟器与真机一致：真机缺了就是真缺，模拟器缺了就不再误报。
  //
  // ⚠️ 结构必须和真机一致：容器名 `assets`，`portrait.*` 是它的**直接子控件**，
  //    且每个都得有数字 `imageId`（`read_palette` 有 `type(id)=="number"` 这道门）。
  {
    const pal = add('assets', 'container', canvasRoot.id, { cx: 3000, cy: 3000, w: 10, h: 10 });
    if (pal) {
      // ⚠️ 必须把容器自己也登记进 `idOf` —— `addSub` 是靠 `idOf[parentName]` 找父控件的。
      //    第一版漏了这步，结果只有第一个子控件建上（后面找不到父级），
      //    真机/模拟器就报「调色板里没有素材 portrait.B / portrait.C」。
      idOf.assets = pal;
      // ⚠️ **必须和用户真机存档里的调色板逐项一致** ——
      //    这里的值是 2026-09-28 用 `readGil` 从 `完整界面14-9图.gil` 里读出来的真实值。
      //    少一项会误报"调色板里没有素材"，多一项又会**掩盖真机缺图**的问题。
      //
      //    ★★★ 2026-10-09 **这份表【已经过期】→ 已按真机存档改正** ✗✓
      //      · 原来 9 项（A 112003 / B 112001 / C 112005 / D 112007 / E 112009 /
      //        F 112011 / G 112013 / H 112060 / V 112053）取自 **09-28 的 `完整界面14-9图.gil`** ✓
      //      · 而**当前存档**（`226-四键-几何B+v093内嵌.gil` 实测 ✓）里**只有 4 个 portrait**：
      //        **`A=112042` · `B=105104` · `D=105105` · `V=112031`**（`source` 全 = `4294967295` ✓）
      //        —— 与脚本 `lua/ui_controller.lua:4491` 的 `_IDS` 兜底表**逐项一致** ✓
      //      · ★ 于是 `docs/assets取不到-追查.md` 与 `PLAN.md` B 把"脚本表 ≠ 存档表"
      //        当成了一个矛盾 ✗ —— **其实它们一直是同一组** ✓
      //        "对不上"的那一组**就是这个文件**（模拟器快照被当成了存档 ✓）
      //      ★★★ 现在改成 **4 项、与真机逐项一致** ✓ —— 这是 `kit.mjs:154` 立下的规矩
      //        （「模拟器要**逐字段**对齐真机存档」✓）✓
      //      ⚠️ 改完的后果是**故意**的 ✓：`portrait.C / E / F` 在模拟器里**也没有了** ✓
      //        ⇒ 与真机同状：脚本找不到它们 ⇒ 头像空白 ✓
      //        （真机实测：三个关卡用到 C/E/F ✓ 而存档里没有 ⇒ 这就是 D3 那条缺口 ✓）
      //        ⇒ ★ **模拟器从此会如实报出这个缺口**，而不是像以前那样把它盖住 ✓
      const PAL = [
        ['A', 112042], ['B', 105104], ['D', 105105], ['V', 112031],
      ];
      let n = 0;
      for (const [k, id] of PAL) {
        n++;
        addSub('assets', 'portrait.' + k, 'image', { cx: 3000 + n * 20, cy: 3000, w: 80, h: 80 },
          id === null ? {} : { imageId: id });
      }
    }
  }

  // ★ 2026-10-17：**`things` 素材区**（障碍物/家具）—— 与 397 存档同构
  //   名字 = 脚本引用键（`object_key_of` 产出 `obj.<kind>`）；色块占位，真图在编辑器里换
  {
    const pal2 = add('things', 'container', canvasRoot.id, { cx: 3200, cy: 3000, w: 10, h: 10 });
    if (pal2) {
      idOf.things = pal2;
      const T = [
        ['obj.table', 0xFFB07946], ['obj.plant', 0xFF4CAF50], ['obj.carpet', 0xFFD9C8A6],
        ['obj.chair', 0xFFE0A040], ['obj.shelf', 0xFF7A5230], ['obj.statue', 0xFFB8B8C0],
      ];
      let n2 = 0;
      for (const [k, col] of T) {
        n2++;
        addSub('things', k, 'image', { cx: 3200 + n2 * 20, cy: 3000, w: 80, h: 80 },
          { imageId: 100001, imageColor: col, imageSource: 'StaticReference' });
      }
    }
  }

  // ── 4. 不要给容器加底图：占位图元 100005 是「白色五角星」，会盖住整屏。
  //       真实面板底图请在编辑器里配。

  const planIds = new Set(plan.nodes.map((n) => n.id));
  return { planIds, errs, made, subs, tplRoot, canvasRootId: canvasRoot.id };
}

// 把 inspect 结果里的运行树摊平成 { name → node } 便于查询
export function indexTree(ri) {
  const byName = new Map();
  const walk = (x) => {
    if (!byName.has(x.name)) byName.set(x.name, x);
    for (const k of (x.children || [])) walk(k);
  };
  for (const x of (ri.tree || [])) walk(x);
  return byName;
}

// 控件上「看得见」的文字：自己带 text 就用，否则找子控件 text
export function textOf(ri, name) {
  const n = indexTree(ri).get(name);
  if (!n) return null;
  if (n.text != null && n.text !== '') return String(n.text);
  for (const k of (n.children || [])) {
    if (k.name === 'text' && k.text != null) return String(k.text);
  }
  return n.text != null ? String(n.text) : null;
}

// 取某个控件的直接子控件（子控件名是 "face" / "note" / "x" / "text"，
// 不是 "cell.1.1.note" —— 适配层用 parent:GetChild("note") 找它们）
export function childOf(ri, parentName, childName) {
  const p = indexTree(ri).get(parentName);
  if (!p) return null;
  return (p.children || []).find((c) => c.name === childName) || null;
}

export function childText(ri, parentName, childName) {
  const c = childOf(ri, parentName, childName);
  return c == null ? null : c.text;
}

// 控件现在是否可见（编辑器里它们一直存在，靠 visible 开关）
export function visibleOf(ri, name) {
  const n = indexTree(ri).get(name);
  return n ? n.visible !== false : null;
}

export function dumpJson(file, obj) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(obj, null, 2));
}

export async function shot(c, file) {
  const s = await c.requestScreenshot();
  const data = s && (s.png || s.data || s.base64 || s.image);
  if (!data) return null;
  const out = path.join(OUT, file);
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  return out;
}

// ★★★ 2026-09-29：**从主页走进第一关**（测试用）。
//
// 为什么需要：游戏现在开机进**主页**（用户要求的流程），
// 而 `OnStart()` 是官方生命周期、**不接受参数** ——
// 所以"从外面传个 flag 跳过主页"是做不到的（我为此白改了三轮）。
// ⇒ 正确做法就是**真的走一遍主页流程**：点「选关」→ 点第 1 张卡片。
// 顺带把新流程本身测了。
export async function enterLevel(c, tick = async (dt) => { await c.play('step', { dt }); }, card = 1) {
  await c.play('click', { name: 'home.select' }); await tick(0.1);
  await c.play('click', { name: 'select.card.' + card }); await tick(0.2);
}