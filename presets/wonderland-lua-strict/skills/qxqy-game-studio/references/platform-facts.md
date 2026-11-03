# 平台事实与已知边界（跨步骤共用）

本文件把"官方写明 / 本机实测 / 模拟器行为 / 尚未验证"分开记录，供七个步骤共用，避免每轮重新试错。

**读法**：进项目时**只读下面的「必读核心」**（约 1 屏）；其余各节**用到再按索引跳读**。本文件是**查阅手册，不是教材**——线性通读它是在浪费判断力。

**基线版本**：模拟器插件 `dsh-plugin-beyond-simulator` **2.0.8**（`skill.md` + 当前会话工具 schema + 构建产物核对）；官方客户端语料 10 篇（不含服务端节点图）。
**版本变化时**：先按下面 [0. 复核方式](#0-复核方式)确认差异，再引用本文件任何一行。计划里写新版本才有的能力＝返工。

标注：`[官方]` 官方文档原文；`[模拟器]` 插件文档/工具 schema；`[实测]` 实际测量（注明场景，可能随版本失效）；`[推断]` 未验证，不能作为通过依据。

---

## 必读核心（错了要推倒重来的十条）

进项目时读这一节即可；细节按需跳到对应小节。

| # | 事实 | 错了会怎样 | 详见 |
|---|---|---|---|
| 1 | **坐标系**：千星原点左下；HTML 原点左上、Y 向下 | 布局整体镜像/错位，且会一路错到交付 | [1.5](#15-坐标与布局两种基准勿混用) |
| 2 | **客户端 Lua 不能写自定义变量**——读变量、发信号 | 写出永远不会生效的逻辑 | [1.7](#17-服务端交互变量只读信号双向) |
| 3 | **只有存为模板控件的父节点**能被动态创建 | 控件树设计推倒重来 | [1.2](#12-运行时创建) |
| 4 | 树权威是 `root.children`（`tree[].parentId` 无效） | 读错结构，据此做的判断全错 | [3](#3-存档源码与写入生效) |
| 5 | **非空内联 `scripts[].source` 优先于外部文件** | 改了几轮代码却一直在跑旧版本 | [3](#3-存档源码与写入生效) |
| 6 | **没有保存工具**，落盘要请用户点【保存存档】 | 以为存了，实际全在内存里 | [2.4](#24-工具与动作) |
| 7 | **模拟器通过 ≠ 真机通过**；两侧都缺才是真缺陷 | 把环境差异当缺陷修，浪费整轮 | [5](#5-模拟器-vs-真机差异实测换版本要复核) |
| 8 | 只有真机上的索引/素材/手感算真机证据 | 拿模拟器结论交付 | [5](#5-模拟器-vs-真机差异实测换版本要复核) |
| 9 | **没有长按事件**，要用 Down/Up + `dt` 自实现 | 交互实际不响应 | [1.6](#16-事件模型) |
| 10 | 昂贵快照**每轮至多一次**；产物路径保持 ASCII | 上下文被吃掉 / 解释器读不到路径 | [7](#7-上下文与工具经济学) |

---

## 索引（按需跳读）

| 我要确认… | 去哪节 |
|---|---|
| 有哪些控件类型 / 能不能动态建控件 | [1.1](#11-控件类型11-类)、[1.2](#12-运行时创建) |
| 控件挂在哪、生命周期 | [1.3](#13-挂载与生命周期) |
| 文字与字体怎么写 | [1.4](#14-文本与字体) |
| 坐标怎么算（两个基准） | [1.5](#15-坐标与布局两种基准勿混用) |
| 有没有某个事件（长按？拖拽？） | [1.6](#16-事件模型) |
| 客户端能不能改变量 / 怎么跟服务端通信 | [1.7](#17-服务端交互变量只读信号双向) |
| 图片、音频 | [1.8](#18-图片与音频) |
| 规模上限（控件数、层级） | [1.9](#19-规模上限服务端-guide编辑项范围限制非客户端语料) |
| 模拟器支持哪些工具动作、参数、超时 | [2.4](#24-工具与动作) |
| 用例 JSON 的断言怎么写 | [2.5](#25-用例格式208-实测-schema) |
| patch 能改哪些字段 | [2.6](#26-patch-op-与字段子集) |
| `require` 路径怎么写 | [2.7](#27-require-路径) |
| GIA 导入导出 | [2.8](#28-gia-往返) |
| 存档结构哪个字段才算数 / 改了算不算生效 | [3](#3-存档源码与写入生效) |
| 控件索引、GUID、模板引用怎么对应 | [4](#4-索引guid-与模板) |
| "模拟器里不行" 到底是不是缺陷 | [5](#5-模拟器-vs-真机差异实测换版本要复核) |
| 成本/上下文怎么省 | [7](#7-上下文与工具经济学) |
| 哪些结论已经不可信 | [8](#8-不可信结论清单提醒注释是假设) |

---

## 0. 复核方式

复核的**方法**在 [推理姿态 P2、P6](reasoning-patterns.md)——那里讲的是"什么样的结论还不配被相信"。这里只列本平台上的具体查法：

| 要确认的事 | 怎么确认 |
|---|---|
| 官方 Lua/控件语义 | 读当前会话可用的客户端文档：《客户端控件和客户端脚本》《客户端控件API文档》优先，再按控件读专题文档 |
| 模拟器当前能力与版本 | 读插件 `package.json` 版本与 `skill.md`、`qxqy-simulator` Skill；必要时用一次最小探针工程实测 |
| 结论是否还有效 | 见 [P6](reasoning-patterns.md#p6--结论即假设)：找原始证据，或按"当时的条件是否还成立"判断 |
| 写入是否生效 | 见 [P5](reasoning-patterns.md#p5--读回才算写入)：落盘后重新读盘比对字段 |
| 数量/性能结论 | 见 [P2](reasoning-patterns.md#p2--度量先验真)：先证明被测对象与真实对象一致 |
| 真机行为 | 只有真机证据能证明；模拟器绿灯只到"模拟器候选" |

**三层支持度必须分开说**：①编辑器里能创建/保存 ②Lua 字段能读写 ③试玩/真机里真的生效。三者互相不等价——动画与音效方法在 2.0.8 是空操作、按键提示不画键位、模板引用控件不会自动展开。汇报能力时写清是哪一层。

**规则：任何来自注释、旧交接文档、其它会话的结论都是假设。** 引用前先标 `[推断]` 或补一次最小验证；本文件同样适用。

---

## 1. 官方客户端 2D 能力（`[官方]`）

### 1.1 控件类型（11 类）

以《客户端控件和客户端脚本》"客户端控件资产"和《客户端控件API文档》§12(1) 继承关系表为准：

`容器节点`（ClientUIContainerControl）、`文本框`（ClientUITextBoxControl）、`文本视窗`（ClientUITextWindowControl）、`图片`（ClientUIImageControl）、`预设按钮`（ClientUIPresetButtonControl）、`按键提示`（ClientUIKeyHintControl）、`光标检测区域`（ClientUICursorEventAreaControl）、`网格视窗`（ClientUIGridScrollerControl）、`模板引用控件`（ClientUIReferenceControl）、`界面动效`（ClientUIAnimationControl）、`全屏动效`（ClientUIFullscreenAnimationControl）。

- 没有 `progress`/进度条控件；写控件清单不要凭直觉补类型。
- 客户端控件必须有服务端《客户端控件容器》才生效："所有客户端控件和挂载在控件上的脚本将无法正常运行和显示"；容器隐藏或销毁时其内客户端控件销毁。
- 模板引用控件**不会自动实例化**被引用的模板；只有显式 `game.InstantiateClientUIControl` 才会创建实例。

### 1.2 运行时创建

`game.InstantiateClientUIControl(controlPrefabIndex: integer, parent: ClientUIBaseControl)`；配套 `game.DestroyClientUIControl(control)`、`game.GetClientUIControl(controlId)`、`game.FindClientUIRoot(nodeName)`、`game.GetClientUIRoots()`。

- 只能动态创建"**存为模板的客户端控件的父节点**"；挂载在主屏的控件、以及模板内的子节点都**不能**用脚本接口创建。所以实例化方案要求模板本身是容器节点形态。
- `controlPrefabIndex` 是模板索引；`game.GetClientUIControl` 的参数是运行时控件 `Id`。两者不可互换。

### 1.3 挂载与生命周期

- 任意客户端控件的"脚本"页签可添加脚本；只有容器画布内与模板内的控件可挂；其余都是服务器控件，"模板索引无法被客户端脚本调用"。
- 脚本随实例存在，按实例查询：`GetScript(scriptMappingId)` / `GetScripts()` / `GetScriptByPath(path)`。
- 生命周期回调：`OnInit/OnStart/OnEnable/OnUpdate/OnLevelUpdate/OnDisable/OnDestroy`；`script:EnableUpdate(enabled)` 可关闭逐帧更新。
- 官方未说明"模板脚本实例化时自动跑哪些回调"（not found），需要时用探针确认，不要写进契约当既定事实。
- 传送 / 断线重连会销毁全部客户端控件并回到初始状态，需要自己写恢复逻辑。

### 1.4 文本与字体

`fontSize: integer`（Tweenable）、`adaptiveFontSize: boolean`、`minimumFontSize: integer`（Tweenable）——**必须是整数**。文档未定义 `minimumFontSize` 与 `fontSize` 的相互关系。
`[模拟器]` 自适应字号在模拟器中不生效；换行只在显式换行符处发生，与浏览器自动换行不一致。所以"文字在真机是否完整可读"必须留在真机核验清单里，仿真只能给近似。

### 1.5 坐标与布局（两种基准，勿混用）

- 布局字段：`anchoredPositionX/Y`、`sizeDeltaX/Y`、`anchorMinX/Y`、`anchorMaxX/Y`、`pivotX/Y`。
- 官方 §13(3)：无父层级时以**画布左下**为原点；存在父层级时 `GetAnchoredPosition` 返回"与父层级**中心**的相对偏移"。`CursorEventData:GetUIPos()` 以画布左下角为原点。
- 模拟器布局面（`set` 的 `posX/posY/anchorMinX/anchorMinY/...`）用的是**锚点相对父矩形 0–1** 的建模。两者不是同一套基准：跨父级定位、或把设计稿数值直接换算成 `SetAnchoredPosition` 之前，先做一次探针或留真机核验项。
- 官方语料没有"Y 轴向上""anchor 取值 0–1"的明文（not found）；它们是模拟器/工作区既有约定，按约定用即可，但不要在文档里当成官方条款引用。
- HTML 原点左上、Y 向下，禁止把 CSS 像素抄进 Lua。
- 旋转：三轴旋转会进入运行时并做 XY 投影（`(120,0,0)` 与 `(60,180,180)` 等效，无 Z 深度/透视/排序）；**点击命中仍按旋转前的轴对齐矩形**计算。

### 1.6 事件模型

- 光标：`AddCursorEventListener(eventType, callback)` / Remove / RemoveAll / `SimulateCursorClick()`；`Enum.CursorEventType` 只有 8 项：CursorDown、CursorUp、CursorClick、CursorEnter、CursorExit、CursorDrag、CursorBeginDrag、CursorEndDrag。回调收到 `CursorEventData`（`dragging`、`touchId`、`GetUIPos()`、`GetPressUIPos()`、`GetUIPosDelta()`）。
- **没有长按事件**。长按必须用 Down/Up + 显式 `dt` 计时自己实现，并在用例里定义阈值与边界。
- 光标事件前置条件：所在容器的 `showCursor` 为真，"CursorEvent 相关方法都需设置该参数为真后才可正常使用"。
- 按键：`AddKeyEventListener(eventType, callback)`，**回调返回 boolean**；返回已处理则同一容器内其它控件不再响应这次按键。按键按渲染顺序派发，"层级和排序靠前的控件响应优先级更高"。
- 手柄导航：`AddNavigationEventListener(eventType, callback)`（Confirm/Cancel/Focus/LostFocus/左右摇杆八向）。
- 网格视窗：`RefreshItems(itemCount, refreshCallback)`，回调 `fun(control, index)`；另有 ScrollToItemAt / GetItemIndex / GetItemSize / GetContentLength / `scrollProgress`。只有"仅配置在列表项来源中的模板"能应用列表滚动效果；列表项只加载可见范围，且"复用列表生成的列表项不保证同级排序结果稳定"（不要依赖同级顺序做身份判定）。
- 官方未记录节流参数或每帧规则（not found）；逐帧工作自己控量。

### 1.7 服务端交互（变量只读、信号双向）

- 发信号：`game.ServerSignal(signalName)` → `ServerSignal:AddParam(paramType, value)` 或类型化 `AddInt/AddFloat/AddString/AddBool/AddVector3/AddGuid/AddEntity/AddPrefabId/AddConfigId/Add…List` → `SendSignal()`。`Enum.ParamType` 18 项。
- 收信号：`script:RegisterServerSignalHandler(signalName, fun(signalName, signalParams))` / `UnregisterServerSignalHandler`。
- 读变量：`game.GetGlobalCustomVariableValue(entityType, name)`；`Enum.CustomVariableEntityType` 只有 `Level` / `PlayerSelf` / `AvatarSelf`。监听 `script:RegisterCustomVariableChangedHandler(entityType, name, fun(...))` **回调不携带新值，必须自己再 Get**。
- **Lua 不能写自定义变量**：客户端只能 Get + `SendSignal`，由服务端逻辑写变量。所以"客户端直接给变量赋值"在真机上不成立。
- 联机信号延迟最低 100ms（官方原文），不要按同帧往返设计体验。
- 参数类型：Vector3 传 `{x=,y=,z=}` 的 table；Guid / Entity / PrefabId / ConfigId 以 integer 传递。

### 1.8 图片与音频

- 图片：`imageSource`（`Enum.ImageSource`：StaticReference / Item / Equipment / Skill / UnitStatus / Faction / Currency / Prefab）、`imageId`（integer，**只读**）、`SetImage(imageSource, imageId)`。改图必须调 `SetImage`；给 `imageId` 赋值无效。
- **`imageSource` 与 `imageId` 必须成对匹配**：来源与 ID 不匹配同样显示缺失框；不要从一个 ID 反推来源，也不要覆盖 GIA 里来源不明的原始值。
- 素材清单与 `100001–100006` 这类编号**不在客户端语料中**（not found）。见 §2.3 的模拟器预览范围；真实图元 ID 以编辑器/素材表为准，未核实的 ID 一律标 `[推断]`。
- 音频：`game.PlayAudio2D(audioId) -> instanceId` / `game.StopAudio(instanceId)` / `game.IsAudioAlive(instanceId)`（点号调用）。2.0.8 模拟器**没有音频播放链路**，调用不发声。所以"音效正常"只能在真机确认，且 P0 不要依赖音频作为唯一反馈通道。

### 1.9 规模上限（服务端 guide《编辑项范围限制》，非客户端语料）

界面布局 ≤100；自定义控件模板 ≤2000；单个界面控件组内控件 ≤1000；单次玩家屏幕内可显示控件 ≤10000；单关卡信号 ≤99；字符串长度 ≤1000。
这些是全局 UI 上限，不是本工程的性能预算；发布候选做一次实际用量盘点。

### 1.10 调试与调用约定

- 循环内高频调用可能导致"进关加载变久或卡死，且正常日志无法报告此情况"，需查本地 `ErrorLog.txt`。卡死先怀疑循环与逐帧路径，不要先怀疑素材。
- `game` 是全局表：**用点号调用 `game.X(...)`，注意参数个数**。误用冒号（`game:X(...)`）会多传一个 self：模拟器可能静默通过，真机报错。改完 API 调用方式后要回归一次。

---

## 2. 模拟器能力（`[模拟器]`，2.0.8）

### 2.1 工程与资产

- 每会话一份内存存档，固定三类资产：`UI控件-服务端`（客户端控件容器）、`UI控件-客户端`（可被 Lua 实例化的模板）、`Lua 脚本`。
- 脚本挂到客户端控件上；服务端"客户端控件容器"只是资源分组，**不能挂客户端脚本**（可用 `controlAsset` 区分）。
- `newAsset` 只重置当前半边（服务端与客户端分开存储），切换资产用 `selectAsset`。

### 2.2 画布与人数

五画布：`pc-16-9` 1600×900、`pc-21-9` 2100×900、`mobile-16-9` 1280×720、`mobile-19.5-9` 1560×720、`mobile-4-3` 1280×960。
2D 游戏布局基准是 `mobile-16-9`（整屏必须完整可见）；PC 用固定设计板 + `min(canvas/design)` 等比缩放、不足留边；禁止"按 PC 铺满再在手机上裁切"。缩放容器上不要再加全屏不透明兄弟节点（同级先出现的子节点会盖住舞台）。P0 至少覆盖 `mobile-16-9` 与 `pc-16-9`。
多人：1–8 名玩家，每位一份独立客户端；Lua `PlayerSelf` 相对当前视角客户端。`device` / `start {canvasId}` 切换画布会**重建运行时**（时间归零、历史重置、新生命周期），用例不跨画布串联。

### 2.3 素材预览范围（**版本相关，先确认再断言**）

2.0.8 **没有图片素材下载/缓存链路**：只有 `imageId` 100001–100006 画占位图元（100001 矩形、100002 圆形、100003 三角形、100004 四角星、100005 五角星、100006 圆环），其他 ID 显示缺失框。这是**预览限制**，不是"官方素材不能用"：缺失框 ≠ 资源不可用，记录 `targetId` 留真机核验。
这六个图元正好可以当步骤 4 的"模拟器替代方案"素材（形状 + 颜色 + 文本即可表达大多数状态），真机再换成官方图片。
更高版本才加入可下载的静态素材与元件图标、基础/拉伸（三切片/九切片）显示。**版本判定**：读插件 `package.json` 与 `skill.md`，或在最小工程里放一张目标 ID 看结果；不要把新版本能力写进本轮计划。

### 2.3.1 2.0.8 明确缺失的能力（不要按它们设计 P0）

| 缺失 | 后果 | 应对 |
|---|---|---|
| 图片素材下载/预览 | 除基础图元外都显示缺失框 | 素材选择不受限；"图是否对"列入真机核验 |
| 音频播放链路 | 音效无声（Lua 接口存在） | 反馈必须有视觉替代；音效列真机项 |
| 文本视窗/网格视窗的滚动与列表项 | `RefreshItems`/`ScrollToItemAt`/`scrollProgress` 不可用；列表项不实例化 | 依赖列表滚动的玩法在模拟器不可验证，记真机清单 |
| 控件索引批量同步工具 | 只能按语义手工改 | 按 `controlGuidChanges` 逐条核对，禁止全局替换数字 |
| 动画播放（界面/全屏动效） | `PlayAnimation`/`StopAnimation` 为空操作 | 关键反馈不要只靠动效；或退回属性/可见性变化 |
| 按键提示图标 | 试玩不画键位、不按输入设备切换 | 真机看效果 |
| MCP 专属工具（`qxqy_project_open`、`qxqy_preview_*`） | Harness 会话里不存在 | 用 Harness 工具 schema；MCP 用法只在 MCP 宿主里写 |

这些是**模拟器能力缺口**，不是玩法规则；遇到时按 §5 的两侧判定规则处理，不要反复换写法硬试。

### 2.4 工具与动作

> **超时值以当前会话的工具 schema 为准，下表只是 2.0.8 的基线。** 工具 schema 是**活的**，本文件是**快照**——两者冲突时信 schema，并顺手把这行改掉（[P6](reasoning-patterns.md#p6--结论即假设)：过期文档是危险源，不是陈旧装饰）。

| 工具 | 要点 | 2.0.8 工具侧超时 |
|---|---|---|
| `qxqy_studio_get` | 无参数，读工程无损 JSON 快照（严格 JSON） | 5 s |
| `qxqy_studio_patch` | `{op:{...}}`；数据写操作**尽量带最新 `expectedRevision`**（见 §2.6） | 5 s |
| `qxqy_studio_load` | 不传 `path` 列出工作区存档，传相对路径**导入**到当前会话（需已绑定工作区；没有未保存更改保护，会直接替换内存状态） | 8 s |
| `qxqy_studio_ui_screenshot` | 编辑器舞台 PNG（按编辑器 boxes 渲染）；看静态布局/选中项；不需要先 start | 5 s |
| `qxqy_studio_play_screenshot` | 试玩 Runtime PNG（按 Runtime **scene 树**渲染，同级先出现者在上）；需先 `start`；不推进时间；返回 `canvasId`/`frame`/`time`/逻辑尺寸/像素尺寸 | 5 s |
| `qxqy_studio_play` | 见下 | 见下 |
| `qxqy_script_sync` | `discover/status/configure/preview`；`configure` 需 `config{version:1,workspaceDir,clientImportRoot,clientSubdir}` + `expectedRevision`；**没有 apply：复制只能由用户在编辑器确认** | 10 s |

`qxqy_studio_play` 是唯一的**双层**超时：工具侧 10 s，而 Worker 单次请求另有默认 **8 s**，可用环境变量 `QXQY_PLAY_TIMEOUT_MS` 覆盖（下限 1000 ms）。**所以慢动作会先撞 8 s 那层**——超时报 `play worker timed out after Nms` 并终止 Worker，不是工具整体超时。这一点决定了"拆小步"比"加大超时"更可靠。

**2.0.8 的 Harness 工具集里没有"保存"工具**：`patch`/`load`/试玩都只改内存存档，落盘只发生在用户在"模拟器"标签点【保存存档】时（HTTP `save`）。所以"保存完整存档"在本宿主是**请用户操作**，不是 AI 自己调工具；`script-sync` 的复制还要求存档已保存且未再变化。需要顺序是：AI 改 → 请用户保存 → AI preview → 用户确认复制。

`play` 动作：`start`（可带 `canvasId`、`playerCount`、`viewPlayerIndex`）、`device`、`view`、`get`、`step{dt}`、`pointer{type,x,y}`、`key{key}`、`click{name}`、`pause`/`resume`、`stop`、`serverGet`/`serverSet`/`serverSend`、`history`、`saveCase{name,asserts}`、`runCase{case}`（可带 `canvasId`、`playerCount`、`viewPlayerIndex`）。
- `get` 默认不含运行树；`inspect:true` 才带扁平 `tree`，`view:true` 带 `scene`（`tree-v1`），`paint:true` 带扁平 paint 列表，`compact:true` 把日志/历史裁到最后 100 条。
- `start` 不带 `canvasId` 时**跟随编辑器当前画布**（库与新建资产的默认画布是 `pc-16-9`）——要做手机基线用例就必须显式传 `canvasId`，或 `runCase{canvasId}`。
- `pointer` 的 `x`/`y` 必须是有限数，坐标是**当前画布像素**；命中按旋转前轴对齐矩形。
- `click{name}` 按名字取**第一个**匹配控件，且只有该控件在层级中可见、`kind` 为 `button` 或 `cursor` 时才生效；**名字写错或类型不符会静默 no-op**，不报错。用例里出现"点了没反应"时先确认控件名与类型。
- `step{dt}` 单位是秒，按 1/30 s 帧推进；代码**未强制**先 `pause`（要可复现调试仍建议先 `pause`）。
- 硬约束：每会话一个 Worker（重复 `start` 前先 `stop`）；Worker 请求默认 8 s 超时；`stop` 是唯一确定性回收方式；未 `start` 时除 `start`/`device`/`stop` 外的动作报 `play session has not started`；不要用 `step` + 全树读取当轮询。
服务端薄模拟：`serverSet{entityType,name,value}`；`entityType` 取 `Level/PlayerSelf/AvatarSelf` 或座位 `Player1–8`/`Avatar1–8`；未定义变量的 Lua Get 返回 `nil`（模拟器策略）；`serverSend{target,name,params}`，`target` 取 `PlayerSelf`/`Player1–8`/`AllPlayers`；无服务端时报 `play session has no server`。
`setServerLogic` 是**模拟器存档格式，不是官方节点图**：按信号名监听，顺序执行 `setCustomVariable` 与 `sendClientScriptSignal`，`{fromSignalParam:N}` 引用监听信号第 N 个参数（0 起）。真机要按官方节点图重建。

### 2.5 用例格式（2.0.8 实测 schema）

`qxqy-autotest` / `version: 1`，字段：`name`、`dt`（默认 1/30）、`playerCount`、`events[]`、`asserts[]`；旧 `do`/`check` 队列会在运行前规范化。

事件 kind：`pointer`（需有限 `x`/`y`；wheel 另有 `deltaX`/`deltaY`）、`key`、`click`、`pause`、`resume`、`serverSet`、`serverSend`、`view`（`playerIndex` 1–8）。

断言 kind 与必填字段：

| kind | 必填 | 说明 |
|---|---|---|
| `log` | `contains`（可选 `source:"server"`、`level`） | 默认查客户端 `print`/`printerr`；`source:"server"` 才查服务端变量/信号日志 |
| `control` | `id` 或 `name`、`field`、`equals` | 控件字段断言 |
| `var` | `entityType`、`name`、`equals` | 服务端自定义变量 |
| `signal` | `name`（可选 `direction`、`values`） | 入/出站信号 |
| `tree` | `name`、`exists` | 控件是否存在 |
| `lua` | `source`，只能用 `query.var`/`query.control`/`query.logContains`/`query.logs`/`query.serverLogContains`/`query.serverLogs`/`query.signals` | 查询脚本与玩法脚本分 state |

失败报告带 `failedAt`、帧号与现场快照；失败时先读报告，不要急着 `stop`。完整结果是 `{format,name,passed,failedAt,frame,results[],snapshot{time,frame,logs,serverLogs,server}}`。

两个容易误用的点：
- **事件 kind 里没有 `step`**：只有 `pointer`/`key`/`click`/`pause`/`resume`/`serverSet`/`serverSend`/`view`；要推进时间就靠 `dt` 与用例回放。
- **`runCase` 只接受对象**：没有"用例文件加载器"，`args.case` 必须是对象（否则报 `autotest case must be an object or step array`）。把用例存成 `tests/*.json` 是为了人读与版本管理，运行时要用文件工具读取该 JSON 再作为对象传入。
- `click` 的静默 no-op 见 [§2.4](#24-工具与动作)——**这一条只在 §2.4 写一次**，避免两处漂移。

### 2.6 patch op 与字段子集

常用 op：`select`、`pick`、`setCanvas`、`addScript`/`updateScript`/`removeScript`、`setServerLogic`、`newAsset`、`selectAsset`、`setScriptSync`、`addTemplate`、`add`、`reparent`、`moveSibling`、`remove`、`set`、`setControlGuid`、`acknowledgeControlGuidChanges`、`replace`、`renameSave`。
`set` 常用 key：`posX/posY/width/height`、`rotationZ`、`anchorType`、`anchorMinX/Y`、`anchorMaxX/Y`、`pivotX/Y`、`text`、`fontSize`、`imageId`、`enableMask`、`enableFill`、`fillType`、`fillAmount`(0–1)、按钮四状态 `unavailableChildId/hoverChildId/pressedChildId/selectedChildId`、`syncAllDevices`；颜色 `#AARRGGBB`。
**未列出的字段不要猜**：`set` 对不认识的 key 直接报错；以报错为准反推真实字段名，不要凭命名习惯试。

### 2.7 require 路径

脚本 `require` 用导入根：映射路径去掉 `.lua` → 前面加 `default_import_file/`。
映射路径 `workspace/<slug>/draws.lua` → `pcall(require, "default_import_file/workspace/<slug>/draws")`。裸路径只兼容旧存档，新脚本一律带前缀。

### 2.8 GIA 往返

导出由用户在顶栏完成：完整存档包 JSON / Authoring JSON（无损工程格式）/ 当前界面 GIA / 资产包 GIA（已改动项）/ 资产包 GIA 整合包（服务端 `UIControlGroup` 与客户端 `UIControlTemplate` 并排写入 `Root.graph`）/ 分项 Lua。
- **GIA 不保存脚本挂载关系**，也不写 scriptSync 配置；挂载关系要单列。
- 未验证语义一律以**警告**呈现，不猜字段：未知 protobuf 字段不保证往返；部分填充形状/方向、自定义羽化、非 100% 进度只存在于 Authoring JSON。
- 同级顺序：Authoring 列表是**前景优先**，原生 GIA 是**背景优先**；导出/导入各做一次反转。改顺序后用一次往返检查确认，不要凭"看起来对了"。
- 独立脚本 GIA 与整合包的挂载能力不同；导出提示逐条读并写进交付说明。

---

## 3. 存档、源码与写入生效

- 完整存档当前为 **version 4**（读取兼容 1–4 并自动迁移，冲突通过 `migrationWarnings` 报告）；资产带 `layoutSchemaVersion: 2`；只存四平台 `transformByPlatform`。
- 存档两条树表示：`root`（嵌套 `children`）是加载器真正读取的结构；`tree[]`（含 `parentId`）是派生摘要。`[实测]` 改 `tree[].parentId` 没有任何效果，改 `root.children` 才生效。定位"改不动"先确认读的是哪一份。
- `scripts[].source` 非空 ⇒ 试玩运行**内联源码**；只有它为空时才读 `path` 文件。只改磁盘 `.lua` 不同步内联源码 = 仍然跑旧代码，这是"改了没反应"的第一大原因。
- 内存修改与试玩不会自动落盘；写操作尽量带最新 `expectedRevision`（省略时按内存当前状态直接生效，可能覆盖别人的改动——只有 `script_sync configure` 与 HTTP 保存强制要求它）。收到 `revision conflict: expected N, current M` 时重新 `get`、基于新快照重算，不要盲目重试。
- **没有保存工具**，落盘只能由用户操作——完整流程见 [§2.4](#24-工具与动作)（**只在那一处写**）。
- 磁盘存档落后于会话：会话只在用户保存时回写，所以"先改文件再 load"可能被会话回写覆盖。
- 2.0.8 没有独立的"保存"op，也没有"切换当前资产"的 op（切资产用 `selectAsset`）；不要试图用未知 op 绕开。
- 手工拼的节点会因缺四平台槽位被拒；改造存档时优先深拷贝现有节点。
- 写探针/改档工具默认只报告，需显式 `--apply`；写前备份，写后**重新读盘**比对字段，不用"往返字节相等"当生效证明（整体冻结也字节相等）。
- 改插件源码后：`pnpm build` **并重启宿主**（Web/MCP/DSH）再刷新页面；只构建不会热替换运行中的进程。

---

## 4. 索引、GUID 与模板

- **服务端与客户端资产共享同一 guid 空间**：同一编号两边都存在时冲突，客户端那份会被丢弃。`[实测]` 客户端模板 2330 与服务端控件 2330 相撞，模板从未进入会话。
- `setControlGuid{id,guid}` 修改当前资产内客户端控件/模板索引，`guid` 为 1–2147483647 且不与其它控件/脚本索引重复；服务端"客户端控件容器"不能用它修改。
- **别读成"它只改索引"**：它保留内部 id、层级与挂载，**不改 Lua 源码文本**，但**会自动改写指向旧索引的模板引用字段**（`referencedPrefabId`、`itemPrefabId`、`giaRaw.templateRefSlot`）。旧索引在多个资产树里有歧义时**拒绝执行**。所以索引变更后要先确认这些引用字段的落点，再谈 Lua 侧同步——**不要以为"索引改了、引用没动"**。
- 未确认的 `controlGuidChanges` 记录会阻塞实机复制（`script-sync-apply` 在 `pendingGuidChanges > 0` 时拒绝），导出（非存档）也会警告。
- 变更记录 `controlGuidChanges` 含 `{id, controlAsset, controlId, controlName, oldGuid, newGuid}`，可能带 `batchId` 与 `scriptSignature`：同一 `batchId` 表示同时被映射的一批，必须按身份解析到**最终**索引，不能逐条盲替换数字。图片 ID、脚本映射 ID、同级顺序、与旧值同值的无关数值都不能动。
- 处理完（全部语义引用已同步，或确认无引用）才用最新 revision `acknowledgeControlGuidChanges{changeIds}`；未处理项保留。
- 模板索引 vs 运行时 `Id`：`game.InstantiateClientUIControl` 首参是模板索引；`game.GetClientUIControl` 的参数与控件 `Id` 是运行时实例 ID。
- 真机编辑器里"模板层"与"场景层"是两层：`[实测]` 真机存档模板层有手工创建的模板（含模板引用控件依赖的那个），模拟器同一层可能是空的——这解释了"模拟器里某个模板永远实例化失败"。这类问题不是脚本缺陷。
- `[实测]` 同一原型在存档里可能成对出现（一份带顶层父引用、一份不带），`itemPrefabIndex` 指向不带顶层父引用的那份；只改另一份可能不生效。
- **模拟器不可解、必须留给真机的形态**：手建模板引用链、网格视窗列表项模板、依赖列表项实例化的交互流、部分读回字段。识别到这类问题不要反复换写法硬试，记入真机清单并给出判定依据。

---

## 5. 模拟器 vs 真机差异（`[实测]`，换版本要复核）

| 项目 | 真机 | 模拟器 |
|---|---|---|
| 客户端控件树来源 | 引擎/存档（只含真实存在的控件） | 依 plan 构建，可能多出未真正存在的控件 |
| 手建模板实体 | 存在 | 可能不存在 |
| 网格视窗列表项 | 正常实例化 | 未实现 |
| 部分绝对坐标/全局颜色接口 | 可用 | 缺失（脚本会跳过） |
| 部分字段读回 | 正常 | 写入成功、读回默认值 |
| 指针 move/拖拽 | 可用 | 视版本（2.0.8 支持 move/down/up/click） |
| 多指触控 | 完整 | 单活动指针 |

判定规则：**真机有、模拟器没有 ⇒ 记为环境差异，写进真机清单；两边都没有 ⇒ 才是真实缺陷。**
树构建方式差异是系统性原因：模拟器按 plan 造树，真机只有存档里实际存在的控件。所以"模拟器说没问题"不能外推到真机，模拟器通过只能称"模拟器候选"。

---

## 6. 本平台上最容易骗到自己的几种测量

推理方法见 [P2](reasoning-patterns.md#p2--度量先验真)。以下是**在这个平台上实际发生过**的失真来源，按危害排序：

1. **探针树与存档结构不一致。** 用替代树遍历，开销会记到错误的版本上：本工程曾有"每次渲染 972→132 次引擎调用"的结论，因探针树少了每格下的子控件而被推翻。**报数之前，先把探针遍历的边界和存档真实结构逐项对齐。**
2. **结构通过当作行为证据。** 语法/nesting/引号/编码/op 覆盖全绿，不说明行为正确。
3. **测了不该测的东西。** "绿"是真的，但它可能在测已被删除的代码，或测的是旧构建产物。有打包/拷贝环节时，先确认被测文件就是刚改的那个。
4. **精度不够的分辨率。** 低精度时钟差值量不出毫秒；一次性快照看不出逐帧行为。声明的粒度必须支撑结论的强度。
5. **工具自己的输出也会错。** 相信它的数据之前，先确认探针作用域、去重键与采样时机。
6. **写后不回读。** 往返字节相等、读回校验通过，都不等于生效（见 [P5](reasoning-patterns.md#p5--读回才算写入)）。

没有真机数据时不要给毫秒级结论——那属于 `[推断]`，不是 `[实测]`。

---

## 7. 上下文与工具经济学

- 昂贵调用（`get`/`load`/`patch` 的大快照）单次 payload 可达数 MB 到十几 MB。**每轮至多一次**，并让这一次同时回答多个问题。
- 这类调用的完整输出会落到 spill 文件，返回里带路径；用 `Select-String`/grep 只取需要的几十个 token，不要把全文读进上下文。
- 优先用便宜探针（读存档片段、列名字、单点字段）替代快照，量级差约三个数量级。
- 产物路径保持 ASCII：部分解释器无法接收非 ASCII 路径参数。
- Windows 上：不要用带引号的内联 `node -e`（PowerShell 会吃掉引号），写成文件再跑；中文路径要用 `fileURLToPath`，不要用 `new URL().pathname`（会被 URL 编码导致 ENOENT）；`String.Split('123')` 按字符集切分，统计次数用 `[regex]::Matches(...).Count`；改含中文的文件用编辑工具而非 shell 管道（编码会被破坏）；注意行尾策略，避免三行改动变成数千行 diff。

### 读便宜、写昂贵——所以设计阶段该探针就探针

**探查平台能力很便宜；写存档、请用户保存、以及任何会污染交付状态的动作很贵。**

所以：不确定某个 API、字段或能力存不存在时，**不要靠猜，也不要靠"等做到那一步再说"**。做一个**单问题探针**（最小工程、只问一件事、不进生产路径），把答案记下来。

几个常见的能力缺口在模拟器基线里是已知的（音频、素材预览、网格列表项滚动、动效播放、模板引用链），见 [§2.3.1](#231-208-明确缺失的能力不要按它们设计-p0)——**在设计阶段就对照这张表**，比做到一半才发现便宜得多。

要点：**探针可以随时做，但试玩、落盘与"请用户保存"要跟着当前步骤走。** 两者不是一回事，不要把"现在不方便改存档"误当成"现在不能查证"。

---

## 8. 不可信结论清单（提醒"注释是假设"）

- 旧文档/注释里的性能收益、控件可达性、"模板不存在"等结论，可能是被后续测量推翻的版本；引用前找原始证据。
- "工具返回成功""往返字节相等""读回校验通过"都不等于生效。
- 上一轮代理的交接结论同样只是假设；恢复会话时先读实际产物与证据文件，再决定是否沿用。
