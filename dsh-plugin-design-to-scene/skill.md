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
