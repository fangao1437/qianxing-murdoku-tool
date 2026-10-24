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
