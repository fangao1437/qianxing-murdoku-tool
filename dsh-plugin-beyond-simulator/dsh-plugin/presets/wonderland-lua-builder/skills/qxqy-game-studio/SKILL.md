---
name: qxqy-game-studio
description: 按策划案、TDD 测试用例、HTML 效果展示、千星美术参考图与素材、Lua 实现、测试、真机试玩与修复七步制作千星奇域 2D+Lua 游戏；含平台事实与已知边界，不用于 3D 节点图。
---

# 千星 2D+Lua 游戏工作室

交付物是**能在模拟器与真机跑起来的 Lua 游戏 + 完整存档**（可选 GIA 资产），不是网页。本工作流可供不同 AI 工具读取；模拟器操作以当前宿主实际提供的 MCP 或 Harness 工具 schema 为准。

## 按需读取（不要一次读完）

1. **首次进入或恢复会话**：读 [接入与恢复](references/workflow.md) 与 [平台事实与已知边界](references/platform-facts.md)，完成 PREFLIGHT，确定唯一当前步骤。
2. **随后只读当前步骤的文档**（下表）。步骤切换时读下一份；缺证据时只回读受影响的那一份。
3. PREFLIGHT 与平台事实不计入七步；不预先加载七份步骤文档。

| 当前步骤 / 何时读取 | 进入证据 | 产物与退出证据 |
|---|---|---|
| [1. 策划案](references/01-game-design.md)：创意尚未收敛为可测规则 | 想法/参考/已有工程缺口 | `docs/gdd.md`：核心循环、输入、胜负、P0/不做项、风险与 UNKNOWN 都有归属 |
| [2. TDD 制定测试用例](references/02-test-cases.md)：规则已明确，需定义预期或补回归 | GDD 的 CONTRACT/不变量/画布 | 追踪表 + `tests/*.json`（静态校验通过、列出"用例已制定"） |
| [3. HTML 效果展示](references/03-html-prototype.md)：需确认画面、操作与节奏 | 步骤 1 契约 + 步骤 2 用例名 | 可打开试玩的 `prototype/`、不可移植项、`runtime=html` 反馈记录 |
| [4. 千星美术参考图和素材](references/04-art-assets.md)：HTML 体验已确认，需准备正式美术 | 已确认的 HTML 体验 + 美术意图 | `docs/art-bible.md`：参考图、素材清单、目标 ID/图元、还原方案与真机核验项 |
| [5. Lua 编码实现](references/05-lua-implementation.md)：需搭建、实现或修复游戏 | 前三步产物 + 已核验的知识来源 | 可加载 Lua + 完整存档 + 挂载/架构说明 + Red→Green→Regress 记录 |
| [6. 测试](references/06-simulator-testing.md)：已有可运行版本，需验证规则与体验 | 步骤 5 的存档与用例 | 用例结果、截图、日志、缺陷闭环、已知限制；状态=模拟器候选 |
| [7. 真机试玩验证与 bug 修复](references/07-device-validation.md)：准备交付或处理真机回传 | 模拟器候选 + 资产清单 + 导出警告 | 导入/挂载与索引记录、脚本更新交接、真机结果与未验证项清单 |

## 全局硬规则

1. **每轮只推进一个步骤**；已有工程从最早缺失的证据继续，窄修复只读受影响步骤。
2. **步骤 1–4 不打开模拟器、不改存档、不跑 `runCase`**；有效 TDD Red 要等步骤 5 有可运行骨架、目标生产行为缺失才算。
3. **不发明平台能力**：API、字段、枚举、imageId、GIA 字段、控件类型都要有来源（官方文档 / 已核验知识库 / 实测探针）。查不到就标 `UNKNOWN`，不许猜。2D 客户端语料的路线是 `miliastra-knowledge-lua` Skill + `list_client_documents` / `get_client_document`；`miliastra-knowledge` 与 `rag_search` 只覆盖 3D 服务端节点图。
4. **证据分级**：每条结论标 `[官方]` / `[模拟器]` / `[实测]` / `[推断]` / `[未验证]`；模拟器绿灯只到"模拟器候选"，网页与搜索不能当试玩证据。
5. **结论即假设**：注释、旧文档、上一轮交接都要复核；引用平台事实前回读 [platform-facts.md](references/platform-facts.md)。
6. **写入要证明生效**：落盘后读盘比对字段；只改外部文件不改内联 `source` 等于没改。
7. **能力缺口按两侧规则判定**：真机有而模拟器没有 ⇒ 环境差异；两边都没有 ⇒ 真实缺陷。
8. **上下文经济**：每轮至多一次昂贵快照调用，其余用便宜探针；产物路径保持 ASCII。
9. **提问边界**：只在玩法语义、HTML 体验、真正不同的美术方向、真机观察上请用户决定；路径、断言、控件拆分、目录结构自行决定，不反复确认"是否继续"。

## 决策与交接

- 以 `docs/production-plan.md` 记录：当前步骤、进入/退出证据、知识来源与版本、阻塞项、下一步。
- 以 `records/playtest.md` 记录每轮实际结果与来源（`runtime=html|simulator|device`）。
- 以 `docs/tech-architecture.md` 记录 Lua 文件、控件/容器、服务端变量/信号的职责与挂载点，结构变化即更新。
- 恢复与回退规则、知识库核验流程见 [workflow.md](references/workflow.md)；平台事实、工具语义与已知差异见 [platform-facts.md](references/platform-facts.md)。
