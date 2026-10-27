# 节点图双向工具 —— spike 报告

> 目标命题：**「节点图可以由代码生成并被游戏/编辑器接受」**
> 验证方式：复用开源项目 **Ayaya_Miliastra_Editor** 的 Graph Code → 校验 → 导出链路，
> **不自己写 protobuf 节点图写入器**。
>
> 日期：2026-10-22　｜　执行：graphcode-spike　｜　任务卡：`task-6`
>
> 证据标签：`[实测]` = 本次跑出来的；`[推断]` = 有依据未验证；`UNKNOWN` = 不知道，不猜。

> ```
> ⚠️ 定位已变更（2026-10，task-7）：本报告 §1–§10 记录的是**旧路线**（Ayaya / GPL-3.0 / Python）。
>    现在的主路线 = **genshin-ts（MIT，TypeScript/npm）→ compile → inject**，
>    我们**永不自己写 protobuf 节点图**，也**不再依赖** Ayaya 的写入链。
>    Ayaya 只剩「节点目录 / 排版」的历史参考价值，非依赖。
>    ⇒ 现行结论、真实命令、产物、风险矩阵见 **§11「MIT 写入路线」**（本文件最后一节）。
> ```

---

## 0. 结论先说

| 问题 | 结论 |
| --- | --- |
| 节点图能由代码生成吗？ | **能**　`[实测]` |
| 生成的图能被工具链接受吗？ | **能**　`[实测]`（外部 `validate-file` 判「通过」，`validate-graphs --all` 判 0 错误） |
| 能被**游戏/编辑器**接受吗？ | **UNKNOWN** —— 差最后一步：用他们的导出工具落 `.gil` 再真机导入。本工程**没有做**（也**不做**，边界见 §6） |
| 我们缺的「节点名 → 参数/端口」表能产出吗？ | **能**　`[实测]` → `tools/qx/graphcode/nodes.json`，**558 节点 / 534 有端口名** |
| 我们的存档里有节点图吗？ | **有**　`[实测]`：`517-模板测试-v2.gil` 里有 1 张图、7 节点、7 连线 |

**一句话**：**部分可行，且卡点已经定位到最后一个具体动作** ——
"生成 + 静态校验"这一段完全跑通；"落盘 `.gil` 并被真机吃下"这一段**只能由外部工具完成**，
本工程按 GPLv3 隔离只做**调用方**，不做实现方。

> 🔁 **本条已被 §11 推翻/取代**：改用 MIT 的 genshin-ts 之后，"落盘 `.gil`"这一段**已经在本机跑通**
> （写入到 `_work/` 的存档副本，见 §11.4），GPL 隔离这套限制也随之不再需要。

---

## 1. 仓库、版本、许可

| 项 | 值 | 证据 |
| --- | --- | --- |
| 仓库 | `https://github.com/AyayaXiaowang/Ayaya_Miliastra_Editor` | — |
| commit | `189cb6aa6f5a060ce5791bc77412f0073cbcc51f` | `[实测]` GitHub API `/commits/main` |
| commit 日期 | 2026-03-13T11:12:20Z | `[实测]` 同上 |
| 许可 | **GPL-3.0** | `[实测]` GitHub API `license.spdx_id` + 仓库内 `LICENSE`（35148 B） |
| 体量 | 4207 条目 / 3783 blob / **60,219,102 B**（≈57 MB） | `[实测]` `git/trees/main?recursive=1` |
| 语言 | Python | — |
| 放置位置 | `_work/ayaya/repo/`（**本工程之外**，未纳入产物） | — |

### 1.1 下载过程（别人照做能复现）

**`git clone` 与 `codeload` zip 都不稳**（本机网络）：`git clone --depth 1` 的 pack 卡在 0 B；
`Invoke-WebRequest` 拉 codeload zip 卡在 0 B 后慢慢爬到 9.78 MB 就停（**zip 不完整：无中央目录**）。

**可用路线（实测有效）**：

```powershell
# ① 拿完整文件树（唯一一次大响应；失败就重试，第 2 次成）
$h = @{ 'User-Agent'='dsh-spike'; 'Accept'='application/vnd.github+json' }
Invoke-RestMethod -Uri 'https://api.github.com/repos/AyayaXiaowang/Ayaya_Miliastra_Editor/git/trees/main?recursive=1' -Headers $h
#   → truncated=False, entries=4207；把 blob 路径抽成清单

# ② 按清单逐个拉文件（ghfast.top 反代 raw，实测最快 ~22 KB/s；gcore.jsdelivr 可作备源但大文件 404）
#    a. 存成 list.txt（每行一个仓库相对路径，UTF-8）
#    b. _work/ayaya/pfetch.ps1 是并行抓取器（ForEach-Object -Parallel，Throttle 12~14）
pwsh -NoProfile -File _work\ayaya\pfetch.ps1 -List .\list-main.txt -Out _work\ayaya\repo -Throttle 14
#    实测：1862 文件 / 9.84 MB，ok=1861 fail=1（只差 .gitignore）
pwsh -NoProfile -File _work\ayaya\pfetch.ps1 -List .\list-ugc.txt  -Out _work\ayaya\repo -Throttle 12
#    实测：365 文件 / 3.76 MB，ok=365 fail=0
```

- 脚本：`_work/ayaya/pfetch.ps1`（并行）、`_work/ayaya/fetch.ps1`（串行版）、`_work/ayaya/getzip.ps1`（`curl -C -` 续传，本机没跑成）
- 清单：`_work/ayaya/list-main.txt`、`list-ugc.txt`
- 最终落地：`_work/ayaya/repo/` **2760 文件 / 27.75 MB**
- **没拉的部分**：`tests/`（1.4 MB，本 spike 不需要）、`assets/` 里的二进制资产、
  `private_extensions` 里的部分 `builtin_resources/*.gil`／UI 相关实现。
  ⇒ 因此 `validate-graphs --all` 有 9 个失败（全是**复合节点**样例，见 §5.2），
  是**我们的下载不全**，不是上游坏了。

### 1.2 Python 环境

**本机系统没有 Python**（`python`、`py` 都不存在；`WindowsApps\python.exe` 是商店占位壳）。

用 **DSH 运行时自带的 3.12.14**（正好落在仓库要求的 3.10–3.12）：

```powershell
$env:QX_PYTHON = "C:\Users\<你>\.dsh\dsh-runtimes\dsh-plugin-desktop-primary-runtime\dependencies\python\python.exe"
& $env:QX_PYTHON --version     # → Python 3.12.14，pip 26.2.1
```

**关键实测结论：本 spike 涉及的命令全部 `零 pip 依赖` 即可跑。**
`requirements.txt` 里那堆重件（PyQt6 / rapidocr-onnxruntime / onnxruntime / opencv-python）
是 **GUI 与 OCR 自动化**用的，`graph_tools` 校验与 `ugc_file_tools` 解析**都不需要**。
⇒ **不需要装任何东西、不需要动本机全局环境**。

> ⚠️ 只有做 **UI Workbench（HTML→bundle）** 和 **截图/OCR 自动化**才要那批依赖。

---

## 2. 最小 Graph Code 示例（原文）

### 2.1 路径说明：任务卡里的 `assets/资源库/节点图/` 不存在

`[实测]` 实际布局是**两层**：

```
assets/资源库/
├── 共享/节点图/<server|client>/…        ← 跨项目复用示例
└── 项目存档/<项目名>/节点图/<server|client>/…
        └── …/实体节点图/{回归,模板示例,校准_枚举覆盖_v1}/
```

### 2.2 最小示例全文（上游 `回归_节点图挂载_实体.py`，57 行）

这是**最干净的**一个：1 个触发器 + 1 个执行节点（加法运算）+ 一个分支。

```python
"""
graph_id: server_regression_graph_mount_entity_01
graph_name: 回归_节点图挂载_实体
graph_type: server
mount: entity_key:一个有节点图的空模型
description: 最小回归：导出/写回时将节点图挂载写入 base .gil 的实体摆放段（root5，slot=3）。
"""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = next(
    p
    for p in Path(__file__).resolve().parents
    if (p / "assets" / "资源库").is_dir() or ((p / "engine").is_dir() and (p / "app").is_dir())
)
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(1, str(PROJECT_ROOT / "assets"))

from app.runtime.engine.graph_prelude_server import *  # noqa: F401,F403


# ---------------------------- 常量（避免魔法数字） ----------------------------
LEFT_VALUE = 1
RIGHT_VALUE = 2
ZERO_VALUE = 0


class 回归_节点图挂载_实体:
    def __init__(self, game, owner_entity):
        # 初始化节点图并做静态校验。
        self.game = game
        self.owner_entity = owner_entity

        from app.runtime.engine.node_graph_validator import validate_node_graph

        validate_node_graph(self.__class__)

    def on_实体创建时(self, 事件源实体, 事件源GUID):
        # 实体创建事件回调：执行一次最小节点调用。
        _结果: "整数" = 加法运算(self.game, 左值=LEFT_VALUE, 右值=RIGHT_VALUE)
        if _结果 >= ZERO_VALUE:
            pass
        return

    def register_handlers(self):
        # 注册事件处理器。
        self.game.register_event_handler("实体创建时", self.on_实体创建时, owner=self.owner_entity)


if __name__ == "__main__":
    from app.runtime.engine.node_graph_validator import validate_file_cli

    raise SystemExit(validate_file_cli(__file__))
```

### 2.3 结构拆解（7 条硬约定）

| # | 约定 | 备注 |
| --- | --- | --- |
| ① | 文件头 docstring 元数据 `graph_id / graph_name / graph_type / description` | 可选 `mount: entity_key:<实体名>` |
| ② | workspace bootstrap：按 `parents` 找根，`sys.path.insert`，再 `from app.runtime.engine.graph_prelude_{server,client} import *` | server/client 两个 prelude |
| ③ | 一个与 `graph_name` **同名**的类；`__init__` 里 `validate_node_graph(self.__class__)` | 实例化即静态校验 |
| ④ | **事件处理器方法名 = `on_<事件中文名>`**，形参 = 该事件的**输出端口名**（顺序即端口顺序） | `on_实体创建时(self, 事件源实体, 事件源GUID)` |
| ⑤ | 节点调用 = **中文函数名**，第一个位置参数是 `self.game`，其余按**端口名**传 kwarg | `加法运算(self.game, 左值=1, 右值=2)` |
| ⑥ | 类型标注用**字符串字面量**：`结果: "整数" = …` | 这是给解析器看的，不是运行时 |
| ⑦ | `register_handlers()` + `__main__` 里 `validate_file_cli(__file__)` | 自检入口 |

### 2.4 触发器 / 执行节点 / 信号 / 变量 怎么声明

| 概念 | 声明方式 | 实例 |
| --- | --- | --- |
| **触发器** | 写成 `on_<事件名>` 方法 + `register_handlers()` 里 `register_event_handler("<事件名>", …)` | `实体创建时`、`自定义变量变化时`、`监听信号`（共 **57** 个 server 触发器，全部有中文名） |
| **执行节点** | 直接当函数调用；返回值可接（`"类型"` 标注），也可不接 | `打印字符串`、`设置自定义变量` |
| **流程分支** | 用 Python 原生 `if/else`，解析器翻成双分支/多分支节点 | `if _结果 >= ZERO_VALUE: …` |
| **信号** | `监听信号` 触发器 + 信号名**字符串常量**入参；发送侧用发送信号节点。上游写回侧会把它提升成 signal-specific runtime_id | 见 §5.3 的 `0x6000000A` |
| **节点图变量** | 类级 `GRAPH_VARIABLES` 声明（上游校验器会警告"冗余初始化"就是查这张表） | `模板示例_局部变量计数.py` |
| **自定义变量** | 走 `设置自定义变量(game, 目标实体, 变量名, 变量值, 是否触发事件)`；初始值应在变量注册表里给 | `assets/…/管理配置/关卡变量/自定义变量注册表.py` |

> 语法糖（`[实测]` 读代码，**没跑**）：切片 / `sum` / `any` / `all` / 三元表达式会被自动翻成复合节点；
> 复合节点可以直接按名字调用（`整数列表_按布尔掩码过滤(输入列表=…, 保留条件列表=…)`）。
> 这两条依赖**复合节点库**，我们没拉全 ⇒ 相关样例校验失败（§5.2）。

---

## 3. 节点表：能产出，且比预期更全

任务卡问的是「能不能列出**节点名 → 参数/端口**」。**能，但需要拼两个源**：

| 源 | 给什么 | 缺什么 |
| --- | --- | --- |
| `node_data/index.json`（`[实测]` Version **2.1.0** / GameVersion **6.2.0** / Author Aluria） | 558 节点：`ID / Name(英文) / Range / Class / Family / Inputs(类型) / Outputs(类型) / TypeMappings`；26 类型；42 枚举；**8 条 GraphConst**（图的序列化固定 ID） | 只有端口**类型**（`"Str"`），**没有端口名** |
| `graph_ir/node_type_semantic_map.json` | `{游戏节点ID → graph_generater_node_name(中文 DSL 名)}`，537 条 | 只是名字 |
| `plugins/nodes/**/*.py` 的 `@node_spec(...)` | **端口名 + 类型**：`inputs=[("流程入","流程"),("变量名","字符串"),…]` | — |

**落地**：`tools/qx/graphcode/nodes.json`（**1,170,152 B**）

| 指标 | 数 | 来源 | 证据 |
| --- | --- | --- | --- |
| 目录节点 | **558** | `node_data/index.json` | `[实测]` |
| 有中文 DSL 名 | **534** | `node_type_semantic_map.json` | `[实测]` |
| `@node_spec` 条目 | **547**（server **422** / client **125**） | `plugins/nodes/**/*.py` 静态解析 | `[实测]` |
| **补齐端口名**的节点 | **534** | 上面两源按中文名对齐 | `[实测]` |
| 仍缺端口 | 24 | — | `[实测]` |
| 服务端触发器 | **57**（全部有中文名） | — | `[实测]` |
| 类型 / 枚举 | 26 / 42 | — | `[实测]` |

按「域/类」分布（`[实测]`）：

```
Server/Execution 168   Server/Query 132   Server/Arithmetic 62   Server/Trigger 57
Client/Query      42   Client/Arithmetic 39  Client/Execution 35   Server/Hidden 13
Client/Hidden      4   Client/Others     3   Server/Control   2   Client/Control  1
```

**这直接回答了"我们一直缺 schema"** —— 缺的不是 `schema`，是**这张表**。
有了它，"这个节点有什么端口、端口什么类型、中文叫什么"就都能查了。

### 3.1 端口名必须二次抽取（为什么不能一步到位）

`node_data/index.json` 的 `Inputs: ["Str"]` 是**类型**；
Graph Code 里写的是 `打印字符串(self.game, 字符串="hi")` —— **名字**。
两者不同源 ⇒ `gen-nodes.mjs` 出表、`gen-ports.mjs` 补名，两步。

```powershell
node tools/qx/graphcode/gen-nodes.mjs --ayaya=$env:QX_AYAYA_REPO
node tools/qx/graphcode/gen-ports.mjs --ayaya=$env:QX_AYAYA_REPO --merge
```

---

## 4. 导出链路：**能出 `.gil`（覆盖存档），也能出 `.gia`**

### 4.1 三段链路（`[实测]` 读代码 + 文档；只有第 1 段本次跑过）

```
Graph Code (.py)
   │  ① engine/graph/graph_code_parser.py + EffectivePortTypeResolver（补齐端口类型）
   ▼
GraphModel (JSON)                         ← 命令：export_graph_model_json_from_graph_code
   │  ② private_extensions/ugc_file_tools/node_graph_writeback/（**他们自己的 protobuf 写入器**）
   ▼
.gil 节点图段（写回覆盖存档）  或  .gia（交付）
   │  ③ pipelines/project_writeback.py（与"导出中心 UI"同款口径）
   ▼
真机导入
```

> ★ 第 ② 段就是**我们不该自己写的那一层**。它有 `template-clone` 与 `pure-JSON 自举` 两种模式，
> 里面全是踩出来的细节（`ConcreteBase + indexOfConcrete`、字典 K/V 载体、signal-specific runtime_id、
> `section10['2']/['4']` 的 repeated wrapper 形态、复合节点 `0x4000xxxx` 的 low16 范围…）。
> **自己造一份 = 把那些坑全部重踩一遍**。这就是复用它最硬的理由。

### 4.2 命令面（`[实测]` `--help`）

**校验（零依赖，本次全跑过）**

```powershell
cd <ayaya_repo>
python -X utf8 -m app.cli.graph_tools validate-file  <节点图.py>      # 单文件
python -X utf8 -m app.cli.graph_tools validate-graphs --all           # 全量
python -X utf8 -m app.cli.graph_tools validate-project                # 项目存档（资源/挂载）
python -X utf8 -m app.cli.graph_tools validate-all                    # 上面三合一
```

**导出 / 解析（走 `run_ugc_file_tools.py`，本次验证了读侧）**

```powershell
cd <ayaya_repo>
python -X utf8 private_extensions\run_ugc_file_tools.py --help        # {ui, entity, project, tool, gui}
python -X utf8 private_extensions\run_ugc_file_tools.py tool <name> --help
```

读写两向对应的工具名（`[实测]` 来自 `tool_registry.py`）：

| 方向 | 工具 | 说明 |
| --- | --- | --- |
| 读 | `parse_gil_payload_to_graph_ir` | **`.gil` payload section10 / 10.1.1 的 NodeGraph blob** → Graph IR　✅ 本次跑通 |
| 读 | `parse_gil_to_graph_ir` / `parse_gia_to_graph_ir` | 从 `.gil` / `.gia` 出 Graph IR |
| 读 | `extract_gil_to_package` | `.gil` → 项目存档目录（核心 `gil_package_exporter/`） |
| 写 | `graph_model_json_to_gil_node_graph` | GraphModel(JSON) → `.gil` 节点图段 |
| 写 | `project import`（推荐） | 与导出中心 UI 同口径，走 `pipelines/project_writeback.py` |

### 4.3 校验前置（`[实测]` 从错误信息反推）

- **节点名必须在该 scope 的节点库里** —— 否则 `CODE_UNKNOWN_NODE_CALL`。
  上游明确写了：**不许**往 `plugins/nodes/**` 补节点来绕过，只能改图/换节点。
- **端口类型要对得上** —— `engine/validate/rules/code_port_types_match_port_types_rule.py`（73 KB）。
- **数据输入端口必须连线或配常量** —— `[实测]` 见过 `CONNECTION_DATA_INPUT`。
- **代码规范**：不许写 `self.xxx.方法()` 这种"原生方法调用"（`IR_MODELING_ERROR`）；
  不许在"实体创建时"给自定义变量写常量默认值（`CODE_CUSTOM_VAR_REDUNDANT_INIT_ON_ENTITY_CREATED`）；
  节点图变量也别做冗余初始化（`CODE_GRAPH_VAR_REDUNDANT_INIT_DEFAULT`）。
- **节点图文件本身要能被 Python AST 解析**（缩进/语法合法），否则资源索引阶段就挂了。

### 4.4 `.gil` vs `.gia`

| | 用途 | 我们的用法 |
| --- | --- | --- |
| `.gil` | **覆盖本地存档缓存**（写回） | 我们已有完整的 `.gil` 读写经验（控件层）；节点图段要靠他们 |
| `.gia` | **项目交付 / 外部资产** | 我们控件侧已经用 `.gia` 走过真机（`tools/qx/gia.mjs`） |

---

## 5. spike 实测记录（命令 + 真实输出）

### 5.1 全链路：生成 → 校验

前置：`$env:QX_AYAYA_REPO` = `_work/ayaya/repo`，`$env:QX_PYTHON` = 上文的 3.12.14。

```powershell
cd qianxing-murdoku
node tools/qx/graphcode/gen-nodes.mjs --ayaya=$env:QX_AYAYA_REPO
node tools/qx/graphcode/gen-ports.mjs --ayaya=$env:QX_AYAYA_REPO --merge
node tools/qx/graphcode/emit.mjs --spec=tools/qx/graphcode/specs/min-loop.json `
     --ayaya=$env:QX_AYAYA_REPO --python=$env:QX_PYTHON
```

输出（`[实测]` 原文）：

```
✅ 写出 …\tools\qx\graphcode\nodes.json
   节点 558（有中文 DSL 名 534）  类型 26，枚举 42，GraphConst 8
# ── gen-ports ──
扫描 570 个 .py，得到 @node_spec 547 条
  按域：{"client":125,"server":422}
  事件节点 57 个；输出端口名不是合法标识符的：0
✅ 已合并进 …nodes.json   补齐端口名的节点：534   仍缺端口：24
# ── emit ──
✅ 生成 Graph Code: …\out\模板_qx最小闭环_实体创建时写变量.py
   图 server_qx_min_loop_01（server），1 个触发器，2 次节点调用
$ (cwd=<ayaya_repo>) <python> -X utf8 -m app.cli.graph_tools validate-file …\模板_qx最小闭环_实体创建时写变量.py
================================================================================
节点图自检:
结果: 通过
警告明细:
  [1] 第31~31行: …在实体创建时对自定义变量『qx_min_loop_flag』写入了常量值 1，疑似无意义的默认值初始化。…
--- validate-file 退出码: 0 ---
```

**「结果: 通过」= 代码生成的图被他们的校验器接受。** `[实测]`

### 5.2 全量校验 `validate-graphs --all`

```powershell
cd <ayaya_repo>
python -X utf8 -m app.cli.graph_tools validate-graphs --all      # 完整日志：_work/ayaya/validate-graphs-all.log
```

```
验证完成:
  总计: 23 个文件    通过: 9    告警: 5    失败: 9
  问题: 24 错误, 19 警告
  错误码：IR_MODELING_ERROR 23 | CODE_UNUSED_QUERY_OUTPUT 14 |
          CODE_CUSTOM_VAR_REDUNDANT_INIT_ON_ENTITY_CREATED 3 | CONNECTION_DATA_INPUT 1
```

- **我们生成的那张图在列表里**：`[WARN] …/_qx_emitted/模板_qx最小闭环_实体创建时写变量.py (errors: 0, warnings: 1)`
  → **0 错误**，只有那条"冗余初始化"告警（是我们故意写的常量，用来测通路）。`[实测]`
- 9 个失败**全是复合节点样例**（`模板示例_共享复合节点*`、`复合节点全类型测试集/*`、`最小复现_bool`），
  错误统一是 `发现Python原生方法调用 self._共享复合_xxx.计算()` ——
  **因为复合节点库没随我们下载的那批文件过来**（在项目存档/复合节点定义里）。`[推断]`（依据：错误形态一致 + 上游 `composite_node_manager` 按需加载子图，缺失即抛错）

### 5.3 读方向：`.gil` → 节点图（**这条最出乎意料**）

```powershell
cd <ayaya_repo>
python -X utf8 private_extensions\run_ugc_file_tools.py tool parse_gil_payload_to_graph_ir `
    --input-gil "<…>\qianxing-murdoku\517-模板测试-v2.gil"
```

```
GIL payload 节点图 IR 导出完成：
- graphs_count: 1
- index: …\ugc_file_tools\out\gil_payload_graph_ir\index.json
```

`index.json`：

```json
[{ "graph_id_int": 1073741825, "graph_name": "新建节点图", "group_index": 0, "entry_index": 0,
   "node_count": 7, "edges_count": 7,
   "ir_json": "graphs/gil_graph_ir_1073741825_新建节点图.json" }]
```

节点（`[实测]` 上游自己的摘要）：

```
node 2: type=1610612746 ()                              ← 0x6000000A，信号类节点
node 4: type=1610612750 ()                              ← 0x6000000E，信号类节点
node 5: type=22  (Set_Custom_Variable)                    → 设置自定义变量 / Execution
node 6: type=652 (Set_Player_Settlement_Success_Status)   → 设置玩家结算成功状态 / Execution
node 7: type=77  (Settle_Stage)                           → 结算关卡 / Execution
node 8: type=248 (Get_List_of_Player_Entities_on_the_Field)→ 获取在场玩家实体列表 / Query
node 9: type=128 (Get_Corresponding_Value_From_List)      → 获取列表对应值 / Query
连线：flow 2:0→6:0, flow 2:0→5:0, flow 4:0→7:0, data 2:0→5:0, data 2:3→5:2, data 9:0→6:0, data 8:0→9:0
```

**结论**：我们这些 `.gil` **确实带节点图**，且能用外部工具读成结构化 IR。`[实测]`

### 5.4 ★ 一个必须记下来的判断错误（不然下次还会踩）

我第一版 `read.mjs` 用「大整数 ID 是否落在节点命名空间」的**启发式**去找节点图段，
扫本工程 5 个存档（486 / 496 / 513 / 515 / 517）**全部报「0 个候选」**，
我差点据此写下「我们这些档没有节点图」。

接上外部解码器一跑：**`graphs_count: 1`** —— **结论是错的。**

真因：图的 `graph_id_int = 1073741825`（= `0x40000001`），
而我们**控件 ID 也是 `1073741824+`**（`0x40000000` 起），两者**同一数值区间**，
启发式根本区分不了；把控件 ID 扣掉之后，非控件大整数里又没有节点类型 ID 的痕迹。

> **教训**：**启发式的"没找到" ≠ "不存在"。**
> 凡"某结构不存在"这类**否定性结论**，必须有一条**独立证据链**（这里是外部解码器 + 上游文档）
> 才能写进文档；拿不出就只许写"未找到"。

---

## 6. GPL-3.0 边界（怎么做到"用了但没污染"）

**原则：只做"调用方"，不做"实现方"。**

| ✅ 允许（本 spike 实际做的） | ❌ 禁止 |
| --- | --- |
| 以**外部子进程**调 `python -m app.cli.graph_tools …` / `run_ugc_file_tools.py …` | `import` 他们的任何模块进本工程 |
| **只读**他们的文件做**静态解析**（`gen-ports.mjs` 读 `@node_spec` 文本，**不 import、不执行**） | 把他们的 `.py` 复制进本工程产物 |
| 生成**同格式**的 Graph Code（`.py` 是我们自己写的字节） | 把 GPL 代码/资源打进本工程发布包 |
| 在 `_work/ayaya/`（**工程之外**）存放他们的仓库 | 把他们的仓库放进 `qianxing-murdoku/` |

具体落实：

1. `emit.mjs` / `read.mjs` 里对外部仓库只有两种操作：**`execFileSync` 起子进程**、**`fs.readFileSync` 只读**。
   全文没有一处 `import` 上游模块。
2. `emit.mjs` 会把生成的 `.py` **复制**到上游 workspace 的暂存位
   （`assets/资源库/共享/节点图/server/实体节点图/_qx_emitted/`），
   因为 `validate-file` 要求在 workspace 里才能解析 bootstrap。
   **这是往他们那边写，不是往我们这边拷**，方向正确。
3. `nodes.json` 是**事实性元数据汇编**（节点 ID / 类型签名 / 端口名），
   但它的**来源是 GPL 仓库的数据文件** ⇒ 我在文件头写了
   `_provenance.upstream_license: "GPL-3.0"` + `license_flag`。

> ### ⚠️ 留给负责人的决定（我不替你定）
>
> `nodes.json`（1.17 MB）**要不要随本工程分发 / 进发布包**？
>
> - **保守（推荐）**：`nodes.json` 加进 `.gitignore`／发布排除，开发机跑
>   `gen-nodes.mjs` + `gen-ports.mjs` **现场生成**（两条命令，10 秒）。
>   ⇒ 本工程不带任何上游派生数据，GPL 传染风险为 0。
> - **便利**：提交 `nodes.json`，但**必须**保持文件头的 GPL 来源与许可标注，
>   且只在**内部研发**使用；对外分发时剔除。
>
> 我**没有**替你决定，代码里两条路都走得通（工具缺 `nodes.json` 时会退化：
> `emit.mjs` 跳过节点名前置校验、`read.mjs` 少一层 ID→名字翻译，都不会崩）。

---

## 7. 未解项

| # | 未解 | 影响 | 下一步 |
| --- | --- | --- | --- |
| 1 | **落盘 `.gil` 后真机是否接受** | 这是命题的**最后一半**，本次**没做** | 见 §8 的最小闭环实验 |
| 2 | 端口**语义名**与 pin 索引的对应（读方向） | 读出来的图只能给"结构骨架"，不能直接生成等价 Graph Code | IR 里每个 `pin` 有 `index_int`；需要跟 `@node_spec` 的端口顺序对齐验证 |
| 3 | 连线的 `kind_int` 语义（1/2/3） | 我第一版猜"1=flow 2=data"，与上游自己的输出对不上（它报 6 条，我报 7 条 `kind=3`）⇒ 已改成**以上游原文为准**，不自己判断 | 读 `node_graph_semantics/` 的常量定义 |
| 4 | `0x6000000A` / `0x6000000E` 这类 **signal-specific** node_type_id 不在 `nodes.json` 里 | 信号节点的名字/端口翻不出来 | 信号 ID 由 `.gil` 的信号表动态分配 ⇒ 必须**结合本档信号表**翻译，不能查静态目录 |
| 5 | 复合节点（复合库）没拉全 | `validate-graphs --all` 里 9 个复合样例失败；语法糖写法无法验证 | 补齐 `assets/资源库/项目存档/*/复合节点/` 一类目录再跑 |
| 6 | 我们的 **2D+Lua 客户端游戏**到底要不要服务端节点图 | 决定这条工具链**有没有必要**进主流水线 | **产品决策**，见 §9 |

---

## 8. 下一步最小闭环实验（具体命令，能过就走完）

目标是补上 §7 第 1 项：**"生成的 `.gil` 真机能吃"**。

```powershell
# ── 0. 前置 ─────────────────────────────────────────────────────────────
$env:QX_AYAYA_REPO = "D:\新建文件夹\miHoYo Launcher\_work\ayaya\repo"
$env:QX_PYTHON     = "C:\Users\<你>\.dsh\dsh-runtimes\dsh-plugin-desktop-primary-runtime\dependencies\python\python.exe"
cd "D:\新建文件夹\miHoYo Launcher\qianxing-murdoku"

# ── 1. 生成最小图（1 触发器 + 1 执行节点）并静态校验 ──────────────────
node tools/qx/graphcode/emit.mjs --spec=tools/qx/graphcode/specs/min-loop.json `
     --ayaya=$env:QX_AYAYA_REPO --python=$env:QX_PYTHON
#   期望：--- validate-file 退出码: 0 ---

# ── 2. 让**外部工具**落盘（本工程不代劳）─────────────────────────────
#   推荐入口（与"导出中心 UI"同口径）：
cd $env:QX_AYAYA_REPO
& $env:QX_PYTHON -X utf8 private_extensions\run_ugc_file_tools.py project --help
& $env:QX_PYTHON -X utf8 private_extensions\run_ugc_file_tools.py project import --help
#   ⇒ 按 help 填：项目存档目录、目标 base .gil、输出 basename
#   备选入口（单图直转）：
& $env:QX_PYTHON -X utf8 private_extensions\run_ugc_file_tools.py tool graph_model_json_to_gil_node_graph --help

# ── 3. 产物过我们自己的四道闸门（**只读**，本工程已有）─────────────────
cd "D:\新建文件夹\miHoYo Launcher\qianxing-murdoku"
node tools/gil/probe_guid_collision.mjs  <产物>.gil
node tools/gil/probe_ui_registry.mjs     <产物>.gil
node tools/gil/roundtrip.mjs             <产物>.gil
node tools/gil/diff_fields.mjs           <原档>.gil <产物>.gil
#   期望：撞号 0；登记表自洽；往返逐字节一致；diff 只出现"多了节点图"相关的段

# ── 4. 用我们的 read.mjs 把节点图读回来，和 spec 对账 ───────────────────
node tools/qx/graphcode/read.mjs --gil=<产物>.gil `
     --ayaya=$env:QX_AYAYA_REPO --python=$env:QX_PYTHON --outdir=tools/qx/graphcode/out
#   期望：graphs_found ≥ 1，节点名/连线与 specs/min-loop.json 对得上

# ── 5. 真机：交给用户导入 ──────────────────────────────────────────────
#   用户的动作：模拟器/编辑器导入 <产物>.gil → 看节点图是否出现、是否可编辑、
#              关卡里跑一次、确认自定义变量真的被写
```

**判定标准**：第 3 步四道闸门全绿 + 第 4 步读回来对得上 + 第 5 步真机看得见图且变量生效
⇒ 命题的"被游戏/编辑器接受"这一半才算**证成**。任何一步没过，都只能算"部分可行"。

---

## 9. 需要你或用户决定/动手的事

### 9.1 必须由**产品**决定的（会改变这条工具链的地位）

**我们要不要服务端节点图？**
本工程是 **2D + Lua 客户端脚本** 的游戏（`engine_adapter_qianxing.lua` / `main.lua` 那一套），
而节点图是**服务端逻辑**的可视化编程。两种情况差别很大：

- **不需要** → 这条工具链只当**诊断工具**用（`read.mjs` 读别人的档、`nodes.json` 当节点字典），
  `emit.mjs` 停在骨架，**不进主流水线**，不投入后续。
- **需要** → 就要接受：**节点图必须由上游工具落盘**，我们只负责"生成 spec + 校验 + 对账"。
  这时要排期做 §8 的闭环 + §7 的第 2/4 项（端口语义、signal ID 翻译）。

### 9.2 必须由**你（负责人）**拍板的

1. **`nodes.json` 是否入库/分发**（GPL 边界，见 §6 的 ⚠️ 框）。我现在是**默认入库**并带 GPL 标注，
   若你要求"零上游派生数据"，我就把它加进 `.gitignore` 并改 README 说明"现场生成"。
2. **要不要补齐上游仓库的复合节点资源**（为了让 `validate-graphs --all` 全绿）。
   代价：再拉几 MB；收益：复合节点/语法糖那批写法可验证。

### 9.3 只需要**用户**在真机上做的

§8 第 5 步：把外部工具落盘的 `.gil` 导进编辑器，看：
① 节点图在不在；② 能不能编辑；③ 关卡里跑起来自定义变量有没有被写。
**这一步我替代不了**（本会话没有真机、没有游戏客户端）。

### 9.4 我**不**需要的东西（省得你去弄）

- ❌ 不用装 Python —— 运行时自带的 3.12.14 够用，且本次所有命令**零 pip 依赖**。
- ❌ 不用装 PyQt6 / onnxruntime / opencv —— 那是 GUI 与 OCR 用的。
- ❌ 不用改本机全局环境 —— 全部命令都在 `_work/` 与 `qianxing-murdoku/tools/qx/graphcode/` 内。
- ❌ 不用配代理 —— 下载路线已写进 §1.1，`ghfast.top` 够用（慢，但能完成）。

---

## 10. 本次改动的文件

**新增（全部在允许范围内）**

| 路径 | 说明 |
| --- | --- |
| `qianxing-murdoku/tools/qx/graphcode/README.md` | 用法 / 边界 / 判据坑 |
| `qianxing-murdoku/tools/qx/graphcode/nodes.json` | **节点总表**（1,170,152 B） |
| `qianxing-murdoku/tools/qx/graphcode/gen-nodes.mjs` | 外部 `node_data/index.json` + 语义映射 → `nodes.json` |
| `qianxing-murdoku/tools/qx/graphcode/gen-ports.mjs` | 外部 `@node_spec` → 补端口名 |
| `qianxing-murdoku/tools/qx/graphcode/emit.mjs` | spec → Graph Code → 外部 `validate-file`（**不写 `.gil`/`.gia`**） |
| `qianxing-murdoku/tools/qx/graphcode/read.mjs` | `.gil`/`.gia` → `graph.json` + `behavior-spec.md` |
| `qianxing-murdoku/tools/qx/graphcode/specs/min-loop.json` | 最小闭环样例 |
| `qianxing-murdoku/tools/qx/graphcode/test/run-tests.mjs` | **离线自测 43 项**（不联网/不需 Python/不需外部仓库） |
| `qianxing-murdoku/tools/qx/graphcode/out/*` | 生成物（可删可重建） |
| `qianxing-murdoku/docs/节点图双向工具-spike报告.md` | 本文件 |
| `_work/ayaya/**` | 外部仓库副本 + 抓取脚本 + 日志 |

**自测**：

```powershell
node tools/qx/graphcode/test/run-tests.mjs
# → 通过 43，失败 0
```

**没有改动**：`lua/`、`tests/`、`tools/gil/` 现有文件、任何 `.gil`/`.gia`、
`engine_adapter_qianxing.lua`、`main.lua`。`tools/gil/gilread.mjs` 只被 `read.mjs` **import 复用**，未修改。

---

## 附录 A：`emit.mjs` 边界（写死的，别放宽）

1. **只生成 `.py`**。`.gil`/`.gia` 落盘一律外部工具。
2. 给 `--ayaya` 时生成完**立刻**调 `validate-file`，把结果原样打出来（不包装、不吞错）。
3. **校验失败不许改本工程任何东西去"让它通过"** —— 要么改 spec，要么承认该节点在此 scope 不可用。
   （上游自己也立了同一条规矩：不许往 `plugins/nodes/**` 补节点绕过 `CODE_UNKNOWN_NODE_CALL`。）
4. spec 里的 `{"$ref": "名字"}` 是**连线**，不是字符串常量。没有它就只能传常量，图是断的。

## 附录 B：踩过的坑（省下一个人半天）

| # | 坑 | 现象 | 真因 |
| --- | --- | --- | --- |
| 1 | `gilread.mjs` 的 varint 在 `f.num`，不是 `f.value` | 全表 `big_ids=0`，**脚本还正常退出** | 静默空结果 —— 最贵的一类错 |
| 2 | 控件 ID 与节点 ID 同一数值区间 | 候选判据"命中 564 个"，全假 | 控件 ID 是 `1073741824+`，与 `0x4000xxxx` 撞区间 |
| 3 | 启发式判"没有节点图" | 5 个档全报 0 候选 | 外部解码器一跑就有 1 张 ⇒ **否定性结论必须有独立证据** |
| 4 | 拿 `def 事件名(game)` 的形参去比端口名 | "57 个事件节点全部不一致" | 那是**运行期 mock 实现**，形参与端口无关；正确判据只是"端口名是合法标识符" |
| 5 | `pin.kind_int` 当连线类型 | 与上游输出对不上 | 那是**源端** kind；目标端在 `connects[].connect.kind_int` ⇒ 已改为不自己判断 |
| 6 | `git clone` / codeload 拉 57 MB | pack 0 B、zip 卡 9.78 MB 后无中央目录 | 改 `ghfast.top` + 逐文件并行 |
| 7 | PowerShell `-o` / `-or` | 解析器报"意外的标记" | 用 `-or`；`&&` 也不支持 |

---

# 11. MIT 写入路线（2026-10 改基，**现行主路线**）

> 执行：gts-writer　｜　任务卡：`task-7`　｜　用户已拍板
>
> 1. 写入器改为基于 MIT 项目 **[josStorer/genshin-ts](https://github.com/josStorer/genshin-ts)** ——
>    我们**永不自己写 protobuf 节点图**，一律用它的 compile / inject。
> 2. 派生内容（`nodes.json` 等）**入库**。
> 3. 服务端节点图**暂不交付**：本轮只把"写入能力"备好、验证命令能跑，不排期做玩法图。

## 11.0 结论先说（对照 §0）

| 问题 | §0（旧，Ayaya） | 现在（gts） |
| --- | --- | --- |
| 节点图能由代码生成吗？ | 能 | **能** `[实测]` |
| 生成的图能被工具链接受吗？ | 能（外部 validate-file） | **能** `[实测]`（`gsts` 编译出 `.gia`） |
| 能**落盘进 `.gil`** 吗？ | UNKNOWN（要外部导出工具） | **能** `[实测]` —— 已产出真实被注入的 `.gil` 副本（§11.4） |
| 能被**游戏/编辑器**接受吗？ | UNKNOWN | **UNKNOWN（真机未验证）** —— 文件层已经写进去了，但还没进编辑器/真机看效果 |
| "节点名 → 参数/端口"表能产出吗？ | 能（558/534） | **能，且更大**：729 节点 / 620 有中文名（§11.5） |
| 许可 | GPL-3.0（只能子进程隔离） | **MIT**（可以入库、可以分发、可以直接 import） |

**一句话**：老报告的卡点（"落盘只能靠外部工具、还不知成不成"）**已经解开一半** ——
"生成 → 编译 → 注入 `.gil`"全链路在本机跑通、可复现、可回归（`tools/qx/graphcode/gts-build.mjs`）；
**唯一还缺的是真机**：把注入后的 `.gil` 导进编辑器，看节点图在不在、跑一次变量有没有被写。

## 11.1 为什么以 genshin-ts 为主（以及代价）

| 维度 | genshin-ts（选它） | Ayaya_Miliastra_Editor（降级） |
| --- | --- | --- |
| **语言同构** | TypeScript/npm，和本工程（`tools/qx/graphcode/*.mjs`、Node 工具链、`qianxing-murdoku` 的 JS 侧）**同构**；生成的产物就是 TS 源码，人和 AI 都能直接读改 | Python 栈，我们只能"生成 .py 字符串 + 起子进程"，中间的语义差异只能靠文本断言 |
| **许可** | **MIT** ⇒ 数据可入库、代码可直接 import、可随发布物分发 | **GPL-3.0** ⇒ 只能子进程隔离、派生数据不敢入库 |
| **构建** | npm 单包 + node 即可（本机无系统 Python 也能跑） | 需要 Python 3.10–3.12 + 一个几万文件的仓库副本 |
| **完善度** | 官方文档站（`gsts.moe`）、模板 `create-genshin-ts`、ESLint 自定义规则、注入安全校验 + 自动备份、`gsts maps` 找地图、增量编译/监听、可导出 IR JSON 调试 | 逆向工具集，能力更全但没有"编译期语义层"，也没有 ESLint / 类型提示 |
| **对 AI 友好** | `dist/src/definitions/*.d.ts` 里有**完整类型 + 中文 JSDoc（节点名/端口名）**，可以直接抽成机读目录（这就是 §11.5 的来源） | 端口名只在 `@node_spec` 的 Python 里，得静态解析 |

**代价（诚实列出）**

1. **锁版本**：他们迭代很快（本轮 `0.2.3`）。`package.json` 必须**精确锁 `0.2.3`**，升级要重跑 §11.5 + §11.9 的自测。
2. **包装层不薄**：`genshin-ts` 依赖 16 个包（含 `protobufjs` / `esbuild` / `typescript`），首次 `pnpm install` 要联网 ~55 个 tarball（本机实测约 3 分钟，中途 `@esbuild/win32-x64` 重试过一次）。
3. **注入目标受安全规则约束**：目标节点图必须**已存在**且（空 or 名字以 `_GSTS` 开头），否则要显式 `skipSafeCheck`（§11.4 实测报错原文）。
4. **注入后必须重载地图**：注入内容在"重载"之前用编辑器保存地图会被覆盖 —— 这是**流程纪律**问题，不是代码问题。
5. **节点命名有漂移**：数据包的英文显示名与 TS 方法名有 109/498 对不上（§11.5），那批节点暂时拿不到中文名/方法名。

## 11.2 安装（真实命令、版本、联网点、失败点）

本机：**无系统 Python**（本轮主路线不需要它）；node 用 DSH 自带的 `v24.21.0`，包管理器用同目录的 `pnpm 11.8.0`。

```powershell
$NODE = "C:\Users\18182\.dsh\dsh-runtimes\dsh-plugin-desktop-primary-runtime\dependencies\node\bin\node.exe"
$PNPM = "C:\Users\18182\.dsh\dsh-runtimes\dsh-plugin-desktop-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"

# 装到 _work/gts（**不污染仓库**）
New-Item -ItemType Directory -Force -Path "D:\新建文件夹\miHoYo Launcher\_work\gts" | Out-Null
# package.json 里写死 "genshin-ts": "0.2.3"
Push-Location "D:\新建文件夹\miHoYo Launcher\_work\gts"
& $NODE $PNPM install --reporter=append-only
Pop-Location
```

**结果** `[实测]`：

| 项 | 值 |
| --- | --- |
| 包 | `genshin-ts@0.2.3`（MIT，`bin: gsts → bin/gsts.mjs`） |
| 依赖 | `+55` 包（`+genshin-ts 0.2.3`） |
| 网络 | **需要联网**。npm registry 可达；`raw.githubusercontent.com` **超时**（`ghfast.top` / `gh-proxy.com` 反代或 GitHub API 可用） |
| 失败点 | `pnpm install` 退出码 **1**：`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.2, protobufjs@7.6.6`。**不影响使用**（esbuild 的二进制在可选平台包里）—— 实测编译/注入全通。要消掉它就 `pnpm approve-builds` 或在 `package.json` 的 `pnpm.onlyBuiltDependencies` 里放行 |
| 运行期告警 | `gsts` 启动会做 `检查更新 / 检查公告`，本机**必然失败**（`update check failed: This operation was aborted`），**只是 warning，退出码 0** |

> 顺带：`create-genshin-ts@0.2.3`（MIT，零依赖）只是脚手架，模板在 `templates/start/`（`src/main.ts` + `gsts.config.ts` + `tsconfig.json`）。
> 我们**没有**用 `npm create`（要联网跑 npm 脚本），而是**照模板手工在 `_work/gts/proj/` 搭了一份最小的**，等价且可控。

## 11.3 compile：真实 CLI 用法与产物

```powershell
cd "D:\新建文件夹\miHoYo Launcher\_work\gts\proj"
& $NODE "D:\新建文件夹\miHoYo Launcher\_work\gts\node_modules\genshin-ts\bin\gsts.mjs" `
      -c gsts.config.ts --noinject --lang zh-CN
```

最小工程（`_work/gts/proj/`）：

```ts
// src/main.ts
import { g } from 'genshin-ts/runtime/core'
g.server({ id: 1073741825 }).on('whenEntityIsCreated', (_evt, f) => {
  f.printString('qx-gts hello')
})
```

`gsts.config.ts` = `{ compileRoot: '.', entries: ['./src'], outDir: './dist' }`。

**真实输出** `[实测]`（退出码 0）：

```
[info] 开始编译…
[ok] …\dist\src\main.gs.ts
[info] 开始生成 GIA…
[ok] …\dist\src\main.json
[ok] …\dist\src\main.gia (id=1073741825)
[info] GIA 全部生成完成（1 个）
[warn] --noinject 已启用，跳过注入
```

**产物差异** `[实测]`：

| 文件 | 大小 | 是什么 |
| --- | --- | --- |
| `main.gs.ts` | 364 B | TS 被**展开成节点函数调用**的中间文件（`// @gsts:entry`），排错第一现场 |
| `main.gs.js` / `.js.map` | 222 / 624 B | 上述中间件的 JS 版（编译器执行它来吐 IR） |
| `main.json` | 549 B | **IR**：`{ graph: {type:'server', mode:'beyond', sub_type:'entity', id:1073741825, name:'_GSTS_main'}, variables:[], nodes:[{id:1,type:'when_entity_is_created',next:[2]},{id:2,type:'print_string',args:[{type:'str',value:'qx-gts hello'}]}] }` |
| `main.gia` | **360 B** | 可注入产物；文件头 `00 00 01 64 … 00 00 03 26 …`（`.gia` 与 `.gil` 同族魔数 `0x0326`） |

关键点：`g.server({id}).name` 默认会被加 `_GSTS_` 前缀 ⇒ **天然满足注入安全规则里"名字以 `_GSTS` 开头"那一条**。

## 11.4 inject：真实用法与产物（**只写 `_work/` 的存档副本**）

### 11.4.1 先确认目标 `.gil` 里到底有没有节点图

老报告 §5.4 的"我们这些档没有节点图"这个结论**是错的**。用 gts 自带的解码件（`injector/node_graph.js` 的 `buildNodeGraphFieldIndex`）一扫：

```
485-教程teach-v289.gil              → nodeGraph id=1073741825, type=20000, 出现 1 次
517-模板测试-v2.gil                 → nodeGraph id=1073741825, type=20000, 出现 1 次
assets/纯2D游戏模板(客户端脚本版).gil → nodeGraph id=1073741830 / 1073741831, type=20000
```

⇒ **我们的存档里本来就有服务端节点图（id `1073741825`，`type=20000`）**。
旧结论翻车的原因见附录 B 第 3 条：**否定性结论没有独立证据**。

### 11.4.2 注入的两条路（都实测过）

**路 A：`gsts` 配置注入（上游官方口径，写"真机存档目录"）**

```ts
// gsts.config.ts
inject: { gameRegion: 'China', playerId: 153793556, mapId: 1073742207,
          nodeGraphId: 1073741825, skipSafeCheck: false }
```

`resolveGilTarget()` 的行为 `[实测 读代码]`：只认
`%LocalLow%\miHoYo\原神\BeyondLocal\<playerId>\Beyond_Local_Save_Level\<mapId>\<mapId>.gil`，
**不接受任意路径**；注入前会 `maybeBackupGil()` 自动备份（保留 200 份）。
`gsts maps` 能列出这台机器上真实存在的地图 `[实测，退出码 0，81 行]`：

```
[ok] maps: C:\Users\18182\AppData\LocalLow\miHoYo\原神\BeyondLocal\153793556\Beyond_Local_Save_Level
         1073742207  2026/10/22 13:01:08
         …
```

> ⚠️ 本任务**没有**用路 A 写用户真实存档 —— 边界是"只写 `_work/`"。路 A 与本轮用的是**同一个注入器**
> （`src/cli/gsts.js` 第 211/224 行：`injector.injectManyBytes({… skipNonEmptyCheck: !!gilCfg.skipSafeCheck})`），
> 差别只在"目标文件从哪来"和"有没有自动备份"。

**路 B：直接调 `injectGilFile()`（本轮采用，可指定 `outPath`、可对副本操作）**

```js
import { injectGilFile } from '<gts>/dist/src/injector/index.js'
injectGilFile({ gilPath: '<副本>.before.gil', giaPath: '<x>.gia',
                targetId: 1073741825, skipNonEmptyCheck: false,
                outPath: '<产物>.after.gil', lang: 'zh-CN' })
```

### 11.4.3 三条已知规则的**实测验证**

| 规则（上游文档） | 实测 | 证据 |
| --- | --- | --- |
| **目标图必须存在**，且（空图 or 名字以 `_GSTS` 开头） | ✅ 命中 | 不加 `skipSafeCheck` 时被拒：`[error] target NodeGraph not empty and name not _GSTS*: 新建节点图`（485 档里那张图叫"新建节点图"，有 7 个节点） |
| **`inject.skipSafeCheck` 可关安全检查** | ✅ 命中 | 加 `--skip-safe-check`（= `skipNonEmptyCheck: true`）后 `mode=replace` 成功 |
| **注入后需要重载地图** | ⏳ 只能真机验证 | `[实测 读文档]` 见 §11.8；代码层面无法证伪 |

### 11.4.4 端到端产物（`[实测]`，本轮最终证据）

```powershell
cd "D:\新建文件夹\miHoYo Launcher\qianxing-murdoku"
& $NODE tools\qx\graphcode\gts-build.mjs `
    --src="tools\qx\graphcode\out\模板_qx最小闭环_实体创建时写变量.ts" `
    --workbench="D:\新建文件夹\miHoYo Launcher\_work\gts" `
    --copy-gil="485-教程teach-v289.gil" `
    --outdir="D:\新建文件夹\miHoYo Launcher\_work\gts-out" `
    --skip-safe-check
```

| 文件 | 字节 | sha256（前 16） | 说明 |
| --- | --- | --- | --- |
| `qianxing-murdoku\485-教程teach-v289.gil`（**只读源**） | 1 699 178 | `714c6e9764483ea5…` | **前后一致，仓库存档一个字节没动** |
| `_work\gts-out\485-教程teach-v289.before.gil` | 1 699 178 | `714c6e9764483ea5…` | 逐字节副本（注入基线） |
| `_work\gts-out\485-教程teach-v289.after.gil` | **1 698 825** | `834d1637d841dfd6…` | **真的被注入过的 `.gil`**，字节差 **−353** |

**读回来对账** `[实测]`（用 gts 的 `findNodeGraphTargets` 解码目标图）：

```
before: id=1073741825 type=20000 nodeCount=7  nodes=[1610612746,1610612750,22,652,77,248,128]   ← 原来的"新建节点图"
after : id=1073741825 type=20000 nodeCount=3  nodes=[71,1,22]
```

`71` = `when_entity_is_created`（实体创建时）、`1` = `print_string`（打印字符串）、`22` = `set_custom_variable`（设置自定义变量）——
**和 `specs/min-loop.json` 的 1 触发器 + 2 节点完全对上**，图 id / 图类型不变。

## 11.5 节点表换源：`nodes.json` 改成 MIT 派生

**能不能从 MIT 源导出"节点名 → 参数/端口"目录？能，而且比 Ayaya 版更大。**

`gen-nodes.mjs --gts=<genshin-ts 安装目录>` 只读下面这些 **MIT** 文件：

| 来源（只读） | 提供什么 | 条数 |
| --- | --- | --- |
| `node_data/node_pin_records.js` → `NODE_PIN_RECORDS` | 服务端节点：英文显示名 / id / `inputs[]` `outputs[]`（**类型表达式**，如 `Str`、`R<T>`、`L<R<T>>`）/ `reflectMap` 泛型具体化表 | **498** |
| `node_data/client_node_metadata.js` → `CLIENT_NODE_METADATA` | 客户端节点：**中文 `displayName`** + 带类型/默认值的 pins | 907 条 → 去重 **231** 个 `nodeType` |
| `node_data/types_list.js` → `TYPES_LIST` | 类型表 | **26**（与旧 Ayaya 版**同数**，可交叉验证） |
| `node_data/enum_id.js` | `ENUM_ID` 59 / `ENUM_ID_CLIENT` 46 / `ENUM_VALUE` 259 | — |
| `definitions/zh_aliases.js` | `SERVER_F_EN_TO_ZH` 423 / `SERVER_EVENT_EN_TO_ZH` 65（**中文名 ↔ TS 方法名**，等价于 Ayaya 的 `node_type_semantic_map.json`） | — |
| `definitions/events.js` → `ServerEventMetadata` | **触发器（Trigger）判定依据** | **65** |
| `definitions/nodes.d.ts` | 每个 `f` 方法 JSDoc 里的**中文节点名 + 中文端口名**（读文本静态解析） | 398 个方法拿到中文名 |
| `definitions/events-payload.d.ts` | 每个事件出参的 **中文端口名 → TS 字段名** | — |

**换源结果（`tools/qx/graphcode/nodes.json`，已入库）** `[实测]`：

| 指标 | 旧（Ayaya / GPL-3.0） | 新（genshin-ts / **MIT**） |
| --- | --- | --- |
| 节点总数 | 558 | **729**（服务端 498 + 客户端 231） |
| 有中文名 | 534 | **620** |
| 服务端 Trigger | 57 | **55**（另有 events 目录 65 条） |
| 类型 | 26 | **26**（同数） |
| 枚举 | — | **59** |
| 许可标注 | `GPL-3.0` ⚠️ | **`MIT`** ✅ 可入库、可分发 |
| 独有字段 | `graph_consts`(8) | **没有**（Ayaya 专有概念，已删） |
| 多出来的 | — | `method`（TS 方法名）、`reflect_map`（泛型具体化）、`events[].payload[]`（中文出参→TS 字段） |

```powershell
node tools/qx/graphcode/gen-nodes.mjs --gts="D:\新建文件夹\miHoYo Launcher\_work\gts"
# ✅ 节点 729（有中文名 620）／类型 26，枚举 59，事件 65
#    Server/Function 443 ｜ Server/Trigger 55 ｜ Client/ClientNode 231
```

**诚实的两处缺口**（都写进了 `nodes.json` 的 `_provenance`）：

1. `counts.server_without_dsl = 109` —— 数据包的英文显示名和 TS 方法名有漂移
   （`Split 3D Vector` vs `split3dVector` 之类），这批节点 `method` 为空，**`emit --target=gts` 会拒绝生成**，不猜。
2. `counts.server_without_port_names = 321` —— 上游 JSDoc 没给中文端口名（`name: null`），只有 `type`。
   另外：`inputs_types` 的**顺序来自数据包**，可能含隐藏/派生 pin（`设置自定义变量` 就多一个 `Unk`），
   **gts 的位置参数顺序以 `dist/src/definitions/*.d.ts` 的方法签名为准**，不是数据包的 pin 表。

## 11.6 生成链路：`emit.mjs --target=gts`（默认）+ `gts-build.mjs`

```
specs/*.json ──emit(默认 target=gts)──▶ out/<graph_name>.ts
                                            │
                          gts-build.mjs ────┤ compile(= gsts --noinject) 
                                            ▼
                                     dist/src/<name>.{gs.ts,json,gia}
                                            │
                          gts-build.mjs ────┤ inject(= injectGilFile → 只写 .gil 副本)
                                            ▼
                                  _work/gts-out/<base>.{before,after}.gil
```

- `--target=gts`（**默认**）：产 **TS 源码**，`import { g } from 'genshin-ts/runtime/core'`，
  中文事件名 → gts 方法名、事件出参中文名 → `evt.<字段>`、节点中文名 → `f.<方法>(位置参数)`、
  `{"$ref":"x"}` → 连线、`{"$int":n}` → `n` 的 bigint 字面量。
- `--target=ayaya`：**DEPRECATED**，保留历史分支（`emit.mjs` 里已写注释"仅历史参考、不参与流水线"），
  回归用例 `specs/min-loop-ayaya.json`，离线可测。
- `emit.mjs` **只写源码**，`.gil`/`.gia` 一律不碰。

`out/模板_qx最小闭环_实体创建时写变量.ts`（`[实测]` 生成）核心 6 行：

```ts
g.server({ id: 1073741825, name: "模板_qx最小闭环_实体创建时写变量" })
  .on("whenEntityIsCreated", (evt, f) => {
    const 事件源实体 = evt.eventSourceEntity
    const 事件源GUID = evt.eventSourceGuid
    f.printString('qx-min-loop: entity created')
    f.setCustomVariable(事件源实体, 'qx_min_loop_flag', 1n, true)
  })
```

## 11.7 风险矩阵

| # | 风险 | 真实表现（本轮实测） | 缓解 |
| --- | --- | --- | --- |
| 1 | **许可** | gts + 其内嵌数据包**都是 MIT** ⇒ 派生表可入库 | 保留 `_provenance`（upstream / license / sources / regenerate）；`--ayaya` 分支的产物**明确写"不入库"** |
| 2 | **版本漂移** | 他们发版快（0.2.3 而已）；定义文件一改，`nodes.json`/`emit` 可能漂 | `package.json` **精确锁 `0.2.3`**；升级必须重跑 `gen-nodes --gts` + `run-tests.mjs`（72 项）并 diff `nodes.json` |
| 3 | **构建 / 环境** | node 24.21.0 + pnpm 11.8.0 可跑；`pnpm install` 退出码 1（`IGNORED_BUILDS`）但**不影响功能**；`gsts` 每次启动都打 2 条网络告警 | 允许 `IGNORED_BUILDS`；把 `检查更新/检查公告` 两条告警当噪声过滤（`gts-build.mjs` 已做） |
| 4 | **网络** | npm registry 通；`raw.githubusercontent.com` 超时 | 只用 npm registry + GitHub API；反代 `ghfast.top`/`gh-proxy.com` 备用 |
| 5 | **注入依赖地图与信号表** | 注入**必须**目标图已存在（`target-not-found` 就失败）；编译期会从目标地图抽信号定义到 `src/resources/signals.ts` | 流程纪律：**先在编辑器里建图并保存**，再注入；`gsts maps` 找 `mapId` |
| 6 | **注入后需重载地图** | 未重载就用编辑器保存地图 ⇒ 注入内容被覆盖 | 交付文档必须写死这条；`gts.config` 有 `reinjectOnMapChange` 可兜底 |
| 7 | **安全规则 vs 我们的旧档** | 我们档里的图叫"新建节点图"（非空、非 `_GSTS*`）⇒ 默认注入**被拒** | 正路：编辑器里建 `_GSTS*` 图；临时路：`--skip-safe-check`（= `inject.skipSafeCheck`） |
| 8 | **节点命名漂移** | 109/498 服务端节点拿不到中文名/方法名 | 不猜：`method` 为空就**拒绝生成**并报错；缺口记在 `counts.server_without_dsl` |
| 9 | **真机** | 完全未验证 | §11.8 |

## 11.8 真机未验证点（必须说清，不许当已验证）

1. **注入后的 `.gil` 能不能被编辑器/游戏吃下** —— 文件层已经写进去了（图 id/类型/节点数都能对账），
   但"编辑器打开看不看得见这张图、能不能编辑"**没验证**。
2. **`genericId` 与节点语义的对应**只从数据包/官方命名推出来的，**没有在编辑器里逐个比对**。
3. **运行期效果**：`实体创建时 → 打印字符串 → 设置自定义变量` 是否真的写进自定义变量，未验证。
4. **信号/自定义变量/资源**：`signals.ts` 的抽取逻辑只在真实地图上才能触发，本轮**只读代码，未执行**。
5. **重载地图**这条规则，只在文档里看到，**没有在客户端上跑一遍**。

## 11.9 "节点图交付"解除阻塞，还差什么

**已经不再缺**：写入器（有，MIT）、节点表（有，MIT）、生成器（有）、编译（通）、注入（通）、回归测试（离线 72 项）。

**还缺（按代价从低到高）**：

| # | 缺什么 | 谁来做 | 说明 |
| --- | --- | --- | --- |
| 1 | **一次真机确认** | 用户 | 把 `_work/gts-out/485-教程teach-v289.after.gil` 导进编辑器 → 看 id `1073741825` 的图是不是 3 个节点 → 关卡跑一次看 `qx_min_loop_flag` |
| 2 | **一个 `_GSTS*` 命名的空图** | 用户（编辑器里点几下） | 有它就不用 `skipSafeCheck`，走完全干净的安全路径 |
| 3 | **把 `.gia` 手动导入验证一遍** | 用户 | 上游还有"直接导入 `.gia`"的路子，可交叉验证是"注入"还是"我们生成的图"有问题 |
| 4 | **服务端玩法图的需求** | 产品 | 用户已定：**本轮不交付**。所以这条**不排期** |
| 5 | 补齐 109 个命名漂移节点 | 我们 | 要么等上游修，要么按 `reflectMap`/`NODE_ID` 反查，**不许猜** |

**下一步一条命令**（跑完整链路，仍只写 `_work/`）：

```powershell
cd "D:\新建文件夹\miHoYo Launcher\qianxing-murdoku"
& "C:\Users\18182\.dsh\dsh-runtimes\dsh-plugin-desktop-primary-runtime\dependencies\node\bin\node.exe" `
  tools\qx\graphcode\gts-build.mjs `
  --src="tools\qx\graphcode\out\模板_qx最小闭环_实体创建时写变量.ts" `
  --workbench="D:\新建文件夹\miHoYo Launcher\_work\gts" `
  --copy-gil="485-教程teach-v289.gil" --outdir="D:\新建文件夹\miHoYo Launcher\_work\gts-out" --skip-safe-check
```

## 11.10 本轮改动与自测

| 路径 | 动作 | 说明 |
| --- | --- | --- |
| `tools/qx/graphcode/gen-nodes.mjs` | 改 | **新增 `--gts=`（主路线，MIT）**；`--ayaya=` 降级 fallback（注释与 provenance 都写死"产物不入库"） |
| `tools/qx/graphcode/nodes.json` | **换源重生** | 729 节点 / 620 中文名 / 26 类型 / 59 枚举 / 65 事件；头标 `MIT` |
| `tools/qx/graphcode/emit.mjs` | 改 | **默认 `--target=gts`** 产出 TS；`--target=ayaya` 标 DEPRECATED；新增数字 `graph_id`、`graph_subtype`、`{"$int":n}`、positional `args` 校验 |
| `tools/qx/graphcode/gts-build.mjs` | 新增 | compile →（可选）inject；只写 workbench 与 `.gil` 副本 |
| `tools/qx/graphcode/specs/min-loop.json` | 改 | 改成 gts 口径（数字 id + 数组 args） |
| `tools/qx/graphcode/specs/min-loop-ayaya.json` | 新增 | ayaya 分支的回归 fixture |
| `tools/qx/graphcode/test/run-tests.mjs` | 重写 | **72 项全绿**，仍**不联网 / 不需 Python / 不需外部仓库** |
| `tools/qx/graphcode/README.md` | 改 | 顶上加定位：主路线 = gts |
| `_work/gts/**`、`_work/gts-out/**` | 新增 | workbench（`genshin-ts@0.2.3`）+ 最小工程 + 注入副本 + 探针脚本 |

```powershell
node tools/qx/graphcode/test/run-tests.mjs
# → 通过 72，失败 0
```

**没有改动**：`lua/`、`tests/`、`tools/gil/` 现有文件、仓库内任何 `.gil`/`.gia`（只复制到 `_work/`）、
`main.lua`、`ui_controller.lua`、`engine_adapter_qianxing.lua`。

---

# 12. 官方 `.gia` 样本验收集（2026-11）

> 前置事实：用户已在真实编辑器里**成功导入 gsts 编译出的 `.gia`**，链路通了。
> 于是把「节点图 → 规格/IR」这一侧拿 5 份**真实官方/社区 `.gia`** 打磨一遍，并用反向回编译
> （读 → 译 → gts compile）量出**翻译算法的实测边界**。

## 12.0 结论先说

| # | 结论 | 证据等级 |
| --- | --- | --- |
| 1 | **节点图层不再需要 Python / 外部仓库**：`.gia` 的 wire 结构已解，纯 Node 可读 | [实测] 5 份样本全解，0 个未知类型 id |
| 2 | **端口语义名解出来了**（旧版最缺的一层）：本文件内定义的节点带引脚名 | [实测] 复合节点定义里有 `#100..#103` 引脚消息 |
| 3 | **常量解得出来**（float32 / int / str / bool / enum / Vec3 / list / 泛型包裹） | [实测] 2000+ 个常量全覆盖，无一例 UNKNOWN（除字典） |
| 4 | **连线方向能定**：引脚种类 1..4 = 执行入/执行出/参数入/参数出（与定义侧字段号差 99） | [实测] 5 份样本的数据流能复现出合理语义（见 §12.2 坠崖保护） |
| 5 | **读得出 ≠ 译得回**：5 份样本的 7 个图里只有 **2 个**能完整翻译并编译通过 | [实测] 见 §12.4 |
| 6 | **`.gil`（整张地图）的节点图段本工具没解**：布局完全不同 | [实测] `517-模板测试-v2.gil` 用新解码器得 0 单元 |
| 7 | **`nodes.json` 的中文名不唯一**：74 组 dsl 同时存在于服务端与客户端，且客户端那条没有 method | [实测] 朴素的 `byDsl.set` 会让「双分支」查出空 method |

## 12.1 这一轮解出来的 wire 结构（`.gia` 导出布局）

```
信封：offset 0,4,8,12,16 = 5×u32；u32[16] = bodyLen；body = 20..20+bodyLen；trailer 4 字节

root #1 = graph 桶的 GraphUnit × n
root #2 = acc   桶的 GraphUnit × n        ← 同一个 guid 空间，会撞号 ⇒ 用 (bucket,index) 定位
GraphUnit = { #1 Id{#2 class, #3 type, #4 guid}  #2 相关 id  #3 name  #5 which
              #13 节点图内容(which=9)  #14 节点单元内容(which=12/14)  #19 控件  #35 脚本 }

which 种类（只写实测见到的；语义没解的标 UNKNOWN，不猜）：
  1=模型  7=UNKNOWN(#15 载荷)  9=节点图  12/14=节点单元定义  15=容器节点
  18/19=模版  21=界面控件组  61=UNKNOWN  69=客户端脚本

节点图 which=9：#13 → #1 → #1 = inner
  inner #1 头{#1=10000 #2=20000|20002 #3=21001|21002 #5=<graphId>}
  inner #2 图名（常为空 ⇒ 回退 unit#3 ⇒ 再回退「定义单元的 guid == graphId」拿复合节点名）
  inner #3 实例 × n      ← 实例{#1 序号 #2 类型元组 #4 引脚绑定 #5/#6 画布 x/y #7 注释}
  inner #6 组/注释 × m

类型元组 #2 = { #1=10001  #2=20000|20002  #3=22000|22001  #5=<typeId> }
  #3=22000 ⇒ typeId 在全局节点目录（nodes.json）
  #3=22001 ⇒ typeId **本文件内定义**（which=12/14 的节点单元）← 这就是「复合节点」

节点单元定义 which=12/14：#14 → #1 → #1 = body
  body #4 类型引用 / #100 执行入 / #101 执行出 / #102 参数入 / #103 参数出
  每个引脚 { #1 引脚名  #3 引脚序号  #4 类型或默认值  #8 引脚 id }
  ⇒ **端口语义名的唯一来源**（旧版只能写 UNKNOWN 的就是这一层）

引脚绑定 body#4 = { #1{种类,序号}  #2 同上  #3 常量信封  #4 常量种类  #5{对端实例, 对端引脚} }
  引脚种类（[实测] 与定义侧字段号严格差 99，且方向能被 5 份样本的数据流复现）：
    1=执行流入  2=执行流出  3=输入参数  4=输出参数
  ★ 一个绑定记录住在实例 A 上，说的是「A 的本端引脚 ↔ B 的对端引脚」。
    **光看记录推不出方向**：A 的 pin 是 out 就 A→B，是 in 就 B→A。
    旧版正是栽在这里（把源端 kind 当连线类型，7 条全报成一种），别重犯。

常量信封（2000+ 个样本全覆盖）：
  A 直接形态 { #1=<cat> #2=1 #4=<类型描述> #<值字段>=<值> }
  B 泛型包裹 { #1=10000 #2=1 #110{ #1=<tag> #2{ …与 A 同构… } } }
  类型描述 #4 = { #1=1 #100{ #1=<类型 id> } }，类型 id 与 nodes.json `types[].id` **同一套**
  ⇒ **按类型 id 决定怎么读值**，不要按 cat（实测 cat=6 既装 Boolean 也装 EnumItem 4101/1200）
  值字段：101=Id  102=int  104=**float32**  105=str  106=bool/枚举  107=Vec3{1,2,3}  109=列表元素
  ⚠️ 「字段在但是空消息」(`#104{}`) = 取零值；它和「字段整个不存在」语义相同 —— 看不见就会误判
```

## 12.2 5 份样本读数表　[实测]

命令：

```powershell
cd "D:\新建文件夹\miHoYo Launcher\qianxing-murdoku"
node tools/qx/graphcode/read.mjs --gil="assets/保护玩家防止坠崖掉落自动传送.gia" --outdir=_work_probe --spec
node tools/qx/graphcode/coverage.mjs --in=assets --md=docs/official-gia-coverage.md
node tools/qx/graphcode/roundtrip.mjs --in=assets --workbench=..\_work\gts
```

| # | 样本 | 字节 | 单元(which) | 节点图 | 节点定义(复合) | 节点 | 连线(执行/数据) | 图变量 | 信号 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `保护玩家防止坠崖掉落自动传送.gia` | 1010 | 7×1, 9×1 | 1 | 0 | 7 | 8（2/6） | — | — |
| 2 | `常用复合节点大全v1.7(…).gia` | 160021 | 9×87, 12×87 | 87 | **87** | 473 | 523 | `time` | — |
| 3 | `实时获取投射物坐标（最快每0.06s获取一次）.gia` | 10407 | 9×4, 12×3 | 4 | 3 | 34 | 42 | — | — |
| 4 | `玩家掉线检测、重连检测、断网检测.gia` | 19777 | 9×2, 12×5, 14×4, 15×1, 21×1, 69×1 | 2 | 9 | 33 | 37 | `NOLOC_isDisconnect` | `[玩家]检测掉线-心跳包`、`[玩家]检测掉线-广播信号` |
| 5 | `只按空格实现二段跳.gia` | 21607 | 1×1, 9×1, 18×1, 19×1 | 1 | 0 | 40 | 60（20/40） | `平台` | — |

**逐份结论**

1. **坠崖保护（1010 B，7 节点）** —— 读出来是一条完整、语义自洽的链：
   `角色移动速度达到条件时` →(执行) `双分支`(条件 = `数值小于等于`(`拆分三维向量`(`获取实体位置与旋转`(`获取角色归属的玩家实体`(事件源实体)))).Y, **-20**))
   →(真) `Teleport Player (Beyond Mode)`(玩家实体, **(10, 0.5, -15)**, **(0, 135, 0)**)。
   所有 3 个 Vec3 与 1 个 float 常量都解出来了（`-20` 走 `#104` float32）。
   ⚠️ 两个节点只有英文名、`nodes.json` 里没有 method：`9 Split 3D Vector`、`288 Teleport Player (Beyond Mode)`。
2. **复合节点大全（160021 B）** —— 这是**分层最丰富**的一份：87 个 `which=12` 节点单元定义 + 87 张实现图，
   其中 **80** 个能靠 `guid == graphId` 对上实现图。定义里带完整引脚名，所以「复合节点」在**读**的层面是全解的。
3. **投射物坐标（10407 B）** —— 4 张图：1 张示例 + 3 张复合节点实现图。示例图 12 节点 / 14 连线，
   用到 `拼装列表`（101 个入参引脚，实测只绑了 2 个，其余是零值空常量）与 2 个复合节点。
4. **掉线检测（19777 B）** —— 唯一带「信号」的一份：`which=12` 里出现 `监听信号`/`发送信号` 的**本地定义**
   （`nodes.json` 里它们是 300001 / 300000，但图里引用的是本文件内定义，所以按 `guid` 解析）。
   还有 `which=15` 容器节点、`which=21` 界面控件组、`which=69` **客户端脚本**单元（名字 `PlayerDisconnectDetector`）。
5. **二段跳（21607 B）** —— 单张 40 节点大图，4 个触发器（实体创建时 / 定时器触发时 / 自定义变量变化时…），
   图变量 `平台`，枚举常量（`跟随坐标系`=1200、`跟随类型`=1100）与非空列表常量（拼装 5 个 int）。

## 12.3 节点类型覆盖度　[实测]

5 份样本一共用到 **107** 个不同的节点类型 id：

| 类别 | 种类数 | 含义 | 处置 |
| --- | --- | --- | --- |
| `SERVER_OK` | 79 | 服务端节点，有中文名 + gts 方法名 | 直接翻译 |
| `ALIAS_OK` | 3 | 上游没给方法名，靠 `node-aliases.json` 人工签名核对补上 | 翻译（[推断]，靠 compile 兜底） |
| `NO_DSL` | 3 | 在 nodes.json 里但**没有中文名**（只有英文显示名） | **拒绝生成** |
| `NO_METHOD` | 0 | 有中文名但没方法名 | **拒绝生成** |
| `COMPOSITE` | 22 | 本文件内定义的复合节点 | **拒绝生成**（要展开实现图） |
| `UNKNOWN` | 0 | 两边都没有 | **拒绝生成** |
| `CLIENT_OK` | 0 | 客户端节点 | 只读，不生成 gts |

- **识别命中率 82/107 = 76.6%**；「解不出来」的 **0** 个。
- 缺的 25 个里，**22 个不是缺失而是「定义在文件里」**（复合节点），真正有问题的只有 **3 个**
  （`[时间]`/`[执行]` 类复合节点实现图里用到的 `Set List Value` / `Get Currently Active Entity Deployment Group List` / `Query Timestamp (UTC+0)` 这类上游没给方法名的节点）。
- **可翻译命中率 = (79+3)/107 = 76.6%**，其余一律拒绝生成。

**处置策略（写进 `node-aliases.json`，不是写进代码的 if）**

| 情况 | 策略 |
| --- | --- |
| `nodes.json` 有 method | 直接用 |
| `nodes.json` 有名字没 method | 查 `node-aliases.json`；**必须**端口个数 + 类型序列 + 返回值个数三项全同且候选唯一，并写 `evidence` + `confidence` |
| 多出参节点 | 查 `node-aliases.json` 的 `out_fields`（属性名不在 nodes.json 里）；查不到报 `MULTI_OUT_PIN` 拒绝生成 |
| 复合节点 | 拒绝生成（记 `COMPOSITE_NODE`）；将来要支持就得**展开实现图**，本工具没做 |
| 什么都不认识 | 拒绝生成（记 `NOT_IN_CATALOG` / `UNKNOWN`），**绝不猜** |

本轮只补了 3 条别名 + 2 条 `out_fields`，全部标 `[推断]`：

| type_id | 英文名 | gts 方法 | 依据 |
| --- | --- | --- | --- |
| 9 | Split 3D Vector | `split3dVector` | `[Vec]→[Flt,Flt,Flt]` ↔ `split3dVector(Vec3Value): {xComponent,yComponent,zComponent}` |
| 225 | Create 3D Vector | `create3dVector` | `[Flt,Flt,Flt]→[Vec]` ↔ `create3dVector(x,y,z): vec3` |
| 288 | Teleport Player (Beyond Mode) | `teleportPlayer` | `[Ety,Vec,Vec]→[]` ↔ `teleportPlayer(entity, loc, rot): void`；⚠️ 显示名带 `(Beyond Mode)`，**语义等价没验证** |

`out_fields`：`9 → [xComponent, yComponent, zComponent]`、`99 → [location, rotate]`（依据 gts `nodes.d.ts` 的返回对象声明）。

## 12.4 emit 回编译结果　[实测]

链路：`.gia` → `giaread` → `read2spec` → `emit.mjs --target=gts` → `gts-build.mjs`（compile only，不 inject）。

| 用例 | 图 | 节点 | 结果 | 说明 |
| --- | --- | --- | --- | --- |
| `atlas-collision-death` | `[执行]角色碰撞死亡`（composite-atlas 的实现图） | 2 | ✅ **compile 通过**，产出 `.gia` 486 B | 进入碰撞触发器时 → 销毁实体(进入者实体) |
| `atlas-hide-player-model` | `[执行]隐藏玩家模型`（同上） | 2 | ✅ **compile 通过**，产出 `.gia` 437 B | 实体创建时 → 激活关闭模型显示(事件源实体, false) |
| `fall-protect-linear` | 坠崖保护 | 7 | ❌ **compile 失败** | `TypeError: fn is not a function` @ `nodes.ts:3239 doubleBranch` |
| `fall-protect-strict` | 坠崖保护 | 7 | ⛔ 我们的层拒绝 | `CONTROL_FLOW_NODE` ×1 |
| `projectile-coords` | 示例-每0.1秒获取一次投射物坐标 | 12 | ⛔ 我们的层拒绝 | `COMPOSITE_NODE`×2 + `CROSS_HANDLER_REF`×4 + `MISSING_ARG`×1 |
| `disconnect-detect` | [玩家]掉线检测 | 31 | ⛔ 我们的层拒绝 | `COMPOSITE_NODE`×3、`NO_DSL_NAME`×2、`NO_METHOD`×2、`CONTROL_FLOW_NODE`×1、`LIST_CONSTANT`×1 … |
| `double-jump` | 跟随 | 40 | ⛔ 我们的层拒绝 | `CONTROL_FLOW_NODE`×4、`ENUM_CONSTANT`×2、`LIST_CONSTANT`×1、`UNKNOWN_CONSTANT`×1 … |

**失败原因分类**（这就是「翻译算法」的实测边界，全在 `read2spec.mjs` 的 `BLOCKERS` 里）：

| 分类 | 含义 | 为什么没法自动绕过 |
| --- | --- | --- |
| `CONTROL_FLOW_NODE` | 双分支/多分支/有限循环/遍历 | gts 的分支 API 是**回调式**（`doubleBranch(cond, onTrue, onFalse)`），emit 的 spec 是平铺调用列表，给不出回调 ⇒ 连 IR 都生成不出来（实测报 `fn is not a function`） |
| `COMPOSITE_NODE` | 本文件内定义的复合节点 | 要「展开实现图」才能译；展开本身是另一件事（递归 + 端口对账），本轮没做 |
| `NO_DSL_NAME` / `NO_METHOD` | 上游数据包没给中文名/方法名 | 只能人工签名核对进 `node-aliases.json`，或等上游修 |
| `MULTI_OUT_PIN` | 取了多出参节点的第 N 个出参 | 属性名不在 nodes.json 里（端口名常为 `null`）⇒ 必须查 `out_fields` |
| `ENUM_CONSTANT` | 枚举常量（如 1200 / 1100 / 4101） | gts 要枚举成员（`FollowCoordinateSystem.X`），数字塞不进去 |
| `LIST_CONSTANT` | 非空列表常量 | 元素能拆出来（`#109`），但 gts 列表字面量写法**没验证** ⇒ 不敢生成 |
| `DICT_CONSTANT` | 字典常量 | 字段布局没解 |
| `CROSS_HANDLER_REF` | 数据引用跨了两个触发器处理器 | emit 的 spec 里 handler 各自独立，名字不共享 |
| `MISSING_ARG` | 某入参既没连线也没常量 | 用零值兜底会**改变语义**，默认不许（有 `--allow-zero-defaults` 开关，但没在任何用例里开） |

⚠️ **两张「通过」的图有个共同点：都没有分支/循环**。这不是巧合，是边界。

## 12.5 固化：fixture + 测试

`assets/` 里的 `.gia` 是别人的产物（未入库、跨版本、体积大）⇒ **不进回归**。
入库的是「我们的解码器从它身上读出来的结论」：

| fixture | 内容 | 用途 |
| --- | --- | --- |
| `fixtures/index.json` | 样本清单 | 自测入口 |
| `fixtures/<slug>.digest.json` ×5 | 信封 / 单元种类 / 每图节点数与类型直方图 / 定义表 / 资源引用 | **解码回归**：算法一改，digest 一 diff |
| `fixtures/fall-protect.decode.json`、`fixtures/projectile-coords.decode.json` | 逐节点的 type_id/来源/名字/坐标/注释 + 全部连线 | **黄金解码**：7 个节点逐条对得上 |
| `fixtures/*.spec.json` ×3 | 翻译产物（emit 口径） | 离线复现翻译 |
| `fixtures/*.emit.ts` ×3 | emit 的黄金输出 | **逐字节比对**，防翻译悄悄漂移 |
| `fixtures/roundtrip.json` | 7 个用例的 status / blockers / compile 结果 / `.gia` 指纹 | **回编译基线** |

```powershell
node tools/qx/graphcode/test/run-tests.mjs
# → 通过 186，失败 0        （本轮从 72 → 186，**新增 114 项**）
```

测试仍然**不联网 / 不需 Python / 不需外部仓库 / 不需要 `assets/` 里的样本**：
`[7]~[11]` 全读 fixtures；`[12]` 验证「样本全缺时工具优雅退化，且不许清空基线」。

## 12.6 本轮改动

| 路径 | 动作 | 说明 |
| --- | --- | --- |
| `tools/qx/graphcode/giaread.mjs` | **新增** | `.gia` 节点图层原生解码（单元/定义/图/实例/绑定/常量/资源引用）。复用 `tools/gil/gilread.mjs` 的 `parseMsg`，不重抄 parser |
| `tools/qx/graphcode/read2spec.mjs` | **新增** | 图 → emit spec + **blocker 分类**（默认 strict，有 blocker 就 exit 2 不产出） |
| `tools/qx/graphcode/coverage.mjs` | **新增** | 覆盖度体检 + fixture 固化 + `docs/official-gia-coverage.md` 生成 |
| `tools/qx/graphcode/roundtrip.mjs` | **新增** | 读→译→emit→compile 全链用例表（用例写死，基线可复现） |
| `tools/qx/graphcode/node-aliases.json` | **新增** | 3 条方法别名 + 2 条 `out_fields`，每条带 `evidence`/`confidence` |
| `tools/qx/graphcode/read.mjs` | 重写 | 节点图层改成**原生**；`--ayaya` 降为可选交叉校验；新增 `--spec`；`.gil` 布局**明确报读不出来** |
| `tools/qx/graphcode/emit.mjs` | 改 | ① 支持 `node-aliases.json`（别名 + 端口仍取 nodes.json）；② 修 `byDsl` 后者覆盖前者导致「双分支」查出空 method |
| `tools/qx/graphcode/test/run-tests.mjs` | 改 | 新增 `[7]`~`[12]`，**186 项全绿** |
| `tools/qx/graphcode/fixtures/**` | **新增** | 只有提取后的 JSON / spec / TS 文本，**没有任何 `.gia`/`.gil` 二进制** |
| `docs/official-gia-coverage.md` | **新增** | 机器生成，别手改 |

**没有改动**：`assets/` 里的 `.gia`（只读）、`lua/`、`tests/`、`tools/gil/` 现有文件、仓库内任何 `.gil`/`.gia`、
`main.lua`、`ui_controller.lua`、`engine_adapter_qianxing.lua`。

## 12.7 未解项（写清楚，别假装解了）

1. **`.gil` 的节点图段**：`.gil` 是整张地图，root 是 1..53 个并列「段」，`readUnits` 得 0 个单元。
   本工具**明确报 `layout: 'other'` 并说读不出来**。要读还得走外部解码器（`--ayaya` + python）。
   这一条是这一轮**最大的退步**（旧版靠外部解码器能读 `.gil`），必须记着。
2. **图头 `tag2`(20000/20002) / `tag3`(21001/21002)** 到底是不是「服务端/客户端」，**没验证出来**，只原样记录。
   （反例：`向服务器节点图发送信号` 是 20002 但 nodes.json 标 Client；`发送客户端脚本信号` 是 20000 且 nodes.json 里根本没有。）
3. **图变量 / 信号没有独立表**：现在的读法是「看引用它们的节点 + 那个字符串常量」，是**间接**证据（标 `[实测-间接]`）。
4. **`which=7` 的 `#15` 载荷**（样本里叫「监听移动速率」）语义未解；`which=61` 也没解。
5. **`(Beyond Mode)` 后缀**：`288` 映射到 `teleportPlayer` 只证明**能编译**，没证明**语义等价**。
6. **语义等价整体没做**：即使编译通过，emit 的顺序调用模型也表达不了分支/循环/注释分组。
7. **列表/字典常量的 gts 写法**：没验证过，所以一律拒绝生成（宁可拒绝，不要生成半对的东西）。

