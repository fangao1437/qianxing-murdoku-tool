--[[----------------------------------------------------------------------------
  tools/probe_ui_tree.lua —— 控件树探针（单文件，直接映射即可运行）

  用途：把当前客户端控件树的「层级 + 名称 + 运行时ID + 模板索引」打进日志，
        用来确认：控件名称到底有没有生效、以及树的结构顺序。

  用法：
    1. 千星沙箱 → 客户端脚本资源管理器 → 新建脚本映射 → 指向**本文件**
    2. 把该映射挂到任意一个客户端控件的「脚本」页签
    3. 试玩 → 日志面板勾选「客户端脚本」→ 复制所有 [probe] 行发给开发者

  它不依赖工程的任何模块，单独跑，所以即使主脚本还没接好也能用。
----------------------------------------------------------------------------]]--

local function safe(fn, default)
  local ok, v = pcall(fn)
  if ok and v ~= nil then return v end
  return default
end

local function name_of(c)
  return safe(function() return c.name end, "?")
end

local function info(c)
  return string.format("name=%s id=%s prefab=%s active=%s visible=%s",
    tostring(name_of(c)),
    tostring(safe(function() return c.id end, "?")),
    tostring(safe(function() return c.prefabIndex end, "?")),
    tostring(safe(function() return c.activeInHierarchy end, "?")),
    tostring(safe(function() return c.visible end, "?")))
end

local function walk(c, path, depth)
  if c == nil then return end
  if print then
    print(string.format("[probe] %s%s  %s", string.rep("  ", depth), path, info(c)))
  end
  local kids = safe(function() return c:GetChildren() end, nil)
  if kids then
    for i = 1, #kids do
      walk(kids[i], path .. "/" .. i, depth + 1)
    end
  end
end

local function dump()
  if print then print("[probe] dtype=" .. tostring(game and game.GetDevice and game.GetDevice())) end
  if game and game.GetUICanvasSize then
    local w, h = game.GetUICanvasSize()
    if print then print(string.format("[probe] canvas=%sx%s", tostring(w), tostring(h))) end
  end

  -- 官方提供的树打印（会把整棵树按父子层级写进日志）
  if game and game.PrintClientUITree then
    pcall(function() game.PrintClientUITree() end)
  end

  -- 自己再走一遍，输出"路径 / 名称 / ID / 模板索引"
  if game and game.GetClientUIRoots then
    local roots = game.GetClientUIRoots()
    if print then print(string.format("[probe] roots=%d", roots and #roots or 0)) end
    if roots then
      for i = 1, #roots do walk(roots[i], tostring(i), 0) end
    end
  end
end

local dumped = false
local elapsed = 0

function OnInit()
  if print then print("[probe] OnInit") end
end

function OnStart()
  -- 控件可能比脚本晚一步就绪，放到 OnUpdate 里等一会儿再打
end

function OnEnable() end
function OnDisable() end

function OnUpdate(dt)
  if dumped then return end
  elapsed = elapsed + (dt or 0)
  if elapsed < 1.0 then return end     -- 等 1 秒，确保容器与控件都已创建
  dumped = true
  if print then print("[probe] ===== 控件树开始 =====") end
  dump()
  if print then print("[probe] ===== 控件树结束 =====") end
end

function OnLevelUpdate(dt) end
function OnDestroy() end
