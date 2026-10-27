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
