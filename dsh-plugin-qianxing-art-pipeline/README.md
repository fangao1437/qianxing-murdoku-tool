# dsh-plugin-qianxing-art-pipeline

千星沙箱（原神千星奇域）家具美术管线的 **DeepSeek Harness 插件（Host-only bundle）**。
把交接包 `murdoku-project/美术管线-插件化交接-2026-10-24/` 的六个阶段实现成 8 个模型可调用的工具，
阶段之间只交换**契约 JSON（version 1）**：实现可替换，接口不变。

零运行时依赖：只用 `node:` 内建模块 + 本包内文件（`.gil` 编解码已 vendor 进 `src/gil/`），无需 npm 安装、无需 Python。

## 安装（任意 DSH profile）

本包是标准 DSH bundle（`package.json` 里 `dsh.bundle.patch` 指向 `cordis.patch.yml`），
**本地目录安装即可**，三种方式任选：

```sh
# ① 命令行：本地路径（把目录换成你 clone / 解压出来的位置）
dsh plugin --profile <profile> add "<插件目录>"

# ② 代理里执行（DSH 会话内）
plugin_manager { action: "install_bundle", target: "<插件目录绝对路径>" }

# ③ 若已从 GitHub 克隆 tool 仓（本包在其子目录）
git clone https://github.com/fangao1437/qianxing-murdoku-tool.git
dsh plugin --profile <profile> add "qianxing-murdoku-tool/dsh-plugin-qianxing-art-pipeline"
```

> ⚠️ 本包位于 tool 仓的**子目录**，`dsh plugin add github:<user>/<repo>` 这种「整仓即插件」的方式不适用
> （pnpm 的 git 依赖不支持子目录）；请先 clone 再按路径安装，或用下面「独立副本」的目录/压缩包。
> 如果希望一行 `dsh plugin add github:...` 安装，需要把本包拆成独立仓库。

- 安装后：会话工具列表出现 `art_*` 8 个工具；技能 `murdoku-art-pipeline` 可被模型按需加载。
- 卸载：`plugin_manager { action: "remove_bundle", target: "dsh-plugin-qianxing-art-pipeline" }`。
- 首次安装**无需重启**（新 bundle 通过 HMR 激活）；**之后修改本包源码必须重启 DSH** 才会加载新 JS 模块
  （本地 `link:` 安装的 ESM 模块缓存在进程内）。
- 配置（可选，写在 profile 的 `cordis.patch.yml`）：`workspaceRoot` 指定相对路径的解析根，默认 = 会话当前工作目录。
- 运行环境：Development/Desktop 版 DSH；本包不声明 peer 依赖，不需要 `schemastery` 等宿主包。

## 8 个工具

| 阶段 | 工具 | 输入 → 输出 |
|---|---|---|
| S1 | `art_decompose` | 参考图 PNG（或拟合记录）→ `ArtSpecSet` |
| S2 | `art_build_spec` | 手写层表 → `ArtSpecSet`（规范化 + 校验） |
| S3 | `art_slice` | `Layout` → 每件家具 `{templateKey, anchor, span, offsetCells}` |
| S3 | `art_preview` | `ArtSpecSet` + `Layout` → 1600×900 SVG + `ValidationReport` |
| 共用 | `art_validate` | `spec` / `WriterJob` / `.gil` → `ValidationReport` |
| S4 | `art_write_gil` | `WriterJob` → 容器 `.gil` + `WriterReport`（四闸） |
| S5 | `art_embed_script` | `EmbedJob` → 最终 `.gil` + `EmbedReport`（三方标记链） |
| S6 | `art_inspect` | 最终 `.gil` → 模板/引用/内嵌脚本清单 |

## 数据契约（version 1）

见交接包 `06-数据格式与接口契约.md`。要点：

```
Layer        { order, imageId, color, w, h, dx, dy_down, y_up=-dy_down, rotDeg? }   单位=content 画布 px
ArtSpecSet   { version:1, name, source, cellTemplatePx:108, templates:{ [名字]: TemplateSpec } }
Layout       { version:1, name, rows, cols, frame, rooms, cells, objects }
WriterJob    { version:1, base, out, ops:[replace_template_layers|set_canvas|set_things_ref|set_family], expect? }
EmbedJob     { version:1, container, script, out, expectMarker }
```

只允许官方基础形状 `imageId ∈ {100001,100002,100003,107102,106056}`；颜色 `0xAARRGGBB`；
输出文件不得覆盖输入文件；失败抛 `[E_XXX] …`（`E_SPEC_INVALID / E_BASE_MISMATCH / E_GIL_WRITE / E_COLLISION / E_MARKER / E_EDITOR_LOSS / E_PATH / E_ARGS / E_IO`）。

## 配置

profile 的 `cordis.patch.yml` 里覆盖插件行（可选）：

```yaml
- id: qianxing-art-pipeline
  name: dsh-plugin-qianxing-art-pipeline
  config:
    workspaceRoot: "D:\\新建文件夹\\miHoYo Launcher"   # 相对路径的解析根；默认 = 会话当前工作目录
```

## 验证（黄金样本）

仓库里两份真实交付档可作为**字节级**验收（测试见 `test/run-tests.mjs`）：

| 测试 | 输入 | 期望 |
|---|---|---|
| S4 写入 | base = `547-一二关美术-容器-v19.gil` + 雕像 381 层（`_work/art-tools/art_v332g_statue.json`） | 输出 SHA256 = `CBCDCD9C29…D76ACBFE`（= `551-…-容器-v21.gil`），记录 2047 |
| S5 嵌入 | `551-…-容器-v21.gil` + `dist/client_script.lua` + marker `v332` | 输出 SHA256 = `AA3986A1A8…2FDEB92`（= `552-一二关美术-v332.gil`），内嵌 1540088 字节 |
| S3 预览 | `qianxing-murdoku-tool/art/specs/furniture_templates.json` + `art/examples/level-demo.json` | SVG 几何与参考 `render-preview.mjs` 一致 |
| S1 拆解 | `_work/art-ref/render/icons-colored/statue__secret-lab.png` | 56×91、块 300–500、空洞/重叠/越界 0、MAE ≤ 0.08 |

离线验收两条命令（缺本机素材的用例自动 SKIP）：

```sh
node test/run-tests.mjs   --workspace="D:\新建文件夹\miHoYo Launcher"   # 22 项，含 schema 回归
node test/check-host-output.mjs --workspace="D:\新建文件夹\miHoYo Launcher"   # 8 项，宿主同款无损 JSON 校验
```

`check-host-output.mjs` 直接使用 DSH 装机目录里的 `@deepseek-ai/dsh-util-values` 复刻宿主对工具结果的
`snapshotJsonValue` 校验（找不到该模块时 SKIP）：它能提前抓住 `-0` / `undefined` / `NaN` / 非普通对象
这类「mock ctx 测不出来、真机才炸 INVALID_TOOL_OUTPUT」的问题。

> **改代码后必须重启 DSH**：本插件以 `link:` 方式安装，Node 的 ESM 模块缓存在进程内不会被
> `remove_bundle`/`install_bundle` 清掉；只有重启 Desktop 才会加载新代码（症状：工具仍返回旧行为）。

## 目录

```
index.js                # apply(ctx, config)：注册工具 + 技能
src/tools.js            # 8 个工具定义（模型可见 schema）
src/define.js           # 零依赖 ToolDefinition 构造 + 入参校验 + 输出无损 JSON 消毒
src/contract.js         # 契约常量与规范化（imageId/颜色/画布/层）
src/geometry.js         # 棋盘几何（1600×900 / 584@(608,138) / ruler12 / gap4）
src/paths.js            # 工作区根解析、JSON 读写、覆盖保护
src/errors.js           # 结构化错误 E_*
src/skill.js            # 运行时技能注册
skill.md                # 模型侧使用指引
src/stages/*.js         # S1–S6 各阶段实现（契约见文件头注释）
src/gil/gilread.js      # vendor：.gil 解析/编码（来自 qianxing-murdoku/tools/gil/）
src/gil/gilwrite.js     # vendor：.gil 安全写入 + 往返/字段 diff 闸门
src/gil/ops.js          # WriterJob 四种 op 的通用实现
src/gil/gates.js        # 进程内闸门（撞号/往返/确定性/引用清单）
test/run-tests.mjs      # 离线验收（mock ctx，不依赖 DSH 运行环境）
test/check-host-output.mjs  # 宿主输出闸门预检（无损 JSON，需本机 DSH 装机目录）
TEST-FLOW.md            # 给用户的测试流程
```

## 合规

仓库只存 `id / 颜色 / 尺寸 / 几何 / 坐标`；不引用、不打包任何官方贴图、`.gil`、`.gia`、截图。
参考图只在本地 `_work/` 使用（测试会用到本机已有素材，缺失时自动跳过该用例）。

## 事件记录：schema 非法导致整轮请求 400（2026-10-24，已修复并加防护）

- **现象**：插件注册的工具 schema 里用了 DSH 作者方言 `type:'json'`，本包手写 `ToolDefinition` 绕过了 `defineTool` 的编译，非法 schema 被原样放进模型请求 → 供应商整轮 400（`Invalid schema for function 'art_build_spec': "json" is not valid under any of the schemas listed in the 'anyOf' keyword`），所有会话/子任务一起失败。
- **修复**：`src/define.js` 新增 `providerParameters()` 投影：`type:'json'` → 去掉 `type`、只保留注解（标准 JSON Schema 里"无 type 约束"= 任意值，与官方 `defineTool` 对 `json` 的编译结果一致）；`properties/items/oneOf/anyOf/allOf` 递归处理。
- **防护（关键）**：
  1. 非标准 `type`、以及**白名单之外的关键字**（如 `format/$ref/pattern`）在**插件加载期直接抛错**——宁可插件加载失败，也不把坏 schema 送进模型请求；
  2. `test/run-tests.mjs` 常驻 3 条 schema 回归用例（无 `type:"json"` / 任意 JSON 参数保留说明 / 非标准 type 加载期抛错）；
  3. 以后新增工具参数只允许：`string/number/integer/boolean/object/array`（或 `json` 走投影）+ `description/required/enum/items/properties`。
- **教训**：手写 ToolDefinition 时，`parameters` 会原样进入模型请求；注册表只校验 `output.schema`，**不校验 `parameters`**。

## 事件记录：工具输出的 `-0` 被宿主判为「非无损 JSON」（2026-10-24，已修复）

- **现象**：`art_decompose` / `art_build_spec` 在真机调用返回
  `tool "art_decompose" returned invalid output: value is not lossless JSON`；离线 mock ctx 用例却是全绿。
- **根因**：层几何里 `y_up = -dy_down`，当 `dy_down = 0` 时得到 **`-0`**；宿主在把工具结果交给 UI 前用
  `snapshotJsonValue` 做「JSON 往返无损」校验，`-0` 往返会变成 `0` ⇒ 整条工具结果被拒（`INVALID_TOOL_OUTPUT`）。
- **修复**：
  1. `src/contract.js` 的 `round2()` 把 `-0` 归一为 `0`（数据层面根治）；
  2. `src/define.js` 新增 `toLosslessJson()` 出口消毒：`-0 → 0`、丢弃 `undefined` 字段、`NaN/Infinity/bigint/非普通对象`
     直接抛 `E_INTERNAL`（不静默降级）；
  3. 新增 `test/check-host-output.mjs`：用宿主同款 `snapshotJsonValue` 离线复刻这道校验，8 个工具输出全绿。
- **教训**：mock ctx 只覆盖业务断言，**不覆盖宿主对结果的序列化约束**；发布前必须跑一遍宿主同款校验。


