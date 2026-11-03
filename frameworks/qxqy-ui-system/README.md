# qxqy-ui-system · 千星「翻页单击活动」UI 框架（架构骨架）

按官方教程资产 `教程UI系统_翻页单击活动样式.gia` 的**角色构成**，在客户端 Lua 侧实现的一套
多屏多页、点击驱动的活动界面骨架。**布局与内容设计按需求留白**，框架只负责
「屏 / 页 / 输入 / 状态 / 服务端桥」这几件事。

## 一分钟看懂

```
app.root                ← 脚本挂在整屏根容器上
└ screen.demo           ← 一个界面
   ├ btn.close          ← 关闭
   ├ hud.title          ← 标题
   ├ hud.pager          ← 页码 "1 / 3"
   ├ tab.p1/p2/p3       ← 页签（点它跳到同名页；子件 state.sel/state.off 表示选中）
   ├ btn.prev / next    ← 左右翻页
   ├ btn.reset          ← 重置当前页
   └ page.p1/p2/p3      ← 页（同一时刻只有一页可见）
```

框架**按名字发现**这些控件（`App.config` 里是一张名字表），所以：
在编辑器里按上表命名并摆好，脚本自动接管；摆不全也不会崩，`APP_DIAG` 会点名缺谁。

## 快速开始

```bash
# 1) 改代码（只改 src，不要改 main.lua / module.lua）
#    lua/src/00_util.lua … 91_api.lua

# 2) 重新打包（两种形态，产物不同）
node tools/build_bundle.mjs --mode standalone   # → lua/main.lua   （整份挂到 app.root）
node tools/build_bundle.mjs --mode module       # → lua/module.lua （并入关卡主脚本）
#    （追加 --check 只校验是否最新）

# 3) 语法检查（本机有 lua/luac 时）
luac -p lua/main.lua

# 4) 在模拟器里重开试玩即可生效（存档用路径模式，读 lua/main.lua）
```

### 要不要给教程单独建脚本映射？

**不要，并入主脚本**。教程要读关卡状态、要和关卡抢 Esc、要跟着传送恢复；
拆两个脚本就变成「跨脚本 invoke（映射 id 会重映射）/ 信号（≥100ms）」+ 双份索引与输入监听。
判定条件与完整理由见 [ADR-001](docs/adr-001-single-script.md)。

并入写法（`lua/module.lua` 粘到主脚本顶部）：

```lua
local T = Tutorial.install({ root_name = "tutorial.root", keys_enabled = false, log_prefix = "[tutorial]" })
function OnStart() T.OnStart() end
function OnUpdate(dt) T.OnUpdate(dt) end   -- 主脚本自己分派 dt
T.act("close") / T.show("p2") / T.hide() / T.state() / T.diag()
```

生成/重建存档（改了控件树才需要）：

```bash
node tools/gen_save.mjs              # 以 records/proto-project.json 为原型生成
# 然后在模拟器里【导入】workspace/qxqy-ui-system/qxqy-ui-system.save.json
```

## 目录

| 路径 | 内容 |
|---|---|
| `lua/src/` | 10 个模块：`Util / Engine / Bind / State / Screen / Pager / Input / App / Entry / Tutorial` |
| `lua/main.lua` | standalone 产物（单文件），挂到 `app.root` |
| `lua/module.lua` | module 产物（单文件），只暴露 `Tutorial`，并入主脚本用 |
| `qxqy-ui-system.save.json` | 模拟器完整存档（41 控件 + 1 脚本映射） |
| `tests/t0*.json` | 7 个 qxqy-autotest 用例（翻页/页签/钳制/关闭/键盘/PC 画布/下行校正） |
| `tools/` | `build_bundle`（双模式） `gen_save` + GIA 解析工具链 |
| `docs/` | [策划案](docs/gdd.md) · [技术架构](docs/tech-architecture.md) · [**ADR-001 单脚本决策**](docs/adr-001-single-script.md) · [GIA 解析](docs/gia-structure.md) · [官方 API 笔记](docs/api-notes.md) · [三仓调研](docs/repo-survey.md) · [制作计划](docs/production-plan.md) · [真机交接](docs/device-handoff.md) |
| `records/` | GIA 解析产物、原型快照、[试玩记录](records/playtest.md) |

## 当前状态

- ✅ 模拟器候选：7/7 用例通过（mobile-16-9 与 pc-16-9 双画布），截图见 `records/playtest.md`
- ⏳ 真机未验证：脚本导入/挂载、键盘、四态、联机、传送恢复 —— 见 [真机交接](docs/device-handoff.md)
- 🧩 布局/内容/美术**留白**：演示页只有占位文案与基础图元（100001/100005/100006）

## 关键约束（改之前先读）

1. **控件是 userdata**，不是 table；判断"是不是控件"用 `Engine.is_ctrl()`。
2. `active` 默认 false 且只读 ⇒ 显隐必须 `SetActive/SetVisible`；屏根/页根要显式激活。
3. 容器不能靠"隐藏"来切页（隐藏会销毁其内客户端控件）；切屏只关 `visible`。
4. 只有预设按钮 / 光标检测区域能收点击；容器 `showCursor` 必须为真（存档里已置真）。
5. 客户端**不能写**自定义变量 ⇒ 翻页只发信号，变量由服务端写。
6. 单一可见性权威：屏 = `Screen.apply()`，页 = `Pager.apply()`，选中态 = `State`。别在别处再写一遍。
