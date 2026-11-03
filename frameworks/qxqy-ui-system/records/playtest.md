# 试玩记录（runtime=simulator）

> 只有真机证据能改"真机"结论；本文件全部是 **模拟器候选** 级别。

## 2026-10-20 · 第 1 轮：骨架跑通

**环境**：模拟器插件 2.0.8；画布 `mobile-16-9`(1280×720) 与 `pc-16-9`(1600×900)；
存档 `workspace/qxqy-ui-system/qxqy-ui-system.save.json`；脚本路径模式（`source` 空，读 `lua/main.lua`）。

### 启动日志（首个绿灯）

```
[ui] LIFECYCLE OnInit
[ui] DISCOVER screens=1 pages=3 tabs=3 root=app.root
[ui] KEY_BIND ctrl=app.root n=5 Left@string Right@string A@string D@string Escape@string
[ui] SIGNAL_BIND ui/sync
[ui] APP_DIAG screens=1 pages=3 tabs=3 clicks=7 keys=true screen=demo page=p1 missing=none dup=20 dup_bad=none state_missing=none
[ui] APP_READY booted=true attempts=1
```

语义：发现 1 屏 / 3 页 / 3 页签；7 个点击绑定全部成功（3 页签 + 4 按钮）；键盘 5 键绑定成功；
没有缺失控件；`dup=20` 全部是局部子名（`text`/`plate`/`state.*`/`label`/`bg`），`dup_bad=none`。

### 用例结果（7/7 通过）

| 用例 | 画布 | 结论 | 关键证据 |
|---|---|---|---|
| `t01_boot` | mobile-16-9 | ✅ | `DISCOVER screens=1 pages=3 tabs=3 root=app.root`；`page.p1.visible=true`、`page.p2/p3=false`；`hud.pager.text="1 / 3"` |
| `t02_next` | mobile-16-9 | ✅ | `PAGE demo/p2 idx=2`、`ACT next<- btn.next page=p2`；pager `2 / 3`；服务端 inbound `ui/nav=["demo","p2",2]` + `ui/action=["demo","next"]` |
| `t03_tab` | mobile-16-9 | ✅ | `ACT p3<- tab.p3 page=p3`；pager `3 / 3`；p1/p2 隐藏、p3 显示 |
| `t04_clamp` | mobile-16-9 | ✅ | 首页点 `prev` 不产生 `ACT`（钳制生效）；随后 tab.p3 + next 仍停在 `3 / 3` |
| `t05_close` | mobile-16-9 | ✅ | `screen.demo.visible=false`，同时 `tree: page.p1 exists=true`（**容器没销毁**，符合"隐藏容器=销毁"的反面验证） |
| `t06_key` | pc-16-9 | ✅ | `Right→p2`、`Left→p1`、`Escape→close`，三条 `ACT … <- key` 均出现 |
| `t07_pc` | pc-16-9 | ✅ | PC 画布同样 `DISCOVER 1/3/3`，`hud.pager="2 / 3"`、`page.p2.visible=true`（锚点布局跨画布成立） |
| `t08_server_sync` | mobile-16-9 | ✅ | 下行 `ui/sync(p3)` → `APP_SYNC page=p3` + `APP_SYNC_APPLIED page=p3` → pager `3 / 3`、p3 可见 |

用例文件：`tests/t01_boot.json` … `tests/t08_server_sync.json` 是**完整用例（8 个文件）**。
`runCase` 只接受内联对象（没有文件加载器），所以实跑时是把文件内容作为 `args.case` 传入的；
其中 `t01/t02/t07/t08` 实跑用了**缩减版断言集**（6/6/3/4 条），文件里多出的断言由**同一次运行的
`APP_DIAG` 行与快照**背书（`missing=none`、`state_missing=none`、`dup_bad=none`、`page.p3` 状态、`inbound` 信号），
下次回归建议直接按文件全量跑。`t03/t04/t05/t06` 实跑与文件一致。

### 截图证据

| 帧 | 内容 |
|---|---|
| `f112`（mobile-16-9） | 首屏：标题、3 页签（p1 选中=金星，p2/p3 未选中=灰环）、`第 1 页 · 内容留白`、`‹`/`重置`/`›`/`×`、页码 `1 / 3` |
| `f455`（mobile-16-9） | 点 `btn.next` 后：内容换为 `第 2 页`、页码 `2 / 3`、页签选中标记移到 2、底板色调变化 |

两张截图都在 `/qxqy-play-mobile-16-9-f112.png` / `-f455.png`（试玩截图工具返回的规范化副本）。
**结论：页显隐、页签选中态、页码文本三处同时正确 ⇒ 「单一可见性权威 + 状态层」这套结构在模拟器成立。**

### 本轮踩到并已修掉的缺陷（Red → Green 记录）

| # | 现象 | 根因 | 修法 | 复验 |
|---|---|---|---|---|
| 1 | `DISCOVER screens=0 root=nil`；`APP_READY booted=true` 却什么都没做 | ①`GetClientUIRoots()` 在 OnInit 阶段不可用（早期判断）②真正原因：`Bind`/`Engine` 用 `type(x)=="table"` 判控件，而运行时控件是 **userdata** | 加 `Engine.is_ctrl()`（table 或 userdata）并替换全部判据；boot 改成"发现到屏才算成功" | `DISCOVER screens=1 …` |
| 2 | `main.lua:175: attempt to index a nil value (global 'Engine')` | 批量替换把 `Engine.is_ctrl` 也写进了 Engine 模块内部，模块自身 local 未声明前解析成全局 nil | 模块内部一律用局部 `ctrl_like` | 重跑通过 |
| 3 | `clicks=0`，`missing=btn.*;tab.*:找不到` | `Bind.rebuild` 用 `is_ctrl(list)` 判断"是不是单个控件"，但数组也是 table ⇒ 把 `{root}` 又包了一层 | 改成按"是不是数组"判断（`as_list`） | `clicks=7` |
| 4 | 日志出现 3 份 `LIFECYCLE` | `load` 合并脚本注册表，旧脚本 id 与旧挂载被"复活" | 新脚本用固定 id `1073742200` + `removeScript` 清掉 1073742106/1073742107 | 单份日志 |
| 5 | 改磁盘 Lua 不生效（每轮都要重推 40KB 源码） | 存档 `source` 为内联副本 | 把 `source` 置空改走路径模式 | 改一行重开即生效 |

### 交付物自检（最后一次，用**磁盘上的存档**重新导入）

把 `qxqy-ui-system.save.json`（199,874 字节、1 个脚本映射、`source` 为空）重新导入后重跑：

```
[ui] DISCOVER screens=1 pages=3 tabs=3 root=app.root
[ui] APP_DIAG screens=1 pages=3 tabs=3 clicks=7 keys=true screen=demo page=p1 missing=none dup=20 dup_bad=none state_missing=none
[ui] APP_READY booted=true attempts=1
```

`t01_boot` 的**全部 10 条断言**重跑通过（含 `page.p1/p2/p3` 三个 visible、`screen.demo` visible、
`hud.pager="1 / 3"`、`missing=none`、`state_missing=none`）。

⚠️ 复检时发现：**再次导入同一存档会多出一条脚本映射**（incoming id 与内存已有 id 冲突时，
插件会分配新 id `1073742201` 并挂到同一控件）⇒ 出现两份实例、双份日志。
导入后务必确认 `scripts` 只有 1 条；多余用 `removeScript` 清掉。

### 第 2 轮：并入主脚本形态 + 离线桩（2026-10-20 晚）

改动：新增 `91_api.lua`（`Tutorial` 门面）、`config.keys_enabled`、双模式打包（`--mode standalone|module`）。
决策背景见 `docs/adr-001-single-script.md`。

| 检查 | 方式 | 结果 |
|---|---|---|
| standalone 重跑 | 模拟器 `mobile-16-9` | ✅ `DISCOVER 1 屏/3 页/3 页签`、`clicks=7 keys=true`、页签 `tab.p2 → p2`、`next → p3`、页码 `3 / 3` |
| module 形态 | **离线桩** `lua tests/offline/module_smoke.lua` | ✅ 20/20：不抢全局 `OnInit/OnStart/OnUpdate`、只有 `Tutorial`、install 后自行 boot、翻页/跳页/关闭/`OnUpdate` 全通 |
| 双模式产物一致 | `build_bundle --check`（分别两种 mode） | ✅ |

**离线桩抓到 1 个真缺陷（模拟器里看不见）**：boot 时只调了 `Screen.open`（屏显隐），
**没调 `Pager.apply`** ⇒ 页显隐 / 页码文本 / 页签选中态都没在启动时写一次。
模拟器里看起来是对的，纯粹因为存档初始值恰好等于"第 1 页"。
修法：`App.boot` 里 `Screen.open(...)` 之后补 `Pager.apply(first, {notify=false})`。
⇒ 教训：**"存档里恰好摆对"会掩盖"启动没有渲染"**，所以需要不预先摆好的离线桩。

另：`local Tutorial = …` 之后写 `Tutorial = Tutorial` **不会**建出全局（同名 local 在作用域内，
赋值落到 local）——离线测试第一个断言就红。产物改为 `_G.Tutorial = Tutorial`。

### 第 3 轮：导出可导入的 `.gil`（真机存档）并用模拟器验证渲染

目的：把教程依赖的 41 个控件**直接建进一个 `.gil` 关卡存档**，配基础可视素材，验证"导入真机后能看见/能对上名字"。

做法（走仓库成熟链，见 `docs/gil-build.md`）：
- 骨架 = `qianxing-murdoku/assets/纯2D游戏模板(客户端脚本版).gil`（24 条记录，每种控件一个原型，干净关卡）
- 图片供体 = `qianxing-murdoku/存档/470-遗留清理-v282.gil`（模板的图片原型**没有 assetId**，借一张真图才看得见）
- 写入 = `gilread.mjs` + `gilwrite.mjs:writeGil()`（编码→落盘→**从磁盘重读**→往返→记录数→字段 diff 四道闸）
- 产物 = `qianxing-murdoku/存档/473-教程UI系统骨架-v1.gil`（182.9 KB / **63 条记录**）+ `export/473-教程UI系统骨架-v1.save.json`（供模拟器验证）

| 检查 | 证据 | 结果 |
|---|---|---|
| 往返 | `node qianxing-murdoku/tools/gil/roundtrip.mjs export/…gil` | ✅ 重新编码与原始体**逐字节一致**（顶层 43 字段，尾 `00000679`） |
| 结构 | `gil_inventory.mjs` 重读 | ✅ `客户端控件容器(1073742016)` + **`app.root(1073742017)` 父=null 子=1** + `screen.demo(1073742040) 父=1073742017 子=12`，41 个语义名齐全 |
| 画布根 | 对照真机存档 `470`：`客户端控件容器 子=0` + `root 父=null 子=74` | ✅ 同构（我们的画布根改名为 `app.root`，Lua 的 `FindClientUIRoot("app.root")` 才找得到） |
| 渲染 | 转出 save → `qxqy_studio_load` → `mobile-16-9` 截图 | ✅ 标题、3 页签（含金色选中点）、`×`/`‹`/`›`/`重置`、页码 `1 / 3`、第 1 页底板+文案全部出现，位置与设计一致；底板深蓝可读 |
| 颜色 | 转出存档实测 `imageColor`：plate=`3711256158`、bg=`2350787130/2351570474/2350787102`、state.sel=`4294955088`、state.off=`2862262463` | ✅ 四类各自生效 |

转换告警 11 条**逐条判读后都是"可解释、非缺陷"**：20 条引擎脚手架被剔除（参考存档也没有）、11 条模板自带原型记录 `#504` 缺失被改挂 root、7 条按钮四态子控件引用为空（我们故意不做四态，交给编辑器配）。

**仍未做/未验证**：
- `[未验证]` **真机层序**：`.gil` 的子 id 列表按"引擎顺序"（与编辑器列表相反）写入；模拟器里层序正确（标题/按钮压在页底板之上），但真机若看起来反了，用 `node tools/build_gil.mjs --order=spec` 重跑。
- `.gil` 里**没有内嵌我们的 Lua 脚本**（模板自带的是它自己的 16 KB 脚本）；真机导入后仍需建映射 + 挂到 `app.root`（见 `docs/device-handoff.md`），或用 `tools/gil/embed_script.mjs` 把 `lua/main.lua` 内嵌进去。
- 真机导入未能在此环境验证（模拟器只证明"结构 + 渲染"）。
- 页 p2/p3 在静态存档里是 `visible=true`（没有脚本去隐藏），叠在 p1 下面；挂上脚本后由 `Pager.apply` 接管。
- 按钮四状态子控件引用仍为空（骨架原型自带），四态外观交给编辑器配。

**颜色"亮黄绿"的真因（值得记一笔）**：不是写错字段，而是**任务书里的十进制算错**——
`0xDD35465E` 应为 `3711256158`，我写成了 `3707041886`（=0xDCF4F85E 亮黄绿）。
实测确认 plate 与 bg **走同一条路径**：`槽(73,96) details → #84 { #502 = imageColor, #503 = assetId }`。
⇒ 凡是颜色/ID 这类常量，**在代码里写 hex 字面量、由构建脚本现算十进制**，不要在文档里手算后抄。

**可复现性**：同一份输入重跑两次，产物 sha256 一致（`31CABB3A…B8069`，187,323 B）。

**存放位置（2026-10-21 起，用户指定）**：测试存档统一放 `qianxing-murdoku/存档/`，本次即
`qianxing-murdoku/存档/473-教程UI系统骨架-v1.gil`（sha256 与上表那次构建**完全一致**，只是换了位置和名字）；
验证用转出存档与机器摘要留在 `export/473-教程UI系统骨架-v1.{save.json,build.json}`。

### 已知限制（模拟器侧）

- 界面动效 `PlayAnimation` 为空操作、无音频链路 ⇒ `界面动效` 控件在演示里只是占位。
- 只有基础图元 100001/100004/100005/100006 有预览，其它 `imageId` 显示缺失框（演示刻意只用这四个）。
- 服务端逻辑 `ui/nav → 写变量 + 发 ui/sync` 的**规则**未进内存存档（`load` 丢弃 `serverLogic`），
  下行链路用 `serverSend` 直接注入验证；规则本体在存档 JSON 里，可用 `setServerLogic` 推一次或由用户在编辑器配置。

### 下一步（真机）

见 `docs/device-handoff.md`。要点：把 `lua/main.lua` 建立脚本映射 → 挂到 `app.root` →
用真实导入后的控件索引校准 → 节点图补 `ui/nav`/`ui/sync` → 逐条打勾真机核验清单。


### 第 4 轮：真机导入报「GUID 重复」→ 换高号段重建

真机导入 `473-教程UI系统骨架-v1.gil` 时编辑器报：**界面控件里的开关控件 GUID 重复:1073742041**。

- 自查 `tools/gil_dupid.mjs`：**本档内部 0 个重复认领**（每条记录恰好 1 recordId + 1 infoGuid）
  ⇒ 不是 v259 那类"克隆只改顶层 #501"的内部重复，而是 v257b 那类**与目标工程已用号撞车**；
- 按 v257b 的做法把新增控件搬到**高号段**：新档 `474-教程UI系统骨架-v2.gil`，新 id **1073743800…1073743838**；
- 证据链：`roundtrip` 逐字节一致 · `gil_dupid` 0 重复 · `gil_geom_diff 473 474` = **逐条同构（名字/父子/锚点/偏移/尺寸/子列表数量全一致）**，
  即"除了 id 段，其它与已通过渲染验证的 473 完全相同"；
- 结论状态：**待用户重新导入 474 验证**（真机证据才算数）。
