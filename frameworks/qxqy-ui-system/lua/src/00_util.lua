--[[==========================================================================
  00_util.lua —— 基础工具（无引擎依赖，纯函数）

  约定：
    · 所有模块都是「局部表 + return M」，由 tools/build_bundle.mjs 拼成单文件
      lua/main.lua 后挂到 app.root 上运行（单文件是为了绕开 require 导入根的
      路径风险；源码仍然分模块，见 docs/tech-architecture.md）。
    · 日志统一前缀，方便在试玩日志里 grep：`[ui]`。
--]]--

local M = {}

M.PREFIX = "[ui]"

-- 日志前缀可改（并入主脚本时用调用方的前缀，便于在同一份日志里区分模块）
function M.set_prefix(p)
  if type(p) == "string" and p ~= "" then M.PREFIX = p end
end

-- 找"脚本上下文"（官方《客户端控件API文档》§5(1) 的 script 字段）：
--   ① 全局 script；② 回调实参里第一个 table。找不到返回 nil（信号监听会降级跳过）
function M.script_ctx(...)
  local g = rawget(_G, "script")
  if g ~= nil then return g end
  for i = 1, select("#", ...) do
    local v = select(i, ...)
    if type(v) == "table" then return v end
  end
  return nil
end

function M.log(fmt, ...)
  local s = select("#", ...) > 0 and string.format(fmt, ...) or tostring(fmt)
  print(M.PREFIX .. " " .. s)
end

function M.warn(fmt, ...)
  local s = select("#", ...) > 0 and string.format(fmt, ...) or tostring(fmt)
  -- printerr 不阻断运行（官方：日志 print/printerr 均可）
  printerr(M.PREFIX .. "!" .. " " .. s)
end

function M.clamp(v, lo, hi)
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

function M.round(v)
  return math.floor(v + 0.5)
end

-- 数组按 id 查下标：pages[i].id == id
function M.index_of(list, id)
  for i = 1, #list do
    if list[i].id == id then return i end
  end
  return nil
end

function M.count(list)
  if type(list) ~= "table" then return 0 end
  local n = 0
  for _ in pairs(list) do n = n + 1 end
  return n
end

-- 稳定的键名排序后 join，用于 diag 去抖（避免每次打印顺序不同）
function M.keys_sorted(t)
  local ks = {}
  for k in pairs(t or {}) do ks[#ks + 1] = tostring(k) end
  table.sort(ks)
  return ks
end

function M.join(list, sep)
  local out = {}
  for i = 1, #list do out[i] = tostring(list[i]) end
  return table.concat(out, sep or ",")
end

-- 前缀匹配：`tab.p1` 命中前缀 "tab."
function M.starts_with(s, prefix)
  return type(s) == "string" and string.sub(s, 1, #prefix) == prefix
end

return M
