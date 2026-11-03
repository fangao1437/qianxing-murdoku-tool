# 教程 UI 系统 · 成果汇总（2026-10-21）

> 一句话：按教程 GIA「翻页单击活动样式」的**角色构成**，做出一套可运行的千星 2D+Lua UI 框架
> （屏/页/翻页/页签/四态/输入/服务端桥），并把它 41 个控件的界面**直接生成进一个可导入真机的 `.gil` 关卡存档**。

## 1. 交付物

| 类别 | 路径 | 状态 |
|---|---|---|
| Lua 框架（源码 10 模块） | `workspace/qxqy-ui-system/lua/src/*.lua` | ✅ 模拟器候选 |
| Lua 产物（standalone / module） | `lua/main.lua` · `lua/module.lua` | ✅ 两种形态均通过验证 |
| 模拟器完整存档 | `workspace/qxqy-ui-system/qxqy-ui-system.save.json` | ✅ 用户已保存，路径模式（source 空）|
| **真机用 .gil** | `qianxing-murdoku/存档/475-教程UI系统骨架-v3.gil` | ⚠️ 待真机导入验证 |
| 失败留档（GUID 撞号） | `qianxing-murdoku/存档/473-…-GUID撞号勿用.gil` · `474-…-GUID撞号勿用.gil` | 按仓库习惯标「勿用」 |
| 测试用例 | `tests/t01…t08.json`（7 个实跑通过）· `tests/offline/module_smoke.lua`（20/20） | ✅ |
| 文档 | `docs/`：gdd · tech-architecture · adr-001 · gia-structure · api-notes · repo-survey · gil-build · device-handoff · production-plan | ✅ |
| 试玩记录 | `records/playtest.md`（4 轮，含每轮证据） | ✅ |
| 工具 | 见 §5 | ✅ |

## 2. 关键结论（可以直接拿去用）

1. **教程 GIA 是"模板库"不是可导入的界面存档**：`Root.graph` 2 个界面 + `accessories` 113 条记录；
   6.7.0 新槽位（`21/38`/`38/56` 等）连模拟器 schema 都不认识 ⇒ 只能取"角色构成"，不能往返。
   （解析工具与结论：`docs/gia-structure.md`）
2. **不要为教程单开脚本映射**：跨脚本只能 `script:Invoke`（依赖会重映射的 mappingId）或服务端信号（≥100ms）；
   教程↔关卡的实时联动、同一次 Esc 的裁决、索引/恢复/交付都会翻倍。已落地 `module` 形态给主脚本内嵌。
   （决策与用法：`docs/adr-001-single-script.md`）
3. **框架只按名字发现控件**：`app.root / screen.* / page.* / tab.* / btn.* / hud.*`，
   布局与内容留白；摆不全不崩，`APP_DIAG` 一行点名缺谁。
4. **单一可见性权威**：屏=`Screen.apply`、页=`Pager.apply`、选中态=`State`；别处只改期望值
   （旧工程 4 个真机事故都出自"同一件事两处负责"）。
5. **控件 id 必须选本机未占用的号段**（本轮两次踩坑的根因）：
   `473` 撞 1073742041、`474` 撞 1073743800+（都是目标工程已用的号）；
   `475` 用 **1073745000…5038**，已在本机 75 个存档里验证未占用。

## 3. 证据矩阵（都是实测，不是"应该没问题"）

| 项 | 证据 |
|---|---|
| 模拟器功能 | 7/7 用例：启动发现 1 屏/3 页/3 页签、`clicks=7 missing=none`、翻页/页签/钳制/关闭/键盘/PC 画布/下行校正 |
| 视觉 | 两张截图（首屏 + 翻到第 2 页）：页显隐、页签选中、页码三处同时正确 |
| module 形态 | 离线桩 20/20：不抢全局生命周期、`Tutorial.install` 后自行 boot、翻页/关闭/`OnUpdate` 全通 |
| .gil 可解析 | `roundtrip.mjs`：重编码与原始体**逐字节一致**（体积 187,323 B） |
| .gil 树正确 | 63 条记录 = 24 基线 + 39 新建；`app.root` 复用画布根 `1073742017`、父=null、子=1、1600×900 |
| .gil 无内部撞号 | `gil_dupid.mjs`：0 个 id 被 ≥2 条记录认领（三处 GUID 位置全查） |
| 换号段不改结构 | `gil_geom_diff.mjs 473 475`：63 条**逐条同构**（名字/父子/锚点/偏移/尺寸/子列表数量全一致） |
| 号段未占用 | `scan_local_gil.mjs`：全库 75 个存档中含 `1073745000` 的 **0 个** |

## 4. 当前状态与阻塞

| 项 | 状态 |
|---|---|
| 模拟器 | ✅ 绿（`records/playtest.md` 第 1~2 轮） |
| `.gil` 结构/渲染 | ✅ 反解成模拟器存档后截图验证（第 3 轮） |
| **真机导入** | ⚠️ `475` 待用户导入；前两版因 GUID 撞号失败（已留档标「勿用」） |
| 真实美术 | ⏸ 留白：演示只用 100001/100005/100006 基础图元 |
| 服务端规则 | ✅ 存档 JSON 里有 `ui/nav → Level.UiLastPage/UiLastIndex + ui/sync`；模拟器载入会丢，需 `setServerLogic` 或编辑器配置 |
| 传送/断线恢复 | ❌ 未实现（框架留了 `Bind.invalidate()`，流程待补） |

## 5. 工具索引（都用 node 直接跑）

| 工具 | 用途 |
|---|---|
| `tools/build_bundle.mjs --mode standalone\|module` | 源码 → 单文件 Lua（`--check` 只校验一致性） |
| `tools/gen_save.mjs` | 生成模拟器存档（以 `records/proto-project.json` 为节点原型） |
| `tools/build_gil.mjs [--probe] [--base=…] [--order=…]` | 生成 `.gil`（唯一写入通道 `writeGil`，四道闸） |
| `tools/gil_inventory.mjs` · `gil_slots.mjs` · `gil_rawname.mjs` | 读 `.gil`：清单 / 槽位 / 字符串路径 |
| `tools/gil_dupid.mjs` | 查 GUID 重复（recordId / infoGuid / nodeRef 三处都算） |
| `tools/gil_geom_diff.mjs` | 两档控件树是否"逐条同构、只差 id" |
| `tools/scan_local_gil.mjs` | 扫本机真实存档，判断号段是否被占用 |
| `tools/pb.mjs` + `gia_*.mjs` | 自建 GIA 解析器（信封/槽位/树） |

## 6. 复现一条命令链

```bash
cd workspace/qxqy-ui-system
node tools/build_bundle.mjs --mode standalone          # 或 module
luac -p lua/main.lua
node tools/gen_save.mjs                                # → qxqy-ui-system.save.json（模拟器导入）
node tools/build_gil.mjs                               # → qianxing-murdoku/存档/475-….gil
node tools/gil_dupid.mjs "qianxing-murdoku/存档/475-教程UI系统骨架-v3.gil"
node tools/scan_local_gil.mjs --id=1073745000
node tools/gil_geom_diff.mjs "qianxing-murdoku/存档/473-…-勿用.gil" "qianxing-murdoku/存档/475-…-v3.gil"
```

## 7. 踩坑 → 修法（都写进了对应文档）

| 坑 | 真因 | 修法 | 出处 |
|---|---|---|---|
| `DISCOVER screens=0` | 运行时控件是 **userdata**，`type(x)=="table"` 判据把真控件全判非法 | `Engine.is_ctrl()`（table 或 userdata） | playtest 第 1 轮 |
| `clicks=0` | `Bind.rebuild` 把 `{root}` 又包了一层（数组也是 table） | `as_list()` 按"是不是数组"判断 | playtest 第 1 轮 |
| 启动没渲染页 | boot 只调 `Screen.open`，漏了 `Pager.apply`（存档恰好对才没暴露） | boot 里补一次 `Pager.apply(first)` | 离线桩抓到 |
| 底板亮黄绿 | 任务书把 `0xDD35465E` 的十进制算错 | 代码写 hex 字面量、构建脚本现算 | playtest 第 3 轮 |
| 导入报「GUID 重复 1073742041」 | 与**目标工程已用号**撞车（本档内部 0 重复） | 换本机未占用号段（1073745000+） | playtest 第 4 轮 / gil-build 六、六之二 |
| `474` 仍重复 | 选的 1073743800+ 恰是对方工程在用（仓库 production-plan 就写着要"再挪一档"） | 先 `scan_local_gil` 验证再选段 | gil-build 六之二 |
| `gil_to_save` 转出 5KB 空档 | 该 wrapper 的 `--in/--out` 解析基准不一致，失败仍写小文件 | 暂用"与已验证档逐条同构"替代；待修 | playtest 第 4 轮 |
