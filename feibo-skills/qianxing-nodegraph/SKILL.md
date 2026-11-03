---
name: qianxing-nodegraph
description: "千星沙箱（原神 UGC）节点图双向工具链：.gia 节点图解码 → 行为规格（反向翻译）→ genshin-ts TypeScript → .gia（可选注入 .gil 副本）。当用户发来 .gia/.gil 要读节点图、要翻译成规格/TS、要把规格编译成 .gia、或要把节点图写进 .gil 时使用；对应工具 qianxing_gia_read / qianxing_gia_translate / qianxing_spec_emit / qianxing_gia_build / qianxing_selftest。"
---

> 调用说明：本技能提到的工具不是原生工具，需在项目目录 `qianxing-murdoku-tool` 下用命令行调用：
> `node .feibo-plugins/qx.mjs call <工具名> '<JSON参数>'`
> （也可用 `--file=args.json` 传参；`node .feibo-plugins/qx.mjs list --full` 查看参数）

来源插件：`dsh-plugin-qianxing-nodegraph`

本插件的工具：

- `qianxing_gia_read` — 读千星沙箱的 .gia 节点图文件：原生解码节点/连线/常量/端口名，产出 graph.json + 人类可读的 behavior-spec.md（控件层记录也会读）。只读、不改文件。要顺带产出翻译规格时传 spec=true。.gil 的节点图段本工具读不了（会返回 layout=other）。
- `qianxing_gia_translate` — 把 .gia 节点图反向翻译成 emit.mjs 能消费的行为规格 JSON（spec）。能译的图才写 spec；分支/循环/枚举/列表/字典常量/复合节点等会按 BLOCKERS 分类拒绝并在 translate.json 里写明原因（退出码 2），不要当成功。
- `qianxing_spec_emit` — 把行为规格 JSON（qianxing_gia_translate 的产物，或手写 spec）编译成 genshin-ts 的 TypeScript 源码（人可读、可手改、可进版本库）。纯离线，不联网。
- `qianxing_gia_build` — 调上游 genshin-ts（MIT）把 TypeScript 编译成 .gia；可选 --copy-gil 把节点图注入到 .gil 的副本（不原地改存档）。需要服务器上有一个装了 genshin-ts 的 workbench 目录（含 node_modules/genshin-ts/bin/gsts.mjs）；没有
- `qianxing_gil_graph_ids` — 列出 .gil 存档里所有节点图 id（注入节点图时的 targetId 必须是其中之一）。只读；需要 genshin-ts 工作台来解析 .gil 内部结构。
- `qianxing_selftest` — 跑 vendor 工具链的离线回归（186 项，不联网、不需要 Python、不需要样本 .gia），确认插件自带的工具链完好。

---

# qianxing-nodegraph · 千星沙箱节点图双向工具链

把 `.gia` 节点图「读出来 / 反向翻译成规格 / 编译成 genshin-ts TS / 编译回 `.gia` 并注入 `.gil` 副本」。
底层是 `qianxing-murdoku-tool`（MIT，零依赖），本插件已 vendor 进包，不需要额外装任何东西。

## 何时使用

- 用户发来 **`.gia`** 文件，要「看看里面节点图长什么样 / 有哪些节点、连线、常量」
- 要把 `.gia` 的节点图**反向翻译**成行为规格 JSON 或 TypeScript 源码
- 有行为规格 JSON / TS，要**编译成 `.gia`**，或**写进 `.gil` 存档副本**
- 要确认工具链本身是否正常（离线自测）

## 工具

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `qianxing_gia_read` | `.gia`（或 `.gil` 控件层）→ `graph.json` + `behavior-spec.md` | `path`，可选 `spec=true` 顺带翻译 |
| `qianxing_gia_translate` | `.gia` → 行为规格 `spec.json`（译不动的写 BLOCKERS 报告） | `path` |
| `qianxing_spec_emit` | 行为规格 JSON → genshin-ts TypeScript | `spec` |
| `qianxing_gia_build` | TS → `.gia`（compile），可选注入 `.gil` **副本** | `ts`、`workbench`、可选 `copyGil`、`targetId` |
| `qianxing_gil_graph_ids` | 列出 `.gil` 里所有节点图 id（注入用 targetId） | `gil`、`workbench` |
| `qianxing_selftest` | 离线回归 186 项 | 无 |

产物默认落在 `~/.dsh/qianxing-out/`，工具返回里带绝对路径清单。

## 标准流程

1. 用户在 QQ 发来文件（会被下载到 `~/.dsh-qqbot/media/`）
2. `qianxing_gia_read(path=<文件绝对路径>, spec=true)` → 看 `stdout` 与 `artifacts`
3. 需要规格就 `qianxing_gia_translate`；被拒绝（exit=2）时**如实告诉用户**是哪类 BLOCKERS，不要当成功
4. 规格 → TS：`qianxing_spec_emit(spec=<spec.json 路径>)`
5. TS → `.gia`：`qianxing_gia_build(ts=<ts 路径>, workbench=/root/gts-workbench, copyGil=<可选 .gil>, targetId=<可选：.gil 里已有的节点图 id>)`
   - 要注入 `.gil` 前，先 `qianxing_gil_graph_ids(gil=<.gil 路径>, workbench=/root/gts-workbench)` 拿 targetId（必须是存档里已存在的图 id）
6. 把产物（`.gia` / `.gil` / `.md` / `.json`）用 `qqbot_send_file` 发回给用户；发完不要附加解释

## 硬限制（必须如实转告，不许糊弄）

- **`.gil` 里的节点图段读不出来**：`qianxing_gia_read` 对 `.gil` 只读控件层，节点图会返回 `layout: "other"`、`graphs: []`。
- **反向翻译会拒绝**：分支/循环（`CONTROL_FLOW_NODE`）、枚举/列表/字典常量、复合节点（`COMPOSITE_NODE`）、多出参等一律按 BLOCKERS 拒绝，退出码 2 —— 这是设计，不要改写成"成功"。
- **写方向依赖上游 genshin-ts**：`qianxing_gia_build` 需要一个装了 `genshin-ts` 的 workbench 目录（`/root/gts-workbench`），没有就返回 `E_NO_WORKBENCH`，不许假装编译成功。
- **注入只写副本**：`copyGil` 会被复制一份再写，绝不原地改存档。
- **真机未验证**：工具链自带的说明是"注入后的 `.gil` 被编辑器/游戏接受"这一步还没在真机确认过；不要把"文件层成功"说成"游戏里已生效"。

## 排错

- `E_NO_WORKBENCH`：先建工作台：`mkdir -p /root/gts-workbench && cd /root/gts-workbench && npm init -y && npm i genshin-ts`
- 命令超时：单条渲染/编译命令加 `timeout`，大文件编译可能 1-3 分钟
- 中文乱码/路径找不到：统一用绝对路径；QQ 下载目录在 `~/.dsh-qqbot/media/`

