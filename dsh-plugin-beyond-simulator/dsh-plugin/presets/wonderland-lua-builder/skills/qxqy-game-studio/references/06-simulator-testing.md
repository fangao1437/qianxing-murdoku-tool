# 6. 测试

## 输入与适用时机

读可运行存档、源码、P0 与高风险用例、最近缺陷和美术占位清单。工具接入与显式保存遵守 [步骤 5](05-lua-implementation.md)，按当前会话 schema 操作。

## 工具配方（按目标选，不要互相替代）

```text
# 规则与交互
qxqy_studio_play { "action": "start", "args": { "canvasId": "mobile-16-9", "playerCount": 1 } }
qxqy_studio_play { "action": "runCase", "args": { "case": <用例对象> } }        # 或 args.case 走文件
qxqy_studio_play { "action": "get" }                                          # 日志/时间/历史（不含运行树）
qxqy_studio_play { "action": "get", "args": { "inspect": true } }              # 需要结构化断言时才拉运行树
qxqy_studio_play { "action": "pointer", "args": { "type": "click", "x": 800, "y": 450 } }
qxqy_studio_play { "action": "click", "args": { "name": "StartButton" } }      # 按控件名触发，优先用它
# 服务端薄模拟
qxqy_studio_play { "action": "serverSet", "args": { "entityType": "PlayerSelf", "name": "Gold", "value": 10 } }
qxqy_studio_play { "action": "serverSend", "args": { "target": "PlayerSelf", "name": "Battle_OnReward", "params": [1] } }
# 画面
qxqy_studio_ui_screenshot {}            # 静态布局/层级/控件图元（编辑器舞台）
qxqy_studio_play_screenshot {}          # 运行画面（需先 start；不推进时间）
# 收尾
qxqy_studio_play { "action": "stop" }   # 唯一确定性回收方式
```

规则：每会话一个 Worker（重复 `start` 前先 `stop`）；工具侧超时大约 get 5 s、load 8 s、截图 9 s、play/script_sync 10 s，Worker 请求默认 8 s；`step{dt}` 单位秒、按 1/30 s 帧推进（代码未强制先 pause，但要可复现调试仍建议 pause）；未 `start` 时除 start/device/stop 外的动作报 `play session has not started`；**不要用 `step` + 全树读取当轮询**；`get` 默认不含运行树，`inspect:true` 才带 `tree`、`view:true` 带 `scene`。

三个静默陷阱：
- **`click{name}` 写错名字不报错**：按名字取第一个匹配控件，且只有 `kind` 为 `button`/`cursor` 且在层级中可见时才触发；用例"通过"却什么都没点时先查控件名与类型。
- **不带 `canvasId` 的 `start` 跟随编辑器当前画布**（默认 `pc-16-9`）：手机基线用例必须显式 `start{canvasId:"mobile-16-9"}` 或 `runCase{canvasId}`。
- **`runCase` 只接受对象**：没有用例文件加载器，`args.case` 必须是对象，文件要用文件工具读出后再传。

## 五层证据

| 层 | 验证内容 | 证据 |
|---|---|---|
| L0 | JSON、路径、挂载、控件树、字段齐全 | 静态检查、`qxqy_studio_get` 定向读取 |
| L1 | 纯状态、计分、碰撞、生成、边界 | 纯函数/窄接口回放（不依赖渲染） |
| L2 | 输入 → 状态/日志/控件/变量/信号 | `qxqy-autotest` + `runCase`，失败看 `failedAt`/帧号/现场快照 |
| L3 | 布局、层级、裁切、反馈、动画 | `qxqy_studio_ui_screenshot` 与 `qxqy_studio_play_screenshot` |
| L4 | 易懂、公平、节奏、触控、真机 | 观察式试玩、用户反馈、真机 |

HTML 展示用于提前沟通体验，不能替代本阶段的规则回归与画面检查。模拟器看不见的官方图不算视觉回归失败：记 `targetId`，真机看效果。动画与音频在 2.0.8 是空操作/无声，相关结论一律标未验证。

## 用例执行与缺陷闭环

1. 跑 P0 与高风险边界用例；每个用例独立启动，**不跨画布或跨状态串联**。
2. 失败先读报告（`failedAt`、帧号、现场快照），判断是**规则缺陷、环境差异还是用例问题**：真机有而模拟器没有的按环境差异记录，两边都没有的才是缺陷。
3. 新缺陷先留最小复现，再修，再回归该用例与相关用例，并确认改动真的进入了被测代码（有打包环节先重新打包）。
4. 每个状态变化做**双向断言**；结构检查通过不等于行为正确。
5. 重新执行后保留修复前后证据；失败用例不得删除或改期望值求绿。

## 布局与边界检查

- 基准画布 `mobile-16-9`（1280×720）整屏完整可见；PC 用同一设计板等比放大/留边。五画布：`pc-16-9`、`pc-21-9`、`mobile-16-9`、`mobile-19.5-9`、`mobile-4-3`。
- 检查层级、裁切、反馈、文字完整性与触控热区；旋转元素要单独确认命中区域是否符合预期（命中按旋转前矩形）。
- 按玩法扩展 `edge-contact`、`input-spam`、`pause-resume`、`restart-twice`、`large-dt`、触控、服务端变量/信号与其余画布 smoke。切画布会重建生命周期，用例单独跑。
- 不要把 HTML 截图或搜索结果当作模拟器试玩证据。

## 观察试玩与反馈

- 让用户在模拟器页观察或盲玩；每轮只验证少量问题、只调整少量变量，随后回归已稳定规则。
- 反馈分类为 `bug / design / art-content / platform / not-now`，每类给出下一步归属步骤。
- 缺失的官方图片保留 `targetId` 进真机检查；缺失框本身不能证明资源不可用。

## 发布候选检查

五画布检查、截图矩阵、控件/Lua/资源用量与规模上限、资产清单、GIA 导出警告、脚本挂载说明、以及"哪些只有模拟器证据"的明确列表。模拟器通过后只能称**模拟器候选**。

## 产物与完成条件

保留用例结果、截图、日志、缺陷处理结果、已知限制与导出警告；`records/playtest.md` 标 `runtime=simulator`。每条结论带证据标签。P0 与相关边界已回归，未通过项明确列出。

## 下一步与回退

进入 [7. 真机试玩验证与 bug 修复](07-device-validation.md)。设计问题回步骤 1–3；素材问题回步骤 4；规则/实现问题回步骤 2、5；平台未知建立探针或交给步骤 7。按需读取对应文档，不整套重跑。
