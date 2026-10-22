# 第三方来源与许可边界

本仓库（`qianxing-murdoku-tool`，MIT）自己**不包含**任何第三方代码或素材的副本，
除了下面明确标注为「随仓库分发」的那一份**派生数据**。写清楚是为了让任何人能复核许可。

---

## 1. 随仓库分发的派生数据

### `data/nodes.json` —— 节点总表（729 节点 / 620 中文名 / 26 类型 / 59 枚举 / 65 事件）

- 来源（**全部 MIT**，只读，未复制其源码）：
  - [josStorer/genshin-ts](https://github.com/josStorer/genshin-ts) `0.2.3`（MIT）
    - `dist/src/thirdparty/.../node_data/node_pin_records.js`（服务端节点 498）
    - `.../node_data/client_node_metadata.js`（客户端节点去重 231）
    - `.../node_data/types_list.js`（26 类型）、`.../node_data/enum_id.js`（59 枚举）
    - `dist/src/definitions/zh_aliases.js`（中文名 ↔ TS 方法名）、`events.js`（65 事件）
    - `dist/src/definitions/nodes.d.ts`、`events-payload.d.ts`（中文端口名 / 事件出参字段名）
  - 其内嵌数据包 [Wu-Yijun/Genshin-Impact-Miliastra-Wonderland-Code-Node-Editor-Pack](https://github.com/Wu-Yijun/Genshin-Impact-Miliastra-Wonderland-Code-Node-Editor-Pack)（MIT）
- 派生方式：`node src/gen-nodes.mjs --gts=<装了 genshin-ts 的目录>`（**不联网**，纯读本地文件）
- 许可判定：上游 + 数据包**都是 MIT** ⇒ 该派生表可以入库、可以随本仓库分发。
  文件头 `_provenance` 里写死了 `upstream` / `upstream_license` / `sources` / `regenerate`，
  测试会断言 `upstream_license === "MIT"`（`test/run-tests.mjs` [1]）。
- 注意：本表是**我们**的拼装结果，不是上游的原始 schema；上游改版后需要重跑生成并 diff。

> 这份 JSON 是**数据**（节点名/端口名/类型清单），不是上游代码的拷贝。

### `data/node-aliases.json` —— 人工签名核对的别名表

- 我们**自己**写的（MIT）：`gts_method`（`nodes.json` 里缺方法名、但实测核对过签名的节点）
  与 `out_fields`（多出参节点的属性名）。每条都标了依据；**不是猜的**。
- 被 `read2spec.mjs` 用来补 `NO_METHOD` / `MULTI_OUT_PIN` 两类缺口。

### `fixtures/**` —— 从真实 `.gia` 解码出来的读数

- 内容：解码摘要/完整解码结果/翻译出的 spec/`emit` 产物（`.json` / `.spec.json` / `.ts`）。
- 来源：5 份**官方/社区 `.gia` 样本**（二进制**不入库**，在私有主仓库的 `assets/` 下）。
- 为什么可以入库：这些文件是**我们自己的解码器产出的结论**（节点 id、端口名、拓扑、常量形状、生成的源码），
  不含官方美术资源/关卡内容。这是**工程判断，不是法律意见**；若权利人另有主张，
  删掉 `fixtures/` 只影响回归对账，不影响工具可用性。
- 生成：`node src/coverage.mjs --in=<样本目录>` 与 `node src/roundtrip.mjs --in=<样本目录>`。
- `docs/official-gia-coverage.md` 同理：它是 `coverage.mjs` 的**输出报告**，里面有样本文件名与解码统计。

---

## 2. 运行期外部依赖（不随仓库分发，需要自己装）

### genshin-ts `0.2.3`（MIT）—— 写方向的编译器与注入器

- 用途：`src/gts-build.mjs` 调它的 `gsts` CLI 做 **compile**（TS → `.gia`），
  并 import 它的 `dist/src/injector/index.js` 的 `injectGilFile()` 做 **inject**（`.gia` → `.gil` 副本）。
- 版本**精确锁 `0.2.3`**：上游迭代快，升级必须重跑 `gen-nodes` + `run-tests` 并 diff `data/nodes.json`
  （见 `docs/spike-报告摘要.md` §风险矩阵）。
- 安装（联网，装到**仓库外**的工作台目录，别装进本仓库）：

  ```powershell
  $GTS = "<你放工作台的目录>\gts"
  New-Item -ItemType Directory -Force -Path $GTS | Out-Null
  # $GTS\package.json: { "name":"qx-gts-workbench","private":true,"type":"module",
  #                      "dependencies":{ "genshin-ts":"0.2.3" } }
  Push-Location $GTS; npm install --no-audit --no-fund; Pop-Location
  ```

  然后：`--workbench=$GTS`（`gen-nodes.mjs` 用 `--gts=`/`$env:QX_GTS_HOME`，`gts-build.mjs` 用 `--workbench=`/`$env:QX_GTS_WORKBENCH`）。
- 边界：我们**永不自己写 protobuf 节点图**，`.gil`/`.gia` 的字节全部由上游产出。

---

## 3. 明确**没有**包含的东西

| 东西 | 许可 | 状态 |
| --- | --- | --- |
| [AyayaXiaowang/Ayaya_Miliastra_Editor](https://github.com/AyayaXiaowang/Ayaya_Miliastra_Editor) | **GPL-3.0** | **未包含、未派生、非依赖**。历史 spike 阶段曾用它做「节点目录 / 导出链路」的对照研究；该阶段**产物不入库**，`data/nodes.json` 已改为纯 MIT 源重新生成。`src/emit.mjs --target=ayaya` 与 `src/gen-ports.mjs` 只是**历史分支/遗留**：产物是 `.py` 文本、不参与流水线、`gen-ports --merge` 现在默认拒绝（要 `--i-know-legacy`）。本仓库**不含**它的一行代码或一份派生数据。 |
| 官方/社区 `.gia` 节点图资产（5 份样板） | 官方素材授权 | **二进制不入库**（`.gitignore` 里 `*.gia`）。只把**我们解码器产出的读数**放进 `fixtures/`，见该目录 `README.md`。 |
| 任何 `.gil` 存档（含官方贴图/关卡/脚本） | 官方素材授权 | **不入库**（`*.gil`）。 |
| `_work/`（下载仓库、genshin-ts 工作台、注入副本、探针脚本） | 各家 | **不入库**。 |
| `node_modules/` | 各家 | **不入库**，靠 `npm install` 复原。 |
| 图片素材（`*.png`/`*.svg`…） | 官方素材授权 | **不入库**（`.gitignore` 兜底）。 |

---

## 4. 本仓库自己的代码

`src/*.mjs`、`test/*.mjs`、`tools/*.mjs` ⇒ **MIT**（见 `LICENSE`）。
其中 `src/gilread.mjs` 是从主项目的 `tools/gil/gilread.mjs` 原样同步来的（同一作者、同许可），
它是**控件层**的 `.gil` protobuf 读写基础模块；节点图层的字节**不经它**。

---

## 5. 引用但不分发

- 千星沙箱 / 千星奇域（原神 UGC）官方文档：只作为事实来源引用，未复制正文。
- 主游戏仓库（私有工作仓库）：`docs/` 下的报告是它的**摘要**，不是原文搬运；
  上游代码通过 `tools/sync-from-master.mjs` 同步（见 `docs/同步与维护.md`）。
