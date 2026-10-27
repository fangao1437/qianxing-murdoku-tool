# 千星 2D+Lua 游戏制作工作流与 Agent 预设

一套可由不同 AI 工具读取的七步制作工作流，以及 DeepSeek Harness 的 Agent 预设注册配置。目标是交付**能在模拟器与真机跑起来的 Lua 游戏 + 完整存档**，并按真机回传修复问题。

本目录同时是两件东西：

1. **上游仓库的预设源目录**（对应 `miliastra-beyond-simulator` 的 `agent/wonderland-lua-builder/`）；
2. **本机可安装/可应用的优化版**，用 `tools/` 下的脚本生成本地插件包所需的 `cordis.patch.yml` 并同步 skills。

## 文档组织

| 文件 | 作用 |
|---|---|
| [SKILL.md](skills/qxqy-game-studio/SKILL.md) | Skill 入口：按需读取、步骤索引、全局硬规则 |
| [workflow.md](skills/qxqy-game-studio/references/workflow.md) | PREFLIGHT、知识库核验、证据登记、步骤门、回退 |
| [platform-facts.md](skills/qxqy-game-studio/references/platform-facts.md) | **平台事实与已知边界**：官方 2D 能力、模拟器工具语义、存档/索引规则、模拟器 vs 真机差异、证据与度量纪律、上下文经济学 |
| [01](skills/qxqy-game-studio/references/01-game-design.md) 策划案 · [02](skills/qxqy-game-studio/references/02-test-cases.md) TDD 用例 · [03](skills/qxqy-game-studio/references/03-html-prototype.md) HTML 展示 · [04](skills/qxqy-game-studio/references/04-art-assets.md) 美术素材 · [05](skills/qxqy-game-studio/references/05-lua-implementation.md) Lua 实现 · [06](skills/qxqy-game-studio/references/06-simulator-testing.md) 测试 · [07](skills/qxqy-game-studio/references/07-device-validation.md) 真机验证 | 七个步骤各自的操作细节、退出证据与回退 |
| [agent.cordis.yml](agent.cordis.yml) / [preset.yml](preset.yml) | Harness 预设的插件清单与显示名（上游构建读这两个文件） |
| [evals/agent-behavior.md](evals/agent-behavior.md) | 可观察行为评测 E1–E23 与汇总指标 |
| [CHANGELOG.md](CHANGELOG.md) | 本优化版改了什么、依据是什么、怎么验证 |
| [tools/](tools/) | `build-patch.mjs`（生成补丁，等价上游构建变换）、`apply.mjs`（应用到已安装插件包）、`verify.mjs`（结构与内容自检） |

进入方式：首次或恢复会话先读 workflow + platform-facts 做 PREFLIGHT，确定唯一当前步骤，随后只读该步骤文档。步骤 1–4 不操作模拟器；HTML 是体验展示；模拟器通过只到"模拟器候选"。

## 在 DeepSeek Harness 中使用

- 预设 ID：`wonderland-lua-builder`；显示名：**千星 2D+Lua 游戏制作**。
- 新建任务时在 **设置 → Agent 预设** 选择它；已有任务不会自动切换。
- 插件由 `dsh-plugin-beyond-simulator` 提供：仓库构建（`pnpm build` / `scripts/build.mjs`）读取本目录的 `preset.yml` 与 `agent.cordis.yml` 生成 `dsh-plugin/cordis.patch.yml`，并把本目录整份复制进插件包。`tools/` 下是等价的维护脚本，用于自检变换、验证结构、把改动应用到"已安装插件包"（会先备份，升级后重新执行即可）。

```powershell
# 生成 dsh-plugin/cordis.patch.yml（已安装形式），并自检与已安装补丁逐字节一致
node tools/build-patch.mjs --selftest <已安装插件包>/dsh-plugin/cordis.patch.yml

# 应用到已安装插件包（先备份，再写补丁与 agent.cordis.yml/preset.yml/README.md/evals/skills）
node tools/apply.mjs --target <已安装插件包目录> --dry-run
node tools/apply.mjs --target <已安装插件包目录>

# 结构与技能路径自检
node tools/verify.mjs
node tools/check-skill-path.mjs --profile <DSH profile 目录>
```

已安装插件包目录形如 `<DSH_HOME>/profiles/<profile>/node_modules/dsh-plugin-beyond-simulator`。

## 在 OpenCode、WorkBuddy、Codex 等工具中使用

1. 按上游 `mcp/README.md` 连接模拟器，检查实际工具是否可见；需要浏览器查看和试玩时同时启动指向同一工作区的 Web。
2. 把完整的 `skills/qxqy-game-studio/` 放在 AI 可读取的位置，保留 `SKILL.md` 与 `references/` 的相对路径；按宿主机制安装 Skill，或在项目指引中指定入口文件按需读取。
3. 给 AI 提供当前项目、想法或待修复问题。安装 MCP 不会自动加载本工作流，也不会安装 Harness 预设。

## 资料与验证边界

- 启动前检查工作区指引、本地知识目录，以及当前 AI 宿主的插件/MCP/Skill 配置与可见能力，寻找 `miliastra-toolbox` 系列或其它知识来源；确认能读到官方客户端 2D/Lua API 与使用指南，记录来源、版本与缺项。已有资料直接复用，仅询问仍缺的内容。详见 [知识库发现与可用性核验](skills/qxqy-game-studio/references/workflow.md#知识库发现与可用性核验)。
- 本工作流不捆绑官方知识库，不能从普通 Lua/UI 或 3D 节点经验猜接口。
- 平台事实有版本基线（当前 2.0.8）：**模拟器预览范围、控件索引工具、音频与列表滚动能力随版本变化**，换版本先复核 [platform-facts.md](skills/qxqy-game-studio/references/platform-facts.md)。
- 模拟器只把有限图元画成占位图，其余显示缺失框——这是**预览限制**，不是素材不可用；记录目标 ID 后在真机确认。模拟器通过不等于真机通过。
- 行为评测见 [agent-behavior.md](evals/agent-behavior.md)；改动 persona/Skill/工具集后至少重跑其中列出的用例。
