# 2. TDD 制定测试用例

## 输入与适用时机

读 GDD 中的 `CONTRACT`、状态机、不变量与目标画布。新游戏在 HTML 展示与生产 Lua 之前制定用例；已有缺陷只补相关回归用例。本步骤只做静态检查，不启动模拟器、不改存档、不跑 `runCase`。

## 执行动作

### 1. 建追踪表

`需求 → 规则/不变量 → 模拟器场景 → 用例 → oracle → 证据层`

| 需求 | 规则/INV | 场景 | 用例文件 | oracle | 证据层 |
|---|---|---|---|---|---|
| 点击目标加分 | INV-1 每次有效点击 +1 | 开局点一次 | `first-success.json` | 分数控件文本 + `score 1` 日志 | L2 + L3 |

规则要覆盖：状态、胜负、计分、冷却、碰撞边界、暂停/重开、稳定输入语义、服务端变量与信号、已复现缺陷。

### 2. 用例设计规则

- **确定性**：运动、冷却、计时显式消费 `dt`；随机玩法由配置、变量或首事件注入可复现 seed/序列。
- **独立性**：每个用例独立启动；切画布是新生命周期（时间归零、历史重置），用例不跨画布或跨状态串联。
- **oracle 优先级**：①玩家可见控件/状态 ②稳定领域事件 ③`query.*` 诊断。测试不得复制生产算法（否则实现错了测试也会跟着错）。
- **双向断言**：每个状态变化同时断言"该发生的发生了"和"不该发生的没发生"（加分/不加分、可点/不可点、隐藏/显示）。
- **稳定日志**：使用领域事件，如 `game_start`、`score <n>`、`fail <reason>`、`restart`。
- **覆盖顺序**：高风险、高频、最近缺陷、复杂状态转换优先，而不是追求百分比。
- `HYPOTHESIS` 关联体验检查（人工/试玩）；`CONTRACT` 关联可观察断言；`UNKNOWN` 关联资料、探针或真机验证。视觉、手感与真机项目另列人工检查。

### 3. 用例格式（`qxqy-autotest` / `version: 1`）

不要自创 schema。每个用例单独存到 `workspace/<slug>/tests/`，字段与断言 kind 见 [平台事实 §2.5](platform-facts.md#25-用例格式208-实测-schema)。

```json
{
  "format": "qxqy-autotest",
  "version": 1,
  "name": "first-success",
  "dt": 0.03333333333333333,
  "events": [
    { "kind": "click", "name": "StartButton" },
    { "kind": "click", "name": "Target" }
  ],
  "asserts": [
    { "kind": "control", "name": "ScoreText", "field": "text", "equals": "1" },
    { "kind": "log", "contains": "score 1" },
    { "kind": "tree", "name": "ResultPanel", "exists": false }
  ]
}
```

要点：
- 断言必填字段必须齐全（`log.contains`、`control.field` + `equals`、`var.entityType` + `name` + `equals`、`tree.name` + `exists`、`lua.source`）。缺字段的用例在运行期才会失败，等于浪费一轮。
- 事件 kind 只有 `pointer`/`key`/`click`/`pause`/`resume`/`serverSet`/`serverSend`/`view`（**没有 `step`**）；`pointer` 需要有限 `x`/`y`，坐标是当前画布像素。
- **稳定控件优先 `click`（按控件名）**，只有坐标本身是规则时才用 `pointer`。注意 `click` 只在控件为按钮/光标类型时生效、名字写错会静默 no-op——用例"绿"但实际没点时，先查控件名与类型。
- 文件存放与运行方式不同：用例存 `tests/*.json` 供人读与版本管理，但 `runCase` **只接受对象**，要用文件工具读出 JSON 后再作为 `args.case` 传入。
- 需要服务端参与时，用 `serverSet`/`serverSend` 构造前置，用 `var`/`signal` 断言结果。
- `mobile-smoke` 必须显式 `runCase{canvasId:"mobile-16-9"}`，不与 PC 串联（不带 `canvasId` 会跟随编辑器当前画布，默认 `pc-16-9`）。

### 4. 最小覆盖

P0 基线：`boot`、`first-success`、`first-fail`、`restart`、`mobile-smoke`（最短成功路径 + 整屏可见 + 不崩溃 + 关键状态）。
按玩法扩展边界：`edge-contact`（边界碰撞）、`input-spam`（连点/连触）、`pause-resume`、`restart-twice`、`large-dt`（掉帧大步长）、触控热区、服务端变量/信号路径、其余四画布 smoke（`pc-16-9`、`pc-21-9`、`mobile-19.5-9`、`mobile-4-3`）。
布局与 HUD 以 `mobile-16-9`（1280×720）为完整可见基准；PC 画布只做等比放大/留边，不裁掉手机上看得到的内容。

### 5. 反模式（出现即返工）

- 用 `assert log contains "fun"` 之类断言代替体验判断。
- 断言写在诊断字段上，而玩家可见控件明明可以断言。
- 用例依赖墙钟、机器速度或偶然帧。
- 为让用例变绿而修改期望值或删除失败用例。
- 一个用例同时改多个变量或覆盖多个状态转换，失败后无法归因。
- 在步骤 2 就跑 `runCase`（此阶段只做静态校验）。

### 6. 静态校验（本步骤唯一允许的执行动作）

用工作区脚本或手工检查确认：JSON 可解析、`format`/`version` 正确、每条断言字段齐全、引用的控件名与 GDD 一致、事件 kind 合法、`dt` 为正数。**写"用例已制定"**，不要写"已通过"。

## 产物与完成条件

产物为追踪表与 `tests/*.json`。规则到用例可追踪；P0 与高风险边界都有用例；每条用例有明确 oracle 与失败边界；静态校验通过。

有效 Red 要等步骤 5 骨架可运行后，由**目标生产行为缺失**产生。坏 JSON、路径错误、事件到不了控件、模拟器未启动或工具故障都不算 Red；已有完整行为的工程不为制造 Red 而删除生产代码。

## 下一步与回退

新游戏进入 [3. HTML 效果展示](03-html-prototype.md)，用例留给 [5. Lua 编码实现](05-lua-implementation.md)执行。规则不清回 [1. 策划案](01-game-design.md)；规则变化先改契约与用例。
