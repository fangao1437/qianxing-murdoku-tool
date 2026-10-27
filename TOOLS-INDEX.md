# 工具与插件总索引

> ★ 本仓是千星奇域（原神 UGC，官方名「千星沙箱」）相关**工具与插件**的集合仓 ✓
> ★★ 分两类 ✓：**可安装的 DSH 插件**（顶层 `dsh-plugin-*`）＋ **主项目的工具脚本**（`project-tools/`）
> ★★★ 整理时点 ✓：**2026-10-27** ✓　★ 来源 ✓：主仓 `qianxing-murdoku`

---

## 〇 ★★ 一分钟导航

| 想干什么 | 去哪 |
|---|---|
| ★ **在编辑器里编辑 UI / 试玩** | ★ `dsh-plugin-beyond-simulator/`（★ `qxqy_studio_*`）|
| ★★ **读 `.gil` 存档、体检、改控件** | ★ `project-tools/gil/`（★ `inspect_gil.mjs` 先看）|
| ★ **给家具做美术（参考图→图元→写档）** | ★ `dsh-plugin-qianxing-art-pipeline/`（★ `art_*`）|
| ★★ **改 3D 场景摆位** | ★ `dsh-plugin-qianxing-3d-placement/`（★ `scene3d_*`）|
| ★ **设计图 → 3D 场景** | ★ `dsh-plugin-design-to-scene/`（★ `scene_*`）|
| ★★ **查千星节点/文档/排障** | ★ `dsh-plugin-miliastra-toolbox/` |
| ★ **节点图 `.gia` 双向翻译** | ★ `dsh-plugin-qianxing-nodegraph/`（★ 核心实现在 `src/`）|
| ★★ **代码审计 / 性能测量** | ★ `project-tools/audit/` ＋ 根目录 `check_*` |
| ★ **关卡数据校验（唯一解）** | ★ `project-tools/validate_levels.lua` |

★ **更细的逐条工具目录** ✓：★ `project-tools/docs/工具目录.md`（★ 63KB，带危险等级与用法）✓

---

## 一 ★★★ 插件（8 个 · DeepSeek Harness 可安装）

★ **装法** ✓：★ 把整个 `dsh-plugin-*` 目录放进
`%USERPROFILE%\.dsh\profiles\<profile>\node_modules\` ✓（★ 或在桌面端插件页安装）✓
★ **发布形态** ✓：★ 已提交 `package.json` ＋ `dsh-plugin.json`（★ 若存在 ✓）＋ `README.md` ✓

| 插件 | 版本 | 作用 | 暴露给模型的工具 |
|---|---|---|---|
| ★★ **`dsh-plugin-beyond-simulator`** | ★ 2.0.8 | ★ **千星奇域客户端 UI 编辑与试玩模拟器** | ★ `qxqy_studio_get` / `load` / `patch` / `play` / `play_screenshot` / `ui_screenshot` |
| ★★ **`dsh-plugin-qianxing-art-pipeline`** | ★ 1.0.0 | ★★ **家具美术管线**（参考图→图元规格→预览→写 `.gil` 模板→嵌脚本→验收） | ★ `art_decompose` / `art_build_spec` / `art_slice` / `art_preview` / `art_validate` / `art_write_gil` / `art_embed_script` / `art_inspect` |
| ★★ **`dsh-plugin-qianxing-nodegraph`** | ★ 0.1.3 | ★★ **节点图双向工具链**（`.gia` 解码／反向翻译／规格→TS／TS→`.gia` 注入 `.gil` 副本） | ★ `qianxing_gia_read` / `qianxing_gia_translate` / `qianxing_spec_emit` / `qianxing_gia_build` / `qianxing_selftest` / `qianxing_gil_graph_ids` |
| ★★ **`dsh-plugin-qianxing-3d-placement`** | ★ 0.1.0 | ★ **3D 场景「摆位」主线**（读实体变换→按坐标表改→写副本重读校验，绕开 Blender/GIA） | ★ `scene3d_list_entities` / `scene3d_apply_placement` |
| ★ **`dsh-plugin-qianxing-3d-report`** | ★ 0.1.0 | ★ **3D 场景确认报告**（设计图＋预览＋渲染＋坐标表 → PDF） | ★ `scene_report_pdf` |
| ★ **`dsh-plugin-design-to-scene`** | ★ 1.0.0 | ★ **设计图 → 3D 场景**（SceneSpec v1 → 预览 → Blender 场景/渲染/GLB → 千星落地清单） | ★ `scene_parse_plan` / `scene_spec_validate` / `scene_preview` / `scene_build_blender` / `scene_qx_plan` |
| ★ **`dsh-plugin-qianxing-prefab-render`** | ★ 0.1.0 | ★ **官方素材渲染**（渊星 prefab 几何库＋贴图 → 场景＋渲染；★ 云端不能导出 GIA ✗） | ★ `scene_prefab_status` / `scene_build_prefab` |
| ★ **`dsh-plugin-miliastra-toolbox`** | ★ 0.1.0 | ★ **千星沙箱知识库查询**（节点用法／指南／教程／FAQ／语义检索） | ★ 知识库类工具（★ 文档检索 ＋ 节点查询 ✓） |

★★ **依赖关系** ✓：
- ★ `qianxing-art-pipeline` / `qianxing-nodegraph` / `qianxing-3d-*` / `prefab-render` **各自 vendor 了 `.gil` 读写模块** ✓（★ 来源 = 本仓 `src/` ✓ MIT ✓）
- ★★ `design-to-scene` **零运行时依赖** ✓
- ★★★ **`beyond-simulator` 与 `miliastra-toolbox` 是「环境/知识」类** ✓，可与上面任意组合 ✓

★ **技能（skills）** ✓：★ `murdoku-art-pipeline` 技能随 `qianxing-art-pipeline` 提供 ✓
（★ 技能目录在 `%USERPROFILE%\.dsh\skills\` ✓）

---

## 二 ★★★ 项目工具（`project-tools/` · 526 文件 · 4.3MB）

★ **来源** ✓：主仓 `qianxing-murdoku/tools/` ✓
★★ **本文档正文按「能干什么」分组** ✓；★★★ **逐条清单见 `project-tools/docs/工具目录.md`** ✓

### 2.1 ★★★ `gil/` —— `.gil` 存档读写与体检（★★ 最核心，197 文件）

| 工具 | 用途 |
|---|---|
| ★★ **`inspect_gil.mjs`** | ★ **只读体检第一步**：记录数／控件树／脚本标记／palette／模板二份 ✓ |
| ★★ **`gilread.mjs`** | ★ **protobuf 单消息体解析**（★ 纯 Node ✓ 无依赖 ✓）|
| ★★ **`gilwrite.mjs`** | ★ **写回**：七步断言（★ 含「输出必须 ≠ 输入」✓）|
| ★★ **`diff_fields.mjs`** | ★ **字段级 diff**（★ 改前改后比对 ✓）|
| ★★ **`roundtrip.mjs`** | ★ **编码往返闸门**（★ ⚠️ 一致 ≠ 生效 ✗ 见 `docs/`）|
| ★★ **`embed_script.mjs`** | ★ **把客户端脚本叠进 `.gil`**（★ `--expect-marker=vNNN` 三方链核对 ✓）|
| ★ **`delete_controls.mjs` / `clone_control.mjs` / `reparent.mjs` / `renumber_ids.mjs`** | ★ 控件增删改与 id 重排 |
| ★ **`fix_clue_tpl_origin.mjs` / `fix_cell_layers.mjs` / `fix_palette_ids.mjs`** | ★ 定点修：线索模板原点／格子层序／调色板镜像 |
| ★ **`gen_*.mjs`（约 50 个）** | ★ **一次性生成器**：调色板／棋盘／按钮美术／模板／things／图标… |
| ★ **`_*.mjs`（约 90 个）** | ★★ **一次性探针** ✗ —— ★ 保留作证据，★ **不是日常工具** |
| ★★★ **`_probe_full_texts.mjs`**（2026-10-28） | ★★ **全树扫文本叶子** ✓ —— ★ 证明 `.gil` **能存文本** ✓（★ 定位到 `/#505/#503/#75/#510/#501` ✓）|
| ★★★ **`_probe_write_text.mjs`**（2026-10-28） | ★★ **写文本受控实验** ✓ —— ★ 改已有 ＋ 补空文本，四闸全过 ✓ 原档不动 ✓ |
| ⚠️ **`_probe_texts.mjs`（旧）** | ★ **只扫状态块内部** ✗ ＋ 只收 `len<=64` ✗ ⇒ ★★ **范围有限，结论不可信** ✗（★ 曾据此误判「存不了文本」✓）|

★ **用法** ✓：
```bash
node project-tools/gil/inspect_gil.mjs "存档/455-外圈骑格线-v267.gil"
node project-tools/gil/embed_script.mjs --in="存档/452-门定位常走路径.gil" --out="存档/456-新档.gil" --expect-marker=v268
```

### 2.2 ★★ `audit/` —— 代码与构建审计（17 文件）

| 工具 | 用途 |
|---|---|
| ★★ **`check_actions.mjs`** | ★ **动作死链扫描**（★ 发出去无人处理的 `action` ✓ ★ 逐行正则、连注释一起扫 ✗）|
| ★ **`check_nesting.mjs`** | ★ 控件嵌套/父子合法 |
| ★★ **`deadcode.mjs`** | ★ **死代码扫描** |
| ★★ **`measure_bundle.mjs`** | ★ **打包体积测量** |
| ★ **`proto_strip_comments.mjs`** | ★ 原型去注释 |
| ★ **`reconcile.mjs`** | ★ 计划与脚本对账 |
| ★ **`sim_surface.mjs`** | ★ 模拟器接口面清单 |

### 2.3 ★★ `qx/` —— 千星侧探针与素材工具（177 文件）

| 工具 | 用途 |
|---|---|
| ★ **`library.mjs` / `library-catalog.json`** | ★ **官方素材库检索**（★ prefab / 贴图目录 ✓）|
| ★ **`probe_gil_assets.mjs` / `_childlist` / `_diff` / `_names` / `_flags`** | ★ **`.gil` 内容探针**（★ assets 名单／子列表／差异／名字／标志位 ✓）|
| ★ **`gia.mjs`** | ★ `.gia` 轻量读写 |
| ★ **`make_icons.mjs` / `make_sheet.ps1`** | ★ 图标批量生成／拼图 |
| ★ **`find_asset.ps1` / `find_slots.ps1` / `probe_pixels.ps1`** | ★ 素材查找／插槽枚举／像素采样 |
| ★ **`avatar_*.ps1`** | ★ 头像裁切／识别／定位（★ 一次性调查 ✓）|
| ★ **`samples/mono/`（95 张）、`samples/`（14 张）** | ★ **合成测试图**（★ 用于字形/像素探针 ✓ ★ 可由 `make_icons.mjs` 重建 ✓）|
| ★ **`graphcode/` / `scenes/`** | ★ 图表代码／场景样本 |

### 2.4 ★★ `sim/` —— 模拟器与试玩（46 文件）

| 工具 | 用途 |
|---|---|
| ★★ **`kit.mjs`** | ★ **模拟器核心**（★ 控件树/几何/父级解析 ✓）|
| ★★ **`play_test.mjs`** | ★ **自动化试玩脚本** |
| ★ **`build_ui.mjs` / `build_hint_save.mjs`** | ★ 造 UI 场景／提示存档 |
| ★ **`audit_flow.mjs` / `audit_layout.mjs`** | ★ 流程审计／布局审计 |
| ★ **`analyze_png.mjs` / `diff_png.mjs` / `map_png.mjs`** | ★ **截图分析**（★ 像素比对／区域映射 ✓）|
| ★ **`gil_to_save.mjs`** | ★ `.gil` → 模拟器存档 JSON |
| ★ **`calibrate.mjs` / `calib2.mjs` / `geom_probe.mjs`** | ★ 几何标定 |
| ★ **`verify_art.mjs` / `white_blobs.mjs` / `overlap.mjs`** | ★ 美术验收／白块检测／重叠检测 |

### 2.5 ★★★ 根目录 —— 主流程（84 个，挑重点）

| 工具 | 用途 |
|---|---|
| ★★ **`bundle_client_script.lua`** | ★ **打客户端脚本包** → `dist/client_script.lua` |
| ★★ **`bump_build_marker.mjs`** | ★ **升构建标记**（★ `--set=vNNN --note=…` ✓）|
| ★★ **`check_all.ps1`** | ★ **总闸门**（★ 语法＋回归＋编码 ✓）|
| ★★ **`run_checks.ps1` / `run_smoke.ps1` / `final_check.mjs`** | ★ 分项校验／冒烟／终检 |
| ★★ **`check_encoding.mjs`** | ★ **编码闸门**：`.lua/.mjs/.md/.json` 必须【无 BOM】✓；`*.ps1` 必须有 BOM ✓ |
| ★★ **`validate_levels.lua`** | ★★ **关卡唯一解闸门**（★ 内容设计必跑 ✓）|
| ★★ **`lua_audit.mjs`** | ★ 语法／残留／引用／单射槽位 |
| ★★ **`lua_blocks.mjs`** | ★ 块配对（★ `--selfcontained` 有假阳性 ✗ 见 docs）|
| ★★ **`lua_map.mjs`** | ★ **可删区间 + 干跑**（★ `--delrange` 用模拟栈，比 blocks 可靠 ✓）|
| ★ **`lua_syntax.lua` / `lua_lint.ps1` / `lua_quote_scan.ps1`** | ★ Lua 语法／lint／引号扫描 |
| ★ **`sabotage_check.mjs`** | ★ 破坏性自检（★ 验闸门是否真能拦 ✓）|
| ★ **`repo_bridge.mjs`** | ★ **无 git 时的仓库交换工具**（★ 解析 `.git/index` ✓）|
| ★ **`archive_version.mjs`** | ★ 版本归档 |
| ★ **`install_script_to_sandbox.ps1` / `sync_to_editor.ps1`** | ★ 装进编辑器沙箱／同步 |
| ★ **`gen_editor_guide.mjs` / `gen_setup_requirements.mjs`** | ★ 生成编辑器指南／环境要求 |

### 2.6 ★★ 根目录 —— 关卡与设计

| 工具 | 用途 |
|---|---|
| ★★ **`design_rules.lua` / `design_solve.lua`** | ★★ **关卡设计规则求解**（★ 摆位可解性 ✓）|
| ★★ **`draw_layout_v2.mjs`** | ★★ **画布局图 PNG**（★ 出设计图 ✓）|
| ★ **`dump_layout.lua` / `dump_level.lua`** | ★ 导出布局／关卡数据 |
| ★ **`make_level_from_grid.lua` / `new_level.lua`** | ★ 从网格表造关卡／新建关卡 |
| ★ **`list_required_assets.lua`** | ★ 列出关卡需要的素材 |
| ★ **`check_layout_dupes.lua` / `check_plan_integrity.mjs`** | ★ 布局去重／计划完整性 |
| ★ **`design_probe_*.py`（12 个）** | ★ 设计图取色／墙体／门／边缘分析（★ 一次性 ✓）|

### 2.7 ★★ 根目录 —— 真机特性验证（每条都对应一个曾经的真 bug）

| 工具 | 验什么 |
|---|---|
| ★ **`verify_press_feedback.mjs`** | ★ 按下反馈 |
| ★ **`verify_longpress.mjs`** | ★ 长按门槛 |
| ★ **`verify_gray_unplace.mjs`** | ★ 灰白层与「拿起」 |
| ★ **`verify_row_overwrite_sentinel.mjs`** | ★ 单射覆盖哨兵（★ 谁最后写 ✓）|

### 2.8 ★★ 根目录 —— 截图分析（Python）

| 工具 | 用途 |
|---|---|
| ★ **`shot_probe.py` / `shot_measure.py` / `shot_crops.py`** | ★ 真机截图取样／测量／裁切 |
| ★ **`shot_classify.py` / `shot_seams.py` / `shot_zoom.py` / `shot_sample.py`** | ★ 分类／接缝检测／放大／采样 |

★ **依赖** ✓：★ Python 3 ＋ numpy/Pillow（★ 与 `design_probe_*.py` 共用 ✓）

### 2.9 ★ `lua-tooling/` 与 `lua53check/`

| 工具 | 用途 |
|---|---|
| ★ **`lua-tooling/qianxing.yml`** | ★ selene 配置（★ 千星 API 白名单 ✓）|
| ★★ **`lua53check/check.cjs`** | ★★ **真机 Lua 5.3 校验**（★ 本机 `luac` 是 5.4 ✗ ⇒ 语法差异会漏 ⇒ 用这个 ✓）|

---

## 三 ★★★ 常用命令（三闸门）

```bash
# ① 打包 + 语法
lua project-tools/bundle_client_script.lua
node project-tools/lua53check/check.cjs dist/client_script.lua --run

# ② 回归（在主项目仓里跑，工具来自本仓）
lua tests/<名>.lua

# ③ 叠进存档（★ 必须核对三方链）
node project-tools/gil/embed_script.mjs --in="存档/<基准>.gil" --out="存档/<新>.gil" --expect-marker=vNNN
```

★ **内容设计专用** ✓：
```bash
lua project-tools/validate_levels.lua        # ★ 唯一解闸门（必须「恰好 1 个解」）
node project-tools/draw_layout_v2.mjs        # ★ 出布局图
```

---

## 四 ★★★ 约定与边界

### 4.1 ★★ 命名约定
- ★ **`_` 前缀** ✓ = **一次性探针/临时脚本** ✗ —— ★ 保留作证据，★ **不保证可跑** ✓
- ★★ **`gen_*.mjs`** ✓ = **一次性生成器**（★ 生成后改存档；★ 复跑可能幂等也可能不 ✓）
- ★ **正式工具** ✓ = 无前缀、有 `--in/--out` 参数、可在新档上复跑 ✓

### 4.2 ★★★ 本仓**不含**的东西（有意为之 ✗）

| 排除项 | 原因 |
|---|---|
| ★★ **二进制**（`stylua.exe` / `selene.exe` / `lua-language-server`，36MB）✗ | ★ 可重装 ✓ |
| ★★ **生成物**（`tools/*/out/`，约 110MB）✗ | ★ 可重建 ✓ |
| ★★ **下载缓存**（`_dl/`，10MB）✗ | ★ 可重新下载 ✓ |
| ★★ **`node_modules/`** ✗ | ★ `npm i` 重建 ✓ |
| ★★ **官方与社区素材**（`sprites/` 28MB、`.gil`、`.png`、`.gia`）✗ | ★★ **授权不在我们手里** ✓ 见 `.gitignore` ✓ |
| ★ **`_wip/`** ✗ | ★ 临时工作区 ✓ |

★★ **⇒ 所以 `project-tools/qx/samples/` 的示例图不入库** ✗
　 ⇒ ★ **需要时用 `make_icons.mjs` 重建** ✓
　 ⇒ ★★ **`project-tools/docs/工具目录.md` 里记了每个工具的历史用法** ✓

### 4.3 ★★ 三条硬规矩（都在 `project-tools/docs/` 里有出处）

1. ★★★ **写 `.gil` 后必须【从磁盘重读】断言** ✗ —— ★ 读内存/刚写的 buffer 证明不了落盘 ✓
2. ★★★ **`roundtrip` 逐字节一致 ≠ 改动生效** ✗ —— ★「冻结整棵树」也能一致 ✓
3. ★★ **`Adapter:find()` 返回陈旧句柄** ✗ —— ★ 引擎重建控件后必须走树遍历 ✓

---

## 五 ★★ 文档索引

### 5.1 本仓原有（工具链/插件设计）
| 文档 | 内容 |
|---|---|
| ★★ `README.md` | ★ 节点图工具链总说明（★ 读/写双向、硬边界 ✓）|
| ★★ `docs/限制清单.md` | ★ **已知限制与未验证项**（★ 先读 ✓）|
| ★ **`docs/读取与翻译算法.md`** | ★ `.gia` 解码与规格翻译算法 |
| ★ **`docs/official-gia-coverage.md`** | ★ 官方 `.gia` 覆盖度 |
| ★ **`docs/同步与维护.md`** | ★ 与主项目同步规则 |
| ★ **`docs/dsh-plugin-art-pipeline.md`** | ★ 美术管线插件说明 |
| ★ **`docs/3D坐标离线改写-验证报告.md`** | ★ 摆位可行性报告 |
| ★ **`docs/渊星工具箱与千星奇域UGC工具-评估.md`** | ★ 工具选型评估 |

### 5.2 主项目随附（`project-tools/docs/`）
| 文档 | 内容 |
|---|---|
| ★★★ **`工具目录.md`（63KB）** | ★★ **逐条工具目录 ＋ 危险等级 ＋ 用法** ✓ |
| ★★ **`插件与工具-调研与安装记录.md`（30KB）** | ★ 插件选型／安装记录 |
| ★★ **`gil工具-总览与错误路径.md`（16KB）** | ★ `.gil` 工具总览 ＋ 常见报错 |
| ★ **`工具探索产出.md`（8KB）** | ★ 探索期产出 |
| ★ **`节点图双向工具-spike报告.md`（74KB）** | ★ 节点图工具的可研报告（★ 本仓 `src/` 的上游背景 ✓）|

---

## 六 ★ 来源与授权

★ **主项目** ✓：`qianxing-murdoku`（★ 千星奇域 2D 谋杀悬疑游戏 ✓）
★ **工具链上游** ✓：`genshin-ts`（MIT ✓）—— ★ 本仓**永不自己写 protobuf 节点图** ✗
★ **本仓内容** ✓：★ 主项目工具脚本（★ 项目自有 ✓）＋ 8 个插件（★ 自有 ✓）
★ **第三方二进制** ✗ 不入库（★ 见 4.2 ✓）
