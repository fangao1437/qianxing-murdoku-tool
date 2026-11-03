# 三仓调查报告 —— 为「千星 UI 系统（翻页/分页框架）」做的技术底稿

> 调查人：repo-survey（teammate）｜只读调查，未改动三个仓库任何文件、未跑模拟器、未碰 git。
> 目标：让没打开过这三个仓的人能（a）知道每个仓是什么、（b）拿到屏幕/页框架的设计意图与模块边界、
> （c）避开 ≥10 条最贵的真机坑、（d）知道解析千星存档该用哪个本地工具。

## 0 元信息

| 项 | 值 |
|---|---|
| `qianxing-murdoku`（主代码仓） | commit **525207d**，origin `github.com/fangao1437/qianxing-murdoku` |
| `murdoku-project`（交班/规格仓） | commit **6c4987d**，origin `github.com/fangao1437/qianxing-murdoku-project` |
| `murdoku-pro`（pro 分支仓） | commit **08a6a99**，origin `github.com/fangao1437/qianxing-murdoku-pro` |
| 规模 | qianxing-murdoku：4448 文件 / 397 MB（116 个 `.gil`，其中 `存档/` 103 个）· murdoku-project：167 文件 / 12.69 MB · murdoku-pro：68 文件 / 0.98 MB |
| 目标官方样例 | `qianxing-murdoku/assets/教程UI系统_翻页单击活动样式.gia`（167.8 KB，另有一份 `好看的 UI(内含底板，牌类模版…).gia` 171.1 KB） |

**证据标记**（逐条给出，不混用）：
`[官方]` = 官方文档原话（仓库存有全文副本 `docs/api-cache/<id>.txt`）｜`[实测]` = 该仓记录的真机或模拟器实测
`[推断]` = 原文档自己标为推断/未证实｜`[repo文档]` = 仓库文档陈述、未见更强来源｜`[我核]` = 本次调查我直接读到的字节级/计数事实

---

## 1 三个仓库各是什么

### 1.1 `qianxing-murdoku` —— 唯一可运行的代码仓（活代码）

- **是什么**：原神「千星奇域」UGC 的 **2D + Lua** 谋杀悬疑（murdoku）工程的**全部源码 + 全部存档 + 全部工具**。界面控件在编辑器里搭（存档 `.gil`），逻辑全在 Lua（`lua/**`），打包成**单文件** `dist/client_script.lua` 注入客户端。`[repo文档] docs/技术架构.md:14-19`
- **入口**：`lua/entry_client_script.lua`（官方 7 个生命周期回调 + `cfg` 生产值）；出包三步 = `lua tools/bundle_client_script.lua` → `powershell -File tools/install_script_to_sandbox.ps1` → 回编辑器点刷新。`[repo文档] docs/技术架构.md:25-46`
- **代码量（本次实测行数）**：`ui_controller.lua` 8012 行 · `engine_adapter_qianxing.lua` 5955 · `murdoku_core.lua` 2963 · `main.lua` 2358 · `murdoku_core`/`room_map` 114 · `entry_client_script.lua` 1035 · `engine_adapter.lua` 147 · `levels/*.lua` 7 个 `[我核]`
- **为什么是单文件**：官方规则是「只有在千星沙箱里**建立了映射**的 `.lua` 文件才会被打包上传」⇒ 一个映射 = 一个文件 ⇒ 多模块 `require` **不保证**上传后还能解析到彼此。`[repo文档] docs/技术架构.md:21-23`
- ⚠️ **它是"施工记录"而不是"干净样板"**：文档自陈 `docs/技术架构.md:8` 的 §一模块表与 §三控件表**仍按 v226 口径**，而文件头另写「最后更新 2026-10-20 / v280」——**引用该表前必须对 `git log`**。

### 1.2 `murdoku-project` —— 交班与规格仓（**没有生产代码**）

- **是什么**：104 篇 `.md`（回执/交接/代码地图/内容设计任务书/性能审计），16 个 `.lua` **全是内容设计数据与审计探针**（`内容设计-*/case_00X-*.lua`、`审计-性能-v192对213-证据/probe_*.lua`），**不含 `lua/` 生产树、不含任何 `.gil`**。`[我核]`
- **可直接用的东西**：`代码地图-四段.md`（`ui_controller.lua` 82 个函数的索引 + 逐段行号 + 「死/重复/过时」总清单）、`模板本体与实例-查证.md`、`网格视窗-光标事件-实现测绘.md`、`回执-things创建全过程与运行时创建根源-2026-10-18.md`、`关键功能清单与性能优化禁区.md`、`仓库注意事项.md`。
- ⚠️ 首行标题是 `# qianxing-murdoku-pro —— 交接与当前矛盾`，与 `murdoku-pro/README.md:1` **完全相同** ⇒ 两仓 README 同源（见 1.4）。`[我核]`

### 1.3 `murdoku-pro` —— 同族「pro」分支，只多一个 003 关卡

- **是什么**：55 篇 `.md`（与 project 高度重叠：README/交接报告/回执-vXXX/代码地图-四段/真机交接 同名）+ **4 个 `.lua`**：`案件003-7x7-关卡数据.lua`（5×5→7×7 的 case_003 关卡数据）+ 3 个性能审计探针。`[我核]`
- **独有内容**：`交接-案件003-月谕茶会-封存报告.md`、`交接-案件003-索引.md`、`案件003-7x7-关卡数据.lua`、`高价值信息-月谕圣牌与Murdoku设计.md`、`案件003-row区内容-编辑器填写表.md`。
- **定位**：一次「单案（case 003 · 7×7 · 复合线索）」的封存尝试，**不是新架构**；其 `案件003-7x7-关卡数据.lua` 用文件头把墙/门/答案/七张卡全部写死成注释，是**内容设计范式的样板**，与 UI 框架无关。

### 1.4 三者关系（一句话）

> **`qianxing-murdoku` 是唯一能跑的东西；`murdoku-project` 是它的知识库/交班（无代码）；`murdoku-pro` = project 的同源分支 + 一个 003 关卡数据文件。**
> 依据：三者 README/回执/代码地图大量同名同内容（`[我核]` 文件比对）；`murdoku-project/README.md:11` 指向的仓库是 `fangao1437/qianxing-murdoku`；`docs/千星存档-gil格式.md` 等 20+ 篇同时存在于 project 与 pro。
> ⇒ **要做新游戏，只读 `qianxing-murdoku` 的 `lua/` + `docs/` + `tools/`；另两仓只在查「某个坑当初怎么查出来的」时用。**

---

## 2 Lua 架构事实（`qianxing-murdoku/lua/`）

### 2.1 五层调用链：单向，不许反向

`[repo文档] docs/技术架构.md:76-106`，我方核对与文件头注释一致：

```
编辑器 .gil → 引擎（客户端控件树 + 官方 Lua API）
                ▲ 引擎 API（Set/Get）      ▲ 事件回调（光标/键盘）
engine_adapter_qianxing.lua  ← 唯一允许直接调引擎的地方（find/sub、set_property、bind_input/_fire）
                ▲ 规划（表）                │ 事件（表）
ui_controller.lua            ← 控件规划 layout_plan()、视图→控件的翻译、输入分发
                ▲ core:view() 快照          │ 语义动作
murdoku_core.lua             ← 纯逻辑，不 require 任何引擎模块
main.lua 横跨：持有 adapter/controller/core，负责主循环与关卡生命周期
```

- **硬规则**：引擎侧只有两条路能改控件 —— ① 规划 → `adapter:set_property(id,key,value)`；② 适配层里的 `ctrl:SetSizeDelta(...)` 直调。`[repo文档] docs/技术架构.md:108-110`
- **第三条路是遗留缺陷**：`main.lua` 每 30 帧直遍历格子子控件（`frames % 30 == 0`），**周期性覆盖别的写者**，但它同时负责点亮格子底图 + 给 `x` 设 `cw*0.7`（用户当年明确要求）⇒ **禁区，不许整段删**。`[repo文档] docs/技术架构.md:112-115`、`docs/仓库注意事项.md:96-99`
- **核心层零依赖**是刻意设计：`murdoku_core.lua:13-16`「本文件不 require 任何引擎模块，可以直接在桌面 Lua 5.4 下跑自检」。

### 2.2 屏幕 / 页状态机 —— **真相：它不是一个框架，是一个字段 + 两张名单 + 一个差集**

这是本次调查**最重要的架构结论**：现有工程**没有** screen/page 框架，只有四个临时机制拼出来的等效物。

**(1) 状态只有一个字段，取三值**：`self.screen = "home"` / `"select"` / `nil`（`nil` = 在关卡里）。
`[我核] lua/ui_controller.lua:326,597,1597-1600,1686`：

```lua
-- ui_controller.lua:1597-1600
      self.screen = "home"; self.modal = nil; self.dirty = true
      self.screen = "select"; self.modal = nil; self.dirty = true; self.select_page = 1
```

**(2) 切屏 = 每次「藏别人」**：`apply_screen_hide(nodes, screen)` 用**固定名单**（`HIDE` 逐 id + `PREFIX` 前缀）把不该显示的节点标 `visible=false`。
`[我核] lua/ui_controller.lua:1924-1941, 2020-2022, 2080`：

```lua
-- ui_controller.lua:1941 / 2020-2022
    PREFIX = { "home", "select" }        -- 关卡内：藏两个屏的整棵子树
  else
    PREFIX = { "clue.", "hud.", "room.label.", "tray.", "action.", "hex.",
               "selbtn.", "tpl.",
               (screen == "home") and "select." or "home." }
```

**(3) 它只单向「藏」，从不负责「显示」**（`ui_controller.lua:2059-2080` 的长注释记录了一次改成双向后真机「一排白方块」的事故）。

**(4) 「该显示」由规划节点的初值 + 状态层负责；「藏过就回不来」由 render 的差集收口**：
`[我核] lua/ui_controller.lua:7612-7662`（`self._shown` = 上一帧显示过谁；不在本帧 `seen` 里的逐条 `visible=false`，并 `forget_visible(id)` 清账本）：

```lua
-- ui_controller.lua:7645-7662
  else
    for id in pairs(self._shown) do
      if not seen[id] and not stale_legacy(id) then
        self:_set_prop(adapter, id, "visible", false)
        forget_visible(id)               -- ★ 藏了就忘 ⇒ 下次该显示时会重发 true
      end
    end
  end
  self._shown = seen          -- 记住这一帧显示了什么，下一帧据此算差集
```

**(5) 控件由「规划数组」声明**：`layout_plan()` 用 `push({id, kind, parent, rect, text/image_id/style/event/visible …})` 逐条 push，**输出一份数组**（v205 清理后 189 个 / 7 组）。`[repo文档] docs/技术架构.md:121-129`｜`[我核] lua/ui_controller.lua:2399-2413`：

```lua
-- ui_controller.lua:2403-2413
  local function push(n)
    if n.visible == nil then n.visible = true end   -- 每节点必须显式 visible
    nodes[#nodes + 1] = n
    return n
  end
  local function btn(id, parent, r, text, event, style, enabled) … end
  push({ id = "root", kind = "container", rect = { x = 0, y = 0, w = M.DESIGN.width, h = M.DESIGN.height }, style = "screen" })
```

**(6) 换代的主要理由就是切屏**：`invalidate_lookups("screen=" .. tostring(self.screen))` 是 4 个调用点之一。`[repo文档] docs/技术架构.md:184-190`｜`[我核] ui_controller.lua:7488-7493`

> **给新框架的直接结论**：把这套东西**显式化**——`Screen` 注册表（id/root 容器/生命周期/on_enter/on_leave）、**每屏一个真实容器父级**、可见性**唯一权威 = 当前屏**、切屏 = 一次 `set_screen(id)` 而不是每次改一行 `self.screen` 再靠前缀名单兜。
> 现有实现的每一个 bug（见 §3 的 P5/P6/P7/P19）都能追溯到「**同一件事有两处负责**」——`docs/显隐所有权与排查纪律.md:121` 已经把这条写成项目级结论：「**同一件事有两处负责 ⇒ 必然漂移**」。

### 2.3 控件查找：按**名字** + 世代缓存 + 负缓存 TTL + 路径兜底

`[我核] lua/engine_adapter_qianxing.lua:571-620`：

```lua
function Adapter:find(name)
  local hit0 = self.controls[name]
  if hit0 ~= nil then return hit0 end
  local miss = self._misses
  if miss ~= nil then
    local stamp = miss[name]
    if stamp ~= nil then
      if stamp == false or self.clock < stamp then return nil end   -- 负缓存
    end
  end
  local roots = game.GetClientUIRoots()                            -- ★ 唯一可靠的根
  for i = 1, #roots do
    local hit = find_in(roots[i], name, 0)                         -- 深度优先按 name 搜
    if hit then self.controls[name] = hit; self:_note_lookup_hit(name); return hit end
  end
  …  -- 兜底：cfg.path_map[name] = "1/2/3" → control_by_path(roots, path)
  --   搜空 ⇒ 记负缓存（命中过 ≥1 次才允许记）；TTL 默认 1.0s，重搜一次仍不在 ⇒ false
```

- **为什么必须缓存「未命中」**：`[实测]` 关卡里 300 帧测到 `GetChildren` 被访问 **1,565,043** 次 ≈ 5217/帧，其中 `action.back` 一个名字 **936/帧**（搜空 ×10/帧）。`engine_adapter_qianxing.lua:514-521`
- **为什么缓存「命中」也必须能作废**：`[官方]`「玩家传送、断线重连时，**所有客户端控件都会被销毁**然后回到初始状态」「客户端容器控件隐藏或销毁时，客户端控件销毁」⇒ 旧实现只清负缓存、**命中缓存永不校验句柄是否还活着** = 当年最大的坑。`engine_adapter_qianxing.lua:548-557`、`docs/技术架构.md:163-169`
- **世代作废只有 4 个调用点**：`create_control`（带 `keep_bindings`）/ `destroy_control` / `sync_clue_grid` / `render(screen=)`。`docs/技术架构.md:183-190`
- `sub(parent_id, child_name)` 可**穿透中间容器**（`content`/`root`/`body`）找子控件，并按代记 `_sub_miss`。`[repo文档] docs/API-四方对照.md:466`、`docs/技术架构.md:177-178`
- **没有 guid 查找**：Lua 侧完全按**控件名**（编辑器里的实例名）找控件；GUID/索引只在存档层与 `InstantiateClientUIControl` 用。`[我核]` grep 全仓 `lua/` 无 `GetClientUIControlByGuid` 之类调用。

### 2.4 输入路由：4 种光标监听 + 「认领者赢」+ 只进不出

- **绑定**：`Adapter:bind_input(id, node)` 对 `预设按钮 / 光标检测区域` 挂 4 种监听 —— `CursorClick`(L5090,5149) / `CursorDown`(L5204) / `CursorUp`(L5210) / `CursorDrag`(L5239)；枚举用 `E("CursorEventType.CursorClick")` 取（取不到就 `warn_once` 并降级）。`[我核] lua/engine_adapter_qianxing.lua:5013-5241`
- **只有「预设按钮 / 光标检测区域」有 `AddCursorEventListener`**（容器节点没有）。`[实测] docs/网格视窗-光标事件-实现测绘.md:35`
- **事件必须现查，不许在绑定时捕获进闭包**：同一颗预设按钮在不同弹窗状态下要发不同事件，而控件只创建/绑定一次。`[实测] docs/技术架构.md:525-535`；认领规则 = **第一个给该控件写 event 的规划节点赢**（`self.event_claim[id]`），不是最后写的。
- **适配器的 `on_input` 是「出」的方向**：`main.lua:471 adapter.on_input = function(event) controller:on_input(event) end` ⇒ 引擎手势**只会进来**，控制器从不「对着某个控件发一个事件」。`[实测] docs/技术架构.md:548-554`（踩过：`_on_grid_item_click` 里自己选一次 + 再发一条 `suspect` ⇒ 选中又被切掉）
- **长按自己合成**：用引擎每帧 dt 累加（`self.now` / `os.clock` 不按墙钟），门槛 `0.28`（曾用 `0.45` ⇒ 压在玩家自己的手 0.45~0.73 上 ⇒ 三分之一按不出来）。`[实测] docs/技术架构.md:542-544`
- `_fire(event, phase, data, src_id)` **必须把 `src_id` 传下去**，否则长按抬起崩（`compare nil with number`）。`docs/技术架构.md:545-546`

### 2.5 模板实例化：`InstantiateClientUIControl` + 「模板引用控件」这座桥

`[我核] lua/engine_adapter_qianxing.lua:847-887`：

```lua
  local allow_auto = (self.cfg.auto_create == true)
  if ctrl == nil and allow_auto and game and game.InstantiateClientUIControl then
    local prefab = (self.cfg.prefab_of and self.cfg.prefab_of[node.id]) or nil
    if prefab == nil then prefab = auto_prefab(self, node) end
    local pname = (self.cfg.parent_of and self.cfg.parent_of[node.id]) or "stage"
    local parent = self:find(pname) … or self:find("root")
    if parent then
      local ok, obj = pcall(game.InstantiateClientUIControl, prefab, parent)
      if ok and obj then
        pcall(function() obj.name = node.id end)
        … 读回 obj.name 核对，名字没生效要 warn_once
        ctrl = obj; self.controls[node.id] = ctrl
        self:invalidate_lookups("create:" .. tostring(node.id))   -- 新控件进树 = 缓存作废
        self:rearm_raycast("create:" .. tostring(node.id))        -- 新按钮默认点不动，要重武装射线
```

配套的 4 条硬事实（全部真机验证过，决定我们能不能用模板）：

| # | 事实 | 证据 |
|---|---|---|
| 1 | **`InstantiateClientUIControl` 只认「客户端控件模板」**；服务器控件（在 `root` 下右键「另存为模板」得到的那种）的索引调用**返回 nil** | `[实测] docs/客户端控件vs服务器控件.md:20-46`（三次真机；`m` 的 1073742380 / 1073742356 全是 nil）；`[官方]`「服务器控件的模板索引无法被客户端脚本调用」 |
| 2 | 让实例化可用的**正确桥梁是「模板引用控件」**：在编辑器里放一个模板引用控件去引用已保存的客户端模板，`cell.1.1` 的 prefabIndex 才变成可用索引 | `[实测] docs/API-四方对照.md:374-384`（三条来源都没写完整，只有真机实验补齐） |
| 3 | 实例化**返回的对象未必已挂到 parent 上**（那次"试造"出来的第一个格子改了名、进了名字缓存、`find` 找得到，但不在树上 ⇒ 引擎不画 ⇒ 屏幕上缺一格） | `[实测] docs/API-四方对照.md:398-413` |
| 4 | **模板复制是完整的**：副本带 `face/note/x` 子控件与 `raycastTarget`；但**模拟器不复制子控件**，所以这条永远只能真机验 | `[实测] docs/API-四方对照.md:415-428` |

- **模板在存档里有两份**（本体 + 每个引用处一份实例，各自带独立子控件，id 全不同）；`itemPrefabIndex` 指向**本体**。`[实测＋推断] docs/模板本体与实例-查证.md:30-56,139-155`｜`docs/技术架构.md:144-152`
- **模板索引 = 「另存为模板那一刻」的快照**：之后再给控件加底图/子控件，**必须重新另存一次**，否则副本全是透明的。`[repo文档] entry_client_script.lua:296-299`
- 规划节点可用 `cfg.prefab_of[node.id] = 索引` + `cfg.parent_of[node.id] = 父名` 精确指定要实例化哪张模板、挂哪个父级。`[我核] entry_client_script.lua:225-289`

### 2.6 服务端：**只有自定义变量与信号，没有节点图逻辑**

`[repo文档] docs/技术架构.md:659-687`。这是 2D+Lua 形态的平台事实，我们的框架同样只需要这两样。

- **信号（`engine_adapter_qianxing.lua` 的常量表，客户端 → 服务端 / 双向）**：`murdoku/ready` `murdoku/place` `murdoku/clear` `murdoku/submit` `murdoku/accuse` `murdoku/solved` `murdoku/save` `murdoku/restore` `murdoku/sync` `murdoku/settle`；接收侧是 `main.lua` 的 `Murdoku.on_signal(name, payload)`（还能收到 `murdoku/next_level`）。
- **存档键（自定义变量）**：`murdoku/save/<关卡id>`（落子与笔记）· `murdoku/recent` · `murdoku/progress` · `clue_scroll`（**已无用但字段不能随手删**，老存档里可能有它）。
- 适配层接口里有 `save(key,value)/load(key)/signal_emit/signal_on`；`save` 第三参 `opts` 必须与真适配器签名一致（否则离线假适配器测不出真实行为）。`[我核] lua/engine_adapter.lua:21-23,126-129`

### 2.7 适配层契约：14 个方法 + 一个可离线跑的桩

`[我核] lua/engine_adapter.lua:8-32`（147 行，是全工程唯一的引擎边界）：

```lua
M.interface = {
  "log", "create_control", "destroy_control", "set_property", "play_effect",
  "bind_input", "now", "after", "cancel", "save", "load",
  "signal_emit", "signal_on", "random_int",
}
```

⚠️ 全部是**方法**，调用方必须用冒号 `adapter:method(...)`；“用点号会把第一个实参当 self —— 这个坑已经踩过一次（render 崩在 create_control：node 变成 nil）”。`[实测] engine_adapter.lua:9-11`
桩 `M.new_stub()` 记录 `props/effects/input_handlers`，`Stub:click(id)` 可模拟点击，`Stub:advance(sec)` 推进定时器 ⇒ **整个操作框架可以脱离游戏跑**。`[我核] engine_adapter.lua:41-158`

---

## 3 真机验证过的坑（按"下次会赔多少时间"排序）

> 用法：**新框架的验收清单就从这张表抄**。每条给 现象 → 根因 → 正确做法 → 出处。

### 3.1 三道门控：少一道就「什么都没发生」

| # | 门控 | 后果 | 出处 |
|---|---|---|---|
| **P1** | 客户端控件必须放在**激活且可见的「客户端控件容器」**里 | 容器没激活/不可见 ⇒ 控件销毁、脚本停 | `[官方]` 4 篇教程同句；`docs/控件坐标表-1600x900.md:62-64` |
| **P2** | 容器必须勾**「显示常驻光标」**（`showCursor`） | 派发条件 = 任一祖先容器 `showCursor===true`；不勾 ⇒ 界面画得再对，**点哪儿都没反应** | `[实测]` `docs/控件坐标表-1600x900.md:66-82`（模拟器实现里挖出、真机症状对上） |
| **P3** | `OnInit` 里必须 `script:EnableUpdate(true)` | 不开 ⇒ `OnInit/OnStart` 都正常、日志正常，但 **`OnUpdate` 一次都不执行**（计时不动、惰性重试不发生） | `[实测]` `entry_client_script.lua:126-142`、`docs/控件坐标表-1600x900.md:84-96` |
| **P4** | 文本显示需要**奇匠等级**（【自定义文本外显】） | 等级不够 ⇒ 文本框不显示内容，按钮/图片不受影响。等级 2 已达标 | `[官方＋实测]` `docs/API-四方对照.md:511-521` |

### 3.2 「点不动」与显隐所有权（本项目头号病，反复发作）

| # | 坑 | 根因与正确做法 | 出处 |
|---|---|---|---|
| **P5** | **只藏不显**⇒"第一次进关墙/门/家具不画，进第二关再回来就有了" | `hide_kids()` **递归**藏子控件且只藏不显；`cell.*` 被藏 ⇒ 连坐全部子控件。修法：每个子控件都要回答「**谁把'该亮'重放一遍**」，且重放必须挂在**真每帧**的 `on_tick`（脏标记驱动） | `[实测]` `docs/显隐所有权与排查纪律.md:9-23`、`docs/技术架构.md:868-901` |
| **P6** | **前缀藏会吃掉合法例外** ⇒ 选关屏「白卡在、点哪儿都没反应」 | `PREFIX` 里的 `"hit."` 同时命中选关屏自己的 `hit.select.*` ⇒ 命中层每帧被 `visible=false`；而命中层本来就隐形，**只在"点击无反应"上可观察**。规矩：**前缀只许给"整族都该藏"的族用**，出现例外就列具体 id | `[实测]` `ui_controller.lua:1964-1992`｜⚠️ 同形：`"cell."` 前缀 + `"home."` 带点匹配不到 `home` 自己（`ui_controller.lua:1928-1941`）|
| **P7** | 容器 `SetVisible(false)`→`(true)` 后**子控件收不到点击**（射线没恢复） | 推测=引擎把它标成不可交互且不恢复 ⇒ 项目改为**两个屏幕容器恒为可见**，屏幕隔离完全交给"按前缀藏子控件" | `[推断＋实测]` `ui_controller.lua:2041-2058` |
| **P8** | 中间容器必须**允许光标事件穿透** | `ClientUIContainerControl.disableCursorEventPassthrough`（是否屏蔽区域内点击穿透）；体检全绿却点不动就是它 ⇒ 脚本自动把该字段关掉 | `[官方＋实测]` `docs/API-四方对照.md:482-492` |
| **P9** | `raycastTarget` 必须打开；**新控件默认点不动** | 脚本靠 `AddCursorEventListener` 收点击，关掉就点不动 ⇒ `create_control` 里必须 `rearm_raycast`；收敛后不再整树重扫 | `[实测]` `engine_adapter_qianxing.lua:876-887,3228-3319` |
| **P10** | **一个 id = 一个引擎控件 = 一份事件** | 同一 `id` 在规划里声明两次 = 两个控件实体但只有一颗真控件、一次绑定 ⇒ 屏幕上多一颗、事件自相矛盾（`action.back` 在 `topbar` 与 `right` 各声明一次）。修法：**布局层就不许重复 id**（`lua tools/check_layout_dupes.lua`），或明确"认领者赢" | `[实测]` `docs/技术架构.md:125-127`、`docs/Lua坑位清单.md:52-56,256-279` |
| **P19** | **藏了就忘**：主动藏掉的控件必须清掉"我发过 true"的账本 | 否则下一个"该显示"的帧被判"没变"⇒ 永不再发 true ⇒ **永久隐藏**（`clues.grid` 曾整片死掉）。首帧分支与"之后每次"分支**都**要 `forget_visible` | `[实测]` `ui_controller.lua:7603-7621,7645-7662` |
| **P20** | 规划里**不要放"存档里没有"的控件** | 渲染循环对"计划有、存档无、有创建路"的节点调 `create_control` ⇒ **每试玩一次 +4 个控件** ⇒ 累积成编辑器「GUID 重复」。规则：**规划只写"存在于存档"的控件** | `[实测]` `docs/回执-things创建全过程与运行时创建根源-2026-10-18.md:100-134,159-172` |

### 3.3 控件树 / 模板 / 图层

| # | 坑 | 正确做法 | 出处 |
|---|---|---|---|
| **P11** | `find()` 命中缓存 = **陈旧句柄**（传送/重连/容器隐藏重显后控件重建，旧句柄 nil：`GetChild`=nil、`GetChildren`=空） | **可行路径只有** `game.GetClientUIRoots()` + 限深树遍历 + 世代缓存；作废时**连命中缓存一起清** | `[官方＋实测]` `engine_adapter_qianxing.lua:546-562`、`docs/技术架构.md:163-169`、`docs/仓库注意事项.md:120-122` |
| **P12** | 模板/图层顺序**由模板里的同级位置决定，不看创建顺序，且互相覆盖** | 显式规划层序（底图最底 → 家具 → 墙 → 门 → 标记 → 笔记最上），实现技巧=按规划列表**倒序** `SetAsFirstSibling()`；`SetSiblingIndex` 越大越靠上 | `[官方＋实测]` `docs/API-四方对照.md:523-537` |
| **P13** | 预设按钮的"外显样式"指**按钮自己**的外观（底图/悬停/按下），**不是"子控件能不能画"**；未被状态节点引用的子控件照常渲染 | 别为了让子控件显示去编辑器里点四个状态节点（那次误读导致返工） | `[实测·已更正]` `docs/API-四方对照.md:462-480` |
| **P14** | 图片有**两个不同概念**：控件级「基础/拉伸」vs 素材级「普通/三宫格/九宫格」 | 「基础不填充、拉伸才填充」；拉伸只有部分素材支持 ⇒ 别依赖它，用 `localScaleX/Y` 缩放基础图；`SetImage` 的 imageId **必须是整数**（`and/or` 表达式会静默变成字符串 ⇒ 真机 `integer expected, got string`） | `[官方＋实测]` `docs/API-四方对照.md:494-509,539-549` |
| **P15** | **「贴格」只能对格子自己用** | `_fit_child_to_cell` 缺 `is_cell_id(id)` 闸门 ⇒ `select.card.N`（无 `face` 子控件）的 `target` 落到卡片自己 ⇒ `SetAnchoredPosition(0,0)` ⇒ **四张选关卡叠成一张** | `[实测]` `docs/技术架构.md:746,759-761` |

### 3.4 坐标系（三套并存，是错位的温床）

- **编辑器画布**：`1600×900`，**左下原点、Y 向上**；锚点 Min=Max=`0.5,0.5`、pivot=`0.5,0.5` ⇒ 表里的「位置(中心)」是**绝对坐标，与父级无关**。`[repo文档] docs/控件坐标表-1600x900.md:46-51`
- **脚本运行时**：`Get/SetAnchoredPosition` 在**无父级时以画布左下为原点，有父级时是与父层级中心的相对偏移**。`[官方] docs/api-cache/mhtakr07vej4.txt:1317-1322`（被 `docs/控件坐标表-1600x900.md:53-56` 引用）
- **设计空间**：`1920×1080`、左上原点、Y 向下，×5/6 换算到画布。`docs/控件坐标表-1600x900.md:12-14`
- **P16 真实事故**：同一个 `root` 底下**混着两套坐标系** —— `gen_home.mjs` 写设计空间原值、`add_button.mjs` 写画布空间相对根中心 ⇒ 「照文档算出来的位置与引擎实际表现对不上」。**结论：位置不许信存档**，`settle.btn` 自 v242 起改由脚本每帧显式 `SetSizeDelta` + `SetAnchoredPosition`。`[实测] docs/转换器-gil到模拟器存档.md:15-27`
- **口径已坐实**：写入 `size=(217,60) pos=(-642,-380)` ⇒ 回读 `(217.0,60.0)(-642.0,-380.0)`（真机探针），模拟器侧 `(689,166)` 正是"父级中心=(800,450)"算出来的 ⇒ **读写同一坐标系（相对父级中心）**。`[实测] docs/技术架构.md:500-504`
- ⚠️ **`SetAnchoredPosition` 曾刻意不加"读回守卫"**（因为读回语义未坐实，加错的方向是"该对齐却不写"）——现在可以加了。`docs/技术架构.md:448-459`

### 3.5 存档 / 流程 / 模拟器边界

| # | 坑 | 正确做法 | 出处 |
|---|---|---|---|
| **P17** | 写 `.gil` 报"✅ 成功"而**输出与输入逐字节相同**（等于什么都没写）；根因 = `encodeMsg` 把 `#503` 无条件当裸 ID 子列表，冻结了 **96%** 的树（2785 个 `#503` 里 2720 个是真消息） | 写盘**必须走 `writeGil()`** 五道闸；验收**必须从磁盘重读** | `[实测]` `tools/gil/gilread.mjs:33-60`、`docs/工具目录.md:6-28` |
| **P18** | **`roundtrip` 逐字节一致 ≠ 改动生效**（"冻结整棵树"也能往返一致）；`diff_fields` 按位置比对 ⇒ 增删记录会报大量连带差异 | 判据分类型：改值用 `expectDiffs:N`；增删用**记录数 + 结构性断言** | `[实测]` `docs/工具目录.md:21-26`、`docs/仓库注意事项.md:116-118` |
| **P21** | 递归改写嵌套 `#504` ⇒ **整屏控件消失**（`root` 还在，子控件运行时全部解析不到） | 同一字段号在不同层级含义不同 ⇒ **只改记录自己的顶层 `#504`**；「12 条记录却改了 36 处」这个计数本身就是红灯 | `[实测]` `docs/事故-整屏控件消失-2026-10-15.md:26-54` |
| **P22** | 克隆控件**只改顶层 `#501`** ⇒ 编辑器报「GUID 重复」 | `.gil` 里 GUID 存**三处**：`/#501`、`/#502/#11/#501`、`/#505/#503/#504/#4` ⇒ 用 `remap_ids.mjs` **全量改号** | `[实测]` `docs/回执-things创建全过程…-2026-10-18.md:83-98` |
| **P23** | **导入 `.gil` 时游戏用的是存档里【内嵌】的那份脚本** | 出货前跑 `embed_script.mjs`；每次导入/. 新建关卡都会换 `external_lua_file` 目录，里面**常躺着旧脚本** ⇒ 测试前必须重跑同步 | `[实测]` `README.md:40-55`、`docs/交付流程-打包与同步.md:87-98` |
| **P24** | **模拟器有、官方没有**的 API：`GetUIPos`（控件上没有）、`kind` 字段、`AddKeyEventListener` 不校验参数、`instantiate` 会复制子控件、点击不受 `disableCursorEventPassthrough` 影响 | **控件方法名一律回 `docs/api-cache/mhtakr07vej4.txt` 核对，别照模拟器抄**；模拟器绿 = 只证明脚本内部链路 | `[实测]` `docs/API-四方对照.md:430-440,482-492,415-428` |
| **P25** | 模拟器**没有可实例化的客户端控件模板** ⇒ `cell.*` 全部实例化失败 ⇒ 棋盘/网格类证据只能靠键盘+日志断言 | 我们的翻页 UI **应当避免"运行时实例化大量控件"**，改成编辑器摆好的固定页面，模拟器才验得动 | `[实测]` `docs/技术架构.md:862-866` |

### 3.6 Lua 语言级（新框架一定会踩）

- **跨帧记忆不能放函数内 `local`**（每次进函数就被重置）⇒ 用**文件级 `local`**；实测退化成 41.8 笔/帧就是这条。`[实测] docs/Lua坑位清单.md:17-25`
- **`%d` 收到浮点会抛** `number has no integer representation`；`game.GetUICanvasSize()` 真机返回**浮点** ⇒ 打引擎数字一律 `%s` / `%.2f`；`OnInit` 里任何诊断都不许有能力中断启动（adapter 先建、诊断各自 pcall）。`[实测] entry_client_script.lua:27-36`、`docs/Lua坑位清单.md:93-96`
- **四类坑要四种判据**：`end` 数量 → `luac -p`；`end` **配对错位** → `check_nesting --depths`；作用域/未定义 → `selene`；编码/BOM → `check_encoding.mjs`。只用一种必然漏。`[实测] docs/Lua坑位清单.md:100-108`
- **字段名不对上 ⇒ 静默走兜底**（生产侧写 `action`、消费侧读 `node.event.action` ⇒ 任何"没接上事件"的控件都被当成"点了某一格"）。`[实测] docs/Lua坑位清单.md:233-242`
- **真机是 Lua 5.3，本机 `luac` 是 5.4** ⇒ 语法闸门一律用 `tools/lua53check/check.cjs`。`[repo文档] docs/技术架构.md:702`

---

## 4 可复用工具清单（**这是本次最值钱的可移交资产**）

### 4.1 `.gil` 工具链（都在 `qianxing-murdoku/tools/`，纯 Node，无依赖）

| 工具 | 做什么 | 输入 → 输出 | 命令 | 危险度 |
|---|---|---|---|---|
| `gil/gilread.mjs` | **`.gil` 读写公共库**：纯 JS protobuf 解析 + 信封处理。导出 `readGil`（→ `{recs,byName,tree,pack}`）、`asIdList`、`findChildListTop`、`stateBlocks`、`pairOf/pairValue`、`ID_LO/ID_HI`、`KNOWN_TYPES` | `.gil` 字节 → 内存树 | `import { readGil } from './gil/gilread.mjs'` | 只读 ✓ |
| `gil/gilwrite.mjs` | **写 `.gil` 的唯一安全通道** `writeGil(g, OUT, {label, expectDiffs\|expectRecs, assert})`：编码→字节 / 输出必须≠输入 / 落盘 / **从磁盘重读** / 往返闸门 / 字段级 diff；另导出 `diffTrees` `loadTree` `findScriptLeaf` `markerOf`。CLI：`node tools/gil/gilwrite.mjs diff <A.gil> <B.gil>` | 内存树 → `.gil` | 见上 | 低（自带五道闸） |
| `gil/inspect_gil.mjs` | **只读出货体检**：记录数/体长/尾、内嵌脚本构建标记、`clue` 4 个状态块逐块位置与尺寸、`assets` 子控件名单、`row.*` 子列表条数；导出 `assetsReport(g)` / `assertAssets(g)` 供别的工具 import | `.gil` → stdout / `--json out.json` | `node tools/gil/inspect_gil.mjs "存档/455-….gil" [--json o.json] [--quiet]` | 只读 ✓ |
| `gil/roundtrip.mjs` | 解析→重编码→与原字节逐字节比较（可行性闸门）。**故意不复用被检对象** | `.gil` | `node tools/gil/roundtrip.mjs <file>` | 只读 ✓ |
| `gil/check_names.mjs` | **名字对账**：脚本按名字要用的控件 vs 存档里实际有的；分类成 🟢脚本会自动建 / 🔵已被换代 / 🔴真缺 | `.gil` | `node tools/gil/check_names.mjs <存档.gil> [--strict]` | 只读 ✓ |
| `gil/embed_script.mjs` | 把 `dist/client_script.lua` **叠进 `.gil`**（导入即最新，堵 P23） | `.gil` + 脚本 → `.gil` | `node tools/gil/embed_script.mjs --in= --out= [--expect-marker=vNNN]` | 低 |
| `gil/remap_ids.mjs` | 克隆体**全量改号**（三处 GUID），堵 P22 | `.gil` → `.gil` | `node tools/gil/remap_ids.mjs …` | 中 |
| `sim/gil_to_save.mjs` | **`.gil` → `qxqy-simulator-save` JSON**（模拟器可直接 `qxqy_studio_load`）。逐条判定几何口径并 WARN；剔除 20 条引擎脚手架；`scripts:[]`（`.gil` 里没有可读的 Lua 映射 ⇒ 不编造） | `.gil` → `.save.json`（**只读输入**，只写新 JSON） | `node tools/sim/gil_to_save.mjs --in="371-….gil" --out="tools/sim/out/371.save.json" [--check=参考存档] [--geom=auto\|canvas\|design]` | 不改 `.gil` ✓ |
| `gil/_probe_innergids.mjs` / `_probe_dupids.mjs` / `_probe_offscreen.mjs` / `_probe_plan_vs_gil.mjs` / `list_names.mjs` | 撞号排查五件套 + 出界普查 + 规划对账 + 名字列举 | `.gil` | 直接跑，看输出 | 只读 ✓ |

**`.gil` 信封（多处一致，`[实测]`）**：`[u32BE 文件长−4][u32BE 1][u32BE 806][u32BE 2(=gil)][u32BE 体长]` + protobuf 体 + 尾 4 字节 `0x00000679`（**必须原样保留**）。
体的结束位置必须用头里的体长（`20+体长`），**不能用文件长度**（末尾还有 4 字节尾）。`docs/千星存档-gil格式.md:51-64`、`tools/qx/gia.mjs:94-110`

### 4.2 `.gia`：**有解析能力，没有写入通路**

- ❌ **`qianxing-murdoku` 里没有任何 `.gia` 解析器/转换器**。`[我核]` grep `tools/**` 全部 `.mjs/.lua/.ps1`：只有 `gil_to_save.mjs:465-471` 出现 `giaRelatedGuids`/`giaInfoIndex`/`giaRaw` 三个 **save-JSON 字段名**，没有任何读 `.gia` 的代码。
- ✅ **有 `.gia` 生成器**：`tools/qx/gia.mjs` —— 但它**不生成 UI 布局**：它构造 scene JSON（`{canvas, elements[], meta}`，图元仅 `ellipse/rectangle/triangle/four_point_star/five_point_star/ring/textbox/image`，**没有 hexagon**）→ `POST https://qx.070077.xyz/api/export/gia` body `{scene, giaGroupName}` → 收 `.gia`。用途是「外部资产 → 转存 → 素材库」，即**素材**而非界面。`[实测] tools/qx/gia.mjs:1-30,60-92`
- ✅ **`.gia` 与 `.gil` 共用同一容器信封，唯一头差别是 offset 12**：`.gil = 2`、`.gia = 3`。`[实测] tools/qx/gia.mjs:16-19,99-110`｜本次复核：教程 GIA 头 = `[171818, 1, 806, 3, 171798]`，尾 = `00 00 06 79`，`20+171798+4 = 171822 = 文件长` ✓ `[我核]`
- ✅ **本会话工作区已有可用的 `.gia` 解析链**（Lead 侧，不是三仓的）：`workspace/qxqy-ui-system/tools/pb.mjs`（无 schema 依赖的 wire-format 读写）、`gia_head.mjs`（信封探测）、`gia_inspect.mjs`（按 `_gia_schema.proto` 解 `Root/GraphUnit/UiControlGroup/ContentWrapper`）、`gia_raw.mjs`、`gia_unit.mjs`。schema 出处 = `qianxing-murdoku/tools/sim/out/_gia_schema.proto`（插件内嵌模式转录）。
- ⚠️ **`.gia` 体的外层与 `.gil` 完全不同**：`.gil` 顶层是 `#9` 组（`#501` 根 id / `#502` 扁平记录表 / `#503`）；`.gia` 顶层是 `Root{graph=1, accessories=2, filePath=3, gameVersion=5}`，控件记录住在 `GraphUnit.ui = 19` 里。**控件记录层（`ContentWrapper` 的 501/502/503/504/505）两级同构**，所以解析可复用 `gilread` 的记录判据。`[我核]`

### 4.3 教程 GIA 实测结构 —— 我们建模的**命名蓝本**（本次直接测量）

`node workspace/qxqy-ui-system/tools/gia_head.mjs "qianxing-murdoku/assets/教程UI系统_翻页单击活动样式.gia"` + 一次 `pb.mjs` 直解：

- 信封：`[171818,1,806,3,171798]`，尾 `0x00000679`；顶层字段 **119** 个；`filePath` 字段里写着 `教程模版v1.3_提醒了部分字段无需翻译.gia`，`gameVersion = "6.7.0"`。`[我核]`
- `Root.graph = 4`：`[玩家]教程节点图`（无 ui）· `发送信号`（无 ui）· **`[教程悬浮交互页]教程？教程！`（ui，3 条记录）** · **`[教程悬浮交互页]教程角落`（ui，4 条记录）**。`[我核]`
- `Root.accessories = 113`：`which` 分布 `12×1 / 14×1 / 15×111`；name 分布（**这就是"翻页单击活动"的控件清单**）：
  `翻页按钮×36` `图片×34` `(null)×11` `角落×4` `教程-被选中×3` `禁用状态素材组×2`，其余各 1：`交互页关闭按钮` `圆圈` `教程切换页签` `教程-未被选中` `切换翻页状态页签` `左侧翻页按钮` `右侧翻页按钮` `教程模式切换页签` `单击触发按钮` `默认状态素材组` `悬浮状态素材组` `按下状态素材组` `界面动效` `教程文案_文本视窗` `教程文案_文本框` `标题` `副标题` `线条` `背景板` `重置内容页签` `教程内容页签` `监听信号` `向服务器节点图发送信号`。`[我核]`
- **结论（建模意图，非字节推断）**：官方「翻页单击活动」= **背景板 + 标题/副标题 + 内容页签（文本视窗）+ 左/右翻页按钮（各带默认/悬浮/按下/禁用四态素材组）+ 关闭按钮 + 界面动效**，页签另有「切换翻页状态页签 / 教程模式切换页签 / 重置内容页签」三种角色。我们的 Screen 框架应当**直接对齐这套命名与角色**。
- ⚠️ **别把它当"可导入的界面模板"**：它是**资产/模板库**（`.gia` = 元件/实体/技能/道具/节点图的导入导出），控件记录只挂在两个 UI unit 下（3 条 / 4 条），其余 111 条是**素材组与模板定义**。`which` 的具体语义**未解出，不猜**。`[官方] docs/千星存档-gil格式.md:14-19`（`.gia` = 资产、`.gil` = 整关存档）

---

## 5 复用裁决

### 5.1 ✅ 直接抄 / 小改就抄（省 5000+ 行重造）

| 复用什么 | 为什么 |
|---|---|
| `lua/engine_adapter.lua` 的**接口契约 + 离线 stub**（147 行） | 已经是"引擎边界"的正解：`{log, create/destroy_control, set_property, play_effect, bind_input, now, after, cancel, save, load, signal_emit, signal_on, random_int}`；stub 能在桌面 Lua 跑通整个操作框架。**新框架保留同形接口即可复用全部离线测试思路** |
| `Adapter:find/sub` + **世代缓存 + 负缓存 TTL + `invalidate_lookups(why,{keep_bindings})`** | 这是全项目最贵的两次优化（5217→几十次/帧的树遍历），且已把"命中缓存陈旧句柄"的坑填好；重写必再踩一次 |
| `Adapter:create_control` 的**"先找、找不到才实例化 + 改名 + 读回核对 + invalidate + rearm_raycast"** 五连 | 每一步都对应一条真机坑（P9/P22/§2.5 表 2/3） |
| `layout_plan()` 的 **`push({id,kind,parent,rect,…})` 数组 + 显式 `visible`**，以及 `render` 的**差集 + `forget_visible` 账本** | 这是"声明式 UI"的雏形，改成"**每屏一个 Screen 对象**"即可；账本机制（P19）必须原样保留 |
| `bind_input` 的**四种光标监听 + `live_event()` 认领者赢 + `on_input` 单向出口** | 事件模型已被真机反复校准（长按 0.28、dt 用引擎时钟、`src_id` 必传） |
| **工具链整套**：`gilread/gilwrite/inspect_gil/roundtrip/check_names/embed_script/gil_to_save` | 见 §4.1；这是唯一能安全改 `.gil` 的通道，重写风险极高 |
| **数据与 UI 分离的范式**：`murdoku_core.lua` 零引擎依赖 + `core:view()` 快照 + `levels/init.lua` 注册表 | 换游戏也照用：规则层永不知道"控件"三个字 |

### 5.2 ❌ 别抄（都是已知病灶，抄了就继承 bug）

| 别抄 | 为什么（证据） |
|---|---|
| `self.screen` **三值 + `apply_screen_hide` 前缀名单** | 单向藏 / 前缀吃掉合法例外 / 容器显隐影响射线 —— 至少 4 个真机 bug 出自这里（P5/P6/P7/P19） |
| `main.lua` **每 30 帧直遍历格子子控件**的第三条写者通道 | 周期性覆盖别的写者；但**又不能整段删**（它负责点亮底图 + `x` 的 70% 是用户要求）⇒ 新框架**从一开始就不要造这种旁路写者** |
| **"规划里有、存档里没有"的节点**（`OBJECT_PALETTE` 那类） | 每次试玩运行时创建 ⇒ GUID 撞（P20） |
| **8012 行单文件 controller**（注释占打包体积 67.3%） | 上机包 1,347,962 B 里 906,668 B 是注释；单文件还让"块配错位"这类 bug 只能靠 `check_nesting --depths` 抓。新项目应**分文件 + 打包时剥注释** |
| **网格视窗（grid）那整套**：`RefreshItems` 回调 + `GetItemIndex` + `_grid_base` 判错 + 双套绑定 | 绑定链在"越界提前 return"处整段不跑（`docs/网格视窗-光标事件-实现测绘.md:148-201`）；且模拟器**没有可实例化的模板**根本验不动（P25）。翻页 UI 用**固定页面 + 显隐**就够，不需要列表项实例化 |
| `ruler.*` / `clue.N.*` / `tray.*` / `selbtn.*` 这些**遗留族** | 已被换代但代码还在（`docs/仓库注意事项.md:101-103`）；`is_legacy_clue_id` 黑名单是活补丁 |
| **照模拟器的 API 表写代码** | `GetUIPos`、`kind`、`instantiate 复制子控件`、`disableCursorEventPassthrough` 不生效 —— 模拟器比真机宽，写下去真机静默失败（P24） |
| **手改 `.gil` 做结构改动**（克隆/删控件/改父子） | 整屏消失事故（P21）+ GUID 三处（P22）。**界面能用手搭就手搭**；必须改时只走 `writeGil()` + 出界/撞号/名字三套探针 |

### 5.3 🔨 必须新写（现有代码里**没有**）

1. **Screen 注册表与生命周期**：`screens[id] = {root_container, on_enter, on_leave, on_update, default}`；`set_screen(id)` 是**唯一**的切屏入口，也是**可见性的唯一权威**（顺带把 `invalidate_lookups` / `rearm_raycast` / `rearm_cursor` 收口到一处）。现有工程用 `screen` 字段 + 4 处换代调用点手工对齐。
2. **每屏一个真实的容器父级**，且容器**恒为可见**（P7），屏幕切换只改"哪棵子树被登记为当前屏"。
3. **页面翻页语义**：`page_index / page_count / on_page_change`，以及"页签 + 左右按钮"的角色表（对齐教程 GIA 的 `左侧翻页按钮 / 右侧翻页按钮 / 切换翻页状态页签 / 重置内容页签`）。
4. **显隐所有权表落成代码**（而不是文档）：一个属性一个写者，越权写直接 `assert`/日志（`docs/显隐所有权与排查纪律.md:65-76` 那张表就是规格）。
5. **`.gia` → 设计稿的只读管线**：已有 `pb.mjs + gia_inspect.mjs` 可读；**写 `.gia` 无通路**（唯一已知生成器是外部 API，只产素材）⇒ 不要承诺"生成 .gia 布局"。

---

## 6 文档间矛盾与「引用前必核」清单

| # | 矛盾/风险 | 两处出处 | 我的处理建议 |
|---|---|---|---|
| 1 | `docs/技术架构.md:8` 自陈 §一模块表/§三控件表**仍按 v226 口径**，而文件头写"最后更新 v280" | 同文件 :7-8 vs :52 | **行数/控件表不可直接引用**，要用重新生成的 `lua tools/dump_layout.lua` → `docs/控件坐标表-1600x900.md` |
| 2 | 「保存模板修改会影响本体」**未证实** | `docs/模板本体与实例-查证.md:110-113,158-169`：官方 6 篇文档全无保存语义；只有结构间接支持 | 只改本体（`itemPrefabIndex` 指向的那份）**是推断**；要动存档布局必须做单变量真机三步实验（同文件 :173-190 给了实验设计） |
| 3 | `gilread.mjs` 的 `rec.parentId` 是**递归取第一个 `#504`** ⇒ 根级记录被误报 `parentId=1` | `docs/模板本体与实例-查证.md:59-63` vs `docs/千星存档-gil格式.md:168`（父子靠顶层 `#504` 显式表达） | **父引用一律读顶层**；不要信任 `rec.parentId` |
| 4 | 模拟器/离线绿灯的分量 | `docs/Lua坑位清单.md:194-201`：模拟器绿只证明脚本内部链路；本项目**反复出现**"离线全通、真机不通"（`docs/技术架构.md:774`） | 每条结论写死"这一步证明了什么 / 没证明什么" |
| 5 | `.gia` 到底能不能"用" | `docs/千星存档-gil格式.md:14-19`（`.gia` = 资产）vs `entry_client_script.lua:218-232`（`.gia` 走外部资产→转存→素材库） | 两个用途都对：`.gia` 能进**素材**，进不了**界面布局**；界面只能靠 `.gil`（编辑器）或运行时实例化 |

**未验证、不猜**：`.gia` 的 `which` 槽位语义；教程 GIA 里 111 条 `which=15` 记录各自对应哪种控件模板；`#1073741844` 到底是什么（`docs/模板本体与实例-查证.md:197` 明确标"未证实"）。

---

## 7 给 Lead 的开工建议（一句话版）

> 抄 `engine_adapter` 的**契约与 stub** + `find/世代缓存/负缓存` + `push 数组 + render 差集 + forget_visible 账本` + 整套 `.gil` 工具链；
> **重写**「屏幕」这一层（注册表 + 每屏容器 + 单一可见性权威 + 翻页语义），并把 `docs/显隐所有权与排查纪律.md` 的所有权表**变成代码约束**；
> 界面**在编辑器里搭**（不克隆/不删控件），Lua 只做显隐 / 换图 / 换字 / 事件；
> `.gia` 只当**命名与角色蓝本**读，别指望生成它。
