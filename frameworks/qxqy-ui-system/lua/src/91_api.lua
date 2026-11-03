--[[==========================================================================
  91_api.lua —— 对外 API 门面（Tutorial）

  为什么有这么一层：本框架要能被**两种形态**使用，且行为一致。

  形态 A（standalone，当前交付形态）：
      整份 bundle 挂在一个控件上，引擎按固定名字调用 OnInit/OnStart/OnUpdate…
      ⇒ bundle 末尾把 7 个生命周期注册成全局函数。

  形态 B（module，并入关卡主脚本时）：
      主脚本已经有自己的 OnInit/OnUpdate，**不能再抢全局回调**；
      ⇒ 不注册任何全局生命周期，只暴露全局 `Tutorial`：
          local T = Tutorial.install({ root_name = "tutorial.root", keys_enabled = false })
          -- 在主脚本自己的 OnStart/OnUpdate 里转发：
          T.OnStart(); T.OnUpdate(dt)

  为什么并入主脚本是推荐做法（而不是给教程单独建一个脚本映射）：
    · 独立脚本是**独立的 Lua 环境**，教程读不到关卡的 Lua 状态表；
      只能走 `script:Invoke`（要拿目标 scriptMappingId —— 每次重新导入都要校准）
      或服务端信号（联机 ≥100ms）。教程与关卡的实时联动会被迫异步。
    · 两套脚本各自注册光标/按键监听 ⇒ 谁来"认领"同一次 Esc 由渲染顺序决定，无法在一处裁决。
    · 控件索引、生命周期恢复（传送/断线会销毁全部客户端控件）、构建与交付都会翻倍。
  什么时候才值得独立映射：教程要**运行时实例化多份**（各自独立状态）、要独立发布复用、
  或要在没有关卡脚本时也能跑。三条都不满足就别拆。
--]]--

local M = {}

-- 默认值：与 App.config 同名键合并（只在 install 时覆盖，不破坏 standalone 行为）
M.defaults = {
  root_name = "app.root",
  keys_enabled = true,
  auto_open = true,
  start_page = nil,
  log_prefix = "[ui]",
  signals = nil,        -- nil = 用 App.config.signals
  buttons = nil,        -- nil = 用 App.config.buttons
  hud = nil,            -- nil = 用 App.config.hud
}

local installed_api = nil

-- 把一组配置合并进 App.config（nil 值跳过）
local function merge_config(cfg)
  if type(cfg) ~= "table" then return end
  for k, v in pairs(cfg) do
    if v ~= nil and k ~= "log_prefix" then
      App.config[k] = v
    end
  end
end

-- 安装：合并配置 → 打日志前缀 → 立刻 boot 一次（引擎侧通常已经能取到控件树）
-- 返回 api 表；重复调用返回同一个 api（幂等）
function M.install(cfg)
  if installed_api ~= nil then
    Util.log("Tutorial.install 已安装，忽略重复调用")
    return installed_api
  end
  merge_config(M.defaults)
  merge_config(cfg)
  if type(cfg) == "table" and type(cfg.log_prefix) == "string" then
    Util.set_prefix(cfg.log_prefix)
  end

  local api = {}
  installed_api = api
  local ctx = (type(cfg) == "table" and cfg.script) or Util.script_ctx()

  ---------------------------------------------------------------- 生命周期 --
  api.OnInit = function(...) App.boot(ctx or Util.script_ctx(...)) end
  api.OnStart = function(...) if not App.booted then App.boot(ctx or Util.script_ctx(...)) end end
  api.OnUpdate = function(dt) App.tick(dt) end
  api.OnEnable = function(...) if not App.booted then App.boot(ctx or Util.script_ctx(...)) end end
  api.OnDisable = function() end
  api.OnDestroy = function() end

  -------------------------------------------------------------------- 动作 --
  -- 关/开界面（不入参 = 用 App.config.auto_open 的屏）
  api.hide = function() Screen.close() return true end
  api.show = function(page_id)
    local s = Screen.current() or Screen.list()[1]
    if s == nil then return false end
    if Screen.current_id() ~= s.id then Screen.open(s.id) end
    if page_id ~= nil then Pager.jump(s, page_id, { notify = true }) end
    return true
  end
  api.is_open = function() return Screen.current_id() ~= nil end
  api.act = function(action) return App.act(action, "api") end
  api.state = function() return App.state() end
  api.diag = function() return App.diag() end
  api.set_title = function(t) return App.set_title(t) end
  api.set_body = function(t) return App.set_body(t) end
  api.register_reset = function(page_id, fn) return App.register_reset(page_id, fn) end
  api.print_tree = function() Engine.print_tree() end

  -- 供主脚本在 OnStart/OnEnable 里显式转发（若它不想用 api.OnStart）
  api.boot = function(...) return App.boot(ctx or Util.script_ctx(...)) end

  Util.log("Tutorial.install root=%s keys=%s", tostring(App.config.root_name), tostring(App.config.keys_enabled))
  App.boot(ctx)
  return api
end

function M.api()
  return installed_api
end

function M.installed()
  return installed_api ~= nil
end

return M
