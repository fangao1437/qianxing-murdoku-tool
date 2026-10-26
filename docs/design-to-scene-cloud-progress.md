# 设计图 → 3D 场景：插件与云端搭载进度报告

- 日期：2026-10-26
- 范围：`dsh-plugin-design-to-scene` 插件（设计图→SceneSpec→预览→Blender 场景→千星落地清单）
  + 云端（腾讯云）挂载副本 + 3D 存档坐标离线改写验证 + 官方元件库清单
- 结论：**路线闭环已打通**；插件可落地、云端包可交付、3D 元件坐标离线改写已通过编辑器导入验证。
  云端镜像的实机构建 / 腾讯云部署由云端负责人执行（本文 §7 给交接步骤）。

---

## 1 交付物一览

| 交付物 | 位置（本仓库） | 说明 |
|---|---|---|
| DSH 插件 | `dsh-plugin-design-to-scene/` | 5 个工具 + 技能 + 测试 + 示例 + 官方元件库 + 云端部署包 |
| 云端部署包 | `dsh-plugin-design-to-scene/cloud/` | Dockerfile / compose / 一键部署脚本 / 无 DSH CLI / 腾讯云部署文档 |
| 官方元件库清单 | `dsh-plugin-design-to-scene/catalog/` | 2721 个官方 prefab（16 分类）+ 检索 CLI + kind 映射 |
| 3D 坐标验证报告 | `docs/3D坐标离线改写-验证报告.md` | 111.gil 结构、移动/旋转实测、编辑器接受度 |
| 渊星插件评估 | `docs/渊星工具箱与千星奇域UGC工具-评估.md` | 「千星奇域 UGC 工具」能力判定 + 安装记录 |

本机构建产物（不在仓库里，云端负责人可按需取用）：
`<工作区>/_dist/design-to-scene-cloud/`（插件 zip + 云端部署包 zip + MANIFEST/SHA256）。

## 2 插件状态（`dsh-plugin-design-to-scene` v1.0.0）

- **5 个工具**：`scene_parse_plan`（网格平面图→SceneSpec v1）/ `scene_spec_validate` /
  `scene_preview`（俯视 PNG）/ `scene_build_blender`（headless Blender → .blend + 渲染 + GLB）/
  `scene_qx_plan`（千星/渊星落地清单）。
- **契约**：SceneSpec v1（坐标 x 右 / z 前 / y 上，单位米），详细字段见 `README.md`。
- **验收**（本机，2026-10-26）：
  - `test/run-tests.mjs` → **8 passed, 0 failed**（含 Blender 真实 headless 出图）
  - `test/self-parse.mjs` → **1130 项断言全过**（设计图↔ground-truth 逐字段对拍）
  - `test/self-preview.mjs` → **30 项全过**（PNG 回读 + 像素抽检）
  - `test/self-blender.mjs` → **27 项全过**（脚本确定性 / py_compile / Blender 4.5.15 真跑）
  - 端到端产物：设计图 → spec → 预览 848×648 → `.blend` 1.0MB / `scene.glb` 55KB /
    渲染 662KB+805KB → placement 16 条
- **安装**：`dsh plugin --profile <p> add <插件目录>` 或 `plugin_manager install_bundle`；改源码后重启 DSH。
- **技能**：`design-to-3d-scene`（随插件注册）。

## 3 云端搭载进度

### 3.1 已交付

| 文件 | 作用 |
|---|---|
| `cloud/Dockerfile` | Node 22 + Blender 4.5.15 LTS + 插件；构建期自检（5 工具注册 + 示例 spec 校验） |
| `cloud/docker-compose.yml` | 插件目录只读挂载 + `/data` 数据卷（腾讯云容器/轻量均可） |
| `cloud/install-on-server.sh` | Ubuntu 22.04/24.04、Debian 12 一键装（Node 22 + Blender + 插件 + 可选注册 DSH），幂等 |
| `cloud/bin/scene-cli.mjs` | **无 DSH 环境** CLI：parse / validate / preview / build / qx / all |
| `cloud/build-bundle.mjs` | 打云端副本（插件 zip + 部署 zip + MANIFEST/SHA256） |
| `cloud/README-腾讯云部署.md` | 三种部署方式 + 验证清单 + 排障 + 安全说明 |

### 3.2 本机已完成验证

| 检查 | 结果 |
|---|---|
| `scene-cli all`（设计图 → 全流程） | 5/5 步全过，产物 12 个（spec/两张预览/blend/glb/两张渲染/placement/plan） |
| `scene-cli build`（真实 Blender） | `executed=true`；`.blend` 1.12MB、`scene.glb` 108KB、渲染 663KB/691KB |
| 云端副本目录内 `test/run-tests.mjs` | **8 passed** |
| `bash -n cloud/install-on-server.sh` | 通过（Git Bash 语法检查） |
| 云端包 MANIFEST SHA256 复算 | 两个 zip 全部一致（见 §3.3） |
| Docker 镜像实机构建 | **未执行**（开发机无 Docker）→ 见 §7 交接 |

### 3.3 云端包（本机最新构建）

| 产物 | 大小 | SHA256 |
|---|---:|---|
| `dsh-plugin-design-to-scene-v1.0.0.zip` | 551,981 B | `b34b17c26da6df8b23577c17ea42e16c7088967537646abbb12a27834d5f2449` |
| `dsh-design-to-scene-cloud-v1.0.0.zip` | 559,378 B | `9ddacacf61b43ba625c92b38577b787297bbbe876f56b708bf1b59fadb065bdf` |

- 生成时间：2026-10-26T13:41:54Z；插件文件 52 个（含 `catalog/` 官方元件库、`cloud/` 部署包）。
- 插件 zip 可直接 `dsh plugin add`；云端部署包 = 插件 + 部署文档。

## 4 3D 存档坐标离线改写（路线闭环，已验证）

> 详细报告：`docs/3D坐标离线改写-验证报告.md`

### 4.1 存档结构（以 `111.gil` 为例，99,407 B）

| 顶层字段 | 内容 | 规模 |
|---|---|---|
| `#4` | 默认模版（角色编辑）：骨骼/特效/触发器 | — |
| **`#5`** | **场景实体（3D 元件摆放）** | **112 个** |
| `#8` | 造物/元件定义 | 13 个 |
| `#9` | UI 页面控件 | 4 个 |
| `#10` | 交互点 | 12 组 |
| `#11` | 阵营 | 3 类 |
| `#22` | 元件属性定义（PropertyTransform 等） | 18 项 |

3D 元件变换路径：`#5 → #1(实体) → #6 → #11(变换)`：
`#1` 位置(x,y,z 米) / `#2` 旋转(欧拉角，稀疏) / `#3` 缩放(x,y,z)。

### 4.2 实测

| 测试 | 改动 | 验证 |
|---|---|---|
| 移动「金属桌子」 | (-8.4978, 1.6686, -13.6686) → (-6.4978, 2.1686, -12.1686)（+2, +0.5, +1.5 米） | 重读误差 0；字段级 diff 仅 3 处 float；其它 111 实体不变 |
| 旋转「相框」 | Y 轴 90° → 45° | 重读一致；diff 仅 1 处 float |
| **编辑器接受度** | 用户导入移动档后重新导出（`比对.gil`） | **坐标保留**；再导出相对我们的档只差 3 字节（顶层 `#40` 保存时间戳 1792672371→1793021606），相对原档只差 12 字节 |

### 4.3 结论与边界

- ✅ 纯 Node 解析 `.gil` → 改 `#11` 数值 → 写新档 → 重读/门禁 → **编辑器导入生效**，
  **完全不需要 Blender / GIA / 账号权益** → 云端坐标编排路线成立。
- 写档时 `#40`（保存时间戳）可不动（实测带旧时间戳导入也生效）；想更贴近原生存档可设为当前 Unix 秒。
- ⚠️ 已验证范围：**只改现有元件的 位置/旋转/缩放**。**新增/复制元件**（新实体记录、ID/引用分配）未验证，一般需编辑器参与。
- 该能力目前是**验证过的流程 + 脚本**（`_work/save-coord-test/move-3d.mjs`），尚未并入插件工具（下一步可做成 `save_scene_place`）。

## 5 官方元件库清单

来源：渊星工具箱缓存的官方 manifest
`%LOCALAPPDATA%\Yuanxing\Tools\blender\resources\display-catalog\*\library\official_prefab_blender_library.json`
（schema `miliastra.display-catalog.v1`，revision `0732dac3…`）→ 生成到 `dsh-plugin-design-to-scene/catalog/`。

| 分类 | 数量 | 分类 | 数量 |
|---|---:|---|---:|
| 人造装饰 | 659 | 建筑 | 164 |
| 建筑结构 | 584 | 植被 | 152 |
| 玩法机关 | 362 | 岩石 | 126 |
| 场景物件 | 208 | 造物 | 115 |
| 饮食 | 110 | 灯具 | 81 |
| 树木 | 59 | 武器 | 34 |
| 地貌 | 26 | 其他 | 18 |
| 工具 | 17 | 流程物件 | 6 |
| **合计** | **2721** | | |

每个元件含：`prefab_id`、名字、分类、几何库文件（geometry-0..3.blend）、包围盒尺寸（米）、pivot、tags、能力标记。
检索方式：

```bash
node catalog/search.mjs --name 桌
node catalog/search.mjs --kind lamp --limit 10
node catalog/search.mjs --category 人造装饰 --min 0.5 --max 2
node catalog/search.mjs --name 灯 --json
```

接设计图：`SceneSpec.kind` + 近似尺寸 → `catalog/kind-map.json` 候选 → `search.mjs` 定具体 prefab →
「元件名 + prefab_id + 目标坐标」写进坐标表。

## 6 本机证据索引（工作区，非仓库）

| 内容 | 路径 |
|---|---|
| 云端副本/压缩包/MANIFEST | `_dist/design-to-scene-cloud/` |
| 3D 移动/旋转测试脚本与产物 | `_work/save-coord-test/`（`111-3d-move-position.gil`、`比对.gil`、`entities-3d.csv`、`REPORT-3D.md` 等） |
| 设计图→场景 demo 产物 | `_work/design-to-scene-demo/`、`_work/live-demo/` |
| 云端 CLI 全流程产物 | `_work/cloud-data/out/` |
| Blender 4.5.15 / 5.2.3 便携版 | `_vendor/blender/`、`_vendor/blender52/` |

## 7 交接：云端负责人需要做的（按顺序）

1. **首次构建镜像**（开发机无 Docker，未实测）：
   ```bash
   docker build -f cloud/Dockerfile -t dsh-design-to-scene:1.0.0 .
   docker run --rm -v $PWD/_work/cloud-data:/data dsh-design-to-scene:1.0.0 \
     node cloud/bin/scene-cli.mjs all --design /data/in/design-demo-b.png \
     --legend /data/in/design-demo-b.legend.json --outDir /data/out
   ```
   预期：`executed=true`、`.blend`/`scene.glb`/两张渲染/placement+plan 全出。
2. **腾讯云主机部署**（轻量/CVM）：上传插件目录 → `sudo bash cloud/install-on-server.sh` → 按脚本输出跑端到端；
   服务器已装 `dsh` CLI 时会自动注册进 profile（默认 `web`）。
3. **挂已有云 DSH 实例**：插件目录挂到 `/srv/dsh-plugins/`，`dsh plugin --profile web add <路径>` 后重启进程；
   Blender 用 `BLENDER_PATH=/opt/blender/blender` 或插件配置 `blenderPath` 指定。
4. **规格建议**：2 核 / 4GB 内存 / 6GB 空闲磁盘（镜像约 700MB）；纯 CPU 时 EEVEE 可能回退 Workbench（`report.engine` 可见），GLB/`.blend` 不受影响。
5. **网络**：镜像构建从阿里云 Blender 镜像拉取；受限时用
   `--build-arg BLENDER_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/blender/release`。
6. **安全**：云上插件纯离线，不联网、不登录、不读游戏进程；数据卷 `/data` 需可写，插件目录可只读挂载。

## 8 风险与已知问题

| # | 风险/缺口 | 处理 |
|---|---|---|
| 1 | Docker 镜像未实机构建 | 云端首次构建时验证（§7.1） |
| 2 | 纯 CPU 云主机 EEVEE 可能不可用 | 插件自动回退 Workbench，日志/`report.engine` 会显示 |
| 3 | 3D 存档写入只验证了「改现有元件变换」 | 新增/复制元件未验证；需要时再立项 |
| 4 | 官方元件库是缓存快照（revision 0732dac3…） | 渊星工具箱更新后重跑 `_work/make-official-catalog.mjs` 刷新 |
| 5 | `_dist` 构建产物不在仓库内 | 需要时按 `cloud/build-bundle.mjs` 重新生成（确定性：同输入同输出，除时间戳字段） |
| 6 | 「千星奇域 UGC 工具」Blender 插件需要 Blender 5.2+ / 账号权益 | 与本插件解耦；GIA 步骤仍在线下 GUI Blender 完成 |

## 9 变更记录

- 2026-10-26：插件 v1.0.0 完成并安装到 desktop profile；云端副本（Docker/脚本/CLI）完成本机验证；
  3D 存档坐标改写验证通过（含编辑器导入再导出）；官方元件库清单（2721 个 prefab）生成；
  本报告与验证报告入库。
