# 设计图约定（plan 模式）v1

> `scene_parse_plan` 的输入格式。**只支持"数字设计图"**：由机器/画图工具按本约定导出的
> 俯视网格平面图（PNG）。手绘/拍屏/带大量文字标注的示意图请走 `mode=spec`（由代理读图后
> 直接写 `SceneSpec`，再用 `scene_spec_validate` + `scene_preview` + `scene_build_blender`）。
>
> 目的：把"设计图→3D 场景"里**确定性的那半段**（网格、房间、墙、门、家具位置）变成可复现解析；
> 造型/材质/灯光这类主观部分由 SceneSpec/代理补全。

## 1. 画布与网格

- 图 = 俯视平面图；**左上角为原点**，x 向右、z 向下（与 SceneSpec 的平面坐标一致）。
- 图边缘留 `margin` 像素空白（默认 24）。
- 网格：`rows × cols` 个正方形格；每格 `cellPx` 像素（默认 48）。
- 网格线：深色（`#1F1A14`，2px），画在格与格之间；**外框也算**。
- `meta.json`（同名旁挂文件）或工具参数 `legend` 提供：
  - `cellPx`、`margin`、`rows`、`cols`；
  - `metersPerCell`：1 格 = 多少米（默认 0.5）；
  - `roomColors`: `{ "#RRGGBB": { name, color? } }`——**格子填充色 → 房间**；
  - `objectColors`: `{ "#RRGGBB": { kind, color?, sizeCells? } }`——**格内色块 → 家具/物件**；
  - `wallColor`: 墙色（默认 `#1F1A14`）；
  - `doorColor`: 门色（默认 `#C06A1E`）；
  - `voidColor`: 空白/不可用（默认 `#FFFFFF`）。

## 2. 房间（room）

- 每个格子先用"格中心像素色"分类：
  - 命中 `roomColors` → 该格属于该房间（同色格子按**4 邻接连通块**合并为一个房间）；
  - 命中 `objectColors` → 该格是家具格（见 §4；家具格**也参与房间连通**，房间 = 其所在背景房间）；
  - `voidColor` → 不属于任何房间（洞/外部）。
- 房间名：`roomColors[color].name`；同名房间合并。

## 3. 墙（wall）与门（door）

- 墙 = 格子之间的**粗线段**：
  - 竖直墙画在 (r, c) 与 (r, c+1) 之间：颜色 `wallColor`，宽 ≥ 3px，高 = cellPx（贯穿该边）；
  - 水平墙画在 (r, c) 与 (r+1, c) 之间，同理。
- 门 = 同一位置上**用 `doorColor` 覆盖的短线段**（宽 ≥ 3px，长度 ≥ cellPx/2）：
  - 该位置仍记一条 wall，同时写入 `openings`：`{ "u": 0.5, "width": 0.9, "height": 2.1, "kind": "door" }`
  - `u` = 门中心在墙上的归一化位置（0..1）。
- 墙的像素检测：对每条格边取中点 ± 边长的采样带，统计 `wallColor`/`doorColor` 占比；
  占比 ≥ 阈值（默认 0.6）判为墙/门。**不要**把房间填充色误判成墙。

## 4. 家具/物件（object）

- 家具 = 格内一个**居中的实心色块**（默认占格宽 70%，矩形），颜色命中 `objectColors`；
- 同色、4 邻接的家具格合并为一个物件（如 2 格桌子）；
- `kind` 来自 legend；`sizeCells` 可覆盖占格比例；
- 高度用 SceneSpec 的 `kind` 默认表（见 README）或 legend 的 `heightM` 覆盖。

## 5. 输出

`scene_parse_plan` 输出 `SceneSpec v1`（见 `README.md`），并附 `stats`：
网格、房间数、墙数、门数、物件数、未分类格数；`warnings` 列出任何无法归类的颜色
（**不静默吞**：无法分类的格子在 spec 里进 `unassigned`，并在 warnings 里报颜色与格数）。

## 6. 参考样例

`examples/design-demo.png` + `examples/design-demo.legend.json`（配套 `design-demo.ground-truth.json`）
是**约定样例**，`test/self-parse.mjs` 用它做逐字段对拍。生成脚本：
`node test/fixtures/make-demo-plan.mjs`（可再生成，输出到 `examples/`）。
