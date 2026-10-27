# 千星 2D+Lua 游戏制作工作流与 Agent 预设

一套可由不同 AI 工具读取的七步制作工作流，以及 DeepSeek Harness 的 Agent 预设注册配置。目标是交付**能在模拟器与真机跑起来的 Lua 游戏 + 完整存档**。

本目录同时是两件东西：

1. **上游仓库的预设源目录**（对应 `miliastra-beyond-simulator` 的 `agent/wonderland-lua-builder/`）；
2. **本机可安装/可应用的优化版**，用 `tools/` 下的脚本生成本地插件包所需的 `cordis.patch.yml` 并同步 skills。

## 这一版的设计取向

**精准 = 更少的猜测，不是更多的规则。**

实测证据：同时生效的规则数到 80 条时，5 个前沿模型的可程序化校验遵守率**全部归零**（[arXiv 2607.19257](https://ar5iv.labs.arxiv.org/html/2607.19257)，4 种格式、2 种放置位置，960 次调用/模型）。所以"把每条注意事项都写进 persona"不但不提高严谨性，还会让**哪几条实际生效变得不可控**。

因此本版把两类东西分开：

| | 放哪 | 为什么 |
|---|---|---|
| **事实的精准**（API、字段、工具语义、版本差异） | `platform-facts.md`，**按索引跳读** | 消除猜测，因此释放注意力 |
| **流程的精准**（证据门、标签、必填表） | **大幅削减** | 消耗注意力，却买不到判断力 |
| **判断力** | `reasoning-patterns.md` 的 14 条可证伪姿态 | 与平台无关，语料没覆盖的情形也成立 |

persona 因此从 6,292 字符降到 4,273 字符；两版预设共享同一套 skills 语料，差异在"什么才算验证过"。

判断依据、被推翻的旧结论与已知取舍见 [docs/design-notes.md](docs/design-notes.md)；逐项变更见 [CHANGELOG.md](CHANGELOG.md)。

## 文档组织

| 文件 | 作用 |
|---|---|
| [SKILL.md](skills/qxqy-game-studio/SKILL.md) | Skill 入口：读什么、七步索引、几条不能错的前提 |
| [reasoning-patterns.md](skills/qxqy-game-studio/references/reasoning-patterns.md) | **14 条推理姿态**（P1–P14）：什么样的结论还不配被相信，每条附实际代价 |
| [platform-facts.md](skills/qxqy-game-studio/references/platform-facts.md) | **平台事实与已知边界**：开头是"必读核心"十条 + 索引；其余各节按需跳读 |
| [workflow.md](skills/qxqy-game-studio/references/workflow.md) | PREFLIGHT、知识库核验、产物位置、回退 |
| [templates/gdd.md](skills/qxqy-game-studio/templates/gdd.md) | 策划案模板（复制用，按需删节） |
| [01](skills/qxqy-game-studio/references/01-game-design.md) 策划案 · [02](skills/qxqy-game-studio/references/02-test-cases.md) 用例 · [03](skills/qxqy-game-studio/references/03-html-prototype.md) HTML 展示 · [04](skills/qxqy-game-studio/references/04-art-assets.md) 美术素材 · [05](skills/qxqy-game-studio/references/05-lua-implementation.md) Lua 实现 · [06](skills/qxqy-game-studio/references/06-simulator-testing.md) 测试 · [07](skills/qxqy-game-studio/references/07-device-validation.md) 真机验证 | 七个步骤：各自"怎么想"、要产出什么、回退 |
| [agent.cordis.yml](agent.cordis.yml) / [preset.yml](preset.yml) | Harness 预设的插件清单与显示名（上游构建读这两个文件） |
| [evals/agent-behavior.md](evals/agent-behavior.md) | 可观察行为评测：代理解不解决**没被枚举**的新情形 |
| [tools/](tools/) | `build-patch.mjs`、`build-bundle.mjs`、`install-profile-preset.mjs`、`apply.mjs`、`verify.mjs` |

**进入方式**：首次或恢复会话读 `reasoning-patterns` + `workflow` + `platform-facts` 的**必读核心**，确定唯一当前步骤，随后只读该步骤文档；其余平台事实用到再查。

## 两个预设

| | `wonderland-lua-builder`（基础版） | `wonderland-lua-precise`（精准版） |
|---|---|---|
| 定位 | 日常开发、窄修复 | 交付、真机同步、性能与结构结论 |
| 差异 | 同一套语料 | 同一套语料，但**"什么才算验证过"的门槛更高**：写进交付物的数量或因果结论必须带"会推翻它的是什么"与"被测对象对齐说明"；回归对比必须**逐名**给出差异 |

精准版**不靠多写规则变精准，靠多要求一次自我证伪**。

## 在 DeepSeek Harness 中使用

- 基础版预设 ID：`wonderland-lua-builder`；精准版：`wonderland-lua-precise`。
- 新建任务时在 **设置 → Agent 预设** 选择；**已有任务不会自动切换预设**（会话保留启动时的插件修订）。
- 基础版由 `dsh-plugin-beyond-simulator` 提供：仓库构建读取 `preset.yml` 与 `agent.cordis.yml` 生成 `dsh-plugin/cordis.patch.yml`。精准版通过 bundle 或 profile patch 注册，与基础版并存。

```powershell
# 生成 dsh-plugin/cordis.patch.yml（已安装形式）
node tools/build-patch.mjs
# 与已安装补丁逐字节比对（证明本地变换等价于上游构建）
node tools/build-patch.mjs --selftest <已安装插件包>/dsh-plugin/cordis.patch.yml

# 生成可安装 bundle（自带 skills/，不依赖 beyond-simulator）
node tools/build-bundle.mjs --out <输出目录>

# 把精准版声明写入 profile patch（先备份；--remove 可撤除）
node tools/install-profile-preset.mjs --profile-patch <cordis.patch.yml> --bundle <bundle 目录>

# 应用到已安装插件包（先备份）
node tools/apply.mjs --target <已安装插件包目录> --dry-run
node tools/apply.mjs --target <已安装插件包目录>

# 自检：规则预算、姿态在场、单一权威、关键事实、链接与锚点
node tools/verify.mjs
node tools/check-skill-path.mjs --profile <DSH profile 目录>
```

## 在 OpenCode、WorkBuddy、Codex 等工具中使用

1. 按上游 `mcp/README.md` 连接模拟器，检查实际工具是否可见。
2. 把完整的 `skills/qxqy-game-studio/` 放在 AI 可读取的位置，保留 `SKILL.md`、`references/`、`templates/` 的相对路径；按宿主机制安装 Skill，或在项目指引中指定入口文件按需读取。
3. 安装 MCP 不会自动加载本工作流，也不会安装 Harness 预设。

## 资料与验证边界

- 启动前检查工作区指引、本地知识目录与当前宿主的插件/MCP/Skill 配置，寻找 `miliastra-toolbox` 系列或其它知识来源；确认能读到官方客户端 2D/Lua API 与使用指南，记录来源、版本与缺项。区分"已配置 / 本会话可调用 / 已取得本轮所需资料"三种状态。详见 [知识库核验](skills/qxqy-game-studio/references/workflow.md#知识库核验)。
- 本工作流不捆绑官方知识库，不能从普通 Lua/UI 或 3D 节点经验猜接口。
- 平台事实有版本基线（当前 2.0.8）：**模拟器预览范围、工具超时与 op 清单随版本变化**，换版本先复核 [platform-facts.md](skills/qxqy-game-studio/references/platform-facts.md)；与当前会话的工具 schema 冲突时**信 schema**。
- 模拟器只把有限图元画成占位图，其余显示缺失框——这是**预览限制**，不是素材不可用；记录目标 ID 后在真机确认。**模拟器通过不等于真机通过。**
- 行为评测见 [agent-behavior.md](evals/agent-behavior.md)。
