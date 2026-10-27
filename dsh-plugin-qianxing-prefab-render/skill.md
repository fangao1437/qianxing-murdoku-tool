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
