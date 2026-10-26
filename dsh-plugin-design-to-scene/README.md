# dsh-plugin-design-to-scene

**设计图 → 完整 3D 场景** 的 DeepSeek Harness 插件（Host-only bundle，零运行时依赖）。

补的是「**千星奇域 UGC 工具**」（渊星工具箱里的 Blender 插件）没有的那段自动化：

| 环节 | 谁做 |
|---|---|
| 设计图 → 场景数据（房间/墙/门/家具/灯光/相机） | **本插件** `scene_parse_plan`（网格平面图自动解析）或代理看图后直接写 `SceneSpec` |
| 视觉预览、与设计图并排对照 | **本插件** `scene_preview` |
| 3D 场景搭建（几何/材质/灯光/相机/渲染/GLB） | **本插件** `scene_build_blender`（headless Blender 自动建场景） |
| 千星落地清单（摆什么/放哪/朝哪/多大 + 步骤/自检） | **本插件** `scene_qx_plan` |
| Blender 里导 GIA / 导入千星 | 「千星奇域 UGC 工具」（渊星工具箱插件库，`host_kind=blender` v1.2.6，`entitlement_required`，需 Blender + 账号权益）——**手工插件，不做设计图自动搭场景** |

> 结论：渊星那个插件是「在 Blender 里手工创作千星场景 + 配灯光环境 + 导入导出 GIA」的工具；
> 本插件把「设计图 → 场景数据 → Blender 场景 → 落地清单」这半段自动化了。

## 安装（任意 DSH profile）

```sh
# 本地目录安装（本仓库子目录）
dsh plugin --profile <profile> add "<路径>/dsh-plugin-design-to-scene"

# 或 DSH 会话里
plugin_manager { action: "install_bundle", target: "<插件目录绝对路径>" }
```

首次安装通过 HMR 生效；**改源码后必须重启 DSH**（link 安装的 ESM 模块缓存）。
配置（可选，profile 的 `cordis.patch.yml` 覆盖该行）：

```yaml
- id: design-to-scene
  name: dsh-plugin-design-to-scene
  config:
    workspaceRoot: "D:\\新建文件夹\\miHoYo Launcher"   # 相对路径解析根；默认=会话当前工作目录
    blenderPath: "D:\\...\\blender.exe"                # 可选：显式指定 Blender
```

## 5 个工具

| 工具 | 作用 |
|---|---|
| `scene_parse_plan` | 网格平面设计图 PNG + 图例 → `SceneSpec v1`（房间/墙/门/家具；未分类颜色进 `warnings`，不静默吞） |
| `scene_spec_validate` | 校验 + 规范化 `SceneSpec`（颜色/坐标/尺寸统一，返回 `ValidationReport`） |
| `scene_preview` | `SceneSpec` → 俯视预览 **PNG**（纯 JS 光栅化，零依赖、不需要 Blender），用于和设计图并排对照 |
| `scene_build_blender` | `SceneSpec` → `build_scene.py` + headless Blender 执行 → **`.blend` + top/perspective 渲染 PNG + GLB** |
| `scene_qx_plan` | `SceneSpec` → `placement.json` + `plan.md`（千星/渊星落地四步 + 已知边界 + 自检表） |

## SceneSpec v1（唯一契约）

坐标系（米）：`x` 右、`z` 前（设计图向下）、`y` 上。平面坐标 = `(x, z)`。

```jsonc
{
  "version": 1, "name": "hall-demo", "unit": "m",
  "bounds": { "width": 8, "depth": 6 },
  "grid": { "cell": 0.5, "rows": 12, "cols": 16 },
  "rooms":  [ { "id":"r1","name":"大厅","color":"#D9CDB4","cells":[[1,1]] } ],
  "walls":  [ { "from":[0,0],"to":[8,0],"height":2.8,"thickness":0.18,
                "openings":[{"u":0.25,"width":1.0,"height":2.1,"kind":"door"}] } ],
  "objects":[ { "id":"table-1","kind":"table","pos":[2,0,3.2],"rotYDeg":0,
                "size":[1.2,0.75,0.8],"color":"#AD9C67" } ],
  "lights": [ { "kind":"sun","rotDeg":[50,20,-25],"intensity":3.2,"color":"#FFF6E0" } ],
  "env":    { "ambientColor":"#CFE0FF","ambientStrength":0.35,"background":"#101826" },
  "camera": { "pos":[4,2.4,-3.2],"lookAt":[4,0.9,3.2],"fov":50 }
}
```

- `kind`：`table desk chair bench shelf plant statue rug pillar crate lamp arch custom`（默认尺寸/颜色见 `src/scene-spec.js`）
- `pos` = 物件**底面中心**；`size` = `[宽, 高, 深]`；门洞 = `openings.u/width/height`
- 样例：`examples/hall-demo.spec.json`（8×6m 双房间 / 16 物件 / 6 墙含 2 门）

## 两条输入路线

1. **网格平面设计图（自动）**：按 [`examples/DESIGN-FORMAT.md`](examples/DESIGN-FORMAT.md) 的数字设计图约定
   + `legend` 图例（颜色→房间/家具映射）→ `scene_parse_plan` 直接出 `SceneSpec`（可复现、可对拍）。
2. **概念图/手绘图（半自动）**：代理用 `read_image` 看设计图 → 直接写 `SceneSpec`（JSON）
   → `scene_spec_validate` → `scene_preview` 对照 → `scene_build_blender`。适合非网格/带透视的设计稿。

## 标准流程

```sh
# ① 设计图 → SceneSpec（或代理手写 spec）
scene_parse_plan { design: "design/hall-plan.png", legend: "design/hall-legend.json",
                   out: "_work/hall.spec.json", previewOut: "_work/hall.parse.png" }
# ② 俯视预览（先改坐标再建 3D）
scene_preview { spec: "_work/hall.spec.json", out: "_work/hall.preview.png" }
# ③ Blender 自动搭建
scene_build_blender { spec: "_work/hall.spec.json", outDir: "_work/hall-scene" }
# ④ 千星落地清单
scene_qx_plan { spec: "_work/hall.spec.json", outDir: "_work/hall-qx" }
```

## Blender

- `scene_build_blender` 自动探测顺序：参数 `blenderPath` → 插件配置 `blenderPath` → 环境变量 `BLENDER_PATH` →
  `_vendor/blender/blender-*-windows-x64/blender.exe` → `PATH` 里的 `blender`。
- **找不到 Blender 时不报错**：`executed=false`，仍产出 `build_scene.py` + `spec.json`，`report` 里
  `blender.found=false` 说明原因（不静默跳过）。
- 本机已装 Blender 4.5 LTS（便携版解压在 `_vendor/blender/`）；也可自行安装后用 `blenderPath` 指过去。
- 生成脚本可直接复用：`blender -b -P build_scene.py -- --spec spec.json --out outDir`。

## 云端部署（腾讯云 / Docker）

插件是纯 Node（零 npm 依赖）+ Blender，可直接在 Linux 云主机/容器里**挂载运行**，也可以在无 DSH 环境里用 CLI 跑：

- **一键部署**：`cloud/install-on-server.sh`（Ubuntu 22.04/24.04、Debian 12：Node 22 + Blender 4.5.15 LTS + 插件 + 可选注册 DSH）
- **Docker**：`cloud/Dockerfile`（Node 22 + Blender 4.5 LTS + 构建期自检）、`cloud/docker-compose.yml`（插件目录只读挂载 + `/data` 数据卷）
- **无 DSH 环境 CLI**：`node cloud/bin/scene-cli.mjs all --design plan.png --legend plan.legend.json --outDir out`
- **完整步骤/验证清单/排障**：[`cloud/README-腾讯云部署.md`](cloud/README-腾讯云部署.md)
- **打云端副本**：`node cloud/build-bundle.mjs` → `_dist/design-to-scene-cloud/`（插件 zip + 云端部署包 zip + MANIFEST）

## 官方元件库清单（找素材用）

`catalog/` 是从渊星工具箱缓存的**官方 prefab manifest**（`miliastra.display-catalog.v1`）生成的元件库清单：

| 文件 | 用途 |
|---|---|
| `catalog/official-prefabs.json` | 全量规范化清单：**2721 个官方元件**，16 个分类；含 prefab_id、名字、分类、包围盒尺寸（米）、几何库文件、tags、能力标记 |
| `catalog/official-prefabs.csv` | 表格版（Excel / 人工挑素材） |
| `catalog/kind-map.json` | SceneSpec `kind` → 候选官方 prefab（按名字/分类预筛，13 个 kind） |
| `catalog/search.mjs` | 检索 CLI：按名字 / 分类 / 尺寸 / kind 找元件 |
| `catalog/官方元件库清单.md` | 清单说明 + 分类统计 + 与设计图流水线的接法 |

```bash
node catalog/search.mjs --name 桌                 # 按名字找
node catalog/search.mjs --kind lamp --limit 10    # 按 SceneSpec kind 找
node catalog/search.mjs --category 人造装饰 --min 0.5 --max 2   # 按分类+尺寸筛
node catalog/search.mjs --name 灯 --json          # 机器可读输出
```

> 找素材流程：设计图/SceneSpec 的 `kind` + 近似尺寸 → `kind-map.json` 候选 → `search.mjs` 选具体 prefab →
> 把「元件名 + prefab_id + 目标坐标」写进坐标表。注意这是**官方元件库**，不含自定义 GIA 资产。

## 验证

```sh
node test/run-tests.mjs --workspace="D:\新建文件夹\miHoYo Launcher"   # 集成验收（含 Blender 端到端，缺失时 SKIP）
node test/self-parse.mjs     # S1：解析↔ground-truth 对拍
node test/self-preview.mjs   # S2/S4：PNG 回读抽检 + placement
node test/self-blender.mjs   # S3：脚本确定性/py_compile（+ Blender 真跑）
```

## 已知边界

1. **`.gil` 既可能是 2D UI 存档，也可能是 3D 场景存档**（实测 `111.gil` 顶层 `#5` 有 112 个 3D 场景实体）。
   3D 元件的变换字段已定位（`#5→#1→#6→#11`：`#1` 位置 / `#2` 旋转 / `#3` 缩放），
   且**离线改写坐标已被编辑器接受**（导入→再导出后坐标保留、只更新了保存时间戳字段）。
   但「新增/复制 3D 元件」尚未验证；本插件目前不直接写 3D 存档，写入能力见仓库文档
   `docs/3D坐标离线改写-验证报告.md`。
2. `scene_parse_plan` 只吃数字设计图约定（`examples/DESIGN-FORMAT.md`）；手绘/概念图走代理写 spec 路线。
3. 「千星奇域 UGC 工具」需要 Blender + 渊星账号权益（`entitlement_required`），本插件不代登录、不绕过权益。
4. 生成脚本针对 Blender 4.5 LTS（EEVEE，`bpy` API）；更高版本一般兼容，但不保证。
5. 零运行时依赖：只用 `node:` 内建；PNG 解码/编码与光栅化都是插件内自带实现。
