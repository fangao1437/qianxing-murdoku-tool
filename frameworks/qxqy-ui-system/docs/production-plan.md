# 制作计划与证据

## 当前步骤

**步骤 6（模拟器测试）已完成 → 等待用户保存存档后进入步骤 7（真机验证）**

用户本轮的请求是"解析 GIA 构建逻辑 + 脚本端实现基本架构，布局与内容设计留白"，属于**步骤 5 的窄范围实现**，
因此按"窄修复只回受影响步骤"处理：步骤 1/2 出最小契约与用例，**步骤 3（HTML 展示）与步骤 4（美术素材）
按用户"留白"的决定显式跳过**（没有内容设计，HTML 演示与美术参考无对象）。

| 步骤 | 状态 | 证据 |
|---|---|---|
| 1 策划案 | ✅ | `docs/gdd.md`（框架契约 = 玩法语义；含不变量与 UNKNOWN） |
| 2 TDD 用例 | ✅ | `tests/t01..t08.json`（8 个文件，7 个已实跑；`t08` 与 `t06` 覆盖跨画布与下行） |
| 3 HTML 展示 | ⏭ 跳过（用户决定） | 无内容设计可比，记录在 `docs/gdd.md` §1 |
| 4 美术参考 | ⏭ 跳过（用户决定） | 演示只用 100001/100005/100006 基础图元占位 |
| 5 Lua 实现 | ✅ | `lua/src/*.lua` + `lua/main.lua` + `qxqy-ui-system.save.json` |
| 6 模拟器测试 | ✅ | `records/playtest.md`：7/7 用例通过，双画布截图 |
| 7 真机验证 | ⏳ 待存档落盘 | `docs/device-handoff.md` |

## 知识来源（本轮实际使用的）

| 来源 | 工具/路径 | 版本/日期 | 用途 | 读取结果 |
|---|---|---|---|---|
| 官方客户端语料（10 篇） | `list_client_documents` / `get_client_document` | 抓取 2026-09-25 | 控件/API/生命周期/输入/桥 | ✅ 已核验 8 篇，落成 `docs/api-notes.md`（20 条"未查到"待探针） |
| 模拟器插件 | `dsh-plugin-beyond-simulator` | **2.0.8** | 存档/GIA/试玩工具语义 | ✅ 会话工具可用；GIA schema 与 `br/wa` 槽位表从其 bundle 提取 |
| 既有工程（真机验证过的实现） | `qianxing-murdoku` @ `525207d` | — | 适配层契约、真机坑、gil 工具链 | ✅ 落成 `docs/repo-survey.md` |
| 教程 GIA | `qianxing-murdoku/assets/教程UI系统_翻页单击活动样式.gia` | gameVersion 6.7.0 | 角色构成 | ✅ 自建解码器解析，落成 `docs/gia-structure.md` |
| 姊妹仓 | `murdoku-project` @ `6c4987d` / `murdoku-pro` @ `08a6a99` | — | 只提供交班/规格，无生产代码 | ✅ 已确认同源、无 lua 生产树 |

**未取得 / 留待验证**：真机 `AddKeyEventListener` 是否支持容器节点；四态按钮真机表现；UI 字符串与控件数量上限。
（`docs/api-notes.md` §未查到 20 条，逐条列入 `docs/device-handoff.md` 核验清单。）

## 本轮实测新增的平台事实（可回写 platform-facts）

| 结论 | 标签 | 来源 | 复核方式 |
|---|---|---|---|
| 运行时控件是 **userdata**（`Control: 0x1ef`），`type(x)=="table"` 判据会把真控件判成非法 | `[实测]` | 探针 `PROBE` 日志 | 重跑探针脚本 |
| 控件 `name` 可读、`visible` 可读；**`id` 字段读取会报错** | `[实测]` | 同上 | 同上 |
| `GetClientUIRoots()` 在 OnInit 就能返回非空数组，但**此时 `GetChildren()` 已可用**（早前误判为"未接好"实为判据 bug） | `[实测]` | 修正后的 `DISCOVER screens=1 …` | 重跑 t01 |
| `addScript/updateScript` 的 `controlId` 用**内部 id**（如 `n40`），可挂到容器节点上 | `[实测]` | patch 返回 `mounted:true` | 重跑试玩 |
| 存档 `scripts[].source` 留空 ⇒ 运行时读 `path` 文件（路径模式），改磁盘后重开试玩即生效 | `[实测]` | 本轮迭代全程 | 改一行再跑 |
| `qxqy_studio_load` **合并**脚本注册表（不替换）；沿用旧脚本 id 会出现多实例同时运行 | `[实测]` | 日志出现 3 份 `LIFECYCLE` | 观察 `removeScript` 后恢复单份 |
| **再次 `load` 同一份存档会多出脚本实例**：incoming 脚本 id 与内存里已有的相同 ⇒ 分配一个新 id（1073742201）再挂同样控件 ⇒ 两份同时跑 | `[实测]` | 第二次 load 后 `scripts` 变成 2 条 | `removeScript` 掉新 id 后恢复 1 条；后续导入前先确认脚本列表长度 |
| `load` 会丢弃 `serverLogic.rules`（存档里写了也变空） | `[实测]` | 载入后 `rules: []` | 用 `setServerLogic` 推一次再看 |
| `AddKeyEventListener` 传**字符串键名**（`"Right"`）在模拟器 PC 画布可用；容器节点上也能绑 | `[实测]` | `KEY_BIND ctrl=app.root n=5 …@string` + `ACT next<- key` | 重跑 t06 |
| 页/屏显隐用 `SetVisible` 生效，`control` 断言的 `visible`/`text` 字段可读 | `[实测]` | t01–t08 | 重跑用例 |

## 阻塞项

1. ~~存档落盘需要用户操作~~ → **已解决**：用户已保存，磁盘文件复核通过（1 条脚本映射 id=1073742200、`source` 为空=
   路径模式、`controlId=n40 app.root`、`serverLogic.rules=1`、41 个控件）。
2. 真机链路（步骤 7）必须等 GIA/脚本导入；导入后注意"多出脚本实例"的坑（见上表）。

## 本轮追加决策（用户提问驱动）

**教程 UI 不新建脚本映射，并入主脚本**（`docs/adr-001-single-script.md`）。
理由：跨脚本只能 `script:Invoke`（依赖会重映射的 scriptMappingId）或服务端信号（≥100ms），
教程↔关卡的实时联动会被迫异步；同一次按键的"认领"跨脚本无法在一处裁决；
索引/恢复/交付全部翻倍。已落地：`tools/build_bundle.mjs --mode module` → `lua/module.lua`（只暴露 `Tutorial`），
`App.config.keys_enabled` 默认 true、并入时置 false 由主脚本裁决按键。

## 下一步

1. 用户保存存档 → 我复核磁盘文件与内存一致（比对 `scripts[].id/source`、`serverLogic`）。
2. 交付真机导入说明（`docs/device-handoff.md`）：建映射、挂 `app.root`、按真实索引校准、
   用 `setServerLogic`/节点图补 `ui/nav → 变量 + ui/sync`。
3. 真机核验清单逐条打勾，回收结果后关闭 UNKNOWN。
