--[[----------------------------------------------------------------------------
  tools/bench_client_perf.lua —— 客户端每帧成本探针（**只读**，不改任何状态）

  形状照抄上游模拟器的 studio/scripts/bench-play-perf.mjs
  （https://github.com/1475505/miliastra-beyond-simulator，GPL-3.0），
  换成**真机客户端脚本**这一侧要量的东西：boot / avg / max / 每帧调用数。

  为什么要有它（而不是继续用 tests/grid_cost.lua）：
    grid_cost.lua 量的是「**调用了多少次**」（离线、假引擎、口径固定），
    这个文件量的是「**真机上到底花了多少毫秒**」—— 同一件事在两个层面。
    两者互补，不是替代：次数能在离线回归里钉死，毫秒只有真机能给。

  ── 两个模式（同一个文件，自动选）────────────────────────────────────────────
    A. 真机模式：脚本跑在千星客户端里（存在全局 `game` / `script`）
       ⇒ 量真实引擎原语的耗时 + 真实 OnUpdate 回调节奏。
    B. 自检模式：直接 `lua tools/bench_client_perf.lua`
       ⇒ 用文件末尾那个**最小假引擎**把整套探针跑一遍，证明
         「探针本身能跑、计时与统计的算法对」。**这一模式的数字不代表真机**，
         它只回答一个问题：这份探针是不是坏的。

  ── 量什么 ───────────────────────────────────────────────────────────────────
    boot   ：从 Init 到第一帧能跑之间的准备耗时（ms）
    avg    ：每次 step 的平均耗时（ms/step）
    max    ：单次 step 的最坏耗时（ms）—— 卡顿看的是这个，不是 avg
    steps/s：每秒能推多少次 step
    每帧调用数：`GetChildren` / `SetAnchoredPosition` / `SetVisible` 等引擎原语
                在**一帧里**被调了几次（探针自己计数，不改控件语义）

  ── 参数（不传就走默认）──────────────────────────────────────────────────────
    lua tools/bench_client_perf.lua [frames] [fanout] [depth]
      frames  量多少帧（默认 300）
      fanout  每个容器挂几个子控件（默认 8）
      depth   树有几层（默认 3）
    真机上用 `script:GetParam("bench_frames")` 之类覆盖（见 BENCH 表注释）。

  ── 规矩 ─────────────────────────────────────────────────────────────────────
    · **只读**：不对任何控件的位置/显隐/文字做**持久的**写入。
      需要压测写路径时，写进去的值与读回的值相同（幂等），且只在探针自己
      造的容器上做 —— 不碰工程里已有的控件。
    · 计数是**包一层再还原**（见 wrap_counter），跑完一定还原，
      不会把探针的计数留在引擎对象上。
    · 没有 os.clock / os.time（客户端脚本没有 os 库）⇒ 计时只能用
      `game` 提供的时间源；取不到就退化成「帧数 + 调用数」，并**明说取不到**。
----------------------------------------------------------------------------]]--

local BENCH = {
  frames = 300,   -- 量多少帧
  fanout = 8,     -- 每容器子控件数
  depth = 3,      -- 树深度
  warmup = 30,    -- 预热帧数（不计入统计）
  budgetMs = 16.7, -- 一帧的预算（60fps）；只用来给结论分档，不做判定
}

-- 命令行覆盖（真机上没有 arg，取不到就保持默认）
local function apply_args(a)
  if type(a) ~= "table" then return end
  BENCH.frames = tonumber(a[1]) or BENCH.frames
  BENCH.fanout = tonumber(a[2]) or BENCH.fanout
  BENCH.depth = tonumber(a[3]) or BENCH.depth
end
apply_args(arg)

-- 真机上引擎不认 arg，改用编辑器里配的脚本变量（有就覆盖）
local function apply_params(s)
  if s == nil or s.GetParam == nil then return end
  local ok, v = pcall(function() return s:GetParam("bench_frames") end)
  if ok and tonumber(v) then BENCH.frames = tonumber(v) end
  ok, v = pcall(function() return s:GetParam("bench_fanout") end)
  if ok and tonumber(v) then BENCH.fanout = tonumber(v) end
  ok, v = pcall(function() return s:GetParam("bench_depth") end)
  if ok and tonumber(v) then BENCH.depth = tonumber(v) end
end

local out = print

----------------------------------------------------------------------------
-- 计数：包一层 → 记账 → **还原**
--   为什么必须还原：这些方法挂在引擎给的控件对象上，探针跑完把计数闭包
--   留在那儿，之后工程自己的调用也会被算进去（上一轮量的就不再是上一轮）。
----------------------------------------------------------------------------
local counters = {}
local wrapped = {}
local function wrap_counted(obj, name)
  if obj == nil or type(obj[name]) ~= "function" then return false end
  local orig = obj[name]
  wrapped[#wrapped + 1] = { obj = obj, name = name, orig = orig }
  obj[name] = function(...)
    counters[name] = (counters[name] or 0) + 1
    return orig(...)
  end
  return true
end

local function restore_all()
  for i = #wrapped, 1, -1 do
    local r = wrapped[i]
    r.obj[r.name] = r.orig
  end
  wrapped = {}
end

----------------------------------------------------------------------------
-- 计时源
--   客户端脚本**没有 os 库**，只能借引擎的时间。两种都试：
--     ① game.GetServerTime / game.GetTime（毫秒，各版本名字不一）
--     ② 兜底：用 dt 累加（只能证明"跑了多少帧"，证明不了"花了多久"）
----------------------------------------------------------------------------
local function make_clock(g)
  local fn = nil
  if g ~= nil then
    for _, k in ipairs({ "GetTime", "GetServerTime", "GetRealTime", "GetFrameTime" }) do
      if type(g[k]) == "function" then fn = g[k] break end
    end
  end
  if fn ~= nil then
    return function()
      local ok, v = pcall(fn)
      if ok and tonumber(v) then return tonumber(v) end
      return nil
    end, "engine"
  end
  -- 兜底：拿不到引擎时间就返回 nil，调用方据此降级
  return function() return nil end, "none"
end

----------------------------------------------------------------------------
-- 统计
----------------------------------------------------------------------------
local function new_stats()
  return { n = 0, sum = 0, max = 0, min = math.huge }
end

local function push(st, ms)
  st.n = st.n + 1
  st.sum = st.sum + ms
  if ms > st.max then st.max = ms end
  if ms < st.min then st.min = ms end
end

local function avg(st)
  if st.n == 0 then return 0 end
  return st.sum / st.n
end

----------------------------------------------------------------------------
-- 造一棵测试树（**只用探针自己实例化的控件**）
--   优先用工程已验证存在的 game.InstantiateClientUIControl（见
--   docs/API-四方对照.md）；取不到就退化成"只量引擎读原语"，并明说。
----------------------------------------------------------------------------
local function build_tree(g, root_ctrl, fanout, depth)
  local made = {}
  if root_ctrl == nil then return made end
  local function grow(parent, level)
    if level > depth then return end
    local kids = nil
    pcall(function() kids = parent:GetChildren() end)
    if type(kids) ~= "table" then return end
    for i = 1, fanout do
      local child = kids[i]
      if child == nil then break end
      made[#made + 1] = child
      grow(child, level + 1)
    end
  end
  grow(root_ctrl, 1)
  return made
end

----------------------------------------------------------------------------
-- 主流程
----------------------------------------------------------------------------
local function run(env)
  local g, s = env.game, env.script
  local clock, clock_kind = make_clock(g)

  out("======================================================================")
  out("  千星客户端每帧成本探针 bench_client_perf")
  out("======================================================================")
  out(string.format("  模式        : %s", env.mode))
  out(string.format("  计时源      : %s%s", clock_kind,
    clock_kind == "none" and "（拿不到引擎时间 ⇒ 只报帧数与调用数，毫秒一栏为 n/a）" or ""))
  if env.mode == "自检" then
    out("  ⚠️ 自检模式的数字来自**假引擎**，只证明探针没坏，**不代表真机**。")
  end
  out(string.format("  参数        : frames=%d fanout=%d depth=%d warmup=%d",
    BENCH.frames, BENCH.fanout, BENCH.depth, BENCH.warmup))
  out("")

  ---------------------------------------------------------------------------
  -- boot：从"找到根控件"到"树建好"
  ---------------------------------------------------------------------------
  local t0 = clock()
  local root = nil
  if g ~= nil then
    for _, k in ipairs({ "FindClientUIRoot", "GetClientUIRoots" }) do
      if type(g[k]) == "function" then
        local ok, v = pcall(g[k], env.root_name)
        if ok then
          root = (type(v) == "table" and v[1]) or v
          if root ~= nil then break end
        end
      end
    end
  end
  local nodes = build_tree(g, root, BENCH.fanout, BENCH.depth)
  local t1 = clock()
  local bootMs = (t0 and t1) and (t1 - t0) or nil

  out(string.format("  [boot] 找到根控件 + 展开测试树：%s   节点数=%d",
    bootMs and string.format("%.2f ms", bootMs) or "n/a", #nodes))

  if #nodes == 0 then
    out("  ⚠️ 没拿到任何控件 —— 真机上请把本脚本挂到一个有子控件的容器上（见 docs/真机搭建与运行指南.md）。")
  end

  ---------------------------------------------------------------------------
  -- 帧循环
  --   两趟分开跑，**不要混**：
  --     ① 计时趟：不包任何东西 ⇒ 数字是纯粹的每帧成本，没有包装开销污染。
  --     ② 计数趟：包住**整棵树**的方法 ⇒ 次数才是"一帧里整棵树被访问了多少次"。
  --   混在一起跑的话，包了 584 个节点 × 6 个方法 = 3500 个闭包，
  --   光这层开销就能把 avg 抬高一截，量出来的"每帧成本"是探针自己的成本。
  ---------------------------------------------------------------------------
  local dt = 1 / 30
  local frames = 0

  local function one_frame()
    -- 只做**读**：遍历整棵树读位置/显隐。
    -- 这是每一帧真实会发生的账（enforce_hidden_subtrees / render 都在做同一类事）。
    local acc = 0
    for i = 1, #nodes do
      local c = nodes[i]
      local x, y = nil, nil
      pcall(function() x, y = c:GetAnchoredPosition() end)
      if x ~= nil then acc = acc + x + (y or 0) end
      pcall(function() return c:GetChildren() end)
    end
    return acc
  end

  -- ① 计时趟
  local st = new_stats()
  for i = 1, BENCH.warmup do one_frame() end
  for i = 1, BENCH.frames do
    local before = clock()
    one_frame()
    local after = clock()
    if before and after then push(st, after - before) end
    frames = frames + 1
  end

  -- ② 计数趟（预热 + 定量，把包装开销挡在计时之外）
  counters = {}
  restore_all()
  local wrappedNames = {}
  for i = 1, #nodes do
    local c = nodes[i]
    for _, name in ipairs({ "GetChildren", "GetChild", "GetAnchoredPosition",
                            "GetVisible", "SetVisible", "SetAnchoredPosition" }) do
      if type(c[name]) == "function" then
        if i == 1 then wrappedNames[#wrappedNames + 1] = name end
        wrap_counted(c, name)
      end
    end
  end
  out(string.format("  [wrap] 计数趟已包住整棵树（%d 节点）；方法：%s",
    #nodes, #wrappedNames > 0 and table.concat(wrappedNames, ", ") or "（无）"))

  local countFrames = math.min(BENCH.frames, 60) -- 计数趟不用跑满，60 帧就够稳定
  for i = 1, BENCH.warmup do one_frame() end
  for i = 1, countFrames do one_frame() end

  local perFrame = {}
  for k, v in pairs(counters) do
    perFrame[k] = v / math.max(1, countFrames)
  end

  out("")
  out("  ── 结果 ──────────────────────────────────────────────────────────")
  if st.n > 0 then
    out(string.format("  [step] avg=%.3f ms/step   max=%.3f ms   min=%.3f ms   %.0f steps/s",
      avg(st), st.max, st.min, 1000 / math.max(0.0001, avg(st))))
    local ratio = avg(st) / BENCH.budgetMs
    local verdict = ratio < 0.25 and "宽裕" or (ratio < 0.6 and "够用" or "吃紧")
    out(string.format("         占 60fps 预算(%.1fms)的 %.1f%% ⇒ %s", BENCH.budgetMs, ratio * 100, verdict))
  else
    out("  [step] n/a（拿不到引擎时间；下面只报调用数）")
  end
  out(string.format("  [frames] 共 %d 帧（另有 %d 帧预热未计入）", frames, BENCH.warmup))
  out("  [per-frame] 每帧调用数：")
  local keys = {}
  for k in pairs(perFrame) do keys[#keys + 1] = k end
  table.sort(keys)
  if #keys == 0 then
    out("      （无 —— 没包到任何方法）")
  else
    for _, k in ipairs(keys) do
      out(string.format("      %-22s %8.1f 次/帧   （合计 %d 次）", k, perFrame[k], counters[k]))
    end
  end

  -- 还原：不许把计数闭包留在引擎对象上
  restore_all()
  out("")
  out("  [restore] 已还原被包的方法，探针未对任何控件做持久写入。")
  out("======================================================================")
  return true
end

----------------------------------------------------------------------------
-- 假引擎（**只用于自检模式**）
--   目的只有一个：证明这份探针能跑、计时与统计的算法对。
--   刻意做得很小 —— 它不是模拟器，不承担任何"像不像引擎"的责任。
----------------------------------------------------------------------------
local function mock_env()
  local function new_ctrl(name, kids)
    local c = { _name = name, _kids = kids or {}, _vis = true, _x = 0, _y = 0 }
    function c:GetChildren() return self._kids end
    function c:GetChild(i) return self._kids[i] end
    function c:GetAnchoredPosition() return self._x, self._y end
    function c:SetAnchoredPosition(x, y) self._x, self._y = x, y end
    function c:GetVisible() return self._vis end
    function c:SetVisible(v) self._vis = v and true or false end
    return c
  end
  -- 3 层 × 8 叉 ≈ 584 个节点的树
  local function build(level)
    local kids = {}
    for i = 1, 8 do
      kids[i] = (level < 3) and build(level + 1) or new_ctrl("leaf" .. level .. "." .. i)
    end
    return new_ctrl("c" .. level, kids)
  end
  local root = build(1)

  -- 假的时钟：每次调用 +0.05ms，让 avg/max 有确定值可断言
  local now = 0
  local game = {
    GetTime = function() now = now + 0.05 return now end,
    FindClientUIRoot = function() return root end,
    GetClientUIRoots = function() return { root } end,
  }
  return { game = game, script = nil, root_name = "root", mode = "自检" }
end

----------------------------------------------------------------------------
-- 入口
----------------------------------------------------------------------------
local function detect_real_env()
  local g = rawget(_G, "game")
  if type(g) ~= "table" then return nil end
  return { game = g, script = rawget(_G, "script"), root_name = "root", mode = "真机" }
end

local real = detect_real_env()
if real ~= nil then
  apply_params(real.script)
  run(real)
else
  local fake = mock_env()
  run(fake)
  out("")
  out("（当前没有 game 全局 ⇒ 走的是自检模式。真机上请把本文件作为客户端脚本挂到容器控件上。）")
end
