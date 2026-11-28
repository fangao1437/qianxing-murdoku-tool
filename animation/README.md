# animation/ —— 千星奇域 · 2D UI 物理柔性纸张动画制作管线（零依赖工具）

> 这是主项目「Murdoku 复刻」749 迭代（v1 → v8）在真机上跑通的 **2D UI 柔性纸张覆放动画**完整工具化版本：
> 千星沙箱约束调研 → 控件树分层与隔离 → **基尔霍夫薄板方程双模态解析解** → 严格不可伸长积分 →
> 逐叶子显隐闭环 → 离线物理审计 / SVG 预览 / `.gil` 静态审计 → 高仿真 Lua 回归 → 真机录屏核验。
>
> 本目录**只含算法、参数预设、离线工具与流程文档**，不含任何 `.gil` / `.gia` / 截图 / 官方贴图（符合仓库 `.gitignore` 合规边界）。

---

## 1 这是什么 / 不是什么

**是**
- 一份真机实测通过的**物理参数预设**：`specs/paper_presets.json`（调查商城独立档案纸卡 `shop_card` + 调查背包便签纸 `bag_note`）；
- 两个零依赖 Node 工具：
  - `tools/kirchhoff-paper-sim.mjs`：基尔霍夫薄板方程双模态离线求解器、60 帧物理硬闸门审计、多帧 SVG 轮廓预览与 Lua 配置片段生成；
  - `tools/audit-gil-anim.mjs`：`.gil` 存档 6 道静态审计闸门（容器完备、16 段纸带、零半透明产物、冷启动初始隐藏、层序遮挡、4 平台槽位静态世界坐标 `< 0.001px`）；
- 一套完整的一键离线自检：`test/run.mjs`（14 项检查，支持离线跑与带真实 `.gil` 跑）；
- 一份把 v1→v8 全部真机踩坑和数学推导写清楚的**完整制作流程文档**：`docs/UI动画制作流程.md`；
- 主项目完整落盘实战脚本对照：`project-tools/build_749.mjs` 与 `project-tools/verify_749_paper_anim.lua`。

**不是**
- 不是逐帧贴图渲染器（无帧序列贴图、无外部美术图片依赖）；
- 不使用半透明叠片特效（全部新增动画图元严格 `alpha = 0xFF`）；
- 不依赖原生 `game.Tween`（全解析 `OnUpdate(dt)` 驱动，避开真机隐藏态续写、连点打架与 `[0,360)` 旋转绕远路）。

---

## 2 快速开始

```bash
# ① 一键离线自检（不依赖主项目、不依赖 .gil 存档）
node animation/test/run.mjs

# ② 带主项目 749_v8 / 748 存档跑完整 6 道静态闸门对账
node animation/test/run.mjs \
  --gil=../qianxing-murdoku/749_背包商店右侧纸张切换动画/749_背包商店右侧纸张切换动画_v8.gil \
  --base=../qianxing-murdoku/748_全核查修复与自闭环验证/748_全核查修复与自闭环验证.gil

# ③ 单独运行求解器物理审计 + 导出 6 帧 SVG 预览 + 导出 Lua 配置片段（产物进 out/，不入库）
node animation/tools/kirchhoff-paper-sim.mjs \
  --preset=shop_card --audit \
  --svg=out/shop-paper-anim.svg \
  --emit-lua=out/shop-paper-cfg.lua

# ④ 单独审计任意带柔性纸张动画的 .gil 存档
node animation/tools/audit-gil-anim.mjs \
  --gil=<目标.gil> --base=<基准.gil> \
  --prefix=econ.shop736.,econ.bag741. \
  --above=econ.shop736.s37, \
  --strips=16
```

---

## 3 目录

| 路径 | 作用 |
|---|---|
| `README.md` | 本说明（定位、快速开始、目录与边界） |
| `docs/UI动画制作流程.md` | **完整制作流程**：千星沙箱能力边界 → 控件分层 → 基尔霍夫薄板方程推导 → 真机逐叶子显隐闭环 → 8 代真机踩坑实录 → 验收门禁 |
| `specs/paper_presets.json` | 调查商城纸卡（`shop_card`）与调查背包便签（`bag_note`）的物理参数与审计门禁预设 |
| `tools/kirchhoff-paper-sim.mjs` | 零依赖离线求解器（与 749_v8 内嵌 Lua 数学等价）：60 帧不可伸长/净空/光滑度审计、SVG 预览、Lua 配置导出、`--self-test` |
| `tools/audit-gil-anim.mjs` | `.gil` 动画结构 6 道静态审计工具（复用 `src/gilread.mjs`） |
| `test/run.mjs` | 一键自检（离线 13 项 + 可选真实 `.gil` 对账 1 项） |
| `../project-tools/build_749.mjs` | 主项目 749_v8 端到端 `.gil` 控件树重构 + Lua 注入构建脚本（实战完整参考） |
| `../project-tools/verify_749_paper_anim.lua` | 主项目 749_v8 高仿真沙箱自动化回归脚本（含冷启动 `_enforce_hidden_subtrees` 逐叶子校验与物理测量断言） |
