# `tools/qx/graphcode/` —— 节点图双向工具（**主路线 = MIT 的 genshin-ts**）

> **定位（2026-10 改基）**
> 主路线 = **[genshin-ts](https://github.com/josStorer/genshin-ts)（MIT，TypeScript / npm）→ compile → inject**。
> 本工程**永不自己写 protobuf 节点图**，写入一律交给它的 injector。
> [Ayaya_Miliastra_Editor](https://github.com/AyayaXiaowang/Ayaya_Miliastra_Editor)（GPL-3.0）**降级**为
> 「节点目录 / 排版」的历史参考数据源，**非依赖**，其产物**不入库**。
>
> 结论与证据见 [`docs/节点图双向工具-spike报告.md`](../../../docs/节点图双向工具-spike报告.md) 的
> **§11「MIT 写入路线」**（§1–§10 是旧 Ayaya 路线的历史记录）。

本目录解决一件事：**让「节点图」能像控件那样被代码生成、被编译、再注入到 `.gil`**。

- **读**：`read.mjs`（`.gia` 节点图**原生解码**，不需要 Python / 外部仓库；`.gil` 只出控件层）
- **写**：`emit.mjs` 产 **TS 源码** → `gts-build.mjs` 跑 **compile → inject**
- **不写**：`.gil`/`.gia` 的字节一个都不由本工程拼

## 文件地图（2026-11）

| 文件 | 职责 | 需要外部依赖？ |
| --- | --- | --- |
| `giaread.mjs` | `.gia` → 图（单元/节点定义/实例/连线/常量/资源引用） | ❌ 纯 Node |
| `read.mjs` | CLI：`.gia`/`.gil` → `graph.json` + `behavior-spec.md`（`--spec` 再加翻译） | ❌ |
| `read2spec.mjs` | 图 → `emit` 能吃的 spec + **blocker 分类**（默认 strict） | ❌ |
| `emit.mjs` | spec → TS（`--target=gts`，默认）/ `.py`（`--target=ayaya`，deprecated） | ❌ |
| `gts-build.mjs` | TS → `gsts compile` →（可选）inject 到 `.gil` **副本** | ✅ workbench |
| `coverage.mjs` | 一批 `.gia` 的覆盖度体检 + fixture 固化 + 报告生成 | ❌ |
| `roundtrip.mjs` | 读→译→emit→compile 全链用例表（写死用例，基线可复现） | 编译需 workbench |
| `gen-nodes.mjs` | 从 genshin-ts（MIT）重新生成 `nodes.json` | ✅ workbench |
| `nodes.json` | 729 节点 / 26 类型 / 59 枚举 / 65 事件（MIT 派生） | — |
| `node-aliases.json` | 上游没给方法名的节点的**人工签名核对**别名 + `out_fields` | — |
| `fixtures/` | 官方样本的**解码结论**（只有 JSON/spec/TS 文本，**没有 `.gia` 二进制**） | — |
| `test/run-tests.mjs` | **186 项**，不联网 / 不需 Python / 不需外部仓库 / 不需 samples | ❌ |

> ⚠️ **范围边界**：`giaread.mjs` 只解 **`.gia`（编辑器「导出节点图」）布局**。
> `.gil`（整张地图存档）的节点图段**没解**，`read.mjs` 会明确报 `layout: 'other'` 并说读不出来 ——
> 那是唯一还需要外部解码器（`--ayaya` + python）的地方。别把「读不出来」当成「这个档没有节点图」。

---

## 0. 先准备 workbench（不是本工程的东西，别拷进来）

```powershell
# workbench = 「装了 genshin-ts 的目录」（该目录下有 node_modules/genshin-ts）
$GTS = "D:\新建文件夹\miHoYo Launcher\_work\gts"
$env:QX_GTS_HOME = $GTS          # gen-nodes.mjs 直接用它
$env:QX_GTS_WORKBENCH = $GTS     # gts-build.mjs 直接用它

$NODE = "C:\Users\<你>\.dsh\dsh-runtimes\dsh-plugin-desktop-primary-runtime\dependencies\node\bin\node.exe"
$PNPM = "C:\Users\<你>\.dsh\dsh-runtimes\dsh-plugin-desktop-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"

# 注意：版本**精确锁死**。他们发版快，升级要重跑 gen-nodes + run-tests 并 diff nodes.json
New-Item -ItemType Directory -Force -Path $GTS | Out-Null
Set-Content "$GTS\package.json" '{ "name":"qx-gts-workbench","private":true,"type":"module","dependencies":{ "genshin-ts":"0.2.3" } }'
Push-Location $GTS; & $NODE $PNPM install; Pop-Location
```

**踩过的坑**：`pnpm install` 会以**退出码 1** 结束（`[ERR_PNPM_IGNORED_BUILDS] … esbuild, protobufjs`），
但 `+genshin-ts 0.2.3` 已装好，实测编译/注入全部可用 —— 别被这个 1 骗了。
`gsts` 每次启动还会打两条 `update check failed / notice check failed`（本机到 GitHub 超时），**只是 warning**。

---

## 1. 生成「节点总表」`nodes.json`（**MIT 派生，入库**）

```powershell
node tools/qx/graphcode/gen-nodes.mjs --gts=$env:QX_GTS_HOME
```

实测（genshin-ts `0.2.3`）：

| 项 | 数 | 来源（全部 MIT，只读） |
| --- | --- | --- |
| 节点总数 | **729** | `node_pin_records.js` 498 + `client_node_metadata.js` 去重 231 |
| 有中文名 | **620** | `zh_aliases.js` + `nodes.d.ts` JSDoc + 客户端 `displayName` |
| 服务端 Trigger | **55** | `events.js` 的 `ServerEventMetadata` |
| 事件目录 | **65** | 同上；含**中文出参名 → TS 字段名**映射 |
| 类型 | **26** | `types_list.js`（与旧 Ayaya 版同数，可交叉验证） |
| 枚举 | **59** | `enum_id.js`（`ENUM_ID` / `ENUM_ID_CLIENT` / `ENUM_VALUE`） |

**每个节点多出来的字段**（比旧 Ayaya 版强）：

- `method`：**TS 方法名**（`setCustomVariable` / `whenEntityIsCreated`）—— `emit --target=gts` 直接用它
- `reflect_map`：泛型具体化表（`[[22,"S<T:Int>"],[23,"S<T:Str>"], …]`）
- `events[].payload[]`：`{ zh: "事件源实体", field: "eventSourceEntity" }`
- `inputs`/`outputs` 的 `name` 可能为 `null` = 上游没给中文端口名，只有 `type`

**两处已知缺口**（写在 `_provenance` 里，不猜）：`server_without_dsl = 109`（英文显示名与 TS 方法名漂移，
这批 `method` 为空，`emit` 会**拒绝**生成）、`server_without_port_names = 321`。

> ⚠️ **端口顺序**：`inputs_types` 的顺序来自数据包，**可能含隐藏/派生 pin**
> （`设置自定义变量` 就多一个 `Unk`）。**gts 的位置参数顺序以 `dist/src/definitions/*.d.ts` 的方法签名为准**。

---

## 2. 写方向 A：`emit.mjs`（spec → **TS 源码**，默认 target）

```powershell
node tools/qx/graphcode/emit.mjs --spec=tools/qx/graphcode/specs/min-loop.json
# ✅ 生成 genshin-ts 源码: tools\qx\graphcode\out\<graph_name>.ts
```

产物（实测）：

```ts
import { g } from 'genshin-ts/runtime/core'

g.server({ id: 1073741825, name: "模板_qx最小闭环_实体创建时写变量" })
  .on("whenEntityIsCreated", (evt, f) => {
    const 事件源实体 = evt.eventSourceEntity
    const 事件源GUID = evt.eventSourceGuid
    f.printString('qx-min-loop: entity created')
    f.setCustomVariable(事件源实体, 'qx_min_loop_flag', 1n, true)
  })
```

### spec 格式

```jsonc
{
  "graph_id": 1073741825,                 // 必须 = 地图里**已存在且已保存**的节点图 id（数字！）
  "graph_name": "模板_qx最小闭环",          // 文件名 + 图显示名（合法标识符）
  "graph_type": "server",                 // server | client
  "graph_subtype": "bool_filter",         // 仅 client 必填 → g.boolFilter({...})
  "variables": { "counter": 0 },           // 可选：节点图变量
  "handlers": [{
    "event": "实体创建时",                  // 中文事件名（nodes.json events[].zh）
    "params": ["事件源实体", "事件源GUID"],  // 事件出参中文名 → 自动映射到 evt.<字段>
    "body": [
      { "node": "打印字符串", "args": ["hi"] },
      { "out": "结果", "node": "是否相等", "args": [{ "$ref": "事件源实体" }, { "$int": 1 }] }
    ]
  }]
}
```

- `args` **数组 = 按方法签名的位置参数**（gts 原生约定，推荐）
- `args` 对象 = 按 `nodes.json` 的 `inputs[].name` 重排；**端口名对不上直接报错，不猜**
- `{"$ref":"x"}` = **连线**（不是字符串常量）；`{"$int":n}` = 整数（gts 里 int 是 bigint → `1n`）

### 边界（写死，别改）

- `emit.mjs` **只写源码**，`.gil`/`.gia` 一律不碰、protobuf 一律不碰。
- 对不上 `nodes.json` 就 **exit 2**（未知节点 / 事件不是 Trigger / 端口名不对 / `method` 为空）——
  **不许为了让校验通过去改本工程**。

---

## 3. 写方向 B：`gts-build.mjs`（compile → 可选 inject）

```powershell
# 只编译，拿 .gia
node tools/qx/graphcode/gts-build.mjs --src=tools/qx/graphcode/out/<name>.ts --workbench=$env:QX_GTS_WORKBENCH

# 编译 + 注入到 **.gil 副本**（脚本拒绝原地写；产物在 --outdir）
node tools/qx/graphcode/gts-build.mjs --src=tools/qx/graphcode/out/<name>.ts `
     --workbench=$env:QX_GTS_WORKBENCH `
     --copy-gil="485-教程teach-v289.gil" --outdir="$env:QX_GTS_OUT" --skip-safe-check
```

实测产物（`[实测]`，2026-10）：

| 文件 | 字节 | 说明 |
| --- | --- | --- |
| `out/<name>.gs.ts` / `.json` / `.gia` | 364 / 549 / **360~700** | 中间文件（展开后的节点调用）/ IR / 可注入产物 |
| `<base>.before.gil` | 1 699 178 | 源 `.gil` 的**逐字节副本**（注入基线） |
| `<base>.after.gil` | 1 698 825 | **被注入过的 `.gil`**，字节差 −353 |
| 读回对账 | — | `before` 节点 `[1610612746,…,128]`（7 个）→ `after` 节点 `[71(实体创建时),1(打印字符串),22(设置自定义变量)]`（3 个） |

### 注入的三条规则（全部实测过）

| 规则 | 实测 |
| --- | --- |
| 目标图**必须存在**，且（空图 or 名字以 `_GSTS` 开头） | 不加开关时被拒：`[error] target NodeGraph not empty and name not _GSTS*: 新建节点图` |
| `inject.skipSafeCheck`（= `injectGilFile({skipNonEmptyCheck:true})`）可关安全检查 | `mode=replace` 成功 |
| **注入后必须重载地图** | 只能真机验证；未重载就用编辑器保存地图 ⇒ 注入内容被覆盖 |

> 我们的 `.gil` 里**本来就有**服务端节点图（id `1073741825` / `type 20000`）。
> 旧报告里"我们这些档没有节点图"是**假阴性**，别信。

---

## 4. 读方向：`read.mjs`（`.gil`/`.gia` → 结构证据 + 规格骨架）

```powershell
node tools/qx/graphcode/read.mjs --gil="517-模板测试-v2.gil" --outdir=tools/qx/graphcode/out
```

产物：`<basename>.graph.json`（机器可读证据）+ `<basename>.behavior-spec.md`（带证据标签）。

| 层 | 状态 |
| --- | --- |
| 控件层（记录/ID/名字） | ✅ 实测，用 `tools/gil/gilread.mjs`，真机导入验证过 |
| 节点图层 | ⚠️ 半成品：本工程没解出 schema，但**外部解码件能读**（见 §3 的 `before` 对账）。要读就用 gts 的 `injector/node_graph.js`，别自己解 |

### 判据坑（已踩过，别踩回来）

- `gilread.mjs` 的 `parseMsg` 把 varint 存在 **`f.num`**，不是 `f.value`。写 `f.value` 会得到
  **全表 0**，而且脚本"成功退出"——静默空结果。
- 候选判据**必须先扣掉控件 ID 命名空间**（`1073000000..1074200000`）。我们的控件 ID 是
  `1073741824+`(=0x40000000)，正好落在"自定义/信号节点 `0x4000xxxx`"的同一数值区间里。
- **否定性结论必须有独立证据**：旧报告用启发式判"没有节点图"，5 个档全报 0，
  换个解码器一跑就有 1 张。

---

## 5. 许可边界（改了，宽松多了）

| 现在（主路线） | 旧（Ayaya） |
| --- | --- |
| genshin-ts + 内嵌数据包**都是 MIT** ⇒ `nodes.json` 可入库、可分发，代码可直接 `import` | GPL-3.0 ⇒ 只能子进程隔离，派生数据不敢入库 |
| `--target=gts` 产 TS，交他们的 `gsts` 编译注入 | `--target=ayaya` 产 `.py`，**DEPRECATED**、不入库 |

`--ayaya=` 仍然保留（本机没装 genshin-ts 时对表用），但它的产物**不入库**，
`emit.mjs` 里也写了注释「仅历史参考、不参与流水线」。

---

## 6. 自测

```powershell
node tools/qx/graphcode/test/run-tests.mjs
# → 通过 72，失败 0
```

覆盖：`nodes.json` 自洽性（含**许可必须是 MIT** 的断言）、`emit` 默认 target=gts 的生成文本、
`$ref` 连线、`$int` bigint 字面量、坏 spec 全部 exit 2、`--target=ayaya` 回归、
`gts-build.mjs` 缺参干净报错、`read.mjs` 不存在的档 exit 2。

**不依赖**外部仓库、不联网、不需要 Python。唯一的例外是 `gts-build.mjs` 真正跑编译时
—— 它需要 workbench，缺的时候 exit 2 并说明缺什么。

---

## 7. 文件一览

| 文件 | 作用 |
| --- | --- |
| `gen-nodes.mjs` | genshin-ts（MIT）数据文件 → `nodes.json`；`--gts=` 主路线，`--ayaya=` 降级 |
| `nodes.json` | **节点总表**（729 节点 / 620 有中文名 / 26 类型 / 59 枚举 / 65 事件），MIT 派生 |
| `emit.mjs` | spec → **TS 源码**（默认 `--target=gts`）/ `--target=ayaya` 的 `.py`（deprecated） |
| `gts-build.mjs` | TS → `gsts` compile → `.gia` → (可选) inject 到 `.gil` **副本** |
| `read.mjs` | `.gil`/`.gia` → `graph.json` + `behavior-spec.md`（结构证据，带 UNKNOWN 标注） |
| `gen-ports.mjs` | **旧 Ayaya 路线遗留（DEPRECATED）**：从 `@node_spec` 补端口名。主路线不需要（端口名来自 JSDoc），且 `--merge` 现在**默认拒绝**（要 `--i-know-legacy`）|
| `specs/min-loop.json` | 最小闭环样例（gts 口径：数字 id + 数组 args） |
| `specs/min-loop-ayaya.json` | ayaya 分支回归 fixture（字符串 id + 对象 args） |
| `test/run-tests.mjs` | 离线自测 72 项 |
| `out/` | 生成物（可删可重建；`*.py` 是旧路线遗留） |
