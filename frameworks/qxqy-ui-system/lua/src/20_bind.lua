--[[==========================================================================
  20_bind.lua —— 控件索引层：名字 → 控件句柄

  为什么需要它：官方**没有**递归按名字查控件的接口，只有
    ctrl:GetChildren() / ctrl:GetChild(name) / ctrl:FindChild(path)
  （《客户端控件API文档》§13(2)），深层控件只能自己遍历建表。

  三条硬约束（来自真机教训 docs/repo-survey.md §2.3）：
    1. **不许缓存陈旧句柄**：传送/断线重连会销毁全部客户端控件（官方 §五.3）。
       所以索引带 generation；外部事件（信号、传送后）可调 Bind.invalidate()
       让下一次 get() 重建。
    2. **不许闭包捕获控件**：事件回调里一律 `Bind.get("btn.next")` 现查，
       控件重建后仍然指向活的那个。
    3. **查找要便宜**：一次 DFS 建表（每个名字只记一次，先出现者赢），
       后续 O(1)。禁止每帧遍历（既有工程实测 300 帧 7020 次 GetChildren）。
--]]--

local M = {}

local index = {}        -- name → ctrl
local order = {}        -- 建表顺序（便于 diag 与调试）
local generation = 0    -- 每次 rebuild +1
local built_from = nil  -- 建表根（用于诊断）

function M.get(name)
  if type(name) ~= "string" then return nil end
  return index[name]
end

function M.has(name)
  return index[name] ~= nil
end

function M.generation()
  return generation
end

function M.names()
  local out = {}
  for i = 1, #order do out[i] = order[i] end
  return out
end

-- 按前缀取名字（例如 "tab." → {"tab.p1","tab.p2"}），保持建表顺序
function M.names_with_prefix(prefix)
  local out = {}
  for i = 1, #order do
    local n = order[i]
    if Util.starts_with(n, prefix) then out[#out + 1] = n end
  end
  return out
end

-- 名字前缀后的短 id：`tab.p1` + "tab." → "p1"
function M.short_id(name, prefix)
  if type(name) ~= "string" then return nil end
  if Util.starts_with(name, prefix) then return string.sub(name, #prefix + 1) end
  return nil
end

function M.invalidate()
  index = {}
  order = {}
  built_from = nil
end

-- 一次 DFS 建表。`roots` 既可以是**数组**（推荐），也可以是单个控件（自动包装）。
-- 判别顺序（踩过坑）：运行时控件是 userdata、内部对象是 table，
--   而「数组」本身也是 table ⇒ **不能**用 `is_ctrl` 判断是不是单个控件，
--   要按「是不是数组」判断：连续编号 1..n 的 table 当数组，其余当单个控件。
-- 同名控件：**先出现者赢**（父在前、兄在前），并把重复项记进 M.duplicates 供 diag。
local function as_list(v)
  if v == nil then return {} end
  if type(v) ~= "table" then return { v } end        -- userdata 控件
  if v[1] ~= nil then return v end                   -- 数组
  if rawget(v, "GetChildren") ~= nil then return { v } end -- 控件对象（模拟器内部形态）
  if next(v) == nil then return v end                -- 空表
  return { v }
end

function M.rebuild(roots)
  M.invalidate()
  local list = as_list(roots)
  M.duplicates = {}
  local seen = {}
  local function walk(ctrl, depth)
    if not Engine.is_ctrl(ctrl) or depth > 32 then return end
    local name = Engine.name_of(ctrl)
    if name ~= nil and name ~= "" then
      if seen[name] then
        M.duplicates[#M.duplicates + 1] = name
      else
        seen[name] = true
        index[name] = ctrl
        order[#order + 1] = name
      end
    end
    for _, kid in ipairs(Engine.children(ctrl)) do walk(kid, depth + 1) end
  end
  for _, r in ipairs(list) do walk(r, 0) end
  generation = generation + 1
  built_from = list
  return generation
end

-- 找直接子控件（不建表场景用：例如给按钮挂事件前确认它属于这个屏）
function M.child(parent, name)
  return Engine.child(parent, name)
end

return M
