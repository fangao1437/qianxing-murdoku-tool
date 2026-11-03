# 真机交接（步骤 7）

> 状态：**模拟器候选**。本文件是实现方给"在千星沙箱里操作的人"的交接；
> 复制文件/建立映射**不代表游戏加载了新代码**，以真机试玩日志为准。

## 1. 交付物

| 物 | 路径 | 说明 |
|---|---|---|
| 客户端脚本 | `workspace/qxqy-ui-system/lua/main.lua` | 单文件 bundle，约 1500 行；挂到 `app.root` |
| 完整存档 | `workspace/qxqy-ui-system/qxqy-ui-system.save.json` | 含 41 个控件与脚本映射（脚本 source 为空 = 路径模式） |
| 脚本源码 | `workspace/qxqy-ui-system/lua/src/*.lua` | 9 个模块；改完后必须 `node tools/build_bundle.mjs` 重新生成 |
| GIA 参考 | `qianxing-murdoku/assets/教程UI系统_翻页单击活动样式.gia` | **只作角色构成参考**，不要当界面存档导入（解析见 `docs/gia-structure.md`） |

## 2. 导入与挂载（按顺序做，每步都有验收点）

> **两条路，选一条**：
> **A. 导入 `.gil`（推荐，控件已建好）**：`qianxing-murdoku/存档/473-教程UI系统骨架-v1.gil` 里已经有 41 个教程控件
> （`app.root → screen.demo → page.* / tab.* / btn.* / hud.*`，含基础可视素材）。
> 走【存档 → 导入存档】把它导入成**新存档**，然后只需补脚本映射与挂载（第 2~3 步）。
> **B. 导入模拟器存档**：把 `qxqy-ui-system.save.json` 用模拟器【导入】进来（只在你继续用模拟器迭代时需要）。

1. **存档**：
   - A：真机【存档 → 导入存档】选 `qianxing-murdoku/存档/473-教程UI系统骨架-v1.gil`。验收：编辑器层级树里能看到
     `app.root → screen.demo → 12 个子控件`，且 `app.root` 是满屏 1600×900、索引 `1073742017`。
   - B：模拟器顶栏【导入】选 `qxqy-ui-system.save.json`。验收：左栏出现 41 个控件。
2. **脚本映射**：Lua 脚本页新建映射，路径建议 `workspace/qxqy-ui-system/lua/main.lua`（与存档一致）。
   验收：脚本列表里该条目的路径与本地文件一致。
   ⚠️ `.gil` **不带脚本挂载关系**（GIA/GIL 都不保存挂载）；真机导入后 `app.root` 上没有我们的脚本，
   必须手工建映射 + 挂载，或用 `node qianxing-murdoku/tools/gil/embed_script.mjs` 把 `lua/main.lua` 内嵌后再导入。
3. **挂载**：把该脚本挂到 `app.root`（整屏根容器）的"脚本"页签。
   验收：`app.root` 的 `scriptMappingIds` 含该脚本 id。
4. **保存**（模拟器【保存存档】）→ 再【试玩】。
   验收：日志出现 `[ui] DISCOVER screens=1 pages=3 tabs=3 root=app.root` 与 `APP_READY booted=true`。
   没有日志 = 脚本没加载（先查映射与挂载），不要先改代码。

## 3. 真实控件索引校准

导入真机后控件索引可能被重映射。若日志出现 `missing=…` 或 `screen=demo page=nil`：

1. 在编辑器里看 `app.root` / `screen.demo` / `page.*` / `tab.*` / `btn.*` / `hud.pager` 的**实际名字**（框架按名查找，不按索引）。
2. 名字不一致时**改名字**（比改代码便宜），或改 `App.config` 里的名字表。
3. 若必须改索引，走 `setControlGuid` + `controlGuidChanges` 流程，并按语义同步脚本里的引用
   （本框架只用名字，没有硬编码 guid，所以通常无需改脚本）。

## 4. 服务端逻辑（真机必须补）

客户端**不能写自定义变量**，所以：

- 上行：本项目已发 `ui/nav`(screen, page, index) 与 `ui/action`(screen, action)。
- 真机节点图要做：监听 `ui/nav` → 写 `Level.UiLastPage`(String) / `Level.UiLastIndex`(Int) → 发 `ui/sync`(page)。
- 模拟器等价配置（`setServerLogic` op，供本地复现）：

```json
{ "op": "setServerLogic", "expectedRevision": <最新>,
  "logic": { "version": 1, "rules": [{
    "id": "ui-nav-record",
    "signalName": "ui/nav",
    "actions": [
      { "kind": "setCustomVariable", "entityType": "Level", "name": "UiLastPage", "value": { "fromSignalParam": 1 } },
      { "kind": "setCustomVariable", "entityType": "Level", "name": "UiLastIndex", "value": { "fromSignalParam": 2 } },
      { "kind": "sendClientScriptSignal", "target": "PlayerSelf", "signalName": "ui/sync", "params": [{ "fromSignalParam": 1 }] }
    ]}]}}
```

> 注意：`qxqy_studio_load` 会**丢弃** `serverLogic.rules`（实测），所以载入存档后要单独推一次这个 op，
> 或直接在编辑器"服务端逻辑"页配置。

## 5. 脚本更新方式（后续迭代）

> **先看决策**：教程**不单独建映射**，并入关卡主脚本（理由见 `docs/adr-001-single-script.md`）。
> 交付形态二选一：`lua/main.lua`（standalone，独立跑/演示）或 `lua/module.lua`（module，并入主脚本）。
> 下面是两种形态各自的更新方式。

- **推荐（module 形态，并入主脚本）**：把 `lua/module.lua` 粘到主脚本顶部（或 require），
  在主脚本自己的生命周期里转发 → 之后只更新这一个文件。要点：
  ```lua
  local T = Tutorial.install({ root_name = "tutorial.root", keys_enabled = false, log_prefix = "[tutorial]" })
  function OnStart() T.OnStart() end
  function OnUpdate(dt) T.OnUpdate(dt); ... end
  ```
  `keys_enabled=false` 时必须由主脚本裁决 Esc/方向键（否则没人翻页）；`T.act("next")` 可由主脚本代按。
- **standalone 形态（独立跑）**：`qxqy_script_sync` 绑定 `workspace/qxqy-ui-system/lua` 目录，之后只做
  `discover → status → preview`，由**用户在"Lua 脚本 → 实机脚本同步"页确认复制**。
  AI 不代替用户点确认，也不用 shell 绕过。
- 手工方式：改 `lua/src` → `node tools/build_bundle.mjs --mode <standalone|module>` → 把对应产物**整份覆盖**进真机脚本
  （bundle 是单文件，不要只贴某个模块）。
- 复制后在千星沙箱**保存并重新试玩**；只看"文件已复制"不算验证。
- 若在编辑器里手工改过脚本，先把改动回收进 `lua/src`，否则下次覆盖会丢失。

### 存档现状（已复核）

`qxqy-ui-system.save.json`：1 条脚本映射（id `1073742200`，`source` 空 = 路径模式，挂 `app.root`/`n40`）、
41 个控件、`serverLogic.rules=1`（`ui/nav → Level.UiLastPage/UiLastIndex + ui/sync`）。
⚠️ 再次导入同一存档会**多出一条脚本映射**（实测），导入后确认脚本只有 1 条。

## 6. 真机核验清单（逐条打勾）

| # | 项 | 判定 | 现状 |
|---|---|---|---|
| 1 | 脚本能加载、`APP_READY` 出现 | 真机日志 | ⬜ |
| 2 | 三页翻页 / 页签跳转 / 页码文本 | 点击观察 | ⬜ |
| 3 | 页签选中标记（金星/灰环）随页切换 | 观察 | ⬜ |
| 4 | 关闭按钮：界面消失但**不白屏崩溃**，再打开能恢复 | 观察 | ⬜ |
| 5 | 键盘 Left/Right/Esc（PC 端） | 观察 | ⬜ `AddKeyEventListener` 是否支持容器节点未知 |
| 6 | 悬浮/按下/不可用四态显示 | 观察 | ⬜ 编辑器四态配置需逐个绑子控件 |
| 7 | 文本换行与字号（手机窄屏） | 观察 | ⬜ 模拟器不能代表 |
| 8 | 联机两人：各自翻页互不干扰 | 双端观察 | ⬜ |
| 9 | 传送/断线重连后的界面恢复 | 观察 | ⬜ **未实现自动恢复**，属已知缺口 |
| 10 | 服务端变量 `Level.UiLastPage` 随翻页变化 | 变量面板 | ⬜ 需先按 §4 接线 |

## 7. 已知差异与环境限制

- 模拟器不播动效、无音频 ⇒ `界面动效` 只是占位；关键反馈都有视觉替代。
- 模拟器只有 100001–100006 图元预览；正式美术换 `imageId` 后**必须在真机看一次**。
- 模拟器"按 plan 建树"，真机只有存档里真实存在的控件 ⇒ 模拟器绿 ≠ 真机通。
