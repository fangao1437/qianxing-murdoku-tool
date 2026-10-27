--[[----------------------------------------------------------------------------
  tools/qx/probe_assets_selftest.lua —— 离线验证 probe_assets.lua **能跑、且能分辨两种结构**

  为什么要它：probe_assets.lua 是要用户**手工挂到真机**上跑的，不能第一次跑就报错、
  更不能"两种情况打一样的日志"（那种探针等于没有）。
  这里用**假 game 环境**把两个剧本各跑一遍，断言日志里出现**互斥**的判据。

  ⚠️ 关键：探针内部用文件级 local（`done` / `elapsed`）做"只 dump 一次"的门闩
     ⇒ **每个剧本都必须重新 loadfile 一次**，否则第二个剧本会因为 `done=true` 直接空转
     （第一版就是这么假绿的 —— 见下面 note 里那句）。

  跑法：lua tools/qx/probe_assets_selftest.lua
  只读：不碰任何工程文件、不写盘。
----------------------------------------------------------------------------]]--

local here = (arg and arg[0]) or "tools/qx/probe_assets_selftest.lua"
local dir = here:gsub("probe_assets_selftest%.lua$", "")
if dir == "" then dir = "./" end

local out = print                       -- 先留真身（下面要劫持 _G.print）
local pass, fail = 0, 0
local function ok(cond, label, detail)
  if cond then pass = pass + 1; out("  [PASS] " .. label)
  else fail = fail + 1; out("  [FAIL] " .. label .. (detail and ("   " .. tostring(detail)) or "")) end
end

-- ── 收日志 ────────────────────────────────────────────────────────────────
local logs = {}
local function has(pat)
  for i = 1, #logs do if logs[i]:find(pat, 1, true) then return logs[i] end end
  return nil
end
_G.print = function(...)
  local t = {}
  for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end
  logs[#logs + 1] = table.concat(t, " ")
end

-- ── 假控件 ────────────────────────────────────────────────────────────────
local function ctrl(name, kids)
  local c = { name = name, kind = "container", active = true, visible = true }
  c.__kids = kids or {}
  c.GetChildren = function() return c.__kids end
  c.GetChild = function(_, k)
    for _, x in ipairs(c.__kids) do if x.name == k then return x end end
    return nil
  end
  return c
end

local function build_root(with_assets)
  local kids = {
    ctrl("modal"), ctrl("toolbar"), ctrl("right"), ctrl("topbar"),
    ctrl("home"), ctrl("stage"), ctrl("clues"),
  }
  if with_assets then
    table.insert(kids, ctrl("assets", {
      ctrl("portrait.A"), ctrl("portrait.B"), ctrl("portrait.V"), ctrl("portrait.D"),
    }))
  end
  return ctrl("root", kids)
end

-- ── 每个剧本：装环境 + **重新加载**探针（拿到全新的 done/elapsed 上值）────────
local init_fn, update_fn
local function scenario(with_assets)
  local rootCtrl = build_root(with_assets)
  local roots = { ctrl("111"), rootCtrl }
  _G.game = {
    GetClientUIRoots = function() return roots end,
    FindClientUIRoot = function(n)
      for _, r in ipairs(roots) do if r.name == n then return r end end
      return nil
    end,
    PrintClientUITree = function() _G.print("[game] PrintClientUITree") end,
  }
  _G.script = { object = rootCtrl }

  logs = {}
  local chunk, lerr = loadfile(dir .. "probe_assets.lua")
  if chunk == nil then return nil, "加载失败：" .. tostring(lerr) end
  local okr, rerr = pcall(chunk)
  if not okr then return nil, "顶层 chunk 抛错：" .. tostring(rerr) end
  -- 探针把 OnInit/OnUpdate 定义成**全局**，重新 loadfile 会覆盖成带新上值的那一份
  init_fn, update_fn = _G.OnInit, _G.OnUpdate
  if type(update_fn) ~= "function" then return nil, "OnUpdate 不是函数" end
  return true
end

local function drive()
  -- 探针在 OnUpdate 里等 2 秒才 dump
  return pcall(function() update_fn(2.5) end)
end

-- ════ 剧本 A：assets 就在 root 下面（= 编辑器截图 / .gil 的结构）══════════
out("== 剧本 A：assets 是 root 的直接子控件（编辑器截图的结构）==")
local aok, aerr = scenario(true)
ok(aok, "A：环境装载 + 探针加载", aerr)
if aok then
  local okA, errA = drive()
  ok(okA, "A：OnUpdate 不抛错", errA)
  ok(has("直接子控件里【有】assets = true") ~= nil,
    "A：报出「本根的直接子控件里有 assets」", has("直接子控件里【有】assets"))
  ok(has("r:GetChild('assets') = true") ~= nil, "A：报出 r:GetChild('assets') = true")
  ok(has("assets=true") ~= nil, "A：深搜报出 assets=true", has("assets=true"))
  ok(has("portrait.V=true") ~= nil, "A：深搜报出 portrait.V=true")
  ok(has("FindClientUIRoot('assets') = false") ~= nil,
    "A：FindClientUIRoot('assets') = false（assets 不是 UI 根 ⇒ 官方接口也救不了）")
  ok(has("FindClientUIRoot('111') = true") ~= nil, "A：FindClientUIRoot('111') = true（同名单根能取到）")
else
  out("  （A 装载失败，跳过 A 的断言）")
end

-- ════ 剧本 B：assets **不在运行时树里**（= 真机症状）════════════════════
out("\n== 剧本 B：assets 根本不在运行时树里（真机症状）==")
local bok, berr = scenario(false)
ok(bok, "B：环境装载 + 探针加载", berr)
if bok then
  local okB, errB = drive()
  ok(okB, "B：OnUpdate 不抛错", errB)
  ok(has("直接子控件里【有】assets = false") ~= nil,
    "B：报出「本根的直接子控件里【没有】assets」", has("直接子控件里【有】assets"))
  ok(has("r:GetChild('assets') = false") ~= nil, "B：报出 r:GetChild('assets') = false")
  ok(has("assets=false") ~= nil, "B：深搜报出 assets=false", has("assets=false"))
  ok(has("portrait.V=false") ~= nil, "B：深搜报出 portrait.V=false")
  ok(has("r:GetChild('home') = true") ~= nil,
    "B：同一份日志里 home 仍然 true（对照组成立 ⇒ 不是「整棵树都读不到」）")
else
  out("  （B 装载失败，跳过 B 的断言）")
end

out(string.format("\n%d passed, %d failed", pass, fail))
os.exit(fail == 0 and 0 or 1)
