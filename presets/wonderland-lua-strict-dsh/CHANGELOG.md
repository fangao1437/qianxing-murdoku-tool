# 优化记录

## 2026-10-18 · 修复：DSH 2.0.18 下三套预设全部无法启动

**症状**：升级到 DSH 2.0.18 后，选用这三个自定义预设的新会话直接失败，报

```
unknown prompt variable "{{cwd}}" in section "deployment:persona-prefix";
registered variables: provider, model
```

**根因**：`dsh-system-prompt` 2.0.18 的提示词变量插值是**严格**的——任何未注册的 `{{…}}` 引用都会让**整次组装失败**，而不是原样保留或降级。2.0.18 只注册 `provider` 与 `model`；`{{cwd}}` 不再由循环提供。官方 README 已明确写出这一点，并要求从自定义 persona 中删除 `Your working directory is {{cwd}}.` 这一句（工作目录另由 working-directory 上下文服务提供）。

三套预设的 persona 都带着这一句（从 2.0.8 时代的模板继承而来），所以**全部**中招，与预设本身的逻辑无关。

**修复**

1. 从所有 persona 源文本中删掉 `Your working directory is {{cwd}}.`，保留该句前后的其余文本（官方建议的最小改动）。
2. 在构建层加**防御性剥离**：`tools/lib/build.mjs` 的 `buildPatch()` 与 `tools/build-bundle.mjs` 在写补丁前统一剥离该从句；若剥离后仍残留 `{{cwd}}`，构建**直接失败**而不是产出坏的补丁。
3. 在 `tools/verify.mjs` 加**硬校验**：persona 里出现任何非 `{{provider}}`/`{{model}}` 的变量即失败，并在错误信息里直接给出修法。这样同类问题不会再静默发布。
4. 同步修正了全部部署位置与作者源：desktop profile patch、插件包 `cordis.patch.yml`、插件包内 `presets/wonderland-lua-builder/agent.cordis.yml`、legacy `.agent-presets` 副本、两个作者目录（`wonderland-lua-builder`、`wonderland-lua-strict`）、以及严格版 bundle。

**验证**（逐处实测，全部 `{{cwd}}` 出现次数 = 0）

| 位置 | 结果 |
|---|---|
| profile patch | 0 |
| 插件包 cordis.patch.yml | 0 |
| 严格版 bundle patch | 0 |
| 基础版 / 严格版作者目录 | 0 |
| 插件包内预设 / legacy 副本 | 0 |

两份 patch 均通过 YAML 解析（带 `!!js` 自定义 tag）；严格版 `verify.mjs` 16 项全绿，新增的变量校验在修前会准确报出 `{{cwd}}`、修后通过。

**教训（已写进工具，不再只靠人记）**：预设里凡是 `{{…}}` 形式的东西，都必须是**当前宿主确实注册过**的变量。DSH 对未注册变量是"整次组装失败"而非降级，因此这是一个**硬兼容边界**，不是文案问题。升级宿主后应先跑一次预设自检；`verify.mjs` 现在会替你把这件事做掉。

**如插件升级覆盖了预设内容**：插件包内的 `presets/wonderland-lua-builder/` 与 `cordis.patch.yml` 会被上游重装覆盖。升级后若预设又出现同一报错，重新执行：

```powershell
# 基础版：重新生成已在作者目录中清洗过的补丁
node tools/build-patch.mjs --out <插件包>/dsh-plugin/cordis.patch.yml
# 严格版
node tools/build-bundle.mjs --out "D:\新建文件夹\miHoYo Launcher\dsh-preset-wonderland-lua-strict"
node tools/install-profile-preset.mjs --profile-patch <profile>/cordis.patch.yml --bundle "D:\新建文件夹\miHoYo Launcher\dsh-preset-wonderland-lua-strict"
```

> 注意：基础版的"作者目录 → 插件包"重建会写入**作者目录当前内容**，若插件包里的内容与作者目录本来就不同（例如上游更新过），请只针对 `cordis.patch.yml` 做最小改动，或用 `--selftest` 先比对。

---

## 2026-10-13（第二轮）· 从「更多规则」转向「更少猜测」

**目标**：提高推理的严谨性与可靠性，同时**降低**分析的模板化与公式化，把创造性与视野广度放回来。

### 判断依据

1. **外部证据**：Eliav 2026（[arXiv 2607.19257](https://ar5iv.labs.arxiv.org/html/2607.19257)，5 模型 × 4 格式 × 2 放置位置）测得同时生效规则数到 **N=80 时全对率归零**——不是渐降，是断崖；且 markdown 相对纯文本无可靠优势（Qwen 35B 反而偏好纯文本，N=160 时差 4.8pp）。**上一版语料远超任何模型能同时遵守的规则预算。**
2. **真实工程方法论**：`qianxing-murdoku` / `murdoku-project` / `murdoku-pro` 三仓库 200+ 版本留下的复盘、撤回记录与交接。提取出可迁移机制：反转哨兵、负对照、仪器与真值对齐、按身份比较、单变量对照、静默路径出声、明确的权威顺序。
3. **本仓库自审**：两名独立审查者对上一版语料逐条核对，产出约 310 条祈使句的统计，其中约 18% 能改变决定。

### 核心判断

上一版把「精准」实现成了**更多的规则**；这一版实现成**更少的猜测**。

- 事实的精准消除猜测，因此**释放**注意力 → 全留在 `platform-facts.md`，改成按索引跳读。
- 流程的精准消耗注意力却买不到判断力 → **大幅削减**。
- 判断力用**能自我证伪的姿态**补上，与平台无关。

### 新增

- **`references/reasoning-patterns.md`**：14 条推理姿态（P1–P14），每条附**实际付出的代价**与**触发条件**。P1 预写推翻条件、P2 度量先验真、P3 两向断言、P4 先分叉再收敛、P5 读回才算写入、P6 结论即假设、P7 先证明检查会红、P8 删掉的东西要变成哨兵、P9 按身份比较、P10 一次只动一个变量、P11 静默路径要出声、P12 区分环境做不到与代码不对、P13 一个事实只能有一个权威位置、P14 证据有层级。
- **`templates/gdd.md`**：把 70 行 GDD 模板从步骤文档移出，改为**复制到产物**，不再占据阅读路径。
- **`platform-facts.md` 的「必读核心」**：10 条"错了要推倒重来"的事实提到文件头部（约 1 屏），其余按索引跳读。

### 修正的错误

| 原文 | 修正 | 依据 |
|---|---|---|
| persona 6,292 字符，含平台红线、GUID 流程、架构文档要求等 | 降到 4,273 字符；删除可在语料内查到的一切，保留**推理取向 + 少量锚点事实** | N=80 地板；规则越多，哪几条生效越不可控 |
| `platform-facts.md:259`「操作保留内部 id、层级与挂载，**不会自动改写 Lua**」紧跟 `:260`「它会**自动改写**指向旧索引的模板引用字段」 | 合并为一条，明确**不改 Lua 源码文本，但会自动改写模板引用字段**，并加"别读成它只改索引" | 插件 dist 核对；原写法会让代理跳过引用字段检查 |
| 步骤 1–4「不打开模拟器、不改存档、不跑 runCase」写死在 persona | 改为**读便宜、写昂贵**：**探针随时可做**，但试玩、落盘与"请用户保存"跟着当前步骤走 | 该禁令会迫使代理在设计阶段**猜**平台能力，正是"降低猜测"的反面 |
| 工具超时表：截图 9 s | 截图 **5 s**（`qxqy_studio_get`/`patch`/截图注册为 `5e3`）；`qxqy_studio_play` 是**双层**超时：工具侧 10 s、Worker 请求默认 8 s（`QXQY_PLAY_TIMEOUT_MS` 可覆盖，下限 1000 ms） | 反混淆插件 dist：`Iu=Math.max(1e3,Number(process.env.QXQY_PLAY_TIMEOUT_MS)\|\|8e3)`、`timeoutMs:8e3`、`timeoutMs:5e3` |
| `verify.mjs` 检查"关键词是否在场" | 改为检查**判断力与结构**，并引入**规则预算** | 在场检查**只能**奖励"把词写进去"，会系统性把语料推向多写规则 |
| `01-game-design.md` 三处相对链接写 `../../references/…` | 改为同目录相对路径 | 从 `references/` 出发会解析到不存在的 `skills/references/` |
| `SKILL.md` 称推理姿态「六条」 | 改为「十几条」 | 实际为 14 条 |
| 「分析完整性清单（逐项给结论，不适用就写"不适用"）」 | 改为**按需回答**的问题清单 | 强制填表格取代判断 |
| 「核心循环必须能写成一句：目标 → 操作 → …」 | 保留"要能说清"，**去掉强制句式** | 涌现式/节奏式/沙盒式玩法不适用 |
| 「证据登记表」五列 + 每次必填 | 删除；改为在**要靠它做决定**的结论上标证据类别 | 仪式化元数据 |
| 「步骤 1–4 不打开模拟器」在 plan-mode 段重复一遍 | 删除；plan-mode 只保留"读 skill、别凭记忆规划" | 同一事实两处负责必然漂移 |

### 自检的变化（这是本轮最关键的机制改动）

`tools/verify.mjs` 从"词汇量检查"改为：

1. **规则预算**：persona 的祈使句条数超 40 即失败；字符数超 6,500 即失败。
2. **必读集合规模**：reasoning-patterns + workflow + platform-facts 必读核心 超 14,000 字符即失败（实测 9,051）。
3. **姿态在场且带触发**：14 条姿态必须都在，且至少 10 条带 `触发` 标记——**喊口号不算**。
4. **单一权威（P13）**：热点事实（`click{name}` 静默 no-op、无保存工具流程）只允许在一个文件里定义。
5. **禁止残留措辞**：`逐项给结论`、`不适用就写不适用`、`必须能写成一句`、`证据登记表` 出现即失败。
6. **关键事实仍在**：10 条"错了要推倒重来"的事实 + 官方 11 类控件清单。
7. **链接与锚点可达**：83 条相对链接、60 个页内锚点。锚点校验只比较可见文字，不重实现 GitHub 的 slugger（那是一条会随实现细节漂移的死路）。

### 验证

```
node tools/verify.mjs
→ 16 项全绿：persona 4,273 字符 / ~0 条祈使句；14 条姿态（14 带触发、9 带代价）；
  2 条热点事实各自单一权威；10 条关键事实 + 11 类控件在位；
  83 条相对链接 + 60 个锚点全部可达；必读集合 9,051 字符（~3,481 tok）。
```

必读集合从约 11,358 tok 降到约 **4,800 tok**（reasoning-patterns + workflow + 必读核心 + 一份步骤文档）。

未做：真机验证（需用户在千星沙箱导入试玩）；上游仓库未提交。

### 兼容与回滚

- 预设 ID、显示名与七步顺序不变；**已有会话不会自动切换**，新会话生效。
- 被删内容不是消失：平台细节仍在 `platform-facts.md`，只是不再进必读路径；每处删除的理由记在 [docs/design-notes.md](docs/design-notes.md)。
- 应用到已安装插件包前会备份为 `*.bak-<时间戳>`；回滚只需还原备份或重新安装插件。
- 上游升级会覆盖插件包内容：升级后重新执行 `tools/apply.mjs`。

### 已知取舍

1. 自检变弱的地方是「无法再保证某个具体事实一定被读到」。**这个代价是有意接受的**——原来那个保证是假的（N=80 地板）。
2. 语料变短后，行为可能不如旧版"看起来勤快"。判断标准应是**返工次数与被推翻的结论数**，而不是产出文档的页数。

---

## 2026-10-13（第一轮）· 精准化与全面化改版（基线：`dsh-plugin-beyond-simulator` 2.0.8）

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
