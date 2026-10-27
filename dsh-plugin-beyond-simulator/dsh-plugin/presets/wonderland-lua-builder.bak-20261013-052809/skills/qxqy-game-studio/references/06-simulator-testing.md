# 6 测试

**什么时候是这一步**：已经有能跑的东西，要验证它。

**做完的标志**：结果、截图、日志、缺陷闭环、已知限制都在；状态 = **模拟器候选**（不是"通过"）。

---

## 怎么想

### 输出之前先读报告，别急着改代码

失败先读 `failedAt`、帧号与现场快照（P2：先确认你看到的是现场，不是替身）。然后分诊：

**规则缺陷 / 环境差异 / 用例本身写错了？** 判据见 [P12](reasoning-patterns.md#p12--区分环境做不到和代码不对)——**不先分诊就会去修不存在的问题。**

### 一个你从没见过它失败的检查，不是证据（P7）

新增任何检查后，先证明它**能红**。破坏后仍为绿时，先确认**破坏到达了被测代码**（有打包环节就先重新打包），再断定检查是空的。

### 修好一个要按名字确认，不按数量确认（P9）

回归时逐名对照失败项。**失败项变多 ⇒ 立刻回滚。**

### 重新执行后保留修复前后的证据

失败用例**不得删除或改期望值求绿**。要让测试通过，改代码或改测试的**操作方式**，不要改判定条件（[P8](reasoning-patterns.md#p8--删掉的东西要变成哨兵)）。

---

## 工具

**动作、参数、超时与限制的权威位置是 [平台事实 §2.4](platform-facts.md#24-工具与动作)**——本节只给常用调用形状，细节去那里查，不要在本地重述（[P13](reasoning-patterns.md#p13--一个事实只能有一个权威位置)）。

```text
# 规则与交互
qxqy_studio_play { "action": "start", "args": { "canvasId": "mobile-16-9" } }
qxqy_studio_play { "action": "runCase", "args": { "case": <用例对象> } }
qxqy_studio_play { "action": "click", "args": { "name": "StartButton" } }
qxqy_studio_play { "action": "get" }                       # 日志/时间/历史
qxqy_studio_play { "action": "get", "args": { "inspect": true } }   # 才带运行树
# 服务端薄模拟
qxqy_studio_play { "action": "serverSet",  "args": { "entityType": "PlayerSelf", "name": "Gold", "value": 10 } }
qxqy_studio_play { "action": "serverSend", "args": { "target": "PlayerSelf", "name": "Battle_OnReward", "params": [1] } }
# 画面
qxqy_studio_ui_screenshot {}       # 编辑器舞台：静态布局/层级/控件图元
qxqy_studio_play_screenshot {}     # 运行画面（需先 start；不推进时间）
# 收尾
qxqy_studio_play { "action": "stop" }
```

**三个静默陷阱**（都会让用例"通过"却什么也没测到）：`click{name}` 名字或类型写错时不报错也不生效；不带 `canvasId` 的 `start` 跟随编辑器当前画布（默认 `pc-16-9`）；`runCase` 只接受对象、不接受文件路径。三者的机制见 [§2.4](platform-facts.md#24-工具与动作) 与 [§2.5](platform-facts.md#25-用例格式208-实测-schema)。

另外两条成本约束：**每会话一个 Worker**（重复 `start` 前先 `stop`）；**不要用 `step` + 全树读取当轮询**——那是最贵的做法。

---

## 证据在第几层

见 [P14](reasoning-patterns.md#p14--证据有层级别拿低层当高层)。在本平台上要特别注意：

- **模拟器看不见的官方图不算视觉回归失败**：记 `targetId`，真机看效果。缺失框本身不能证明资源不可用。
- **动画与音频在模拟器是空操作/无声**，相关结论一律标未验证。
- **不要把 HTML 截图或搜索结果当作模拟器试玩证据。**

---

## 布局与边界检查

基准画布 `mobile-16-9`（1280×720）整屏完整可见；PC 用同一设计板等比放大/留边。五个画布：`pc-16-9`、`pc-21-9`、`mobile-16-9`、`mobile-19.5-9`、`mobile-4-3`。

检查层级、裁切、反馈、文字完整性与触控热区。**旋转元素要单独确认命中区域**——命中按旋转前的轴对齐矩形算。

**切画布会重建生命周期**，用例单独跑，不跨画布串联。

---

## 观察试玩与反馈

让用户在模拟器页观察或盲玩。每轮只验证少量问题、只调整少量变量（P10），随后回归已稳定的规则。

反馈分类：`bug / design / art-content / platform / not-now`，每类给出下一步归属的步骤。

---

## 发布候选检查

五画布检查、截图矩阵、控件/Lua/资源用量与规模上限、资产清单、GIA 导出警告、脚本挂载说明，以及**一份"哪些只有模拟器证据"的明确列表**。

做完这些只能说**模拟器候选**。

---

## 产物

`records/playtest.md` 标 `runtime=simulator`。保留用例结果、截图、日志、缺陷处理结果、已知限制与导出警告。要标证据层级的结论按 [P14](reasoning-patterns.md#p14--证据有层级别拿低层当高层) 标。

---

## 下一步

进入 [7 真机验证](07-device-validation.md)。设计问题回 1–3；素材问题回 4；规则/实现问题回 2 与 5；平台未知建立探针或交给步骤 7。**按需读对应文档，不整套重跑。**
