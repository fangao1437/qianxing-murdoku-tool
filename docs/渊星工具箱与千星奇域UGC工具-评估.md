# 渊星工具箱 / 「千星奇域 UGC 工具」评估报告

- 日期：2026-10-26
- 任务：官网 `ugc.seadp.cn` 下载渊星工具箱 → 插件库安装「千星奇域 UGC 工具」→ 评估它能否「基于设计图直接搭建完整 3D 场景」
- 结论：**不能直接做到**。它是 **Blender 手工插件**（在 Blender 里创作千星场景、配灯光/环境、导入导出 GIA），
  不含「设计图 → 场景」的自动识别/生成。已另行补充实现自动化管线（见文末）。

---

## 1 下载与安装 `[实测]`

| 项 | 值 |
|---|---|
| 安装包 | `https://ugc.seadp.cn/licensing/downloads/yx-toolbox-…/yuanxing-bootstrapper.exe`（63,834,160 B） |
| SHA-384 | `7484fec4…0080fd54`（与本机下载一致 ✓，取自站点 `licensing/config.json`） |
| 版本 | `0.4.45`（文件描述 `Yuanxing Toolbox Setup and Repair`） |
| 安装 | 运行 bootstrapper 后**自动完成**（无需人工点选）：58 个文件复制校验，日志见 `%LOCALAPPDATA%\Yuanxing\InstallerLogs\setup-*.log` |
| 落地 | `%LOCALAPPDATA%\Yuanxing\`（Account/Tools/WebView2/Integrity/diagnostics…）；进程 `yuanxing-toolbox.exe` 已启动，窗口「渊星工具箱」 |
| 界面 | 工作台 / **插件库** / 任务记录 / 账户。未登录时「插件库」会落到账户页（设备、Windows 用户绑定、设备授权） |

## 2 插件库目录 `[实测]`

工具箱启动时拉取并缓存插件目录：`%LOCALAPPDATA%\Yuanxing\Tools\plugin-directory-stable.json`
（revision 466，fetched 2026-10-26T11:56Z）。共 5 个插件：

| module_id | 插件名 | host_kind | 版本 | 访问级别 | 描述 |
|---|---|---|---|---|---|
| `blender` | **千星奇域 UGC 工具** | `blender` | 1.2.6 | `entitlement_required` | 在 Blender 中创作千星奇域场景、配置光源与环境，导入导出 GIA |
| `genshin-chat` | 原神聊天桥接 | `game_process` | 0.2.14 | `entitlement_required` | 被动接收聊天消息，查询与管理本机聊天记录 |
| `genshin-voice` | 千星语音桥接 | `game_process` | 0.1.15 | `entitlement_required` | 连接游戏语音频道，管理麦克风、音量与音频设备 |
| `hall-layout` | 千星大厅布设 | `game_process` | 0.2.23 | `entitlement_required` | 精确调整个人大厅，管理布局方案与坐标预设 |
| `qianxing-assets` | 千星资产文件处理 | `none` | 1.1.10 | `account_required` | 在本机转换图像、GIL 工程与 GIA 资产文件 |

「千星奇域 UGC 工具」（module `blender`）的目录元数据还包含：

- **operations**：`asset_unlock`（移除组件限制）/ `gia_export`（导出 GIA）/ `gia_import`（导入 GIA）
- **resources**：`display-catalog`（资产目录）、`geometry-0..3`（4 套几何库）、
  `textures-clear-0..3` / `textures-light-0..3`（贴图资源）、`ui`（插件界面）、`host`（Blender 插件本体）
- 语言名：中文「千星奇域 UGC 工具」/ 英文「Blender Tools」

## 3 能力判定：能不能「基于设计图直接搭建完整场景」

**不能。** 依据上述目录元数据（源：渊星工具箱自己缓存的目录，不是猜的）：

1. `host_kind = blender`：它是 **Blender 插件**，运行在 Blender 里，不是独立的「图→场景」生成器；
2. 描述是「**在 Blender 中创作**千星奇域场景、配置光源与环境，**导入导出 GIA**」——
   提供的是**创作环境**（几何/材质/贴图/灯光/环境 + GIA 互导），场景由人在 Blender 里搭；
3. operations 只有 资产解锁 / GIA 导入 / GIA 导出，**没有** image-to-scene、layout 识别、自动摆放之类能力；
4. 它需要 **Blender 本体** + 渊星账号**权益**（`entitlement_required`），且插件库访问需要登录
   （账户注册要由工具箱读取本机游戏登录信息；这一步涉及账号凭据上传，未代做）。

### 安装/启用它的前置条件（未代做，需你本人操作）

- 装 Blender 4.x（本机已备 Blender 4.5 LTS 便携版，见补充管线）；
- 在工具箱里登录渊星账号（注册流程会读本机游戏登录信息并上传，按需自行决定）；
- 领取「千星奇域 UGC 工具」权益后，在插件库点安装；之后它在 Blender 里作为插件使用。

## 4 补充实现：`dsh-plugin-design-to-scene` `[实测]`

既然 `blender` 插件只做「Blender 里手工建场景 + GIA 互导」，缺的那半段（**设计图 → 场景数据 → 自动搭 3D 场景**）
由新插件补齐，和渊星插件形成流水线：

```
设计图（网格平面图或代理看图写 spec）
   → [dsh-plugin-design-to-scene] SceneSpec v1（房间/墙/门/家具/灯光/相机）
   → 俯视预览 PNG（与设计图并排对照）
   → Blender 自动搭建：.blend + top/perspective 渲染 + GLB
   → 千星落地清单（摆什么/放哪/朝哪/多大 + 步骤 + 自检表）
   → [渊星「千星奇域 UGC 工具」] 在 Blender 里导 GIA → 千星编辑器导入/摆放
```

插件工具：`scene_parse_plan` / `scene_spec_validate` / `scene_preview` / `scene_build_blender` / `scene_qx_plan`。
细节见 `dsh-plugin-design-to-scene/README.md` 与 `skill.md`。

## 5 证据清单

- 安装包 SHA-384 校验：`7484fec4af25f24c97e32a6c48bf417be05518f4272038182ae076e4bf4edd9f64342f05b4170544aa4de1970080fd54`
- 插件目录缓存：`C:\Users\18182\AppData\Local\Yuanxing\Tools\plugin-directory-stable.json`
- 安装日志：`C:\Users\18182\AppData\Local\Yuanxing\InstallerLogs\setup-6f814eee4dea4d3eb67c614e9c3c06da.log`
- 工具箱界面截图：`_vendor\yuanxing\toolbox.png`、`pluginlib2.png`（插件库→账户页）

---

## 6 授权登录 + 插件安装验证（2026-10-26 晚，已实测）

### 6.1 登录

- 账户页「使用此账号登录」→ 读取本机游戏账号（账号 ID 255989564，原神官服 7.1.0，已在本机验证）→ 登录成功；
  账户：**烧钱的玩意**（Lv2 流星）；工具箱显示「本机已连接当前账户」。
- 随后网页端用「使用本机游戏账号」登录 `ugc.seadp.cn`，与工具盒状态互通（显示「网页已登录」）。

### 6.2 插件权益（entitlement）

- 首次安装失败：`module installation requires an active entitled seat`（无有效授权席位）。
- 权益商城：「千星奇域 UGC 工具」**7 天 = 150 星币 / 30 天 = 500 星币**（1 台设备 · 1 项并行任务）。
- 账户余额 150 星币 → **兑换 7 天席位**成功：有效期至 **2026-11-02 20:31**，余额 0；
  工具箱账户页变为「1 项插件权益 · 千星奇域 UGC 工具（限时授权，本机使用中）」。

### 6.3 安装（关键坑：Blender 版本）

- 第一次安装（用本机已装的 Blender 4.5.15 LTS）失败：
  `Blender 4.5.15 不在此插件支持的宿主版本范围内`。
- 翻插件源码 `compatibility.py` 确认硬要求：**Blender 5.2 LTS+、内置 Python 3.13、64 位 Windows**
  （`bpy.app.version >= (5, 2, 0)`）。→ 改用 **Blender 5.2.3 LTS**（清华镜像下载，Python 3.13.13）后，
  工具箱「选择 Blender」指向 `_vendor/blender52/blender-5.2.3-windows-x64/blender.exe`，重试安装成功。
- 安装结果：插件库卡片变为「**版本 1.2.6 · 可使用**」，出现「打开插件」入口；
  素材资源 640.5 MB 已下载并校验（基础素材随插件安装；清晰贴图包可选未装）。

### 6.4 实机验证

| 检查 | 结果 |
|---|---|
| Blender 插件目录 | `%APPDATA%\Blender Foundation\Blender\5.2\scripts\addons\miliastra_ugc` 已写入 |
| 插件加载 | `addon_utils.enable('miliastra_ugc')` → 成功；`bl_info` = Miliastra UGC Tools **v1.19.2**，要求 `blender=(5,2,0)`，位置 `3D View > Sidebar > Miliastra` |
| 面板/操作符 | 注册 **16 个 MILIASTRA_PT_*** 面板、**56 个** `miliastra.*` 操作符（new_scene / validate_scene / scene_operations / terrain / environment / import_asset / export_assets …） |
| GUI | Blender 5.2.3 可正常启动并加载插件（截图 `_vendor\yuanxing\blender-ui2.png`） |
| GIA 相关 | 操作符里没有直接叫 gia_export/gia_import 的项；GIA 走 `import_asset`/`export_assets` + **受保护连接**（`begin_activation` / `open_protected_session` / `reset_protected_connection`，`host_bridge_abi` + `yuanxing_host_bridge.dll`）。即 GIA 导出/导入需要工具箱启动器拉起 Blender（bridge 生效），**不是随便双击 Blender 就能用**；完整 GIA 实测还需游戏侧环境。 |

### 6.5 结论（更新）

- 「千星奇域 UGC 工具」**已成功安装并可在 Blender 5.2.3 中加载**，16 面板/56 操作符验证通过。
- 它仍是**手工建模/配环境/导 GIA** 的 Blender 插件，**没有**「设计图→自动搭场景」；
  且 **必须 Blender 5.2+**、需要 7 天/30 天席位（星币兑换）。
- 因此前面的判断不变：设计图→场景自动化由 `dsh-plugin-design-to-scene` 补齐；
  云端副本见 `_work/design-to-scene-cloud-delivery.md`。

## 7 证据（本次新增）

- 登录成功截图：`_vendor\yuanxing\step9.png`（账户页 1 项插件权益）→ `refresh1.png`（插件权益列表）
- 安装成功截图：`_vendor\yuanxing\install52-4.png`（卡片：版本 1.2.6 · 可使用）
- Blender 启动截图：`_vendor\yuanxing\blender-ui2.png`（Blender 5.2.3 LTS）
- 插件启动器面板：`_vendor\yuanxing\blender-open2.png`（环境就绪 / 启动 Blender / 素材资源）
- 安装日志：`%LOCALAPPDATA%\Yuanxing\Tools\blender\` 下 `preparation.json`、`preferences.json`（host 指向 5.2.3）
