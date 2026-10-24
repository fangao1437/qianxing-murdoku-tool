# 测试流程 · 千星美术管线插件

> 插件：`dsh-plugin-qianxing-art-pipeline`（8 个 `art_*` 工具 + `murdoku-art-pipeline` 技能）
> 工作区根：**`<你的工作区>`**（下文示例用 `D:\新建文件夹\miHoYo Launcher`，换成你自己的路径即可；
> 工具里的相对路径按会话当前工作目录解析，也可以用绝对路径）
> 分三层验收：**① 离线自动验收**（不碰 DSH）→ **② 会话内工具验收**（走真实工具调用）→ **③ 真机验收**（导入游戏看日志/截图）。

### 实测基线（2026-10-24，本机真实宿主，供后续对照）

| 验证项 | 实测结果 |
|---|---|
| `art_write_gil`（547 + 雕像 381 层） | 输出 `_work/art-pipeline-verify/tool-551.gil`，SHA256 = `CBCDCD9C294E2FD2F4F7FA48C53CA6D169F7585C3B28510E833FF664D76ACBFE` = **仓库 551 逐字节一致**，1491→2047 条 |
| `art_embed_script`（551 + dist v332） | 输出 `_work/art-pipeline-verify/tool-552.gil`，SHA256 = `AA3986A1A898D5FDAA666E7B87C2747BABFC56651D79F2461E5BFF04A2FDEB29` = **仓库 552 逐字节一致**，1540088 字节 |
| `art_inspect` 551 | records=2047、10 模板、statue 381/381、things 10/10 指向模板源、collisions=0、markers=v324/1531678（旧脚本 + warning） |
| `art_validate` spec / gil | 基线规格 94 检查全过 `ok=true`；tool-552 六项检查全过（含 `gil.embeddedMarker` v332） |
| `art_slice` / `art_preview` | level-demo 8 件；auto 口径 `furn.rug.3` + `report.warnings` 回退说明；single 口径与参考渲染器逐图元一致 |
| `art_decompose` | 雕像图标 56×91 → 381 层、MAE=0.05446、空洞/重叠/越界=0 |
| `art_build_spec` | 规范化 + 校验 + `fixes` 报告；`y_up=-0` 已归零（宿主无损 JSON 校验通过） |

---

## 0 安装确认（已装好才往下走）

在任意新会话里对代理说：

> 用 plugin_manager 列出已安装的插件，确认 dsh-plugin-qianxing-art-pipeline 是否已安装并启用。

预期：`list_plugins` 里出现 `qianxing-art-pipeline` 行（模块名 `dsh-plugin-qianxing-art-pipeline`），状态 applied/enabled；
本会话工具列表里出现 `art_decompose / art_build_spec / art_slice / art_preview / art_validate / art_write_gil / art_embed_script / art_inspect`。

也可以用「技能」确认：新会话问「用 murdoku-art-pipeline 技能告诉我美术管线六个阶段」——应能加载技能正文。

---

## 1 离线自动验收（30–120 秒，最强证据）

在 DSH 里让代理执行（或自己开 pwsh 执行）：

```powershell
cd "D:\新建文件夹\miHoYo Launcher\dsh-plugin-qianxing-art-pipeline"
node test/run-tests.mjs --workspace="D:\新建文件夹\miHoYo Launcher"
node test/check-host-output.mjs --workspace="D:\新建文件夹\miHoYo Launcher"
```

**通过标准**：

```
== 结果：22 passed, 0 failed, 0 skipped ==        ← run-tests.mjs（业务 + 黄金样本 + schema 回归）
== 8 passed, 0 failed ==                          ← check-host-output.mjs（宿主无损 JSON 校验，缺 DSH 装机目录时 SKIP）
```

> `check-host-output` 用 DSH 装机目录里的真实 `snapshotJsonValue` 复刻宿主校验，专抓 `-0`/`undefined`/
> `NaN` 这类「离线 mock 测不出、真机才炸 INVALID_TOOL_OUTPUT」的问题（2026-10-24 实际踩过）。

其中 skipped 理论上为 0（本机素材齐全）；若缺 `_work/` 素材会 SKIP 但不判失败。
重点看这几条（都是字节级/几何级黄金样本）：

| 用例 | 通过意味着 |
|---|---|
| `S4 art_write_gil: 547 + 雕像 381 层 → SHA256 == 仓库 551` | 写入器与仓库真实产物**逐字节一致**（能力的最硬证明） |
| `S5 art_embed_script: 551 + dist v332 → SHA256 == 仓库 552` | 嵌入器与仓库最终交付档**逐字节一致** |
| `S3 art_preview: … 与参考渲染器逐图元一致` | 预览图元几何与工具仓参考实现逐项一致 |
| `S1 art_decompose: …` | PNG 解码 + 量化压缩链路可用（空洞/重叠/越界=0，MAE 达标） |
| `S4 幂等/确定性/事务` | 四闸行为正确（重跑不变、失败不留档、不覆盖 base） |
| `schema: parameters 是供应商合法 JSON Schema` | **安全闸**：不会再把非法 schema 送进模型请求导致整轮 400（见 README「事件记录」） |

---

## 2 会话内工具验收（逐个阶段，复制即用）

> 以下提示词假设会话工作目录 = `D:\新建文件夹\miHoYo Launcher`（相对路径按它解析；也可全用绝对路径）。

### 2.1 S6 先体检（最快确认「工具通了」）

> 调用 art_inspect 检查 `qianxing-murdoku/551-一二关美术-容器-v21.gil`，告诉我记录数、模板表、things 引用和是否有内嵌脚本。

预期：`records=2047`、10 个 `furn.*` 模板（含 `furn.statue` 源/母本各 381 层、画布 108×108）、`things.count=10` 且 `refs[].ok` 全 true、`collisions=0`、`markers.embedded=**v324**`、`markers.bytes=1531678`（这是从 547 继承的**旧脚本**；「容器档」只表示还没嵌**新**脚本，不是没有脚本——交付前必须过 S5）。

### 2.2 S1 图元拆解

> 用 art_decompose 把 `_work/art-ref/render/icons-colored/statue__secret-lab.png` 拆成 56×91 的雕像规格（quantize 8，std 2），写到 `_work/art-tools/statue-spec-plugin.json`，报告块数和 MAE。

预期：块数 300–500（参考 381）、`holes/overlaps/outOfBounds=0`、`MAE ≤ 0.08`、层全部 `imageId=100001`、颜色 `0xFFxxxxxx`。

### 2.3 S2 + S3 规格与预览

> 用 art_build_spec 读 `qianxing-murdoku-tool/art/specs/furniture_templates.json` 的 8 个模板，规范化后写出 `_work/spec-rebuild.json`；再用 art_preview 结合 `qianxing-murdoku-tool/art/examples/level-demo.json` 生成 `_work/preview-plugin.svg`；最后用 art_validate 校验规格。

预期：8 模板；SVG 1600×900、含 8 件家具；`art_validate` 返回 `ok=true`。
**人眼验收**：用浏览器/看图打开 `_work/preview-plugin.svg`，家具在格子里居中、层序正确（地毯在底、家具在上）、颜色接近原作图标。
**地毯口径说明**：`art_slice` / `art_preview` 默认 `carpetTemplate="auto"`（运行时 v320+ 口径：横跨 `furn.rug.2`、竖跨 `furn.rug.3`）；若 spec 只有单格 `furn.rug`，auto 模式会回退渲染并在 `report.warnings` 说明。要与旧参考工具 `render-preview.mjs` 逐像素对照时传 `carpetTemplate="single"`。

### 2.4 S4 写入（真实、但不覆盖任何交付档）

> 用 art_write_gil 生成一份新容器：base = `qianxing-murdoku/547-一二关美术-容器-v19.gil`，ops 只有一条 `replace_template_layers`（template=`furn.statue`，sizePx [108,108]，layers 取 `_work/art-tools/art_v332g_statue.json` 里 `templates['furn.statue'].layers`），out = `_work/verify-551.gil`。报告四闸结果和记录数变化。

预期：`records 1491 → 2047`；四闸 `reread/roundtrip/deterministic` 全 true、`idempotent=false`（本次真的改了）、`collision=0`、`thingsRefs.missing=[]`。
**黄金核对**（可选）：`Get-FileHash _work\verify-551.gil -Algorithm SHA256` 应等于
`CBCDCD9C294E2FD2F4F7FA48C53CA6D169F7585C3B28510E833FF664D76ACBFE`（= 仓库 551）。

### 2.5 S5 嵌入

> 用 art_embed_script 把 base 换成刚生成的 `_work/verify-551.gil`，script=`qianxing-murdoku/dist/client_script.lua`，out=`_work/verify-552.gil`，expectMarker=`v332`。报告标记链与字节数。

预期：`marker=distMarker=v332`、`match=true`、`embeddedBytes=1540088`。
**黄金核对**：SHA256 应等于 `AA3986A1A898D5FDAA666E7B87C2747BABFC56651D79F2461E5BFF04A2FDEB29`（= 仓库 552）。

### 2.6 错误路径（确认「不会静默降级」）

依次让代理：
1. `art_embed_script` 的 `expectMarker` 写 `v331` → 必须报 `[E_MARKER]`，且 `_work/` 下**不产生**输出文件；
2. `art_write_gil` 的 `job.expect.records` 写 `9999` → 必须报 `[E_BASE_MISMATCH]`，不产生输出文件；
3. `art_write_gil` 的 `out` 写成 `base` 本身 → 必须报 `[E_PATH]`，且 base 的 SHA 不变。

---

## 3 真机验收（游戏/编辑器侧，S6 的最后一段）

> 这一步在千星编辑器里做，插件只负责「出档 + 清单」。**没做这一步之前，不能宣称游戏里生效。**

### 3.1 准备

1. 用 2.4/2.5 产出的 `_work/verify-552.gil`（或仓库 `552-一二关美术-v332.gil`）作为导入档；
2. 导入编辑器 → **先确认编辑器能打开、不报控件 GUID 重复**。

### 3.2 关键四步（每步都有判据）

| # | 操作 | 判据 |
|---|---|---|
| 1 | 打开编辑器 → 直接进试玩（不改任何东西） | 日志出现 `[murdoku] ===== 构建标记 v332 / … =====`（版本对） |
| 2 | 看日志「家具模板映射」行 | `things 找到=… 条目=10 keys={…}`；条目数=10、无「家具模板缺映射」 |
| 3 | 看每件家具实例化行 | `[murdoku] 家具模板：cell=… ← furn.xxx（prefab=…，格子=…px，父控件=content）` 行数=场上件数；6×6 关 `格子` 应≈89（不是 108） |
| 4 | 截图对照 `_work/art-preview.svg` | 层级：地板 → 地毯 → 家具 → 墙/门/笔记/头像；尺寸不溢格、雕像 381 块能看出形体 |

### 3.3 【最高优先级】编辑器保存往返（交接包 07 坑 1）

> 编辑器「打开→保存」会删掉纯手写的模板记录。必须验证：

1. 导入后**在编辑器里保存一次并导出副本**（如 `_work/editor-roundtrip.gil`）；
2. 让代理：`art_inspect` 对比导入档与导出副本 → `furn.statue` 的 `layers/motherLayers` 是否仍为 381；
3. 在：✅ 编辑器认这份模板（V1 成立）；丢了：❌ 说明该模板必须先在编辑器里建过再填层（插件写入器侧无法绕过，走人工/编辑器侧方案）。

**✅ 2026-10-24 已实测闭环**：编辑器「打开→保存→导出」得到 `qianxing-murdoku/比对.gil`（3217975 字节，比导入档 +3 字节）：

| 检查 | 结果 |
|---|---|
| `art_inspect` | records=2047、**furn.statue 381/381**、其它 9 模板层数全不变、things 10/10 指向模板源、collisions=0、内嵌脚本仍 v332 |
| `art_validate` | `ok=true`，六项检查全过（含 `gil.contentLayers` 逐模板层数） |
| 深比对（记录集合 / 子列表顺序 / 每层位置尺寸图元颜色） | 2047 条记录 ID 集合**完全相同**（仅A/仅B 均为 0）；10 模板 × 源/母本 = 20 份 content，**层数、子列表顺序、每层字段 0 差异** |
| 文件哈希 | 与导入档不同（`AA3986A1…` → `4AC86830…`）：编辑器重编码换了字节布局，**内容没变** |

> ⇒ 结论：模板层由写入器写入、编辑器打开→保存→导出后**完整保留**，07 坑 1 的 V1 路线在本档成立。
> 注意：**编辑器往返后不要用 SHA 对比内容**（编辑器会重编码）；用 `art_inspect` + 层字段深比对
> （复跑脚本：`node _work/art-pipeline-verify/compare-roundtrip.mjs`）。


### 3.4 验收记录模板

```
构建标记：v___（对/错）
things 映射：条目=__（期望 10），缺映射行=__（期望 0）
家具实例化行数：__（期望=件数）
格子像素（6×6）：__（期望≈89）
编辑器往返后 furn.statue 层数：__/__（期望 381/381）
截图：__（路径）
结论：通过 / 不通过（差在哪）
```

### 3.5 真机实测记录（2026-10-24 17:21，导入 `552-一二关美术-v332.gil`）

| 判据 | 日志证据 | 结论 |
|---|---|---|
| 构建标记 | `构建标记 v332 / 2026-10-24 / 雕像改用原作图标压缩（381 纯色矩形，含底座）+ 书架对齐 + 桌子重搭` | ✅ 版本对 |
| 画布 | `画布 1600.00×900.00，与设计一致` | ✅ |
| things 映射 | `things 找到=true 条目=10 keys={chair,plant,rug,rug_2,rug_3,shelf,statue,table,table_h2,table_v2}` | ✅ 10/10，且无「家具模板缺映射」行 |
| 家具实例化 | 大量 `家具模板：cell=… ← furn.xxx（prefab=…，格子=…px，父控件=content）`；雕像 `cell.1.6 ← furn.statue（prefab=1073747136）`；跨格件 `furn.rug.2`/`furn.rug.3` 均出现 | ✅ 模板/引用可用 |
| 缩放通道 | `家具缩放：比例=0.930,0.930 方式=SetLocalScale` | ✅ 走官方 API |
| 格子像素 | 5×5 关 `rects=108.0`（并标注「用 rects ✓」，没有被 `sizeDelta=89` 骗到）；6×6 关实例化行 `格子=89px / 91px` | ✅ 符合 07 坑 7/16 判据 |
| 烘焙旧通道 | `烘焙容器 case_001/002：找到=false 目标=隐藏 子控件=0` | ✅ 旧静态烘焙已不参与 |

**可接受的已知现象（不是缺陷）**：
1. 启动瞬间出现过 `就绪判据未满足（board/cell.1.1/stage/home 都不在）`、控件树只看到 1 个节点，随后 `✅ on_start 成功（重试）` —— 这是属性/控件到达顺序问题（07 坑 8），脚本的恒受理+重试通道生效。
2. 同一格同一模板的「家具模板：…」行出现多次（resync / 切关销毁重建）；04 §1 的设计就是 span/offset 后到会销毁重建，日志重复属预期。

**闭环状态**：§3.3「编辑器保存往返」已于同日实测通过 —— 导出档 `qianxing-murdoku/比对.gil` 的 10 模板 × 源/母本共 20 份 content，层数/子列表顺序/每层字段与导入档 **0 差异**（详见 §3.3 表格）。
⇒ 真机验收（S6）全部判据闭环，整条链路 **S1→S2/S3→S4→S5→真机** 均有实测证据。


---

## 4 失败排查速查

| 现象 | 先查 |
|---|---|
| `[E_ARGS]` | 参数类型/必填；`kind` 必须是 6 种之一；路径参数必须是字符串 |
| `[E_SPEC_INVALID]` | 规格里的 `imageId` 是否在 100001/100002/100003/107102/106056；颜色是否 `0xAARRGGBB`；`w/h>0`；`order` 连续 |
| `[E_BASE_MISMATCH]` | `job.expect.records` / `expect.templates` 与 `base` 实际不符——先 `art_inspect base` 核对 |
| `[E_PATH]` | `out` 等于 `base`/输入；路径为空；路径写错 |
| `[E_GIL_WRITE]` | 四闸之一失败（重读记录数/往返/确定性/幂等）——把错误里的 detail 一起发出来 |
| `[E_COLLISION]` | 新增记录 id 与现有重叠——检查 base 是否被人手动改过 |
| `[E_MARKER]` | dist 脚本标记 ≠ `expectMarker`；或容器里没有可写的脚本叶子（容器档必须先 embed） |
| `tool "art_xxx" returned invalid output: value is not lossless JSON` | 工具输出含 `-0`/`undefined`/`NaN`/非普通对象；跑 `node test/check-host-output.mjs` 定位路径（2026-10-24 实际踩过：层 `y_up=-0`，已修） |
| 改了插件源码但行为没变 | 本插件是 `link:` 安装，改代码后必须**重启 DSH**（remove/install 不会清 Node ESM 模块缓存） |
| 真机「预览有、试玩没有」 | 07 坑 3：模板根 150×150 写成 108；坑 1：手写模板被编辑器删 |
| 真机家具整体大 1.21 倍 | 07 坑 7/16：`GetSizeDelta` 读到模板默认 108，应取布局 rect（6×6≈89） |

## 5 卸载 / 回滚

```
plugin_manager { action: "remove_bundle", target: "dsh-plugin-qianxing-art-pipeline" }
```

插件不修改任何既有交付档：`551-…-容器-v21.gil` / `552-一二关美术-v332.gil` 全程只读（测试用 `_work/` 下的副本）。
