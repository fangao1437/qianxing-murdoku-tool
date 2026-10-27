--[[----------------------------------------------------------------------------
  tools/qx/probe_assets.lua —— 一次试玩定案：`assets` / `portrait.*` 到底在不在运行时树里

  为什么要有这个文件（2026-10-08 追查 task-1 用）：
    工程里那几条探针都在**大 pcall 里静默失败**（见 lua/ui_controller.lua:4188 那个 pcall，
    以及 :4256/:4260 的 `_search` 前向声明缺陷）⇒ 真机日志里"一行都没打出来"。
    这个探针**每一步各自 pcall、每步都打一行** ⇒ 哪一步失败日志里看得见。

  它要回答的 4 个问题（**每条都会打出来**）：
    ① `game.GetClientUIRoots()` 有几个根？每个根叫什么？**每个根的直接子控件名单里有没有 `assets`？**
       ← 这一条直接定案"assets 是不是不在运行时树里"。
    ② `game.FindClientUIRoot("assets")` / `("root")` / `("111")` —— 官方的"按名找 UI 根"。
    ③ 从根起**自己深搜**整棵树（官方 GetChildren/GetChild），看 `assets` / `portrait.V` 在不在。
    ④ `adapter` 那条路返回的 `root` **是不是就是 UI 根**（名字/子控件数对不对得上）——
       因为一旦 `find("root")` 返回了**另一个同名节点**，`GetChild("assets")` 与 `GetChildren()` 都会假失败。

  用法（与 tools/probe_ui_tree.lua 同一套路）：
    1. 千星沙箱 → 客户端脚本资源管理器 → 新建脚本映射 → 指向**本文件**
    2. 把该映射挂到**任意一个客户端控件**的「脚本」页签（挂 root 上最贴近现场）
    3. 试玩 → 日志勾选「客户端脚本」→ 把 `[qxprobe]` 开头的行全部发给开发者

  约束：只读。不 SetActive / 不 SetVisible / 不 SetImage / 不建控件 / 不销毁控件。
        只调 `game.*` 与控件的只读字段/`GetChildren`/`GetChild`，全部包 pcall。
----------------------------------------------------------------------------]]--

local P = "[qxprobe] "

-- 安全取值：读不到就返回 default
local function S(fn, default)
  local ok, v = pcall(fn)
  if ok and v ~= nil then return v end
  return default
end

local function name_of(c)
  if c == nil then return "(nil)" end
  return S(function() return tostring(c.name) end, "?")
end

local function kids_of(c)
  local k = S(function() return c:GetChildren() end, nil)
  if type(k) ~= "table" then return nil end
  return k
end

-- 深度优先：在 node 的子树里找 name，返回 true/false + 走过的节点数
local function deep_has(node, want, maxDepth, budget)
  local seen = 0
  local found = false
  local function walk(c, d)
    if c == nil or found or d > maxDepth or seen > budget then return end
    seen = seen + 1
    if name_of(c) == want then found = true return end
    local ks = kids_of(c)
    if ks == nil then return end
    for i = 1, #ks do walk(ks[i], d + 1) end
  end
  walk(node, 0)
  return found, seen
end

local done = false
local elapsed = 0

function OnInit()
  if print then print(P .. "OnInit") end
end

function OnStart()
  -- 控件树比脚本晚约 0.5 秒就绪，统一放到 OnUpdate 里等
end

function OnEnable() end
function OnDisable() end

function OnUpdate(dt)
  if done then return end
  elapsed = elapsed + (dt or 0)
  if elapsed < 2.0 then return end          -- 等 2 秒，确保容器与控件都建完
  done = true

  if print == nil then return end
  print(P .. "========== 开始（等待 " .. string.format("%.2f", elapsed) .. " 秒）==========")

  -- ── 0) 官方整树 dump（按父子层级写日志）────────────────────────────────
  do
    local has = (game ~= nil and game.PrintClientUITree ~= nil)
    print(P .. "0) game.PrintClientUITree 存在 = " .. tostring(has)
      .. (has and "（下面引擎自己会打一整棵层级树，请一并复制）" or ""))
    if has then pcall(function() game.PrintClientUITree() end) end
  end

  -- ── 脚本宿主：脚本自己挂在哪 ────────────────────────────────────────────
  do
    local obj = S(function() return script.object end, nil)
    print(P .. "script.object = " .. name_of(obj)
      .. "  （kind=" .. tostring(S(function() return obj.kind end, "?")) .. "）")
    -- 从宿主往上爬 3 层（官方字段 parent）
    local cur = obj
    for up = 1, 3 do
      if cur == nil then break end
      local p = S(function() return cur.parent end, nil)
      print(P .. "   ↑" .. up .. " 父 = " .. name_of(p))
      cur = p
    end
    -- 宿主自己的直接子控件
    local ks = kids_of(obj)
    if ks ~= nil then
      local t = {}
      for i = 1, math.min(#ks, 40) do t[#t + 1] = name_of(ks[i]) end
      print(P .. "script.object 的直接子控件（" .. #ks .. "）：" .. table.concat(t, " | "))
      print(P .. "   ★ script.object:GetChild('assets') = " .. tostring(S(function() return obj:GetChild("assets") end, nil) ~= nil))
    else
      print(P .. "script.object 读不到 GetChildren（或不是控件）")
    end
  end

  -- ── 1) 全部 UI 根：名字 + 直接子控件名单（★ 定案这一条）────────────────
  local roots = S(function() return game.GetClientUIRoots() end, nil)
  local rn = 0
  if type(roots) == "table" then rn = S(function() return #roots end, 0) end
  print(P .. "1) game.GetClientUIRoots() 根数 = " .. tostring(rn))
  if type(roots) == "table" then
    for i = 1, rn do
      local r = roots[i]
      local ks = kids_of(r)
      local kn = (ks ~= nil) and #ks or -1
      print(P .. string.format("   根%d  name=%s  kind=%s  active=%s visible=%s  直接子控件数=%s",
        i, name_of(r),
        tostring(S(function() return r.kind end, "?")),
        tostring(S(function() return r.active end, "?")),
        tostring(S(function() return r.visible end, "?")),
        tostring(kn)))
      if ks ~= nil then
        local t, hasAssets = {}, false
        for k = 1, math.min(kn, 60) do
          local cn = name_of(ks[k])
          if cn == "assets" then hasAssets = true; cn = cn .. " ★★★←assets 在这里" end
          t[#t + 1] = cn
        end
        print(P .. "      子: " .. table.concat(t, " | "))
        print(P .. "      ★ 本根的直接子控件里【有】assets = " .. tostring(hasAssets))
      end
      -- 直接子控件按名取
      print(P .. "      r:GetChild('assets') = " .. tostring(S(function() return r:GetChild("assets") end, nil) ~= nil)
        .. "   r:GetChild('home') = " .. tostring(S(function() return r:GetChild("home") end, nil) ~= nil))
      -- 从本根深搜
      local hasA, seenA = deep_has(r, "assets", 6, 4000)
      local hasP, seenP = deep_has(r, "portrait.V", 6, 4000)
      print(P .. "      深搜（≤6 层，走过 " .. tostring(seenA) .. " 个节点）：assets=" .. tostring(hasA)
        .. "  portrait.V=" .. tostring(hasP) .. "（走过 " .. tostring(seenP) .. "）")
    end
  else
    print(P .. "   ✗ GetClientUIRoots 读不到（返回非表）")
  end

  -- ── 2) 官方的"按名找 UI 根" ────────────────────────────────────────────
  do
    local has = (game ~= nil and game.FindClientUIRoot ~= nil)
    print(P .. "2) game.FindClientUIRoot 存在 = " .. tostring(has))
    if has then
      for _, n in ipairs({ "root", "assets", "111", "home" }) do
        local got = S(function() return game.FindClientUIRoot(n) end, nil)
        print(P .. "   FindClientUIRoot('" .. n .. "') = " .. tostring(got ~= nil)
          .. (got ~= nil and ("（name=" .. name_of(got) .. "）") or ""))
      end
    end
  end

  -- ── 3) `find("root")` 那条路：返回的到底是不是 UI 根？──────────────────
  --    ★ 这是本次追查的关键怀疑：万一同名节点抢先命中，
  --      `GetChild("assets")` 与 `GetChildren()` 都会**假失败**。
  do
    local ad = S(function() return _G.__murdoku_debug and _G.__murdoku_debug.adapter end, nil)
    print(P .. "3) 工程适配器可用 = " .. tostring(ad ~= nil))
    -- 不依赖工程：自己按"从根起深搜"复刻一遍 find("root")，报告命中在哪
    if type(roots) == "table" then
      for i = 1, rn do
        local r = roots[i]
        local hitSelf = (name_of(r) == "root")
        local hit, where = false, nil
        local seen = 0
        local function walk(c, d)
          if c == nil or hit or d > 6 or seen > 4000 then return end
          seen = seen + 1
          if name_of(c) == "root" then hit = true; where = d; return end
          local ks = kids_of(c)
          if ks == nil then return end
          for k = 1, #ks do walk(ks[k], d + 1) end
        end
        walk(r, 0)
        print(P .. string.format("   根%d：自身就叫 root = %s ；子树里第一个 root 在深度 %s（走过 %d 个节点）",
          i, tostring(hitSelf), tostring(where), seen))
      end
    end
    if ad ~= nil then
      local r0 = S(function() return ad:find("root") end, nil)
      print(P .. "   adapter:find('root') = " .. name_of(r0)
        .. "  它的直接子控件数 = " .. tostring((function()
             local ks = kids_of(r0); if ks == nil then return "读不到" end return #ks end)()))
      local ks = kids_of(r0)
      if ks ~= nil then
        local t = {}
        for k = 1, math.min(#ks, 60) do t[#t + 1] = name_of(ks[k]) end
        print(P .. "   它的子: " .. table.concat(t, " | "))
      end
      -- 是不是就是某个 UI 根（按身份比）
      local same = "不是任何根"
      if type(roots) == "table" then
        for i = 1, rn do if roots[i] == r0 then same = "就是根" .. i end end
      end
      print(P .. "   ★ adapter:find('root') " .. same)
      -- 上爬找 assets
      local cur, got = r0, nil
      for up = 0, 4 do
        if cur == nil then break end
        local a = S(function() return cur:GetChild("assets") end, nil)
        if a ~= nil then got = up break end
        cur = S(function() return cur.parent end, nil)
      end
      print(P .. "   ★ 从 find('root') 上爬找 assets：命中于第 " .. tostring(got) .. " 层（nil=4 层内没找到）")
      local a = S(function() return ad:find("assets") end, nil)
      print(P .. "   adapter:find('assets') = " .. tostring(a ~= nil))
      local pv = S(function() return ad:find("portrait.V") end, nil)
      print(P .. "   adapter:find('portrait.V') = " .. tostring(pv ~= nil))
    end
  end

  -- ── 4) ★★ 对照组（**必须同一次、同一时刻**）──────────────────────────────
  --   用户提的判据：如果 `modal` 也取不到 ⇒ 是"创建路径"问题；`modal` 取得到 ⇒ 不是。
  --   ⚠️ 这个对照**必须同一次、同一时刻做**。分开两次测会被"句柄过期 / 树被重建"污染 ——
  --      已有的两份证据就是这样：`modal` ✓ 来自**开局**那次回读，`assets` ✗ 来自**调色板查找**那次，
  --      两者时刻不同，**不构成对照**。
  --   同时给出"陈旧句柄判据"：`adapter:find("root")` 靠**命中缓存**返回（缓存从不校验是否还活着），
  --      若它已不是当前的根 / 子控件数为 0，而 `GetClientUIRoots()` 的根是好的 ⇒ 就是句柄过期。
  do
    local CAND = { "assets", "modal", "clues", "topbar", "home", "right", "toolbar",
                   "stage", "tpl.cell", "portrait.V", "row.1.1" }
    local function probe_list(tag, node)
      if node == nil then
        print(P .. "4) " .. tag .. " = **nil（拿不到句柄）**")
        return
      end
      local ks = kids_of(node)
      local kn = (ks ~= nil) and #ks or -1
      local parts = {}
      for i = 1, #CAND do
        parts[#parts + 1] = CAND[i] .. "="
          .. tostring(S(function() return node:GetChild(CAND[i]) end, nil) ~= nil)
      end
      print(P .. "4) " .. tag .. "  直接子控件数=" .. tostring(kn))
      print(P .. "      " .. table.concat(parts, "  "))
    end
    if type(roots) == "table" then
      for i = 1, rn do
        probe_list("GetClientUIRoots()[" .. i .. "] name=" .. name_of(roots[i]), roots[i])
      end
    end
    local ad4 = S(function() return _G.__murdoku_debug and _G.__murdoku_debug.adapter end, nil)
    if ad4 ~= nil then
      local cached = S(function() return ad4:find("root") end, nil)
      probe_list("adapter:find('root') ← ★ 走命中缓存，可能是陈旧句柄", cached)
      local same = "**不是任何根**"
      if type(roots) == "table" then
        for i = 1, rn do if roots[i] == cached then same = "就是根" .. i end end
      end
      print(P .. "4) ★ 陈旧句柄判据：adapter:find('root') " .. same
        .. "（若它子控件数=0 / 取不到 assets，而上面的根取得到 ⇒ **句柄过期**，"
        .. "对应 docs/assets取不到-追查.md §四 H8）")
    else
      print(P .. "4) 拿不到工程适配器（__murdoku_debug.adapter），跳过缓存句柄对照")
    end
  end

  print(P .. "========== 结束（把上面所有 [qxprobe] 行发出来即可定案）==========")
end

function OnLevelUpdate(dt) end
function OnDestroy() end
