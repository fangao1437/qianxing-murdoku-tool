--[[----------------------------------------------------------------------------
  hello_min.lua —— 最小存活探针（不依赖本工程任何模块）

  它只回答一个问题：**这个关卡里，客户端脚本到底跑不跑？**

  用法：把它的内容当成 client_script.lua（**同一个映射、同一个文件名**），
        保存关卡 → 试玩 → 看 cell.1.1 / tray.A / board 的尺寸。

  判读：
    尺寸变成 420  → 客户端脚本机制正常 ⇒ 问题出在我们的主脚本（超长/加载失败）
    尺寸完全没变  → 这个关卡里客户端脚本压根没被执行 ⇒ 查挂载 / 容器 / 权限
--]]--

local function find_by_name(name)
  if game == nil or game.GetClientUIRoots == nil then return nil end
  local ok, roots = pcall(game.GetClientUIRoots)
  if not ok or type(roots) ~= "table" then return nil end
  local function walk(c, d)
    if c == nil or d > 12 then return nil end
    local n
    pcall(function() n = c.name end)
    if n == name then return c end
    local kids
    pcall(function() kids = c:GetChildren() end)
    if type(kids) == "table" then
      for i = 1, #kids do
        local hit = walk(kids[i], d + 1)
        if hit ~= nil then return hit end
      end
    end
    return nil
  end
  for i = 1, #roots do
    local hit = walk(roots[i], 1)
    if hit ~= nil then return hit end
  end
  return nil
end

local function mark(v)
  local names = { "cell.1.1", "tray.A", "board" }
  for i = 1, #names do
    local c = find_by_name(names[i])
    if c ~= nil and c.SetSizeDelta ~= nil then
      local ok = pcall(function() c:SetSizeDelta(v, v) end)
      if ok then return names[i] end
    end
  end
  return nil
end

function OnInit()
  mark(300)
  if print then print("[min] OnInit") end
end

function OnStart()
  mark(420)
  if print then print("[min] OnStart") end
end

function OnEnable() end
function OnDisable() end

local elapsed = 0
function OnUpdate(dt)
  elapsed = elapsed + (dt or 0)
  if elapsed > 1 then mark(420) end
end

function OnLevelUpdate(dt) end

function OnDestroy()
  if print then print("[min] OnDestroy") end
end
