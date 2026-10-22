# qianxing-murdoku-tool

千星奇域（原神 UGC，官方名「千星沙箱」）的**节点图双向工具链**，独立仓库版。

```
             读（read）                                         写（emit → build → inject）
  .gia  ──►  节点图（原生解码，纯 Node，不需要 Python）      行为规格(JSON) ──► genshin-ts TypeScript ──► .gia ──► .gil
  .gil  ──►  控件层（原生） + 节点图段（**暂未解**，见 §4）        （MIT 上游）          compile    inject（只写副本）
             每条结论都带 [实测]/[推断]/UNKNOWN
```

> **硬边界**：本仓库**永不自己写 protobuf 节点图**。`.gil` / `.gia` 的字节一律由上游
> [genshin-ts](https://github.com/josStorer/genshin-ts)（MIT）产出；这里只做生成、校验、翻译与胶水。
>
> 另一条边界同等重要：**翻译层宁可拒绝，也不生成半对的东西**。分支/循环、复合节点、枚举/列表/字典常量
> 一律走 `BLOCKERS` 拒绝（§5），不猜、不近似。

**状态（2026-10，本文所有数字都可在本仓库复跑）**

| 环节 | 证据等级 | 说明 |
| --- | --- | --- |
| 规格 → TypeScript 源码 | **已验证**（离线可复跑） | `src/emit.mjs`；离线回归 **186 项全绿** |
| 图 → 规格（反向翻译） | **已验证**（5 份真实 `.gia`） | `src/giaread.mjs` + `src/read2spec.mjs`；覆盖度与 blocker 见 `docs/official-gia-coverage.md` |
| spec → emit → 源码 **逐字节对账** | **已验证**（离线） | `fixtures/*.spec.json` 生成物与录好的 `.ts` 一致（测试 [11]），不需要样本、不需要联网 |
| TS → `.gia`（compile） | **已验证**（本地跑通） | `src/gts-build.mjs` 调上游 `gsts`，需 workbench |
| `.gia` → `.gil` 副本（inject） | **已验证（文件层）** | 产出真实被注入的 `.gil` 副本，读回对账节点 id 与 spec 对得上 |
| 注入后的 `.gil` 被编辑器/游戏接受 | **真机未验证** | 见 `docs/限制清单.md` §3；这是**唯一**的关键缺口 |
| `.gia` 节点图层读取 | **已验证（原生，纯 Node）** | 节点/连线/常量/端口名本地可读；**不再需要 Python 或外部仓库** |
| `.gil` 控件层读取 | **已验证**（主项目真机导入往返过） | `src/gilread.mjs` |
| `.gil` 的**节点图段** | **未解** | `giaread.mjs` 明确返回 `layout: 'other'` 并说明读不出来；要读 `.gil` 的节点图仍需外部解码器（`--ayaya=` 可选交叉校验） |
| `.gia` 资产导入真机 | **已验证**——但**不是本工具产出的 `.gia`** | 「`.gia` 作为资产能导进编辑器」这条主项目控件侧走过真机；本仓库产出的 `.gia` 还没手动导入过 |

一句话：**"读 → 规格 → 编译 → 注入"在本机全链路跑通、可复现、有 186 项离线回归；差的是一次真机确认。**
不要把它当成"已经在游戏里生效"。

---

## 1. 这是什么 / 不是什么

**是**
- 一份可复跑的**节点目录**（`data/nodes.json`：729 节点 / 620 中文名 / 26 类型 / 59 枚举 / 65 事件），
  由 MIT 上游的只读数据生成，可分发；另有一份**人工签名核对过**的别名表 `data/node-aliases.json`。
- 一个**原生节点图解码器**（`src/giaread.mjs`，纯 Node）：`.gia` 的节点/连线/常量/端口名/复合节点定义**本地可读**，
  不需要 Python、不需要外部仓库。
- 一个**反向翻译器**（`src/read2spec.mjs`）：图 → `emit.mjs` 能吃的 spec，译不动的地方**分类拒绝**（`BLOCKERS`）。
- 一个**规格编译器**：JSON 行为规格 → genshin-ts 的 TS 源码（人可读、可手改、可进版本库）。
- 一条**固定下来的落盘命令**：compile →（可选）inject 到 `.gil` **副本**，永不原地改存档。
- 一套**离线回归**：`node test/run-tests.mjs` → `通过 186，失败 0`，不联网、不需 Python、不依赖外部仓库、**不需要样本 `.gia`**。

**不是**
- 不是 `.gil`/`.gia` 的 protobuf 写入器（那是上游的事，也是我们刻意不做的事）。
- 不是 3D 关卡/节点图排版工具，不做可视化编辑器。
- 不是"节点图全集覆盖"：109/498 服务端节点拿不到方法名、321 个缺中文端口名、复合节点**读得出但译不出**、
  分支/循环与枚举/列表/字典常量**一律拒绝生成**——见 §5。
- 不随仓库分发任何 `.gil` / `.gia` / 官方图片素材（见 `THIRD_PARTY.md`）。

---

## 2. 快速开始

要求：**Node.js ≥ 20**（本仓库实测于 `v24.21.0`），零第三方依赖即可跑测试与生成 TS。

```bash
# ① 离线自测（不联网、不需要 Python、不需要装任何东西、不需要样本 .gia）
node test/run-tests.mjs          # → 通过 186，失败 0

# ② 读 .gia：节点图结构 + 人类可读规格（原生解码，纯 Node）
node src/read.mjs --gil="assets/<某个>.gia"
#   产物：out/<basename>.graph.json（节点/连线/常量/端口名）+ out/<basename>.behavior-spec.md

# ③ 读 + 顺手出 spec（能译的图才写，译不动的写 blocker 报告）
node src/read.mjs --gil="assets/<某个>.gia" --spec
#   产物：out/<graphName>.spec.json + out/<basename>.<graphId>.translate.json（BLOCKERS 分类）

# ④ 图 → spec（等价于 ③ 的翻译部分，单跑）
node src/read2spec.mjs --gia="assets/<某个>.gia" --outdir=out
#   退出码 0 = 全部图都译出；2 = 有图被拒绝（报告照打，spec 不写 —— 看 blocker 分类，不要当成功）

# ⑤ 规格 → TS 源码（默认 out/）
node src/emit.mjs --spec=specs/min-loop.json
# ✅ 生成 genshin-ts 源码: out/模板_qx最小闭环_实体创建时写变量.ts

# ⑥ 生成节点总表（只有要换源/升级 genshin-ts 时才需要；需本机装好 genshin-ts）
node src/gen-nodes.mjs --gts=<装了 genshin-ts 的目录>          # 产物默认写到 data/nodes.json
```

还有两个**维护用**入口（要样本 `.gia` 才有意义；样本二进制不在仓库里，见 `fixtures/README.md`）：

```bash
node src/coverage.mjs  --in=<样本目录> --md=docs/official-gia-coverage.md   # 重算覆盖度报告
node src/roundtrip.mjs --in=<样本目录> --workbench=<工作台>                 # 反向回编译 + 更新 fixtures
```

写方向的落盘（需要 §3 的 workbench，**联网装一次**）：

```bash
# 只编译，拿 .gia
node src/gts-build.mjs --src=out/模板_qx最小闭环_实体创建时写变量.ts --workbench=<工作台目录>

# 编译 + 注入到 .gil **副本**（脚本拒绝原地写；产物落在 --outdir）
node src/gts-build.mjs --src=out/模板_qx最小闭环_实体创建时写变量.ts \
     --workbench=<工作台目录> \
     --copy-gil=<某个>.gil --outdir=out/injected --skip-safe-check
```

注入前必须知道的三条规则（都实测过，见 `docs/spike-报告摘要.md`）：

1. **目标图必须已存在**，且（图是空的 **或** 图名以 `_GSTS` 开头），否则被上游安全检查拒绝；
2. `--skip-safe-check`（= `inject.skipSafeCheck`）可以关掉这条检查——**知道自己在干什么**再用；
3. **注入后必须在编辑器里重载地图**，否则之后用编辑器保存地图会把注入内容覆盖掉。

---

## 3. 依赖矩阵

| 能力 | 需要什么 | 联网 | 备注 |
| --- | --- | --- | --- |
| `test/run-tests.mjs` | Node ≥ 20 | ❌ | 全离线；不需要样本 `.gia`；断言里包含"上游许可必须是 MIT" |
| `emit.mjs`（默认 `--target=gts`） | Node ≥ 20 + `data/nodes.json` | ❌ | 对不上 `data/nodes.json` 一律 exit 2，**不猜** |
| `read.mjs` 控件层 | Node ≥ 20 | ❌ | `src/gilread.mjs` 自带 protobuf 解析 |
| `read.mjs` / `read2spec.mjs` 读 `.gia` 节点图 | Node ≥ 20 | ❌ | **原生解码，纯 Node**（`src/giaread.mjs`），不需要 Python |
| `read.mjs` 读 `.gil` 节点图段 | **未解**；可选外部 GPL 解码器 + Python 3.10–3.12 做交叉校验 | ❌（但需预装） | 只以**子进程**调用，不 import、不分发 |
| `coverage.mjs` / `roundtrip.mjs` | 样本 `.gia` +（roundtrip 还要 workbench） | ❌ | 维护用；仓库里**不含样本二进制** |
| `gen-nodes.mjs --gts=` | 装好的 `genshin-ts@0.2.3` | ❌ | 只读它的数据文件 |
| `gts-build.mjs` | 装好的 `genshin-ts@0.2.3`（workbench） | ❌（装的时候要） | 版本**精确锁 0.2.3** |
| `emit.mjs --target=ayaya` | 可选的外部 GPL 仓库 + Python | ❌ | **历史分支**，产物 `.py` 不入流水线 |

`genshin-ts` 安装（**装到仓库外**，别污染本仓库）：

```powershell
$GTS = "<工作台>\gts"
New-Item -ItemType Directory -Force -Path $GTS | Out-Null
# $GTS\package.json 写死：{ "name":"qx-gts-workbench","private":true,"type":"module",
#                           "dependencies":{ "genshin-ts":"0.2.3" } }
Push-Location $GTS; npm install --no-audit --no-fund; Pop-Location
```

实测踩坑（别被骗）：
- `npm/pnpm install` 可能以**退出码 1** 结束（`[ERR_PNPM_IGNORED_BUILDS] … esbuild, protobufjs`），
  但包已装好、编译/注入全部可用；
- `gsts` 每次启动会打两条 `update check failed / notice check failed`（本机到 GitHub 超时），**只是 warning**，
  `src/gts-build.mjs` 已把它们过滤掉。

---

## 4. 能力边界（读方向）

**`.gia`（资产）**——节点图层**原生可读**，纯 Node，不需要 Python / 不需要外部仓库：

`src/giaread.mjs` 解 `.gia` 的 wire 结构（用 5 份官方/社区样本实测反推，见 `docs/official-gia-coverage.md`）：
单元/信封、图、**节点定义（复合节点）**、节点/引脚/连线、常量、端口名、图变量与信号引用。
`src/read.mjs` 在它之上出 `<base>.graph.json` + `<base>.behavior-spec.md`；加 `--spec` 再走 `read2spec.mjs` 出 spec + blocker 报告。

实测覆盖（同一份报告）：5 份样本共 **107** 种节点类型、**82** 种可识别（**76.6%**）；复合节点读得出（99 个定义）；
读得出**不等于**译得出 —— 见 §5 的拒绝清单。

**`.gil`（存档）**——两层，一层已解一层没解：

- **控件层已解**：`src/gilread.mjs` 解控件记录/ID/父子/尺寸/文本，主项目真机导入往返验证过。
- **节点图段未解**：`giaread.mjs` 对 `.gil` **明确返回 `layout: 'other'` + `graphs: []`**，并在产物/终端里说"读不出来"，
  `read.mjs` 会打印 `节点图层（原生）：读不出来 —— 布局不是 .gia 导出（layout=other）`。
  ⇒ 想读 `.gil` 的节点图，仍然要外部解码器：`--ayaya=<仓库> --python=<python.exe>`，
  它只做**可选交叉校验**（跑一遍打印对照，不参与产物）。**我们不分发、不 import 它。**
  > ⚠️ **缺失 ≠ 不存在**。踩过的坑：用启发式判"这些档没有节点图"，5 个档全报 0，换个解码器一跑就有 1 张。
  > 原因：图的 `graph_id=1073741825` 和我们控件 ID 是同一数值区间，命名空间启发式根本区分不了。
  > **否定性结论必须有独立证据。**
- 顺带的事实：千星存档里**本来就有**服务端节点图（我们样本里 id `1073741825`、`type 20000`）。

**交叉校验**：想用第二条读法对账时，`genshin-ts` 的 `dist/src/injector/node_graph.js` 里有 `findNodeGraphTargets`，
实测能读出 graph id/type/节点 id 列表（不给端口级 IR）—— 这是排障用的，不是我们的产物路径。

---

## 5. 已知缺口（写死，不许糊过去）

**翻译层的总原则：宁可拒绝，也不生成半对的东西。** 译不动的地方由 `read2spec.mjs` 的 `BLOCKERS` **分类拒绝**
（报告里 `blocker` 字段 + 退出码 2），绝不近似、绝不静默丢节点。

| 拒绝类别（`BLOCKERS`） | 触发条件 | 交给谁 |
| --- | --- | --- |
| `CONTROL_FLOW_NODE` | **分支/循环**节点（`双分支` 等）。gts 的 API 是回调式的，顺序调用模型表达不了控制流 | 只能手写 TS；`--treat-branch-as-linear` 可降级为警告，但**语义不等价**且默认**关闭** |
| `COMPOSITE_NODE` | **复合节点**（本文件内定义）。读得出名字/端口/连线，但翻译要展开实现图 | 展开实现图（未做）；或当黑盒手写 |
| `ENUM_CONSTANT` | 常量是**枚举项**，gts 要枚举成员 | 需把枚举值映射到 gts 成员（未做） |
| `LIST_CONSTANT` / `DICT_CONSTANT` | **列表 / 字典**常量。gts 的列表字面量写法未验证、字典布局未解 | 手写常量 |
| `UNKNOWN_CONSTANT` / `MISSING_ARG` | 常量解不出来 / 输入参数既没连线也没常量 | 补齐图或手写 |
| `MULTI_OUT_PIN` | 取了**多出参节点**的第 N 个出参，但属性名未知 ⇒ 要在 `data/node-aliases.json` 的 `out_fields` 登记 | 人工签名核对后登记（`[推断]`，靠 compile 兜底） |
| `NO_METHOD` / `NO_DSL` | 节点没有 gts 方法名 / 没有中文名 | 见下面 §5.1 的两条硬缺口 |
| `NO_TRIGGER_ROOT` / `GRAPH_TYPE_UNKNOWN` | 图里没有触发器 / 推断不出 server-client | 不是可注入的图 |
| `CROSS_HANDLER_REF` / `CYCLE` / `TRIGGER_PAYLOAD` | 数据引用跨了两个 handler / 依赖成环 / 触发器出参名对不上 | 结构性问题，拒绝 |

### 5.1 节点表的硬缺口（数字可在 `data/nodes.json` 查）

| # | 缺口 | 数字 / 表现 | 我们的处置 |
| --- | --- | --- | --- |
| 1 | **服务端节点方法名漂移** | **109 / 498** 个服务端节点的英文显示名与 TS 方法名对不上 ⇒ `method` 为空 | `emit.mjs` **拒绝生成**并 exit 2（`节点 "X" 在 nodes.json 里没有 TS 方法名…不能生成 gts 源码`）。**不猜、不模糊匹配** |
| 2 | **缺中文端口名** | **321 / 498** 个服务端节点的部分端口 `name: null`（只有类型） | 只能按**位置参数**写 `args`；按端口名写的对象形式会因"端口名对不上"被拒 |
| 3 | **端口顺序含隐藏/派生 pin** | `inputs_types` 来自数据包，可能多出 `Unk` 之类 | 位置参数顺序以 gts 的 `definitions/*.d.ts` 方法签名为准，**别拿 pin 顺序硬套** |
| 4 | **`.gil` 的节点图段未解** | `layout: 'other'`，`graphs: []` | 明写读不出来；要读只能外部解码器交叉校验（本仓库不分发） |
| 5 | **语义不完全等价** | spec 是"一串顺序调用"，表达不了分支/遍历，也表达不了图里的注释分组 | 能读、能生成、能编译，但**语义不等价** —— 这一层没做，也不假装做了 |
| 6 | **真机完全未验证** | 注入后的 `.gil` / 本工具产出的 `.gia` 都没进过编辑器/游戏 | 见 §3 与 `docs/限制清单.md` §3 的验证清单，**不许当已验证** |
| 7 | **上游版本漂移** | `genshin-ts` 迭代快（本仓库锁 `0.2.3`） | 升级必须重跑 `gen-nodes` + `run-tests` 并 diff `data/nodes.json` |
| 8 | **注入是"替换整张图"** | `mode=replace`：目标图原有节点会被替换 | 别往有内容的图上注入，除非你就是要替换 |

> `data/node-aliases.json` 是**人工逐条核对签名**后登记的别名（`gts_method` / `out_fields`），
> 它补的是"上游数据没有、但我们实测确认过"的那一小片；每条都标了依据，**不是猜出来的**。

---

## 6. spec 格式（写给 `emit.mjs` 的输入）

```jsonc
{
  "graph_id": 1073741825,                 // 必须是地图里**已存在且已保存**的节点图 id（数字）
  "graph_name": "模板_qx最小闭环_实体创建时写变量",   // 文件名 + 图显示名（合法标识符）
  "graph_type": "server",                 // server | client
  "graph_subtype": "bool_filter",         // 仅 client 必填 → g.boolFilter({...})
  "description": "……",                    // 可选
  "handlers": [
    {
      "event": "实体创建时",               // 中文事件名（data/nodes.json 的 events[].zh）
      "params": ["事件源实体", "事件源GUID"],   // 事件出参中文名 → 自动映射到 evt.<字段>
      "body": [
        { "node": "打印字符串", "args": ["hi"] },
        { "out": "结果", "node": "是否相等", "args": [{ "$ref": "事件源实体" }, { "$int": 1 }] }
      ]
    }
  ]
}
```

- `args` **数组** = 按方法签名的**位置参数**（gts 原生约定，推荐）；
- `args` **对象** = 按 `data/nodes.json` 的 `inputs[].name` 重排；**端口名对不上直接报错，不猜**；
- `{"$ref":"x"}` = **连线**（不是字符串常量）；`{"$int":n}` = 整数（gts 里 int 是 `bigint` → 生成 `1n`）；
- 退出码：`0` 成功 / `1` 校验失败 / `2` spec 不合法（未知节点、事件不是 Trigger、端口名不对、`method` 为空……）。

样例：`specs/min-loop.json`（gts 口径）、`specs/min-loop-ayaya.json`（历史分支回归用）。

---

## 7. 目录

```
src/                    事实源在主工作仓库 tools/qx/graphcode/，由 tools/sync-from-master.mjs 同步
  giaread.mjs           .gia（及 .gil 的控件外结构）**原生节点图解码器**，纯 Node，不需要 Python
  read.mjs              .gil/.gia → graph.json + behavior-spec.md（+ 可选 --spec 出规格）
  read2spec.mjs         图 → emit.mjs 能吃的 spec；译不动的按 BLOCKERS 分类拒绝
  emit.mjs              行为规格 → TS 源码（默认 --target=gts）；--target=ayaya 是历史分支
  gen-nodes.mjs         从 MIT 上游数据生成节点总表 data/nodes.json
  gts-build.mjs         TS → gsts compile → .gia →（可选）inject 到 .gil 副本
  coverage.mjs          样本覆盖度统计 → docs/official-gia-coverage.md
  roundtrip.mjs         读→spec→emit→compile 反向回编译 + 更新 fixtures
  gen-ports.mjs         旧 Ayaya 路线遗留：补端口名；--merge 默认拒绝
  gilread.mjs           控件层 .gil protobuf 读写基础模块（节点图字节不经它）
data/nodes.json         节点总表（MIT 派生，可分发）
data/node-aliases.json  人工签名核对过的别名/多出参字段（gts_method / out_fields）
specs/                  最小示例规格（emit 的输入样例）
fixtures/               5 份真实 .gia 的解码结果 + 可译图的 spec + 录好的 emit 产物（**不放 .gi* 二进制**）
test/run-tests.mjs      离线回归 186 项
tools/sync-from-master.mjs  从主工作仓库同步 + 施加路径适配（锚点找不到就报错）
docs/                   读取/翻译算法、spike 摘要、官方样本覆盖度、限制清单、同步与维护、推送说明
out/                    生成物（gitignore，可删可重建）
```

`fixtures/` 里每个文件的来历、怎么重算、哪些不能进仓库：见 `fixtures/README.md`。

---

## 8. 许可与素材边界

- 本仓库代码：**MIT**（`LICENSE`）。
- `data/nodes.json`：**MIT 派生数据**，可分发（来源与再生成命令写在其 `_provenance` 里）。
- `data/node-aliases.json`：我们**人工核对签名**后写的别名表（依据逐条写在文件里），MIT。
- `fixtures/`：**我们自己解码器从样本 `.gia` 上读出来的结论**（节点 id/端口/拓扑/常量形状/生成的 TS）。
  样本 `.gia` 二进制**不入库** —— 我们只分发自己的读数，不转发别人的素材。
- 运行期依赖 `genshin-ts@0.2.3`（MIT）：**不随仓库分发**，自己装。
- **GPL-3.0 项目（Ayaya_Miliastra_Editor）未包含、未派生、非依赖**：历史 spike 的对照路，
  产物不入库；仓库里只剩两条明确标注的遗留分支（`--target=ayaya`、`gen-ports.mjs`）。
- **官方/社区素材、`.gil`、`.gia`、图片一律不入库**（`.gitignore` 兜底），
  因为授权不在我们手里。细节与判断依据：`THIRD_PARTY.md`（这是工程判断，不是法律意见）。

---

## 9. 与主游戏仓库的关系

本仓库是**从主工作仓库（私有）里切出来的工具层**，只包含节点图工具链：

- 上游事实源：`<主工作仓库>/qianxing-murdoku/tools/qx/graphcode/`（+ `tools/gil/gilread.mjs`）。
  本仓库的 `src/`、`data/nodes.json`、`specs/`、`test/`、`fixtures/` 都由
  `node tools/sync-from-master.mjs --from=<该目录>` 同步而来，**不在这里手写**（手改会漂）。
- 主仓库的**游戏本体**（Lua 客户端脚本、控件存档、美术）**不在**本仓库里，也不会来。
- 同步规则与"两边目录形状不同"要改的那几条路径表达式，见 `docs/同步与维护.md`。

---

## 10. 证据标签约定

本仓库所有结论按三档标注，写文档/写回执都必须带：

| 标签 | 含义 |
| --- | --- |
| `[实测]` | 跑出来的。附命令、输出、字节数或 sha256，别人能复现 |
| `[推断]` | 有读代码/读文档/对数据的依据，但**没跑过**；要写明依据 |
| `UNKNOWN` | 不知道。**不要**用"应该/显然/大概"填坑；否定性结论必须有独立证据 |

测试里也守着这条：`nodes.json` 的上游许可必须是 `MIT`（否则整个仓库的许可叙事就塌了）。
