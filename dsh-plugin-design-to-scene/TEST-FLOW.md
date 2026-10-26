# 测试流程 · 设计图 → 3D 场景（dsh-plugin-design-to-scene）

> 插件：`dsh-plugin-design-to-scene`（5 个 `scene_*` 工具 + `design-to-3d-scene` 技能）
> 定位：补「千星奇域 UGC 工具」（渊星工具箱的 Blender 插件）缺失的「设计图→自动搭场景」这一段。
> 工作区根：`<你的工作区>`（示例用 `D:\新建文件夹\miHoYo Launcher`）
> 分三层：**① 离线自动验收**（不碰 DSH）→ **② 会话内工具验收**（真实调用 5 个工具）→ **③ 3D/千星验收**（Blender 产物 + 渊星 GIA 落地）。

### 实测基线（2026-10-26，本机，供对照）

| 验证项 | 实测结果 |
|---|---|
| `test/run-tests.mjs` | **8 passed, 0 failed, 0 skipped**（含 Blender 真跑一例，约 7–8s） |
| `test/self-parse.mjs` | **1130 项断言全过**，`SELF-PARSE OK`（A/B 设计图 ↔ ground-truth 逐字段一致） |
| `test/self-preview.mjs` | **30 项全过**，`SELF-PREVIEW OK`（PNG 解码回读 + 关键像素抽检） |
| `test/self-blender.mjs` | **27 项全过**，`SELF-BLENDER OK`（Blender 4.5.15 LTS headless） |
| 端到端 demo | 设计图 → 解析（1 房间/4 物件/28 段墙/1 门）→ 预览 448×348 → Blender：`.blend` 1.0MB、`render-top.png` 725KB、`render-perspective.png` 805KB、`scene.glb` 55KB → placement 16 条 |

---

## 1 离线自动验收

```powershell
cd "<插件目录>\dsh-plugin-design-to-scene"

# 集成验收（5 工具 + 端到端 + 错误路径 + Blender）
node test/run-tests.mjs --workspace="D:\新建文件夹\miHoYo Launcher"

# 各阶段自检
node test/self-parse.mjs     # S1 设计图解析
node test/self-preview.mjs   # S2 预览 + S4 落地清单
node test/self-blender.mjs   # S3 Blender 生成/真跑
```

**通过标准**：`== 结果：8 passed, 0 failed, 0 skipped ==`；三个 self 脚本分别打印对应 `... OK`。
（没装 Blender 时 S3 的"真跑"部分会 SKIP，但脚本生成/语法检查仍必须全绿。）

## 2 会话内工具验收（复制即用）

### 2.1 设计图解析（网格平面图）

> 用 scene_parse_plan 解析 `<插件目录>/examples/design-demo.png`，图例用同名 legend，
> spec 写到 `_work/demo.spec.json`，预览写到 `_work/demo.parse.png`。

预期：`stats` = `rows=6, cols=8, cellPx=48, cellMeters=0.5, rooms=1, walls=28, doors=1, objects=4, unassigned=0`；`report.ok=true`；`warnings=[]`。

### 2.2 校验 + 预览

> 用 scene_spec_validate 校验 `_work/demo.spec.json` 并规范化写出；再用 scene_preview 生成 `_work/demo.preview.png`（scale=100）。

预期：validate `ok=true`、checks ≥ 40；预览 PNG 可打开，房间色块/墙/门/家具位置与设计图并排一致。

### 2.3 Blender 自动搭建（真实场景）

> 用 scene_build_blender 把 `examples/hall-demo.spec.json` 搭到 `_work/hall-scene/`，要渲染 top/perspective 两个视角并导出 GLB。

预期：`executed=true`、`blenderPath` 指向 Blender 4.5.15；`renders` 两张 PNG（各 >10KB）；`scene.blend` + `scene.glb` 存在。
**人眼验收**：打开 `render-perspective.png` 应看到房间墙、桌子+椅子、书架、植物/雕像（圆柱）、箱子、灯光阴影；
`render-top.png` 应能与 `scene_preview` 的俯视图对上（房间形状/家具位置一致）。

### 2.4 千星落地清单

> 用 scene_qx_plan 对 `examples/hall-demo.spec.json` 生成 `_work/hall-qx/`。

预期：`placement.json` 16 条（id/kind/x/z/size/rotYDeg/color 与 spec 一致）；`plan.md` 含四步流程
（设计图→SceneSpec→Blender→**千星奇域 UGC 工具 GIA**→千星编辑器）、已知边界、自检表。

### 2.5 错误路径

1. 把 spec 里某堵墙的 `from` 与 `to` 写成一样 → `scene_preview` 报 `[E_SPEC_INVALID]`；
2. `scene_spec_validate` 的 `out` 写成输入 spec 路径 → `[E_PATH]`；
3. `scene_parse_plan` 不传 design → `[E_ARGS]`。

---

## 3 3D / 千星验收

### 3.1 Blender 侧

| 检查 | 判据 |
|---|---|
| 场景可打开 | 双击 `_work/hall-scene/scene.blend`，Blender 打开后能看到房间/家具/灯/相机 |
| 渲染 | `render-top.png` / `render-perspective.png` 与设计图并排核对：墙位置、门洞位置、家具种类/数量/朝向 |
| GLB | `scene.glb` 可被 Blender/其他 DCC 重新导入（Import → glTF 2.0） |
| 可复跑 | 同一 spec 再跑一次 `scene_build_blender` 成功（覆盖式） |

### 3.2 与「千星奇域 UGC 工具」衔接（渊星工具箱，手工步骤）

> 事实（来自渊星工具箱自己的插件目录缓存，`%LOCALAPPDATA%\Yuanxing\Tools\plugin-directory-stable.json`）：
> 「千星奇域 UGC 工具」= Blender 插件（`module_id=blender`, `host_kind=blender`, v1.2.6, `entitlement_required`），
> 描述「在 Blender 中创作千星奇域场景、配置光源与环境，导入导出 GIA」，operations 含 `gia_export`/`gia_import`。
> 它**不做设计图→自动搭建**；需 Blender + 渊星账号权益，登录后才能从插件库安装。

1. 打开 Blender → 运行「千星奇域 UGC 工具」插件；
2. 导入本插件产出的 `scene.blend`（或直接用 `build_scene.py` 在 Blender 里生成）；
3. 用它的 **导出 GIA**（`gia_export`）导出场景/资产；
4. 千星编辑器里 **导入 GIA**（`gia_import`）/按 `placement.json` 摆放，逐项核对坐标与朝向；
5. 记下版本与截图，作为交付证据。

### 3.3 验收记录模板

```
设计图：__（路径）
解析 stats：rooms=__ walls=__ doors=__ objects=__ unassigned=__
预览 PNG：__（路径，与设计图并排：一致/差异）
Blender：executed=__ renders=__ glb=__ blend=__
千星/渊星：GIA 导出=__ 导入=__ 摆件数=__ 核对结果=__
结论：通过 / 不通过（差在哪）
```

---

## 4 失败排查速查

| 现象 | 先查 |
|---|---|
| `[E_ARGS]` | 必填参数（design/spec/outDir）；路径必须是字符串 |
| `[E_SPEC_INVALID]` | `report.checks` 里第一处 `ok=false` 的 id（version/bounds/墙长/物件 kind/相机距离…） |
| `[E_PATH]` | 输出 = 输入；outDir 落在输入文件上 |
| `scene_parse_plan` 颜色没认出来 | legend 里 `roomColors/objectColors` 是否覆盖设计图实际颜色；`warnings` 会列出未分类颜色与格数 |
| 预览/三维墙位置偏 | 设计图约定（`examples/DESIGN-FORMAT.md`）的 margin/cellPx 是否和图一致；先 `scene_preview` 对照再改 |
| Blender 未执行 | `report.checks` 里 `blender.found`；用参数 `blenderPath` 或插件配置指定；本机便携版在 `_vendor/blender/.../blender.exe` |
| Blender 跑失败 | 错误 detail 里有 stderr 尾部；把 `build_scene.py` 单独跑：`blender -b -P build_scene.py -- --spec spec.json --out outDir` |
| 改了插件源码不生效 | link 安装需**重启 DSH** |

## 5 卸载

```
plugin_manager { action: "remove_bundle", target: "dsh-plugin-design-to-scene" }
```

插件不修改输入文件（spec/设计图只读；输出全在 out/outDir）。

---

## 6 云端（腾讯云）副本验收

> 完整部署说明见 [`cloud/README-腾讯云部署.md`](cloud/README-腾讯云部署.md)。
> 本机实测基线（2026-10-26）：`node cloud/build-bundle.mjs` → 47 文件 / 插件 zip 143.2 KB / 云端部署包 150.1 KB；
> `cloud/bin/scene-cli.mjs validate|parse|build|qx` 全部通过（build 走真实 Blender，产物 662KB+805KB 渲染 + 55KB GLB）；
> `bash -n cloud/install-on-server.sh` 语法通过；`_dist` 里的插件副本跑 `test/run-tests.mjs` → **8 passed**。

### 6.1 打云端副本（本机/任意机器，不需要 Docker）

```bash
cd <插件目录>
node cloud/build-bundle.mjs
# 产物：<工作区>/_dist/design-to-scene-cloud/
#   dsh-plugin-design-to-scene/            ← 插件副本目录（可直接挂载/dsh plugin add）
#   dsh-plugin-design-to-scene-v1.0.0.zip  ← 插件副本压缩包
#   dsh-design-to-scene-cloud-v1.0.0.zip   ← 云端部署包（插件 + cloud/ + 文档）
#   MANIFEST.json                          ← 文件数/逐文件 SHA256
```

### 6.2 云主机验证（方式 A：脚本 / 方式 B：Docker）

```bash
# 方式 A
sudo bash cloud/install-on-server.sh          # 幂等；装 Node 22 + Blender 4.5.15 + 插件
cd /opt/dsh-plugin-design-to-scene
node test/run-tests.mjs --workspace=/opt/dsh-plugin-design-to-scene   # 期望 8 passed
node cloud/bin/scene-cli.mjs all --design /data/cloud-data/in/design-demo-b.png \
  --legend /data/cloud-data/in/design-demo-b.legend.json --outDir /data/cloud-data/out

# 方式 B（Docker）
docker build -f cloud/Dockerfile -t dsh-design-to-scene:1.0.0 .
docker run --rm -v "$PWD/_work/cloud-data:/data" dsh-design-to-scene:1.0.0 \
  node cloud/bin/scene-cli.mjs all --design /data/in/design-demo-b.png \
  --legend /data/in/design-demo-b.legend.json --outDir /data/out
```

### 6.3 云端验收清单

| 检查 | 判据 |
|---|---|
| 插件可加载 | `node -e "import('./index.js')..."` 打印 5 个 `scene_*` 工具 |
| CLI 可用 | `node cloud/bin/scene-cli.mjs help` 输出 6 个命令 |
| 无 Blender 也能校验/预览 | `validate` / `preview` 通过（纯 JS） |
| 有 Blender 出场景 | `build` → `executed=true`、`.blend`/`scene.glb`/两张渲染存在且非空 |
| 落地清单 | `qx` → `placement.json` 条数 = 物件数、`plan.md` 关键词齐全 |
| 挂进云 DSH（方式 C） | `dsh plugin --profile web add /srv/dsh-plugins/dsh-plugin-design-to-scene` 后重启，会话里出现 5 个 `scene_*` 工具 |

### 6.4 云端排障

| 现象 | 先查 |
|---|---|
| `executed=false` / `blender.found=false` | `BLENDER_PATH=/opt/blender/blender` 或插件配置 `blenderPath`；`/opt/blender/blender --version` |
| EEVEE 渲染报 EGL/GPU 错 | 纯 CPU 云主机正常现象，插件回退 Workbench（`report.engine` 可见），GLB/`.blend` 不受影响；可 `--no-render` |
| 容器内写权限 | `/data` 必须挂成可写卷；插件目录挂 `:ro` |
| 镜像构建 Blender 下载慢 | `--build-arg BLENDER_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/blender/release` |
| 方式 C 找不到插件工具 | 重启云 DSH 进程（ESM 缓存）；确认 `dsh plugin list --profile web` 有该条目 |
