# 本项目已装插件（FeiBo 适配层）

调用方式：`node .feibo-plugins/qx.mjs call <工具名> '<JSON参数>'`；列表：`list --full`；技能全文：`skill <技能名>`。

## 工具

### dsh-plugin-qianxing-art-pipeline

- **art_decompose** — S1 图元拆解：把一张家具参考图 PNG 拆成「只含官方基础形状」的层列表（ArtSpecSet，契约 version=1）。mode=compress 用调色板量化 + 矩形合并（平涂图标最忠实，雕像基线 56×91 约 381 块）；mode=records 把外部拟合工具的图元记录换算成层。只产出规格 JSON，不写 .gil。压缩自检（空洞/重叠/越界必须为 0）不过会抛 E_SPEC_I
  参数：`["icon","kind","variant","size","mode","quantize","std","records","units","name","out"]` 必填：`["kind"]`
- **art_build_spec** — S2 层表/规格：把手写的 TemplateSpec 层表规范化成 ArtSpecSet（补 y_up=-dy_down、order 1..N、画布默认值、颜色统一 0xAARRGGBB），并做结构校验。产物是 S3 预览与 S4 写入的共同输入。非法规格抛 E_SPEC_INVALID，错误里带第一处不符字段。
  参数：`["templates","name","cellTemplatePx","source","out"]` 必填：`["templates"]`
- **art_slice** — S3 切件：关卡布局 Layout → 每件家具的 { templateKey, anchor, span, offsetCells }（运行时脚本下发的就是这些）。table/carpet 按 4 邻接合并；锚点=包围盒右下格；offsetCells 单位=格、dy 向下为正；横跨地毯自动映射 furn.rug.2 / furn.rug.3。
  参数：`["layout","carpetTemplate","out"]` 必填：`["layout"]`
- **art_preview** — S3 预览/校验：ArtSpecSet + Layout → 1600×900 SVG 观感基准图 + ValidationReport。几何与游戏一致（棋盘 584@(608,138)、ruler 12、gap 4、格宽 5×5=108 / 6×6≈89），只读 ArtSpecSet，不读运行时状态。用于「参考图 vs 预览」并排对照迭代，差异大先查缩放/层序，不要先改美术。
  参数：`["spec","layout","out","labels","scale","carpetTemplate"]` 必填：`["spec","layout"]`
- **art_validate** — 共用校验：target=spec 校验 ArtSpecSet（图元 id/颜色/层序/画布/地毯规则）；target=job 校验 WriterJob 结构；target=gil 校验 .gil（记录数/撞号/模板对闭合/things 引用/内嵌脚本标记）。返回 ValidationReport（ok + checks），不抛错。
  参数：`["target","value","strict"]` 必填：`["target","value"]`
- **art_write_gil** — S4 写入器（事务化）：按 WriterJob 把 TemplateSpec.layers 写进 .gil 模板对的源/母本两份 content，并维护 things 引用控件。支持 op：replace_template_layers / set_canvas / set_things_ref / set_family。四闸全过才产出（重读记录数、roundtrip 逐字节、确定性、幂等），另检
  参数：`["job"]` 必填：`["job"]`
- **art_embed_script** — S5 脚本嵌入：把 dist 客户端脚本写进容器 .gil 的内嵌脚本叶子，得到可导入游戏的最终档。source（脚本标记行）= dist = embedded 三处标记必须一致（expectMarker，如 v332）；脚本 BOM 自动剥离；标记链不一致抛 E_MARKER 且不产出文件。写盘走重读/往返闸门。
  参数：`["job"]` 必填：`["job"]`
- **art_inspect** — S6 结构清单：读 .gil 输出模板表（源/母本/content id、画布、层数）、things 引用（名字→prefab，是否指向模板源）、内嵌脚本标记与字节数、真撞号数、root 顶层控件概览。真机验收/排障第一步：先确认导入的是哪一版、模板与引用是否齐全。
  参数：`["gil","limit"]` 必填：`["gil"]`

### dsh-plugin-qianxing-nodegraph

- **qianxing_gia_read** — 读千星沙箱的 .gia 节点图文件：原生解码节点/连线/常量/端口名，产出 graph.json + 人类可读的 behavior-spec.md（控件层记录也会读）。只读、不改文件。要顺带产出翻译规格时传 spec=true。.gil 的节点图段本工具读不了（会返回 layout=other）。
  参数：`["path","spec","outdir"]` 必填：`["path"]`
- **qianxing_gia_translate** — 把 .gia 节点图反向翻译成 emit.mjs 能消费的行为规格 JSON（spec）。能译的图才写 spec；分支/循环/枚举/列表/字典常量/复合节点等会按 BLOCKERS 分类拒绝并在 translate.json 里写明原因（退出码 2），不要当成功。
  参数：`["path","outdir"]` 必填：`["path"]`
- **qianxing_spec_emit** — 把行为规格 JSON（qianxing_gia_translate 的产物，或手写 spec）编译成 genshin-ts 的 TypeScript 源码（人可读、可手改、可进版本库）。纯离线，不联网。
  参数：`["spec","outdir"]` 必填：`["spec"]`
- **qianxing_gia_build** — 调上游 genshin-ts（MIT）把 TypeScript 编译成 .gia；可选 --copy-gil 把节点图注入到 .gil 的副本（不原地改存档）。需要服务器上有一个装了 genshin-ts 的 workbench 目录（含 node_modules/genshin-ts/bin/gsts.mjs）；没有时返回 E_NO_WORKBENCH，不会假装成功。
  参数：`["ts","workbench","copyGil","targetId","outdir"]` 必填：`["ts"]`
- **qianxing_gil_graph_ids** — 列出 .gil 存档里所有节点图 id（注入节点图时的 targetId 必须是其中之一）。只读；需要 genshin-ts 工作台来解析 .gil 内部结构。
  参数：`["gil","workbench"]` 必填：`["gil"]`
- **qianxing_selftest** — 跑 vendor 工具链的离线回归（186 项，不联网、不需要 Python、不需要样本 .gia），确认插件自带的工具链完好。
  参数：`[]` 必填：`[]`

### dsh-plugin-qianxing-3d-placement

- **scene3d_list_entities** — 列出 .gil 3D 场景存档里的场景实体（#5 列表）：名称、index、位置/旋转/缩放（米/度）。用于「插件只做摆位」主线：先看清存档里已有哪些元件、当前坐标，再决定每个元件要移到哪。只读。
  参数：`["gil"]` 必填：`["gil"]`
- **scene3d_apply_placement** — 3D 场景摆位主线：读 .gil 场景实体，按坐标表离线改写位置/旋转/缩放，写新档并重读校验（原档只读）。placement 每项 {name 或 index, position?:[x,y,z] 绝对坐标(米), delta?:[dx,dy,dz] 相对位移, rotation?:[x,y,z] 欧拉角(度), scale?:[x,y,z]}。绕开 Blender/GIA/渊星；只改现有元件变
  参数：`["gil","placement","out"]` 必填：`["gil","placement"]`

### dsh-plugin-qianxing-3d-report

- **scene_report_pdf** — 把 3D 场景的「设计图 + 俯视预览 + Blender 渲染图 + 元件坐标表」合成一份 PDF 确认报告（不是内部参考，是给用户确认和调整用的）。同时输出 placement.json（坐标为调整输入）。需要服务器有 Chrome（已有）。典型用法：scene_parse_plan → scene_preview → scene_build_blender → 本工具 → qqbot_sen
  参数：`["spec","design","preview","renders","outDir","title"]` 必填：`["spec"]`

### dsh-plugin-design-to-scene

- **scene_parse_plan** — S1 设计图解析：把「网格平面设计图 PNG」解析成 SceneSpec v1（房间/墙/门/家具格 → 场景数据）。只支持 examples/DESIGN-FORMAT.md 里定义的「数字设计图」约定（图例由 legend 提供）；手绘/概念图请让代理看图后直接写 SceneSpec 再走 scene_spec_validate。输出 spec JSON + 可选俯视预览 PNG，并报告未分类
  参数：`["design","legend","rows","cols","cellPx","margin","metersPerCell","out","previewOut"]` 必填：`["design"]`
- **scene_spec_validate** — 校验/规范化 SceneSpec v1（版本、名称、包围盒、房间、墙/门、物件、灯光、相机、环境）。返回 ValidationReport + 规范化后的 spec（坐标/颜色/尺寸统一）；结构错误不会静默修正，而是出现在 checks 里。可作为 scene_preview / scene_build_blender 前的守门。
  参数：`["spec","out"]` 必填：`["spec"]`
- **scene_preview** — S2 场景预览：SceneSpec v1 → 俯视预览 PNG（房间颜色/墙/门/家具 footprint/网格），用于和设计图并排对照（改坐标前先看它）。纯 JS 光栅化，零依赖、不需要 Blender。
  参数：`["spec","out","scale","gridLines","labels"]` 必填：`["spec"]`
- **scene_build_blender** — S3 Blender 搭建：SceneSpec v1 → 生成 bpy 构建脚本并可调用本机 Blender（headless）产出 .blend + 俯视/透视渲染 PNG + GLB。「千星奇域 UGC 工具」是 Blender 里的手工插件（要人建模/配灯/导 GIA）；本工具补自动化：按 SceneSpec 直接搭出完整场景，之后可用渊星插件导 GIA。未找到 Blender 时仍会生成脚
  参数：`["spec","outDir","blenderPath","render","views","exportGlb"]` 必填：`["spec","outDir"]`
- **scene_qx_plan** — S4 千星落地：SceneSpec v1 → 千星/渊星落地清单（物件摆放表 + 坐标/朝向 + GIA 导出导入步骤 + 校验要点）。说明 3D 场景与「千星奇域 UGC 工具」的分工：本工具负责设计图→场景数据→Blender 自动搭建，渊星插件负责在 Blender 里导入导出 GIA 到千星。
  参数：`["spec","outDir","format"]` 必填：`["spec","outDir"]`

### dsh-plugin-qianxing-prefab-render

- **scene_prefab_status** — 检查「官方素材渲染」环境是否就绪：Blender 5.2 可执行文件 + 渊星官方资产（catalog.json / geometry/*.blend / textures）。返回路径与可用性，不渲染。
  参数：`[]` 必填：`[]`
- **scene_build_prefab** — 用渊星官方 prefab（几何库+贴图）把 SceneSpec 自动搭成 3D 场景并渲染：输出 .blend + 透视/俯视 PNG + 统计。只做渲染/预览——云端无法导出 GIA（需要 Windows host bridge + 渊星权益）。第一次用先调 scene_prefab_status 确认环境就绪。
  参数：`["spec","outDir","width","height","samples","exposure","assetsDir","blenderPath"]` 必填：`["spec"]`

### dsh-plugin-miliastra-toolbox

- **get_node_info** — 查询千星沙箱（原神千星奇域 UGC 编辑器）节点的用法：功能、参数、归属端（server 服务端 / client 客户端 / both 双端）与来源文档。按节点标题子串匹配，可批量查询多个节点。仅索引节点图节点，编辑器组件与概念/功能章节请改用 get_document 或 list_documents。
  参数：`["names"]` 必填：`["names"]`
- **list_documents** — 列出千星沙箱知识库中的文档标题（官方指南/教程/FAQ，不含正文）。不知道精确文档名时先用它浏览有哪些文档；不传 keywords 时列出全部 300+ 篇文档。不含客户端控件/客户端脚本文档——那是 list_client_documents 的职责。
  参数：`["keywords"]` 必填：`[]`
- **get_document** — 按标题获取千星沙箱官方文档全文，支持模糊匹配与批量获取。单个关键词命中超过 5 篇时只返回标题列表（status 为 too_many），需换更精确的关键词重查。不含客户端控件/客户端脚本文档——用 get_client_document。
  参数：`["titles"]` 必填：`["titles"]`
- **rag_search** — 对千星沙箱知识库做自然语言语义检索，返回相关文档片段（含相似度 similarity 与来源文档）。适合开放问题与「为什么不触发/不生效」类排障；能用节点名或文档名直接定位时优先用 get_node_info / get_document。仅覆盖服务端语料，客户端语料请用 list_client_documents / get_client_document。
  参数：`["queries","top_k"]` 必填：`["queries"]`
- **list_client_documents** — 列出千星奇域客户端控件/客户端脚本（lua）文档标题（不含正文），仅用于 2D + lua 脚本游戏制作场景。服务端节点图与玩法逻辑问题用 list_documents，不要用本工具。
  参数：`["keywords"]` 必填：`[]`
- **get_client_document** — 按标题获取千星奇域客户端控件/客户端脚本（lua）文档全文，支持模糊匹配与批量获取，仅用于 2D + lua 脚本游戏制作场景。单个关键词命中超过 5 篇时只返回标题列表（status 为 too_many），需换更精确的关键词重查。
  参数：`["titles"]` 必填：`["titles"]`

### dsh-plugin-beyond-simulator

- **qxqy_script_sync** — 实机 Lua 目录复制同步：discover/status/configure/preview。configure 的 args 包含 config(version:1, workspaceDir, clientImportRoot, clientSubdir) 和 expectedRevision；配置随完整存档保存。preview 只检查差异，复制必须由用户在 Lua 脚本页面检查并确认。
  参数：`["action","args"]` 必填：`["action"]`
- **qxqy_studio_get** — 读取当前 DeepSeek Harness 会话的千星 UI 编辑器无损 JSON 快照。
  参数：`[]` 必填：`[]`
- **qxqy_studio_play_screenshot** — 获取当前试玩 Runtime 画面的 PNG。Host 与独立试玩页共用 Runtime scene 树（同级先出现的子节点在上）再画成 PNG，不需要打开试玩页或切换标签。仅在需要观察运行时画面、动画或交互结果时调用；若要看编辑器舞台，请改用 qxqy_studio_ui_screenshot。不会步进时间，也不替代 get {inspect:true} 的结构化断言。
  参数：`[]` 必填：`[]`
- **qxqy_studio_ui_screenshot** — 获取当前编辑器舞台的 PNG。Host 根据 boxes 在进程内渲染，不需要打开或保持“模拟器”标签。用于检查静态 UI 布局、选中项和控件图元；不含完整 Chrome DOM 工具栏/检视器。若要看 Lua Runtime 试玩画面，请改用 qxqy_studio_play_screenshot。
  参数：`[]` 必填：`[]`
- **qxqy_studio_patch** — 修改当前会话的千星 UI 工程。op 必须携带 expectedRevision。客户端控件索引用 setControlGuid（id、guid）；必须根据快照 controlGuidChanges 更新存档 Lua source 和相关源文件的索引引用并核对，完成后用 acknowledgeControlGuidChanges（changeIds）确认，禁止盲目替换全部同值数字。
  参数：`["op"]` 必填：`["op"]`
- **qxqy_studio_play** — 控制当前会话的千星 UI 试玩 Worker：启动、步进、输入、暂停、停止、多设备画布切换、多人视角、服务端变量/信号，以及录制回放用例。
  参数：`["action","args"]` 必填：`["action"]`
- **qxqy_studio_load** — 从当前会话工作区拉取千星模拟器存档。不传 path 时列出工作区内的 qxqy-simulator-save；传入相对路径则加载该存档。
  参数：`["path"]` 必填：`[]`

## 技能

### murdoku-art-pipeline（dsh-plugin-qianxing-art-pipeline）

千星沙箱（原神千星奇域）家具美术管线：参考图 → 图元规格 JSON → 离线预览校验 → 写入 .gil 模板/引用 → 嵌入客户端脚本 → 真机验收。当任务涉及家具美术规格、模板层、.gil 容器写入、脚本嵌入、things 引用控件、美术验收时使用；对应工具 art_decompose / art_build_spec / art_slice / art_preview / art_validate / art_write_gil / art_embed_script / art_inspect。

<details><summary>全文</summary>

# murdoku-art-pipeline · 千星家具美术管线

把「参考图 → 图元规格 JSON → 离线预览校验 → 写入 `.gil` 模板/引用 → 嵌入客户端脚本 → 真机验收」拆成 8 个工具。
所有阶段只交换契约 JSON（`version: 1`），**实现可以替换，接口不变**。

## 何时使用

- 要新增/修改家具美术（椅子、植物、雕像、桌、书架、地毯）并写进千星存档；
- 要把一张参考图变成「只用官方基础形状」的层规格；
- 要离线看棋盘上家具长什么样、核对层序/尺寸/颜色；
- 要把规格写进 `.gil` 的模板对（源/母本 content + 层），或维护 `things` 引用控件；
- 要把 `dist/client_script.lua` 嵌进容器存档出最终档，并核对版本标记链；
- 要确认某份 `.gil` 里模板/引用/内嵌脚本到底是什么（真机导入前后排障）。

不要用它做：3D 节点图、`.gia` 节点图、客户端 UI 控件树编辑。那些不属于本管线。

## 阶段与工具

| 阶段 | 工具 | 输入 → 输出 |
|---|---|---|
| S1 | `art_decompose` | 参考图 PNG / 拟合记录 → `ArtSpecSet` |
| S2 | `art_build_spec` | 手写层表 → `ArtSpecSet`（规范化+校验） |
| S3 | `art_slice` | `Layout` → 每件家具 `{templateKey, anchor, span, offsetCells}` |
| S3 | `art_preview` | `ArtSpecSet` + `Layout` → 1600×900 SVG + `ValidationReport` |
| 共用 | `art_validate` | `spec` / `WriterJob` / `.gil` → `ValidationReport` |
| S4 | `art_write_gil` | `WriterJob` → 容器 `.gil` + `WriterReport`（四闸） |
| S5 | `art_embed_script` | `EmbedJob` → 最终 `.gil` + `EmbedReport`（三方标记链） |
| S6 | `art_inspect` | 最终 `.gil` → 模板/引用/内嵌脚本清单 |

标准链路：`art_decompose` 或 `art_build_spec` → `art_preview` →（满意后）`art_write_gil` → `art_embed_script` → `art_inspect` → 真机。

## 路径与工作区

所有路径按**会话当前工作目录**解析（或用绝对路径）。写文件的参数（`out`、`job.out`、`job.base` 等）：
- 输出**不得覆盖**输入（契约要求；工具会直接拒绝）；
- 优先把中间产物写到 `_work/`、最终产物写回项目目录；
- 绝对路径最稳（例如 `D:\...\qianxing-murdoku\547-一二关美术-容器-v19.gil`）。

## 数据契约速记（version 1）

```
Layer        { order, imageId, color:"0xAARRGGBB", w, h, dx, dy_down, y_up=-dy_down, rotDeg? }
             单位 = content 画布 px；dx 相对中心右正；dy_down 向下为正；order 从下到上 1..N
TemplateSpec { template, kind, variant, sizePx:[w,h], layerCount, layers:[Layer] }
ArtSpecSet   { version:1, name, source, cellTemplatePx:108, templates:{ [名字]: TemplateSpec } }
Layout       { version:1, name, rows, cols, frame, rooms, cells:["0000",…], objects:[{name,kind,cells}] }
WriterJob    { version:1, base, out, ops:[…], expect:{ records?, templates? } }
EmbedJob     { version:1, container, script, out, expectMarker:"vNNN" }
```

`imageId` 只允许官方基础形状：`100001` 矩形、`100002` 椭圆、`100003` 三角、`107102` 近白圆角板、`106056` 柔光圆。
**不要引用官方家具贴图**；仓库只存 id/颜色/尺寸/几何。

## 硬约束（全部实测过，违反会坏档/坏画面）

1. **编辑器打开→保存会删纯手写的模板记录**：模板必须先在编辑器里建过（哪怕是空模板），写入器只往里面填 content/层。写完必须让用户做一次「打开→保存→导出」副本，`art_inspect` 核对层还在。丢层就只能改走编辑器侧手动建。
2. `things` 引用控件的引用值必须是**模板源** GUID，不是母本；`art_inspect` 的 `things.refs[].ok` 为 false 就是这里错了。
3. 模板根 150×150 ≠ content 画布 108×108；多格画布 `h2/rug.2=216×108`、`v2/rug.3=108×216`。
4. 层记录必须克隆自「编辑器认的图片控件」，不要凭空构造记录。
5. 旋转层的非等比缩放是近似；地毯这类轴对齐矩形没问题，带旋转的家具尽量等比。
6. 半透明细节必须有实心底，否则透格子底色（雕像用压缩路线最稳）。
7. Lua 脚本不能带 BOM；标记行 note 不能含「画布」二字（会抢测试的日志定位）。
8. 幂等：同一 `WriterJob` 重跑必须原样复制、SHA 不变；`art_write_gil` 自己会做这个判定。
9. 预演 ≠ 真机：判据是「同数据、同格宽下基本一致」；差异大先查缩放/层级（坑：`GetSizeDelta` 可能读到模板默认 108，而 6×6 格实际 89px）。

## 常用调用示例

```
# 1) 雕像：图标压缩 → 规格（基线 56×91 约 381 块）
art_decompose { icon: "_work/art-ref/render/icons-colored/statue__secret-lab.png",
                kind: "statue", size: [56,91], out: "_work/art-tools/statue-spec.json" }

# 2) 预览：规格 + 布局 → SVG
art_preview { spec: "qianxing-murdoku-tool/art/specs/furniture_templates.json",
              layout: "qianxing-murdoku-tool/art/examples/level-demo.json",
              out: "_work/art-preview.svg" }

# 3) 写入：替换雕像 381 层（base 新 → out 新，不覆盖）
art_write_gil { job: { version:1, base: "qianxing-murdoku/547-一二关美术-容器-v19.gil",
                       out: "qianxing-murdoku/551-…-容器-v21.gil",
                       ops: [ { op:"replace_template_layers", template:"furn.statue",
                                sizePx:[108,108], layers: [ …381 层… ] } ] } }

# 4) 嵌入脚本 + 标记链
art_embed_script { job: { version:1, container: "…/551-…-容器-v21.gil",
                          script: "qianxing-murdoku/dist/client_script.lua",
                          out: "…/552-一二关美术-v332.gil", expectMarker: "v332" } }

# 5) 真机前核对
art_inspect { gil: "qianxing-murdoku/552-一二关美术-v332.gil" }
```

## 错误与验收

- 失败一律 `[E_XXX] 说明 | detail=…`：`E_SPEC_INVALID`（规格非法）、`E_BASE_MISMATCH`（expect 与基准档不符）、
  `E_GIL_WRITE`（四闸之一失败）、`E_COLLISION`（真撞号）、`E_MARKER`（标记链不一致）、`E_EDITOR_LOSS`（编辑器往返丢层，需人工介入）。
- **不要用「工具返回成功」当验收**：`.gil` 类结论必须来自重读磁盘（写入器已内置），美术结论必须来自预览图/真机截图。
- 真机验收看三类日志：构建标记行 → 「家具模板映射：things 找到=… 条目=N」→ 每件「家具模板：cell=… 格子=…px」，
  再对截图看层级（face → 地毯 → 家具 → 墙/门/笔记/头像）与尺寸。


</details>

### qianxing-nodegraph（dsh-plugin-qianxing-nodegraph）

千星沙箱（原神 UGC）节点图双向工具链：.gia 节点图解码 → 行为规格（反向翻译）→ genshin-ts TypeScript → .gia（可选注入 .gil 副本）。当用户发来 .gia/.gil 要读节点图、要翻译成规格/TS、要把规格编译成 .gia、或要把节点图写进 .gil 时使用；对应工具 qianxing_gia_read / qianxing_gia_translate / qianxing_spec_emit / qianxing_gia_build / qianxing_selftest。

<details><summary>全文</summary>

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


</details>

### qianxing-3d-placement（dsh-plugin-qianxing-3d-placement）

千星 3D 场景「摆位」主线（绕开 Blender/GIA/渊星）：读 .gil 场景实体 → 按设计图/坐标表离线改写位置、旋转、缩放 → 写副本 + 重读校验。当用户要在 3D 场景里移动/旋转/缩放已摆好的元件、按设计图调摆位、或验证 3D 存档坐标时使用；对应工具 scene3d_list_entities / scene3d_apply_placement。

<details><summary>全文</summary>

# qianxing-3d-placement · 千星 3D 场景「摆位」主线

**主线口径：插件只做摆位。** 3D 场景不需要 Blender / GIA / 渊星 / 账号权益——
纯 Node 读写 `.gil` 的场景实体变换（`#5 → #6 → #11` 的位置/旋转/缩放），
由编辑器导入验证；这一条已经过真机导入再导出验证（坐标原样保留）。

## 何时使用

- 用户已有一个 3D 场景存档（`.gil`），想按设计图/坐标表**移动、旋转、缩放现有元件**
- 需要先看清存档里有哪些元件、当前坐标
- 「渊星绕过」路线：不导出 GIA、不打开 Blender，直接离线改存档坐标

## 工具

| 工具 | 作用 | 参数 |
|---|---|---|
| `scene3d_list_entities` | 列出场景实体：index / 名字 / 位置(米) / 旋转(度) / 缩放 | `gil` |
| `scene3d_apply_placement` | 按坐标表离线改写（写新档 + 重读校验） | `gil`、`placement`、可选 `out` |

`placement` 每项：

```json
{ "name": "金属桌子", "delta": [2.0, 0.5, 1.5] }
{ "name": "相框", "rotation": [0, 45, 0] }
{ "index": 23, "position": [-6.5, 2.17, -12.17] }
{ "name": "椅子", "scale": [1.2, 1.2, 1.2] }
```

- `position`：绝对坐标（米）
- `delta`：相对位移（米）
- `rotation`：欧拉角（度，稀疏编码，只改存档里已存在的轴）
- `scale`：缩放

## 标准流程

1. 用户发来 `.gil` 3D 存档（QQ 下载到 `~/.dsh-qqbot/media/`）或给路径
2. `scene3d_list_entities(gil=...)` → 看实体清单和当前坐标
3. 按用户要求（或设计图 spec）算出每个元件的目标坐标
4. `scene3d_apply_placement(gil=..., placement=[...])`
   - 原档只读；输出默认 `<名字>.placement.gil`
   - 返回：改了哪些实体、`diffs` 条数、`sha256Before/After`、重读校验结果
5. 把新档用 `qqbot_send_file` 发给用户 → 导入编辑器 → **重载地图**后确认

## 硬限制（必须如实说）

- **只改现有元件的变换**；新增/删除/复制元件没有验证过，不能承诺
- 元件的旋转是稀疏编码：只改存档里已写出的轴；没写的轴不强行生成
- 名字匹配：先精确匹配，再包含匹配；重名时用 `index` 指定
- 导入编辑器后要**先重载地图再保存**，否则可能被旧存档覆盖
- 这是「坐标编排」路线：场景里的元件仍需用户先在编辑器摆好占位

## 与其它插件的关系

- `design-to-scene`（scene_parse_plan / scene_preview / scene_qx_plan）：负责「设计图 → 坐标表」，其 `scene_qx_plan` 的 placement 行就是这个工具要吃的坐标
- `scene_build_blender`：可选的可视化辅助（渲染/GLB），**不是主线**，不需要 GPU 也能只出坐标
- `qianxing-nodegraph`：`.gia` 节点图工具，和 3D 摆位无关

## 判断成功

- `ok: true`、`diffs` 条数与预期一致（每个 position 轴 1 条、每轴旋转 1 条）
- 其它实体的位置/缩放没变（`diffSample` 里只应出现目标实体）
- 用户导入后**元件位置真的变了** → 才算真成功；文件层成功不等于游戏里生效


</details>

### qianxing-3d-report（dsh-plugin-qianxing-3d-report）

3D 场景确认报告：把设计图、俯视预览、Blender 渲染图和元件坐标表合成 PDF，交给用户确认与调整（不是内部参考）；同时输出 placement.json。当 3D 场景需要「出图给别人看」「确认摆位」「导出坐标表 PDF」时使用；对应工具 scene_report_pdf。

<details><summary>全文</summary>

# qianxing-3d-report · 3D 场景确认报告（PDF）

把 3D 场景从「内部参考」变成「可以拿出去确认的东西」：
用设计图 + 俯视预览 + Blender 渲染图 + 元件坐标表合成一份 PDF，交给用户确认和调整。

## 什么时候用

- 用户在 3D 场景里跑了 Blender（或只有 SceneSpec），要**看渲染结果 + 元件坐标**并做确认
- 用户说「给我一份 PDF / 报告 / 排布图确认」「把坐标表导出来」
- 需要把摆位方案发给别人看（不是贴聊天里的内部记录）

## 工具

`scene_report_pdf`

| 参数 | 说明 |
|---|---|
| `spec` | **必填**：SceneSpec 对象或 JSON 路径 |
| `design` | 可选：设计图 PNG（嵌入报告第 1 节） |
| `preview` | 可选：俯视预览 PNG（`scene_preview` 产物） |
| `renders` | 可选：Blender 渲染图路径数组（字符串或 `{path,label}`），一般传 `render-top.png` / `render-perspective.png` |
| `outDir` | 可选：输出目录（默认 spec 同目录 `report/`） |
| `title` | 可选：报告标题 |

产物：

- `scene-report.pdf`（A4，含封面/概览/设计图/预览/渲染图/元件坐标表/房间表/确认与调整说明）
- `scene-report.html`（PDF 源）
- `placement.json`（与坐标表一致，可直接作为调整输入）

## 标准流程

```
1. scene_parse_plan       设计图 + legend → spec.json
2. scene_preview          spec → 俯视预览 preview.png
3. scene_build_blender    spec → .blend + GLB + render-top/perspective.png（可选但推荐）
4. scene_report_pdf       spec + design + preview + renders → PDF + placement.json
5. qqbot_send_file        把 PDF 发给用户确认
```

- 报告第 3 节就是**元件坐标表**（id/kind/x/y/z/rotY/尺寸/颜色）
- 用户调整后，把新坐标喂给 `scene3d_apply_placement` 就能离线改 `.gil`（摆位主线），不需要重跑 Blender

## 注意

- 需要服务器有 Chrome（`/usr/local/bin/google-chrome` 或 `google-chrome`）；没有会返回 `E_NO_CHROME`
- 渲染图是「确认用」的，不是最终游戏画面；真机效果以编辑器导入为准
- 中文由系统字体（Noto CJK）保证，缺字会显示方块
- 单个 PDF 生成约 3-10 秒（主要是 Chrome 启动和嵌入图片）
- 发 PDF 时用 `qqbot_send_file(file_path=".../scene-report.pdf")`；发完不要附加解释


</details>

### design-to-3d-scene（dsh-plugin-design-to-scene）

设计图 → 完整 3D 场景管线：解析网格平面设计图或由代理看图画 SceneSpec v1，校验后用 scene_preview 生成俯视预览，再用 scene_build_blender 自动搭出 Blender 场景（.blend/渲染/GLB），最后 scene_qx_plan 输出千星/渊星落地清单。适用于千星奇域 3D 场景、以及任何需要从设计图快速起场景的任务。

<details><summary>全文</summary>

# design-to-3d-scene · 设计图 → 完整 3D 场景

把「一张设计图」变成「**可运行的 3D 场景**」：`SceneSpec v1` 契约 → 校验 → 俯视预览 →
Blender 自动搭建（.blend + 渲染图 + GLB）→ 千星/渊星落地清单。

这套流程是给 **千星奇域 3D 场景** 用的。先记住分工：

| 环节 | 谁做 |
|---|---|
| 设计图 → 场景数据（房间/墙/门/家具/灯光/相机） | 本插件：`scene_parse_plan`（网格平面图）或代理看图后直接写 SceneSpec |
| 视觉预览、跟设计图并排对照 | 本插件：`scene_preview` |
| 3D 场景搭建（几何/材质/灯光/相机/渲染） | 本插件：`scene_build_blender`（自动生成 Blender 场景） |
| Blender 里导 GIA / 导入到千星 | **「千星奇域 UGC 工具」**（渊星工具箱的 Blender 插件，`entitlement_required`，需要 Blender + 账号权益） |
| 千星编辑器里摆放/验收 | 人（或代理按落地清单逐项核对） |

> 结论先行：渊星那个「千星奇域 UGC 工具」本身是 **Blender 手工搭场景插件**（建场景/配灯光环境/导 GIA），
> **不做「设计图→自动搭完整场景」**。本插件补的就是这段自动化。

## 何时用

- 用户给一张**平面设计图/布局图**，要快速起一个 3D 场景（房间、墙、门、家具位置）；
- 已有 Blender 场景想法，但不想从零手搭：先出 SceneSpec → 自动生成 Blender 场景 → 再精修；
- 需要把 3D 场景落地到千星：要一份「摆什么、放哪、朝哪、多大」的清单。

不要用它做：2D UI 美术管线（那是 `murdoku-art-pipeline`）、千星节点图/玩法逻辑。

## 标准流程（四条命令）

```
# ① 设计图 → SceneSpec（网格平面图；图例见 examples/DESIGN-FORMAT.md）
scene_parse_plan { design: "design/hall-plan.png", legend: "design/hall-legend.json",
                   out: "_work/hall.spec.json", previewOut: "_work/hall.parse.png" }

# ①' 概念图/手绘图：自己看图，直接写 SceneSpec（格式见下），再校验
scene_spec_validate { spec: { ... }, out: "_work/hall.spec.json" }

# ② 俯视预览：跟设计图并排对照，先改坐标再建 3D
scene_preview { spec: "_work/hall.spec.json", out: "_work/hall.preview.png" }

# ③ Blender 自动搭建：.blend + top/perspective 渲染 + GLB
scene_build_blender { spec: "_work/hall.spec.json", outDir: "_work/hall-scene",
                      render: true, exportGlb: true }

# ④ 千星落地清单（摆放表 + 渊星/千星步骤 + 自检表）
scene_qx_plan { spec: "_work/hall.spec.json", outDir: "_work/hall-qx" }
```

## SceneSpec v1（唯一契约）

坐标系（米）：`x` 向右、`z` 向前（设计图向下）、`y` 向上。平面坐标 = `(x, z)`。

```jsonc
{
  "version": 1, "name": "hall", "unit": "m",
  "bounds": { "width": 8.0, "depth": 6.0 },
  "grid": { "cell": 0.5, "rows": 12, "cols": 16 },          // 可选，来自设计图
  "rooms":  [ { "id":"r1","name":"大厅","color":"#D9CDB4","cells":[[1,1]] } ],
  "walls":  [ { "from":[0,0],"to":[8,0],"height":2.8,"thickness":0.15,
                "openings":[{"u":0.5,"width":0.9,"height":2.1,"kind":"door"}] } ],
  "objects":[ { "id":"t1","kind":"table","pos":[2,0,2],"rotYDeg":0,
                "size":[0.9,0.75,0.9],"color":"#AD9C67" } ],
  "lights": [ { "kind":"sun","rotDeg":[45,30,0],"intensity":3,"color":"#FFF6E0" } ],
  "env":    { "ambientColor":"#CFE0FF","ambientStrength":0.35,"background":"#101826" },
  "camera": { "pos":[0,2.2,-4],"lookAt":[0,0.8,0],"fov":50 }
}
```

`kind` 支持：`table desk chair bench shelf plant statue rug pillar crate lamp arch custom`（各自有默认尺寸/颜色，见 `src/scene-spec.js`）。

## 硬约束

1. **单位统一米**，不要混像素；`scene_parse_plan` 用 `metersPerCell` 换算。
2. `pos` 是物件**底面中心**（y=0 通常就是地面）；`size` 是 `[宽, 高, 深]`。
3. 墙 `from/to` 是平面端点；门洞用 `openings.u/width/height`，脚本会自动切墙。
4. 输出**不得覆盖输入**（spec 输入 + 输出同路径会被拒）。
5. Blender 找不到时**不静默跳过**：`scene_build_blender` 会 `executed=false` + report 里
   `blender.found=false`，并照样产出 `build_scene.py`；找到后（本机 `_vendor/blender/.../blender.exe`
   或工具参数 `blenderPath`）会真跑 headless。
6. `scene_parse_plan` **只吃网格平面图约定**（`examples/DESIGN-FORMAT.md`）；手绘/概念图别硬塞，
   会让代理看图写 SceneSpec（`mode=spec` 路线）。
7. 千星 3D 场景不能由本插件直接写存档（那是编辑器/客户端的事）；本插件负责到
   **Blender 场景 + GLB + 落地清单**，GIA 导出/导入由渊星插件完成。

## 验收判据

- `scene_spec_validate` 返回 `report.ok=true`；
- `scene_preview` 的俯视 PNG 与设计图**并排**：房间形状/墙/门/家具位置一致；改坐标后再预览确认；
- `scene_build_blender`：`executed=true`、`renders` 两张 PNG 非空、`glbPath` 存在、`report` 物件数=spec；
- `scene_qx_plan`：`placement` 条数=物件数、坐标/朝向与 spec 一致；markdown 含四步流程与自检表。


</details>

### qianxing-prefab-render（dsh-plugin-qianxing-prefab-render）

千星 3D 场景「官方素材渲染」（借渊星官方 prefab 几何库+贴图）：SceneSpec → 自动选官方 prefab → 摆位 → Blender 5.2 渲染出 .blend/PNG。只能渲染/预览，云端不能导出 GIA（需 Windows host bridge + 渊星权益）。用户要「用官方素材/渊星素材渲染」时使用。

<details><summary>全文</summary>

# qianxing-prefab-render · 官方素材渲染（借渊星 prefab）

把 SceneSpec 自动搭成「**官方元件**」场景并渲染：从渊星官方 prefab 几何库（4 个
`geometry-*.blend`）+ 贴图（4199 张 PNG）里按 kind + 尺寸挑元件，append 实例、按 spec
摆位，Blender 5.2 headless 渲染出 `.blend` + 透视/俯视 PNG。

## 什么时候用

- 用户要「用官方素材 / 渊星素材渲染 3D 场景」「出个像样的场景图」
- `design-to-scene` 的块状体块渲染太粗糙，需要真实元件模型
- 只要**渲染/预览**，不需要导入千星

## 工具

| 工具 | 作用 |
|---|---|
| `scene_prefab_status` | 检查环境：Blender 5.2 + 官方资产（catalog/geometry/textures）是否就绪 |
| `scene_build_prefab` | 渲染：`{spec, outDir?, width?, height?, samples?, exposure?}` → `.blend` + `render-perspective.png` + `render-top.png` + 统计 |

产物：`outDir/scene.blend`、`render-perspective.png`、`render-top.png`、`scene.spec.json`。
返回里的 `placed / missing / prefabKinds` 要如实转述（缺的元件类型会列在 `missing`）。

## 标准流程

```
1. 用户发设计图 / 已有 SceneSpec
2. scene_parse_plan / 手写 spec（必需；本工具只吃 spec）
3. scene_prefab_status        → 确认就绪
4. scene_build_prefab         → 渲染（1200×675/20spp 约 80s；1600×900/32spp 约 2-4 分钟）
5. scene_report_pdf           → 设计图 + 官方素材渲染 + 坐标表 → PDF
6. qqbot_send_file            → 发 PDF / 渲染图给用户
```

## 硬边界（必须如实说）

- **只能渲染/预览，不能导出 GIA**：渊星插件的受保护连接依赖 Windows
  `yuanxing_host_bridge.dll` + 账号权益，Linux 云端走不通；导入千星仍需本地
  Windows Blender + 渊星插件。
- **材质/光照未接渊星材质体系**：官方模型的 baked 光照/自定义 shader 没有完整还原，
  渲染会偏平偏亮；要接近设计图需要继续接材质，或在本地 GUI Blender 里渲染。
- 需要 **Blender 5.2+**（4.5 打不开 5.2 素材）；云端已装 `/opt/blender52`。
- 2GB 内存的机器会 OOM，需要 swap（云端已加 6GB swap）。
- 贴图按文件名重映射；个别缺失会打印 `texturesMissing`，不影响出图但会有品红/纯色块。


</details>

### miliastra-knowledge（dsh-plugin-miliastra-toolbox）

查询千星沙箱（原神千星奇域 UGC 编辑器）知识库：节点用法与参数、官方指南/教程/FAQ 文档、语义检索。当用户询问千星沙箱节点（触发器、运动器、造物、仇恨、商店、背包等）、编辑器功能配置、"为什么不触发/不生效"类排障问题，或需要把玩法需求拆解为具体节点与参考文档时使用。仅覆盖服务端节点图与玩法逻辑，不含客户端控件与客户端脚本（lua）——客户端界面编程问题用 miliastra-knowledge-lua。

<details><summary>全文</summary>

# 千星沙箱知识库查询

知识库覆盖：全部节点说明（含归属端与参数）、官方指南、教程、FAQ，共 300+ 篇文档。

## 调用方式

知识库通过 4 个工具提供：`get_node_info`、`list_documents`、`get_document`、`rag_search`。

- **有同名原生工具（插件模式）**：直接调用工具，参数与返回字段以工具 schema 为准；工具返回的就是知识库 API 的 JSON 结果（`data.result`），无需自行发起 HTTP 请求。
- **无工具环境（纯 Skill/curl 模式）**：通过 HTTP Skill API 调用，JSON 请求体：

  ```
  POST https://ugc.070077.xyz/api/v1/skills/miliastra-knowledge/tools/<工具名>
  ```

  响应统一包裹为 `{ "success": true, "data": { "result": ... }, "error": null }`，取 `data.result`。curl 示例与各工具参数、返回结构、关键词表见本技能配套的 `references/tools.md`（若提供）。

## 什么时候用

- 用户询问千星沙箱某个节点的用法、参数、触发条件
- 用户询问系统/组件功能（战斗、仇恨、商店、背包、运动器、触发器……）
- 用户遇到"为什么不触发/不生效"等排障问题
- 用户想了解某系统的整体设计或配置步骤
- 需要把玩法需求拆解为具体节点名和参考文档
- 客户端控件/客户端脚本（lua）/2D 界面编程问题不用本技能，改用 `miliastra-knowledge-lua`

## 工具一览

| 工具 | 职责 |
|------|------|
| `get_node_info` | 按节点名查说明、参数、归属端与来源文档；支持模糊匹配和批量查询 |
| `list_documents` | 按关键词列出文档标题（不含正文）；用于不知道精确文档名时先看有哪些 |
| `get_document` | 按标题获取官方文档全文；支持批量，一次获取多篇相关文档 |
| `rag_search` | 自然语言语义检索文档片段；支持批量，多个独立问题可一次查完 |

**优先级：结构化工具优先，`rag_search` 兜底。** 能用节点名/文档名直接定位时不用 `rag_search`；`rag_search` 用于开放问题、排障、跨文档比较，或结构化工具结果不足时补充。

## 怎么选工具

1. **用户说了具体节点名** → `get_node_info`
2. **用户说"有没有关于 X 的文档"/不确定文档名** → `list_documents(keywords=[X])` 先看列表（不传 `keywords` 可浏览全部文档）
3. **已知文档/系统名，要完整内容** → `get_document(["系统名"])`
4. **用户用自然语言描述功能或问题** → `rag_search`
5. **查节点后需要看完整配置说明** → 取返回的 `source_doc_title`，再调 `get_document`

**批量原则：多个独立查询合并为一次调用**（所有工具均支持列表入参），不要拆成多轮单条调用，也不要重复相同调用。

## 常见调用顺序

**开放玩法需求**（不知道节点名）：
```
rag_search(["需求描述"]) → get_node_info([命中的节点名]) → get_document([来源文档])
```

**已知节点名**：
```
get_node_info([节点名]) → 需要深入时 → get_document([source_doc_title])
```

**学习某个系统**（如商店、仇恨、背包）：
```
list_documents(["关键词"]) → get_document([精确文档名])
```

**排障类**（"为什么不触发/不生效"）：
```
rag_search(["问题描述A", "问题描述B"]) → get_document(["相关系统文档"])
```

**领域示例 —— 造物/技能**：
```
list_documents(["造物状态"]) → get_document(["造物状态决策节点图", "复杂造物技能"])
  → get_node_info(["复杂造物定点位移", "造物转向指定朝向"])
```

**领域示例 —— 仇恨系统**：
```
rag_search(["嘲讽和仇恨系统配置", "怪物追击玩家行为"])
  → get_node_info(["嘲讽目标", "增加指定实体的仇恨值", "获取指定实体的仇恨目标"])
  → get_document(["仇恨配置"])
```

## 异常处理

- `get_node_info` 无匹配 → 换更短/更通用的关键词重试；仍无结果 → 用 `rag_search`
- `get_document` 返回 `status="too_many"` → 用更精确的关键词重查
- `get_document` 返回 `status="not_found"` → 先 `list_documents` 找候选标题再重查
- `rag_search` 结果为空或不相关 → 换用领域术语重写 query（如把"怪物追我"改为"仇恨 嘲讽 追击"）
- 工具调用报错（HTTP 错误、超时等）→ 换等价关键词重试一次；仍失败则明确告知用户知识库不可用

## 输出规范

- 节点类回答：说明用途、关键参数、**归属端（`side`：服务端/客户端/双端）**，并注明来源文档
- 文档类回答：总结要点，必要时直接引用原文片段
- `rag_search` 结果：优先引用 `similarity` 最高的条目，注明来源文档
- **严格区分"文档原文已说明"与"基于资料的推测建议"**
- 不得编造节点名、参数名或官方结论；查不到就明确说查不到，并建议用户换个问法


</details>

### miliastra-knowledge-lua（dsh-plugin-miliastra-toolbox）

千星奇域 2D + lua 脚本游戏制作（客户端 UI 编程）专用：查询客户端控件与客户端脚本文档——客户端控件容器、文本视窗控件、预设按钮控件、按键提示控件、光标检测区域控件、网格视窗控件、模板引用控件、容器节点控件，以及客户端控件 API 与 lua 脚本接口。仅当用户进行客户端脚本（lua）编程、制作 2D 界面/HUD 或配置客户端控件时使用；服务端节点图与玩法逻辑问题不用本技能。

<details><summary>全文</summary>

# 千星奇域客户端脚本（lua）知识库查询

仅覆盖千星奇域 **2D + lua 脚本游戏制作**（客户端 UI 编程）语料：客户端控件与客户端脚本文档，共 10 篇。

服务端节点图、玩法逻辑、系统配置与排障问题不用本技能，改用 `miliastra-knowledge`。

## 调用方式

知识库通过 2 个工具提供：`list_client_documents`、`get_client_document`。

- **有同名原生工具（插件模式）**：直接调用工具，参数与返回字段以工具 schema 为准；工具返回的就是知识库 API 的 JSON 结果（`data.result`），无需自行发起 HTTP 请求。
- **无工具环境（纯 Skill/curl 模式）**：通过 HTTP Skill API 调用，JSON 请求体：

  ```
  POST https://ugc.070077.xyz/api/v1/skills/miliastra-knowledge/tools/<工具名>
  ```

  响应统一包裹为 `{ "success": true, "data": { "result": ... }, "error": null }`，取 `data.result`。

## 什么时候用

- 用户进行千星奇域 2D + lua 脚本游戏制作（客户端界面/控件编程）
- 询问客户端控件的功能与配置：客户端控件容器、文本视窗控件、预设按钮控件、按键提示控件、光标检测区域控件、网格视窗控件、模板引用控件、容器节点控件
- 询问客户端脚本（lua）如何挂载到控件、如何调用、与控件如何交互
- 需要查客户端控件 API 文档中的脚本接口与参数

## 工具一览

| 工具 | 职责 |
|------|------|
| `list_client_documents` | 按关键词列出客户端控件/脚本文档标题（不含正文）；不知道精确文档名时先看有哪些 |
| `get_client_document` | 按标题获取客户端控件/脚本文档全文；支持模糊匹配与批量获取 |

客户端语料仅 10 篇，结构化工具即可覆盖，**不提供也不需要使用 `rag_search`**。

## 怎么选工具

1. **不确定文档名 / 想浏览有哪些客户端文档** → `list_client_documents(keywords=[关键词])`（不传 `keywords` 列出全部 10 篇）
2. **已知控件/文档名，要完整内容** → `get_client_document(["控件名"])`

**批量原则：多个独立查询合并为一次调用**（两个工具均支持列表入参），不要拆成多轮单条调用，也不要重复相同调用。

## 常见调用顺序

**调研某个客户端控件**（如预设按钮怎么做）：
```
list_client_documents(["预设按钮"]) → get_client_document(["预设按钮控件"])
```

**写 lua 脚本查 API**：
```
get_client_document(["客户端控件API文档"]) → 按其中的接口说明作答
```

**从零搭建 2D 界面**：
```
get_client_document(["客户端控件容器"]) → list_client_documents(["控件"]) → get_client_document([具体控件名])
```

## 异常处理

- `get_client_document` 返回 `status="not_found"` → 先 `list_client_documents` 找候选标题再重查
- `get_client_document` 返回 `status="too_many"` → 用更精确的关键词重查
- `list_client_documents` 无结果 → 换更短/更通用的关键词（如「控件」「脚本」「API」）
- 工具调用报错（HTTP 错误、超时等）→ 换等价关键词重试一次；仍失败则明确告知用户知识库不可用

## 输出规范

- 控件类回答：说明功能、关键配置项、可挂载的客户端脚本调用方式，并注明来源文档
- API 类回答：给出接口名、参数与用法；**严格区分"文档原文已说明"与"基于资料的推测建议"**
- 不得编造控件名、接口名或官方结论；查不到就明确说查不到，并建议用户换个问法


</details>

