# DSH 插件：千星家具美术管线（`dsh-plugin-qianxing-art-pipeline/`）

> 2026-10-24。把「美术管线-插件化交接」的六个阶段做成 **DeepSeek Harness 插件**：
> 8 个模型可调用工具 + 1 个运行时技能，阶段之间只交换契约 JSON（version 1）。
> 本包**零运行时依赖**（只用 `node:` 内建；`.gil` 编解码已 vendor 进 `src/gil/`），不需要 Python。

## 1. 怎么装（任意 DSH profile）

```sh
# 本仓库里就有这个包（子目录安装）
git clone https://github.com/fangao1437/qianxing-murdoku-tool.git
dsh plugin --profile <profile> add "qianxing-murdoku-tool/dsh-plugin-qianxing-art-pipeline"
```

或在 DSH 会话里让代理执行：

```
plugin_manager { action: "install_bundle", target: "<插件目录绝对路径>" }
```

> ⚠️ 子目录安装的限制：pnpm 的 git 依赖不支持「仓库子目录」，所以不能用
> `dsh plugin add github:fangao1437/qianxing-murdoku-tool` 直接装到本包；必须先 clone，
> 或使用独立副本目录（`dsh-plugin-qianxing-art-pipeline-v1.0.0.zip` 解压后按路径装）。
> 若要一行 github 安装，需把本包拆成独立仓库。

安装后：工具列表出现 `art_decompose / art_build_spec / art_slice / art_preview /
art_validate / art_write_gil / art_embed_script / art_inspect`；技能 `murdoku-art-pipeline` 可加载。
首次安装通过 HMR 生效；**改源码后必须重启 DSH**（本地 link 安装的 ESM 模块缓存在进程内）。

## 2. 8 个工具

| 阶段 | 工具 | 输入 → 输出 |
|---|---|---|
| S1 | `art_decompose` | 参考图 PNG（或拟合记录）→ `ArtSpecSet`（纯 JS PNG 解码 + PIL 等价量化/矩形合并） |
| S2 | `art_build_spec` | 手写层表 → `ArtSpecSet`（规范化 + 校验） |
| S3 | `art_slice` | `Layout` → 每件家具 `{templateKey, anchor, span, offsetCells}`（默认运行时 v320+ 口径 `rug.2/rug.3`） |
| S3 | `art_preview` | `ArtSpecSet` + `Layout` → 1600×900 SVG + `ValidationReport` |
| 共用 | `art_validate` | `spec` / `WriterJob` / `.gil` → `ValidationReport` |
| S4 | `art_write_gil` | `WriterJob` → 容器 `.gil` + `WriterReport`（重读/roundtrip/确定性/幂等 四闸） |
| S5 | `art_embed_script` | `EmbedJob` → 最终 `.gil` + `EmbedReport`（source=dist=embedded 三方标记链） |
| S6 | `art_inspect` | `.gil` → 模板对/things 引用/内嵌脚本/撞号清单 |

契约与用法详见 `dsh-plugin-qianxing-art-pipeline/README.md`、`skill.md`、`TEST-FLOW.md`。

## 3. 验证证据 `[实测]`

| 项 | 结果 |
|---|---|
| S4 黄金回放 | 547 容器 + 雕像 381 层 → 输出 SHA256 `CBCDCD9C…D76ACBFE`，与仓库交付档 `551-…-容器-v21.gil` **逐字节一致**（记录 1491→2047） |
| S5 黄金回放 | 551 + `dist/client_script.lua`(v332) → SHA256 `AA3986A1…2FDEB92`，与交付档 `552-一二关美术-v332.gil` **逐字节一致**（内嵌 1540088 字节） |
| 编辑器保存往返 | 导入档「打开→保存→导出」副本：2047 条记录 ID 集合相同；10 模板 × 源/母本共 20 份 content 的**层数/子列表顺序/每层字段 0 差异**（防「编辑器删手写模板」） |
| 真机 | v332 标记、things 10 键、全部家具类型实例化（含 381 层雕像、rug.2/rug.3）、5×5=108px / 6×6≈89px、`SetLocalScale` 缩放通道正常 |
| 端到端图片写入 | 用一张 JPEG 图标（预处理成 PNG）→ `art_decompose` 526 层 → `art_write_gil` 替换 `furn.statue` → `art_embed_script` 出档；从最终 `.gil` **磁盘读回** 526×2 层与规格逐字段一致，渲染图逐字节相同 |
| 离线回归 | `node test/run-tests.mjs`（22 项）+ `node test/check-host-output.mjs`（8 项，用宿主同款 `snapshotJsonValue` 校验工具输出） |

## 4. 已知限制 / 坑（写死，别糊过去）

1. **不能从 0 建模板**：S4 只支持 `replace_template_layers / set_canvas / set_things_ref / set_family`；
   空白档（0 条记录、无 `#9` 控件树）或「编辑器建过但 0 层」的空模板档都无法首次写入——
   替换层需要基准档里已有**层原型**可克隆，且模板必须编辑器建过（否则编辑器保存会删）。
2. **工具 schema 是硬闸**：手写 `ToolDefinition` 的 `parameters` 会原样进模型请求，`type:'json'` 这种作者方言
   必须投影成标准 JSON Schema，否则整轮请求 400。插件在加载期拒绝非法 schema（`src/define.js`）。
3. **工具输出必须是「无损 JSON」**：`-0`/`undefined`/`NaN` 会让宿主报 `INVALID_TOOL_OUTPUT`；
   插件出口统一消毒（`toLosslessJson`），并保留 `test/check-host-output.mjs` 回归。
4. **改代码要重启**：`link:` 安装的本地插件，`remove_bundle`/`install_bundle` 不会清 ESM 模块缓存。
5. **编辑器往返后别用 SHA 比内容**：编辑器会重编码（本机实测 +3 字节）；用 `art_inspect` + 层字段深比对。

## 5. 目录

```
dsh-plugin-qianxing-art-pipeline/
├── index.js            apply(ctx, config)：注册 8 工具 + 1 技能
├── cordis.patch.yml    bundle patch（plugin_manager/dsh plugin add 用）
├── package.json        dsh.bundle.patch 声明；零依赖；入口 index.js
├── locale/{zh,en}.json meta.title/description
├── icon.svg            原创图标（MIT）
├── skill.md            模型侧使用指引
├── README.md           安装/工具/契约/验证
├── TEST-FLOW.md        三层验收流程（离线 → 会话内 → 真机）
├── src/tools.js        工具定义（模型可见 schema）
├── src/define.js       ToolDefinition 构造 + 参数/输出校验（供应商投影 + 无损 JSON 消毒）
├── src/contract.js     契约常量与规范化
├── src/geometry.js     棋盘几何（1600×900 / 584@(608,138) / ruler12 / gap4）
├── src/paths.js        工作区根解析、JSON 读写、覆盖保护
├── src/{png,compress}.js   S1 纯 JS PNG 解码 + 量化/矩形合并
├── src/gil/{gilread,gilwrite}.js  vendor：.gil 编解码与写盘闸门
├── src/gil/{ops,gates}.js WriterJob 四种 op + 进程内闸门
├── src/stages/*.js     S1–S6 各阶段
└── test/               run-tests.mjs（22 项）+ check-host-output.mjs（8 项）
```

## 6. 素材边界

本包**不含**任何官方贴图、`.gil`/`.gia`、截图；图标是原创 SVG。
离线测试需要本机已有的素材/存档时缺失会自动 SKIP，不判失败。
