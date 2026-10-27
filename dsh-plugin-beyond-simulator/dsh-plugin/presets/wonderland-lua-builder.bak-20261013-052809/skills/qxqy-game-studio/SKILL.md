---
name: qxqy-game-studio
description: 制作千星奇域 2D+Lua 游戏：策划、用例、HTML 展示、美术素材、Lua 实现、模拟器测试、真机验证；含平台事实与推理姿态。不用于 3D 节点图。
---

# 千星 2D+Lua 游戏工作室

交付物是**模拟器与真机都能跑的 Lua 游戏 + 完整存档**，不是网页。

本文件是索引，不是规则表。**按需读取，不要一次读完。**

## 读什么

| 顺序 | 文件 | 何时读 | 读它解决什么 |
|---|---|---|---|
| 1 | [推理姿态](references/reasoning-patterns.md) | 每次下结论、做设计、写断言之前回看 | 十几条与平台无关的思考方式，语料没覆盖的情形也靠它 |
| 2 | [平台事实](references/platform-facts.md) | 首次进入；之后**用到哪节查哪节** | 已核验的能力、工具语义、版本差异；文件开头有索引 |
| 3 | [接入与恢复](references/workflow.md) | 首次进入或恢复已有工程时 | PREFLIGHT、产物位置、回退规则 |
| 4 | 当前步骤的文档（下表） | 一次只读一份 | 该步骤的方法与本步特有事实 |

第 4 项**不要预先加载**。切换步骤时才读下一份；某一步缺证据时只回读受影响的那一份。

## 七步

| 步骤 | 什么时候是这一步 | 做完的标志 |
|---|---|---|
| [1 策划案](references/01-game-design.md) | 想法还没收敛成能被测试的规则 | 一局完整体验的契约已定，未知项各有验证方式 |
| [2 用例](references/02-test-cases.md) | 规则清楚了，要定"什么算通过" | 用例清单在，且每条断言都是两向的（P3） |
| [3 HTML 展示](references/03-html-prototype.md) | 要确认画面、操作手感与节奏 | 用户能打开试玩，并给过反馈 |
| [4 美术素材](references/04-art-assets.md) | HTML 体验已确认，要上正式美术 | 素材清单 + 目标 ID/图元 + 缺失项的替代方案 |
| [5 Lua 实现](references/05-lua-implementation.md) | 要开始搭、写或修游戏 | 可加载的 Lua + 完整存档；目标用例走过有效 Red→Green |
| [6 测试](references/06-simulator-testing.md) | 已经有能跑的东西，要验证 | 结果、截图、缺陷闭环、已知限制；状态 = **模拟器候选** |
| [7 真机验证](references/07-device-validation.md) | 准备交付或处理真机回传 | 真机证据，或一份写清"什么还没验"的清单 |

**新游戏**按 1→7。**已有工程**从最早缺失的证据接上。**窄修复**只读受影响的步骤，不必重跑全程。

PREFLIGHT（在 [workflow.md](references/workflow.md)）不计入七步。

## 几条不能错的前提

这些是"错了就得推倒重来"的，细节与版本见 [platform-facts.md](references/platform-facts.md)：

- **坐标**：千星原点在左下；HTML 原点在左上且 Y 向下。**不要抄网页像素**。
- **客户端 Lua 不能写自定义变量**——读变量、发信号；写变量是服务端的事。
- **只有存为模板控件的父节点**能被 `InstantiateClientUIControl` 动态创建。
- **树结构的权威是 `root.children`**；`tree[].parentId` 无效。脚本的**内联 `source` 非空时优先于外部文件**，两处要一起改。
- **没有保存工具**：落盘要请用户在"模拟器"标签点【保存存档】；之后若还要做真机脚本复制，不要再动存档。
- **模拟器通过 ≠ 真机通过**。真机有、模拟器没有的能力，记为**环境差异**；两边都没有才是**真缺陷**。
- **2D 语料**走 `miliastra-knowledge-lua` 技能 + `list_client_documents` / `get_client_document`。`miliastra-knowledge` 与 `rag_search` 只覆盖 3D 服务端节点图，不能拿来答 2D 问题。

## 产物与记录

产物放在 `workspace/<slug>/`，路径与用途见 [workflow.md](references/workflow.md#产物位置)。

记录按**需要**写，不按模板凑：
- `docs/production-plan.md` — 当前步骤、阻塞项、下一步（跨会话续接用）
- `docs/tech-architecture.md` — Lua 文件、控件/容器、服务端变量/信号的职责与挂载点（结构变了才改）
- `docs/gdd.md` — 策划案本体
- `records/playtest.md` — 每轮实际结果与运行环境（`html` / `simulator` / `device`）

**不要为没有内容的阶段建占位文件。** 空表格比没有文件更糟：它看起来像已完成的工作。

## 提问边界

只在**玩法语义、体验取舍、美术方向、真机观察**上请用户决定。
路径、断言、控件拆分、目录结构、命名自行决定，不要反复确认"是否继续"。
