# 优化记录

## 2026-10-13 · 精准化与全面化改版（基线：`dsh-plugin-beyond-simulator` 2.0.8）

**目标**：让七步中每一步的处理更精准、分析更全面——把"能查到的事实"写进文档，把"曾经踩过的坑"变成规则，把"看起来对但错"的结论标注出来。

**判断依据**：①官方客户端 10 篇语料逐条核验（控件类型、事件、变量/信号、字体、坐标）；②本机模拟器 2.0.8 的工具 schema 与 `skill.md`；③上游仓库 `studio/docs/*` 与插件文档；④真实工程 40+ 轮模拟器/真机工作留下的实测结论与撤回记录（`qianxing-murdoku`、`murdoku-project`）。

### 新增

- **`skills/qxqy-game-studio/references/platform-facts.md`（核心新增）**：跨步骤共用的平台事实与已知边界。含官方 11 类控件与动态创建限制、事件模型、变量只读/信号双向、字体与坐标两种基准、模拟器工具与动作语义、用例 schema（含每种断言的必填字段）、patch op 与 `set` 字段子集、`require` 前缀、存档权威结构、索引/GUID/模板规则、模拟器 vs 真机差异表与两侧判定规则、证据与度量纪律、上下文经济学、不可信结论清单。每条都带来源标注与版本基线。
- **步骤门（进入/退出证据）表**：`workflow.md` 与 `SKILL.md` 中每一步都有明确退出证据，缺证据不能算完成。
- **证据登记表**格式与五种标签（`[官方]`/`[模拟器]`/`[实测]`/`[推断]`/`[未验证]`）。
- **评测 E15–E23**：覆盖存档结构权威性、探针保真与度量诚实、模拟器/真机差异判定、上下文经济学、写入生效与内联源码、平台事实红线、结论复核、真机同步证据、步骤门。
- **`tools/build-patch.mjs` / `apply.mjs` / `verify.mjs`**：把上游构建所做的"由 `agent.cordis.yml` 生成 `cordis.patch.yml`"本地化并可自检，便于应用到已安装插件或向上游提交。

### 修正的错误或不精确事实

| 原文 | 修正 | 依据 |
|---|---|---|
| 控件类型写成 `container/image/text/button/progress` | 官方 11 类：容器节点、文本框、文本视窗、图片、预设按钮、按键提示、光标检测区域、网格视窗、模板引用控件、界面动效、全屏动效；**没有 progress** | 《客户端控件和客户端脚本》《客户端控件API文档》§12(1) |
| "布局使用父矩形、锚点和偏移" | 官方：无父级以画布左下为原点，**有父级时 `GetAnchoredPosition` 是相对父层级中心的偏移**；模拟器布局面用的是锚点相对父矩形 0–1——两套基准要分开说 | 《客户端控件API文档》§13(3) |
| 未提长按、变量写入、实例化限制 | 补：**没有长按事件**（Down/Up + `dt` 自实现）；**Lua 不能写自定义变量**；**只有存为模板控件的父节点可被 `InstantiateClientUIControl` 创建**；`game.*` 点号调用与参数个数 | 同上 §6/§17/§18、控件总纲八.1 |
| "模拟器只预览 100001–100006，其他显示缺失框"（未标版本、易被读成素材不可用） | 标为**版本相关**：2.0.8 确实如此且无素材下载链路；缺失框是预览限制、不是素材不可用；**关键可读性必须配模拟器替代方案**，真机核验图是否正确 | 插件 2.0.8 构建产物核对 + 上游 image-assets 文档 |
| 未提音频 | 补：2.0.8 无音频播放链路，音效不是可验证反馈通道 | 上游 audio-assets 文档 + 2.0.8 产物核对 |
| 未提索引批量工具 | 补：2.0.8 **没有** `previewControlGuidSync`/`syncControlGuidReferences`/`autoFillClientGuids`，索引修复只能按语义手工做 | 2.0.8 patch op 清单 |
| 用例示例只有 `log`/`tree` 两种断言 | 补完整断言 kind 与**必填字段**表（`log.contains`、`control.field`+`equals`、`var.entityType`+`name`+`equals`、`signal.name`、`tree.name`+`exists`、`lua.source`），并加分事件 kind | 2.0.8 autotest schema |
| "改存档/试玩"缺结构权威与生效证明 | 补：`root.children` 权威、`tree[].parentId` 无效；非空 `scripts[].source` 优先；写后**读盘字段 diff**；存档 version 4 / `layoutSchemaVersion: 2` | 真实工程实测与撤回记录 + 上游文档 |
| 真机同步"复制成功即可" | 补：复制成功 ≠ 编辑器加载 ≠ 真机通过；要求哈希/字节一致、构建标记行、每轮试玩前重新同步；并列出会拒绝复制的情形（计划过期、未确认的 `controlGuidChanges`、路径穿越等）与备份位置 | 上游 script-sync 文档 + 真机交接实测 |
| 无度量纪律 | 补：探针树必须与存档结构对齐（曾据此得出错误性能结论）；结构通过≠行为证据；测试要确认加载了新产物；不给无真机数据的毫秒结论 | 真实工程审计与撤回记录 |
| 无成本约束 | 补：每轮至多一次昂贵快照调用；大输出走 spill 文件 grep；产物路径 ASCII；Windows 引号/编码/行尾陷阱 | 真实工程 40 轮工具经验 |

### 按已安装 2.0.8 代码复核后的追加修正

写完后对照已安装插件的 `dist/index.js` / `dist/worker.js` 逐条核对，又修正了一批"文档说得好、代码不是这样"的点：

| 原文/默认理解 | 修正 | 依据 |
|---|---|---|
| 步骤 5/7 写"改完显式保存完整存档" | Harness 工具集**没有保存工具**：落盘只能由用户在"模拟器"标签点【保存存档】；实机复制还要求存档已保存且之后未再改动 | 2.0.8 只注册 7 个工具；HTTP `save` + `assertSavedArchive` |
| "数据写操作必须带 `expectedRevision`" | 代码只在**提供时**校验；只有 `script_sync configure` 与 HTTP 保存强制要求。省略＝按内存现状直接生效（可能覆盖别人的改动） | dist 校验分支 |
| "必须先 pause 才能 step" | 代码未强制；只要求已 start | worker `playStep` |
| "稳定控件优先 `click`"（未说限制） | `click{name}` 取第一个同名控件，且仅 `button`/`cursor` 类型生效；**名字写错静默 no-op** | worker click 分支 |
| 用例"独立保存到 tests/"（未说运行方式） | **没有用例文件加载器**：`runCase` 的 `args.case` 必须是对象；文件供人读，运行前用文件工具读出再传 | autotest normalizer |
| 未提画布默认值 | 不带 `canvasId` 的 `start` 跟随编辑器当前画布（默认 `pc-16-9`）⇒ 手机基线用例必须显式传 `canvasId` | 画布表 + start 逻辑 |
| 未提 `setControlGuid` 副作用 | 它会自动改写 `referencedPrefabId`/`itemPrefabId`/`giaRaw.templateRefSlot`，旧索引有歧义时拒绝执行；未确认的变更记录会**阻塞实机复制** | dist `setControlGuid` / `script-sync-apply` |
| 同步备份路径写成 `<batchId>` | 实际为 `<workspace>/.qxqy-script-sync-backups/<planId>/` | script-sync apply |
| 只说"不要用 `miliastra-knowledge`"（没说用哪个） | 明确 2D 路线：`miliastra-knowledge-lua` Skill + `list_client_documents`/`get_client_document`；`rag_search` 只覆盖服务端语料；不存在名为 "miliastra-toolbox" 的工具 | 工具箱插件源码 |
| 未提模拟器图元形状 | 100001 矩形 / 100002 圆形 / 100003 三角形 / 100004 四角星 / 100005 五角星 / 100006 圆环——可直接当步骤 4 的模拟器替代素材 | dist 图元表 |
| MCP 工具被当作可用 | 本 profile **未安装** MCP 工具包：`qxqy_project_*`、`qxqy_preview_*` 与 `handle` 在此不可用，已标注为 MCP 宿主专用 | profile 依赖清单 + dist 字符串核对 |

附带发现：插件自带的 `skill.md` 有一处过期描述（工具速查里写 `play_screenshot` 按 `paint` 渲染，实际按 Runtime `scene` 树渲染）。这正好是"文档也会过期"的实例，已按代码事实写入 platform-facts，并保留"结论即假设"的规则。

### 结构变化

- `SKILL.md`：改为"先 workflow + platform-facts，再只读当前步骤"，并给出每步进入/退出证据与 9 条全局硬规则。
- `workflow.md`：PREFLIGHT 增加"记录插件版本""登记平台事实"；知识库核验补"三层状态"；新增证据登记表、步骤门表、平台能力缺口的回退分支。
- 步骤文档：01 增加"分析完整性清单"与平台可用性预检；02 增加追踪表、双向断言与用例反模式；03 增加观察清单与状态命名对齐；04 增加三层支持度、`fallback`/`deviceCheck` 字段与成本控制；05 增加实现规则表（时间/调用/图片/文本/输入/服务端/require/规模）与生效证明；06 增加精确工具配方、五层证据与发布候选检查；07 增加交付清单格式、索引校准、同步失败模式与"同步是否真的生效"三件事。
- `agent.cordis.yml`：persona 重写（读取协议、步骤门、平台红线、证据纪律），plan-mode 段补"每步进入/退出证据与回退点、依赖的平台事实"。

### 验证

已实际执行并记录结果：

1. **变换等价性**：`node tools/build-patch.mjs --source <.agent-presets 原始目录> --selftest <已安装 cordis.patch.yml>` → `selftest: identical to the installed patch`（18292 字节逐字节一致）。证明 `tools/lib/build.mjs` 的变换与上游 `pnpm build` 产物等价。
2. **结构自检**：`node tools/verify.mjs` → 全部通过（16 行插件配置、persona 6212 字符、补丁 YAML 可解析且 persona 文本与源文件一致、10 份步骤文档非空壳、13 个 Markdown 文件 61 条相对链接全部可达、官方 11 类控件清单与 `progress` 缺失说明在位）。
3. **技能路径可解析**：`node tools/check-skill-path.mjs` → 在两种候选 `baseUrl` 语义下 `customSkillDirs` 都解析到 `<插件包>/dsh-plugin/presets/wonderland-lua-builder/skills`，`qxqy-game-studio/SKILL.md` 存在。
4. **应用与完整性**：`node tools/apply.mjs --target <desktop profile 的插件包>` → 14 个文件写入，`missing=0 extra=0`；应用后 `cordis.patch.yml` 与生成物哈希一致，`skills/` + `evals/` 共 11 个文件与源目录**逐字节一致**；原文件与目录已备份为 `*.bak-<时间戳>`。

未做：真机验证（需要用户在千星沙箱导入并试玩）；`web` profile 仍是 2.0.2（未改动）；上游仓库未提交（本目录即上游 `agent/wonderland-lua-builder/` 的可提交版本）。

### 兼容与回滚

- 预设 ID、显示名、工具集与原有工作流顺序不变；已有会话不会自动切换预设。
- 应用到已安装插件包前会备份为 `*.bak-<时间戳>`；回滚只需还原备份目录/文件，或重新安装插件。
- 上游升级会覆盖插件包内容：升级后重新执行 `tools/apply.mjs`，或把本目录内容提交到上游 `agent/wonderland-lua-builder/` 后重新构建。
