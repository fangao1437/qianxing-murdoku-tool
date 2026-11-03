--[[==========================================================================
  90_entry.lua —— 生命周期入口（官方 §1 的 7 个固定名字）

  只做三件事：
    1. 把「脚本上下文」找出来（不同宿主下 script 可能是全局、也可能作为回调实参）
    2. 保证 boot **只跑一次**（OnInit 与 OnStart 谁先来都能启动）
    3. OnUpdate 只把 dt 转给 Input.tick（长按计时），其余工作都是事件驱动的
  官方没有承诺 OnInit/OnStart 的先后顺序（见 docs/api-notes.md §未查到 1），
  所以这里不依赖顺序。
--]]--

local M = {}

local function script_ctx(...)
  return Util.script_ctx(...)
end

function M.OnInit(...)
  Util.log("LIFECYCLE OnInit")
  App.boot(script_ctx(...))
end

function M.OnStart(...)
  Util.log("LIFECYCLE OnStart")
  if not App.booted then App.boot(script_ctx(...)) end
end

function M.OnEnable(...)
  Util.log("LIFECYCLE OnEnable")
  if not App.booted then App.boot(script_ctx(...)) end
end

function M.OnUpdate(dt, ...)
  -- 兜底：若宿主没有调 OnInit/OnStart，第一帧仍然把框架启动起来
  if not App.booted then App.boot(script_ctx(...)) end
  App.tick(dt)
end

function M.OnLevelUpdate(dt)
  -- 关卡逐帧（受时停影响）：本框架不依赖它，保持空实现，避免宿主报缺失
end

function M.OnDisable() end
function M.OnDestroy() end

return M
