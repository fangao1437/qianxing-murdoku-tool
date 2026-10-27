## 千星节点图双向工具链 · 使用说明

插件：`dsh-plugin-qianxing-nodegraph`（vendor 自 `qianxing-murdoku-tool`，MIT）
底层：`.gia` 节点图原生解码 + 行为规格反向翻译 + genshin-ts 编译/注入。

## 能做什么

1. 读 `.gia` 节点图：节点、连线、常量、端口名 → `graph.json` + `behavior-spec.md`
2. `.gia` → 行为规格 JSON（能译的才写，译不动按 BLOCKERS 拒绝）
3. 行为规格 → genshin-ts TypeScript 源码
4. TS → `.gia`（compile）
5. 把编译好的 `.gia` 注入 `.gil` 存档的**副本**（不原地改档）

## 工具与参数

- `qianxing_gia_read` — 读 `.gia` / `.gil` 控件层
  - `path`：文件绝对路径；`spec=true` 顺带翻译；`outdir` 可选
- `qianxing_gia_translate` — `.gia` → 行为规格
  - `path`；`outdir` 可选；退出码 2 = 有图被 BLOCKERS 拒绝（不是成功）
- `qianxing_spec_emit` — 规格 → TS
  - `spec`；`outdir` 可选
- `qianxing_gia_build` — TS → `.gia`，可选注入 `.gil` 副本
  - `ts`；`workbench`（默认 `/root/gts-workbench`）；`copyGil`；`targetId`；`outdir`
- `qianxing_gil_graph_ids` — 列出 `.gil` 里所有节点图 id
  - `gil`；`workbench`（注入前先用它拿 targetId）
- `qianxing_selftest` — 离线回归（186 项）

产物默认目录：`/root/.dsh/qianxing-out/`

## 典型流程

```
① 用户发 .gia → qianxing_gia_read(path, spec=true)
② 需要规格 → qianxing_gia_translate(path)（被拒绝就看 translate.json 的 BLOCKERS）
③ 规格 → TS → qianxing_spec_emit(spec)
④ TS → .gia → qianxing_gia_build(ts, workbench=/root/gts-workbench)
⑤ 要写存档 → qianxing_gil_graph_ids(gil=/root/xxx.gil)
             → qianxing_gia_build(ts, copyGil=/root/xxx.gil, targetId=<已有图 id>)
⑥ 产物（.gia / .gil / md / json）用 qqbot_send_file 发回
```

QQ 里发来的文件会下载到 `/root/.dsh-qqbot/media/`，可以直接作为路径使用。

## 限制（务必如实转告）

- `.gil` 里的**节点图段读不出来**：只支持读 `.gia`；`.gil` 只读控件层（返回 layout=other、graphs=[]）。
- 反向翻译会**拒绝**分支/循环（CONTROL_FLOW_NODE）、枚举/列表/字典常量、复合节点、多出参等，退出码 2；这是设计，不要改写成成功。
- 注入 `.gil` 必须有**已存在的目标图 id**（用 `qianxing_gil_graph_ids` 查）；只写副本，源存档不动。
- 注入后必须**在编辑器里重载地图再保存**，否则会被旧存档覆盖；真机是否接受注入档尚未验证。
- 写方向依赖上游 genshin-ts 工作台：`/root/gts-workbench`（已装 genshin-ts 0.2.3）。

## 常用命令

- `/qianxing-nodegraph help` — 本说明（自动打包成 zip 文件发送）
- `/qianxing-nodegraph tools` — 工具列表
- `/qianxing-nodegraph flow` — 典型流程
- `/qianxing-nodegraph limits` — 限制清单
- `/qianxing-nodegraph faq` — 常见问题

群里使用需要 @机器人；私聊直接发命令即可。

## 常见问题

- **E_NO_WORKBENCH**：服务器缺 genshin-ts 工作台，执行
  `mkdir -p /root/gts-workbench && cd /root/gts-workbench && npm init -y && npm i genshin-ts`
- **target NodeGraph not found**：`targetId` 不在该 `.gil` 里，先用 `qianxing_gil_graph_ids` 查
- **注入被拒：non-empty / _GSTS**：目标图非空且名字不以 `_GSTS` 开头，属上游安全检查；用 `--skip-safe-check` 或换 `_GSTS` 图
- **编译报错**：帖完整 stdout，先看是否 TS 生成阶段就失败
- **中文乱码/路径找不到**：统一用绝对路径；QQ 下载目录在 `/root/.dsh-qqbot/media/`

## 维护

- 说明文件：`/root/.dsh/qianxing-nodegraph-help.md`（改完直接生效，无需重启）
- 插件目录：`/root/.dsh/profiles/qqbot/node_modules/dsh-plugin-qianxing-nodegraph/`
- 工作台：`/root/gts-workbench/`
- 注意：qqbot 插件升级会覆盖本机补丁（斜杠命令、出站加固等），升级后需重新覆盖
