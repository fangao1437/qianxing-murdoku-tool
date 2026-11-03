# 技术架构（运维手册）

> 结构一变就改这里。读者是"接手的人 / 未来的自己"：不看代码也能知道**哪个文件管什么、哪个控件叫什么、数据怎么流**。

## 1. 产物地图

```
workspace/qxqy-ui-system/
├── lua/src/*.lua            源码（9 个模块，按依赖顺序）
├── lua/main.lua             **构建产物**（单文件 bundle，被挂到 app.root；不要手改）
├── qxqy-ui-system.save.json 完整模拟器存档（客户端控件容器 + 41 个控件 + 1 个脚本映射）
├── tools/
│   ├── build_bundle.mjs     src/*.lua → lua/main.lua（含 --check 一致性校验）
│   ├── gen_save.mjs         以 records/proto-project.json 为原型生成存档
│   ├── patch_guards.mjs     历史修复脚本（控件判据 table→userdata），已固化，勿再跑
│   ├── pb.mjs / gia_*.mjs   GIA 解析工具（见 docs/gia-structure.md §7）
│   └── probe_worker_*.mjs   读取模拟器插件内嵌 schema / 函数（排障用）
├── tests/t0*.json           7 个 qxqy-autotest 用例
├── tests/offline/           离线桩（纯 Lua 跑 module 形态，不依赖模拟器）
├── export/                  真机交付物：`473-教程UI系统骨架-v1.gil`（关卡存档）+ 便于验证的同名 save.json
├── docs/                    gdd / tech-architecture / gia-structure / api-notes / repo-survey / adr-001 / production-plan / device-handoff / gil-build
├── records/                 GIA 解析产物、proto 快照、playtest 证据
└── （真机交付流程见 docs/device-handoff.md）
```

### 导出 `.gil`（真机可导入的关卡存档）

**位置约定（2026-10-21 用户指定）**：测试存档**统一放到 `qianxing-murdoku/存档/`**，命名沿用该仓的
`NNN-描述-vN.gil` 序列（该目录现有 461…470，仓库根另有 471/472；本次用 **473**，下一次 **474**）。
`build_gil.mjs` 顶部的 `SEQ` / `SLUG` 两个常量就是改这里；机器摘要与验证用存档留在本工程 `export/`，不污染对方仓。

`.gil` 是**整关存档**（界面布局 + 节点图 + 地形…），真机走【存档 → 导入存档】。
本工程的 `.gil` 由 `tools/build_gil.mjs` 生成，**不手搓字节**，走仓库成熟链：

```
基线  qianxing-murdoku/assets/纯2D游戏模板(客户端脚本版).gil   （24 条记录，含每种控件的一个原型）
图片供体  qianxing-murdoku/存档/470-遗留清理-v282.gil         （模板里的图片原型没有 assetId，借一条有素材的）
写入  gilread.mjs + gilwrite.mjs(writeGil)  ← 自带"落盘后重读 + 往返 + 记录数 + 字段 diff"四道闸
自检  tools/gil_inventory.mjs（名字/父子/几何）· roundtrip.mjs（逐字节）· gil_to_save.mjs（转模拟器存档再试玩截图）
```

三条铁律（来自 `qianxing-murdoku/docs/千星存档-gil格式.md`，已真机验证）：
1. 加控件必须**同时**写①记录本身 ②**父控件的子 id 列表**；只写①文件能解析但游戏里看不见。
2. 克隆原型要**清空原型自己的子列表**，否则副本会认领原型的子控件。
3. 换 id 要把**三处**都改：顶层 `#501`、`#502(1,5)/#11/#501`、各槽 details 里的 nodeRef `#504/#4`。

**单一真相**：脚本内容以 `lua/main.lua`（磁盘文件）为准 —— 存档里的 `scripts[].source` 是**空串**，
运行时会读 `path` 指向的文件（路径模式，实测可用）。所以改代码的流程是：

```
改 lua/src/*.lua
  ├─ node tools/build_bundle.mjs --mode standalone   → lua/main.lua    （整份挂到 app.root）
  └─ node tools/build_bundle.mjs --mode module       → lua/module.lua  （并入关卡主脚本用）
→ 停止/重新启动试玩（standalone）或粘贴/require 到主脚本（module）
```

（只有"新增脚本映射 / 改挂载点 / 改控件树"才需要动存档。）

**两种形态**（同一份 src，见 `docs/adr-001-single-script.md`）：

| 形态 | 产物 | 全局回调 | 用途 |
|---|---|---|---|
| standalone | `lua/main.lua` | 自己注册 7 个 | 教程单独跑 / 演示（当前交付形态） |
| module | `lua/module.lua` | 不注册，只暴露 `Tutorial` | **并入关卡主脚本（推荐）**：`Tutorial.install{root_name="tutorial.root", keys_enabled=false}` + 主脚本转发 `OnUpdate(dt)` |

## 2. Lua 模块（bundle 内的 9 段，顺序即依赖顺序）

| 模块 | 文件 | 职责 | 关键约束 |
|---|---|---|---|
| `Util` | `00_util.lua` | 日志（`[ui]` 前缀）、clamp、字符串/表工具 | 无引擎依赖 |
| `Engine` | `10_engine.lua` | **唯一**调用 `game.*` 与控件方法的层 | 每个调用都做存在性检查 + `pcall`；`is_ctrl()` 认 table **与** userdata |
| `Bind` | `20_bind.lua` | 名字 → 控件句柄索引（一次 DFS 建表，generation 计数） | 回调里**现查**不捕获；重复名只记第一次并统计 |
| `State` | `30_state.lua` | 可选中控件的 `state.sel`/`state.off` 互斥显隐 | 只写这两个子控件 |
| `Screen` | `40_screen.lua` | 屏注册表 + 屏级显隐（`want_id`→`_shown` 差量写） | 屏根恒 active，切屏只 `SetVisible` |
| `Pager` | `50_pager.lua` | 页模型：顺序翻页/跳页/重置/页码/页签选中 | 页顺序 = 编辑器同级顺序；边界默认钳制 |
| `Input` | `60_input.lua` | 点击绑定（`CursorClick`）、键盘试探绑定、长按计时 | 只绑按钮类控件；同 (控件,事件) 只挂一份 |
| `App` | `70_app.lua` | 装配：发现控件 → 接输入/信号 → 开屏 → 诊断；扩展点 | 发现 0 屏 = 待命不崩；`boot` 可重入 |
| `Entry` | `90_entry.lua` | 7 个生命周期全局函数 → 转给 App（**仅 standalone 形态**） | 不依赖 OnInit/OnStart 顺序 |
| `Tutorial` | `91_api.lua` | 对外门面：`install/api/tick/show/hide/act/state/diag` | module 形态下唯一全局；不抢生命周期 |

扩展点（后续填内容用）：

```lua
App.register_reset("p2", function(page) ... end)  -- 「重置内容页签」的业务实现
App.set_title("…") / App.set_body("…")            -- 改标题/正文
App.act("p3", "外部")                              -- 等价于点页签
App.state()                                       -- 取 {screen=, page=}
QxUI_Diag() / QxUI_PrintTree() / QxUI_Act(a)      -- 调试入口（全局）
```

## 3. 控件树（存档里的真实 id / guid）

| 控件 | 内部 id | guid | 说明 |
|---|---|---|---|
| `客户端控件容器` | `sc1` | 1073741850 | **服务端**资产；客户端控件必须放在它下面 |
| `app.root` | n40 | 1073741890 | 容器节点，铺满；`showCursor=true`；**脚本挂这里** |
| `screen.demo` | n39 | 1073741889 | 界面根，铺满；`showCursor=true` |
| `hud.title` | n13 | 1073741863 | 标题文本框（28 号字） |
| `hud.pager` | n14 | 1073741864 | 页码文本框（`%d / %d`） |
| `btn.close` | n12 | 1073741862 | 预设按钮，子件 `text`/`plate` |
| `tab.p1` / `tab.p2` / `tab.p3` | n19 / n24 / n29 | …869 / …874 / …879 | 页签按钮，子件 `text`/`state.sel`/`state.off`/`plate` |
| `btn.prev` / `btn.next` | n32 / n35 | …882 / …885 | 左右翻页 |
| `btn.reset` | n38 | 1073741888 | 重置当前页 |
| `page.p1` / `page.p2` / `page.p3` | n3 / n6 / n9 | …853 / …856 / …859 | 页容器（比例锚点 0.08/0.14 → 0.92/0.84） |
| `label` / `bg` | n1,n2 / n4,n5 / n7,n8 | …851,852 / 854,855 / 857,858 | 每页的占位文案与底板（素材留白） |

**同级顺序 = 绘制顺序**：编辑器里同级列表**第一项在上**。因此 `screen.demo` 的子顺序是
`btn.close → hud.title → hud.pager → tab.* → btn.prev/next/reset → page.*`（交互层在前，内容页在后，
否则页底板会盖住按钮）。

## 4. 脚本映射与运行模式

| 项 | 值 |
|---|---|
| 脚本 id | `1073742200`（固定，避免与其它映射撞号） |
| 映射路径 | `workspace/qxqy-ui-system/lua/main.lua` |
| 挂载控件 | `app.root`（n40） |
| 存档内 `source` | **空串** ⇒ 运行时读磁盘文件（路径模式） |
| 内联模式的风险 | 若 `source` 非空，试玩跑的是**内联副本**，改磁盘不生效 —— 本工程刻意留空 |

`load` 存档是**合并脚本注册表**（不是替换）。实测教训：沿用旧脚本 id 会把旧脚本"复活"并挂到同号控件上，
出现 2~3 份实例同时跑。**改脚本 id 或先 `removeScript` 再导入**。

## 5. 数据流

```
                   ┌──────────── 客户端（Lua，本项目）────────────┐
点击 tab/btn ─────► Input（CursorClick）─► App.act(action)
                                          ├─► Pager.apply() ─► Engine.SetVisible(page.*) + hud.pager 文本 + State.set(sel/off)
                                          └─► Engine.send_signal("ui/nav"/"ui/action")
键盘 Left/Right/Esc ► Input.enable_keys ────┘（同一 App.act）
                                                     │
                                            ┌────────▼────────┐
                                            │ 服务端（真机节点图 / 模拟器 setServerLogic）│
                                            │ 收 ui/nav → 写 Level.UiLastPage 等变量      │
                                            │ 发 ui/sync → 客户端校正页                    │
                                            └────────┬────────┘
script:RegisterServerSignalHandler("ui/sync") ◄──────┘ ─► App 以服务端为准 jump（幂等）
```

信号约定：`ui/nav`(screen, page, idx) / `ui/action`(screen, action) / `ui/sync`(page)。
服务端规则示例见 §7「已知缺口」。

## 6. 唯一可见性权威（排障第一原则）

| 目标 | 唯一写入者 | 其它地方 |
|---|---|---|
| `screen.*` 的 visible/active | `Screen.apply()` | 只设 `want_id` |
| `page.*` 的 visible/active | `Pager.apply()` | 只改 `screen.page_index` |
| `state.sel` / `state.off` | `State.apply_one()` | 只调 `State.set()` |
| `hud.pager` 文本 | `Pager.apply()` | — |

排查"控件该显不显"时：先确认它属于哪一类目标，再回**唯一写入者**，不要去别处找第二份逻辑。
（既有工程的 4 个真机事故全部来自"同一件事两处负责"。）

## 7. 已知缺口 / 待办

| 项 | 现状 | 下一步 |
|---|---|---|
| 服务端规则未进内存存档 | `load` 会丢弃 `serverLogic`（实测 `rules` 变空）；存档 JSON 里已写好规则 | 用户在编辑器"服务端逻辑"页补，或用 `setServerLogic` op 推一次；真机要按官方节点图重建 |
| 传送/断线重连恢复 | 框架有 `Bind.invalidate()`，但没有自动恢复流程 | 步骤 7 真机观察后补 |
| 手柄导航 | 只留 `canControllerFocus` 字段与文档说明 | 需要时用 `game.SetControllerFocus` 落地 |
| 真机键盘 | 容器节点是否支持 `AddKeyEventListener` 未验；模拟器可用 | 真机核验清单 P1 |
| 动效/音效 | 模拟器不播动画、无音频链路 | 反馈全部有视觉替代；真机核验 |

## 8. 调试清单

| 症状 | 先看 |
|---|---|
| 没有任何 `[ui]` 日志 | 脚本映射是否为空 source + 路径是否存在；`mountError` 是否报 Lua 错误 |
| `DISCOVER screens=0` | 名字是否写成 `screen.xxx`；`Bind` 是否有 `apt`；日志里 `missing=` 会点名 |
| 点了没反应 | 目标是不是**预设按钮/光标检测区域**；容器 `showCursor` 是否为真；`clicks=` 是否覆盖它 |
| 白屏但日志正常 | 屏根/页根 `SetActive(true)` 是否执行过（`active` 默认 false） |
| 改了代码没生效 | 存档 `source` 是否被写回成内联；是否忘了 `build_bundle` |
| 日志出现多份 `[ui] LIFECYCLE` | 脚本注册表里有重复映射（见 §4） |


### 控件 id 段规则（2026-10-21 真机踩坑后定）

- 新增控件的 id **不要**取 `maxId + 1`：会撞上目标工程里编辑器自己的控件
  （实测报「界面控件里的开关控件GUID重复:1073742041」）。
- 统一用**高号段**：`build_gil.mjs` 的 `ID_BASE`（默认 `1073743800`，可 `--base=` 覆盖）。
  历史依据：`qianxing-murdoku/docs/回执-GUID撞号-v257b.md`（那次也是搬到 1073743794+ 才通过）。
- 导入前自查两个工具：
  - `node tools/gil_dupid.mjs <档>` —— 内部是否有"同 id 被 ≥2 条记录认领"；
  - `node tools/gil_geom_diff.mjs <旧档> <新档>` —— 换号段后是否"逐条同构、只差 id"。
