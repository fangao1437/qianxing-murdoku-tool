# dsh-plugin-design-to-scene 云端（腾讯云）部署说明

> 这份文档 + `cloud/` 目录 = **可以在云端挂载/运行的插件副本**。
> 插件本体是纯 Node ESM（零 npm 依赖），唯一外部程序是 Blender（只在 `scene_build_blender` 阶段用到）。
> 云端不需要游戏客户端、不需要登录任何账号、不读游戏数据——它只处理你给的设计图/JSON。

## 0 交付物清单

| 文件/目录 | 说明 |
|---|---|
| `dsh-plugin-design-to-scene/`（插件根） | 插件本体，可 `dsh plugin add` 或目录挂载进任意 profile |
| `cloud/Dockerfile` | Node 22 + Blender 4.5 LTS + 本插件的镜像（含构建期自检） |
| `cloud/docker-compose.yml` | 挂载插件源码 + `/data` 数据卷的 compose 示例 |
| `cloud/install-on-server.sh` | Ubuntu/Debian 云主机一键装（Node/Blender/插件/可选注册 DSH） |
| `cloud/bin/scene-cli.mjs` | **无 DSH 环境**也能跑的 CLI：parse/validate/preview/build/qx/all |
| `cloud/README-腾讯云部署.md` | 本文档 |

## 1 三种挂载/部署方式（按需选一）

### 方式 A：轻量应用服务器 / CVM 直接部署（推荐，最简单）

```bash
# 上传插件目录到服务器（git clone / scp / 对象存储下载均可）
scp -r dsh-plugin-design-to-scene root@<你的服务器IP>:/opt/
ssh root@<你的服务器IP>
cd /opt/dsh-plugin-design-to-scene
sudo bash cloud/install-on-server.sh
```

脚本做的事：apt 装 Blender 运行库 → npmmirror 装 Node 22 → 阿里云镜像装 Blender 4.5.15 LTS →
插件复制到 `/opt/dsh-plugin-design-to-scene` → 冒烟验证（工具注册 + spec 校验）→
若服务器上已有 `dsh` CLI 则自动 `dsh plugin --profile web add ...`。

之后在服务器上用 CLI 跑场景：

```bash
cd /opt/dsh-plugin-design-to-scene
node cloud/bin/scene-cli.mjs all \
  --design /data/cloud-data/in/design-demo-b.png \
  --legend /data/cloud-data/in/design-demo-b.legend.json \
  --outDir /data/cloud-data/out
```

### 方式 B：Docker / 容器服务（TKE、轻量容器）

```bash
# 在插件根目录构建（约 700MB 镜像，含 Blender）
docker build -f cloud/Dockerfile -t dsh-design-to-scene:1.0.0 .

# 跑一次端到端（设计图放宿主机 ./_work/cloud-data/in）
mkdir -p _work/cloud-data/in _work/cloud-data/out
cp examples/design-demo-b.* examples/hall-demo.spec.json _work/cloud-data/in/
docker run --rm \
  -v "$PWD/_work/cloud-data:/data" \
  dsh-design-to-scene:1.0.0 \
  node cloud/bin/scene-cli.mjs all \
    --design /data/in/design-demo-b.png \
    --legend /data/in/design-demo-b.legend.json \
    --outDir /data/out
```

或者用 compose（插件目录以只读方式挂进容器，改代码不用重建镜像）：

```bash
docker compose -f cloud/docker-compose.yml build
docker compose -f cloud/docker-compose.yml run --rm scene-builder \
  node cloud/bin/scene-cli.mjs all \
    --design /data/in/design-demo-b.png --legend /data/in/design-demo-b.legend.json --outDir /data/out
```

### 方式 C：挂进**已有的 DSH 云实例**（如果你在云上跑 DSH）

插件是标准 DSH bundle；把插件目录挂进实例的 profile 插件目录，然后注册：

```bash
# 1) 目录挂载（容器/宿主都行）：把插件目录放到云 DSH 能访问的路径，例如
#      /srv/dsh-plugins/dsh-plugin-design-to-scene
# 2) 注册（在云 DSH 所在环境执行）
dsh plugin --profile web add /srv/dsh-plugins/dsh-plugin-design-to-scene
# 3) 重启该 profile 的 dsh 进程（ESM 模块缓存，必须重启）
```

也可以在 DSH 会话里用插件管理器：

```
plugin_manager { action: "install_bundle", target: "/srv/dsh-plugins/dsh-plugin-design-to-scene" }
```

**关键**：云上 DSH 里的 `scene_build_blender` 要能找到 Blender。三种给法（任选）：
1. 插件配置项：profile `cordis.patch.yml` 里该行 `config: { blenderPath: "/opt/blender/blender" }`
2. 环境变量：`BLENDER_PATH=/opt/blender/blender`（在启动 dsh 的 shell/systemd 里设置）
3. 把 Blender 放 `$DSH_WORKSPACE_ROOT/_vendor/blender/<版本>/blender`（自动探测）

## 2 云端验证清单（部署后按顺序执行）

```bash
cd /opt/dsh-plugin-design-to-scene   # 或容器内 /opt/dsh-plugin-design-to-scene

# ① 插件可加载、5 个工具齐全
node -e "import('./index.js').then(m=>{const t=new Map();m.apply({tools:{register(d){t.set(d.name,d);return()=>{}}},skills:{register(s){return()=>{}}}},{});console.log([...t.keys()].sort().join(','))})"
# 期望：scene_build_blender,scene_parse_plan,scene_preview,scene_qx_plan,scene_spec_validate

# ② 示例 spec 校验（不依赖 Blender）
node cloud/bin/scene-cli.mjs validate --spec examples/hall-demo.spec.json --out /tmp/check.json

# ③ 全量离线验收（有 Blender 时包含真渲染；约 1 分钟）
node test/run-tests.mjs --workspace=/opt/dsh-plugin-design-to-scene
# 期望：== 结果：8 passed, 0 failed, 0 skipped ==

# ④ 设计图 → 场景 端到端
mkdir -p /data/cloud-data/in /data/cloud-data/out
cp examples/design-demo-b.* examples/hall-demo.spec.json /data/cloud-data/in/
node cloud/bin/scene-cli.mjs all \
  --design /data/cloud-data/in/design-demo-b.png \
  --legend /data/cloud-data/in/design-demo-b.legend.json \
  --outDir /data/cloud-data/out
# 期望产物：
#   out/scene.spec.json / out/plan-preview.png
#   out/blender-scene/{scene.blend, scene.glb, render-top.png, render-perspective.png}
#   out/qx-plan/{placement.json, plan.md}
```

## 3 资源与系统要求

| 项 | 最低建议 | 说明 |
|---|---|---|
| CPU | 2 核 | Blender 建场景 + EEVEE/Workbench 渲染 |
| 内存 | 4 GB | 大场景 + 渲染时更高 |
| 磁盘 | 6 GB 空闲 | Blender 解压 ≈1.2GB + 镜像/产物 |
| 系统 | Ubuntu 22.04/24.04、Debian 12、容器 | 其他发行版需自己装 Blender 4.5 + Node 20+ |
| 网络 | 仅首次安装需要 | 之后纯离线跑 |

## 4 常见问题

| 现象 | 处理 |
|---|---|
| `build: executed=false`、`blender.found=false` | 云上没找到 Blender：`BLENDER_PATH=/opt/blender/blender` 或插件配置 `blenderPath`；`/opt/blender/blender --version` 先确认能跑 |
| 渲染报 EGL/GPU 错误 | 纯 CPU 云服务器 EEVEE 可能不可用，插件会自动回退 **Workbench**（`report.engine` 会显示）；`.blend`/GLB 不受影响。也可只建场景：`build --no-render` |
| `dsh: command not found` | 方式 A/B 不需要 dsh；方式 C 先在云实例装好 DSH |
| 中文路径/文件名乱码 | 插件内部全部 `path` 处理，Linux 用 UTF-8 文件名即可；容器 locale 默认 C.UTF-8 |
| 权限错误（挂载卷只读） | 输出目录必须是可写卷；docker-compose 里插件挂 `:ro`、数据卷 `/data` 可写 |
| 镜像构建时 Blender 下载失败 | 换 `--build-arg BLENDER_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/blender/release` |

## 5 安全说明（重要）

- 本插件**不联网、不登录、不读游戏进程**；只读写你指定的本地文件（设计图/JSON/输出目录）。
- 云端镜像里没有游戏客户端，也没有任何账号凭据；可以安全地跑在 CI/批处理里。
- 与「千星奇域 UGC 工具」（渊星 Blender 插件）不同：那个需要 Blender 桌面 + 渊星账号权益，
  **不能**在无 GUI 的云端完成 GIA 导出；云端负责到 `.blend`/GLB + 摆放清单，GIA 导出在本地 Blender 完成。

## 6 升级 / 回滚

```bash
# 升级：替换插件目录（保留 /data），重启 DSH 或重建容器
rsync -a --delete dsh-plugin-design-to-scene/ /opt/dsh-plugin-design-to-scene/
# 回滚：切回上一份目录副本即可（插件无状态，不写系统位置）
```
