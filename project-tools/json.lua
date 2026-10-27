--[[----------------------------------------------------------------------------
  tools/json.lua —— 极小 JSON 编码器（工具脚本共用）

  只处理本项目会用到的类型：table（数组/字典）、string、number、boolean、nil。
  中文直接按 UTF-8 原样输出（不用转义），换行/制表/控制字符会被转义。
----------------------------------------------------------------------------]]--

local M = {}

local function esc(s)
  s = tostring(s)
  s = s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
  s = s:gsub("[%z\1-\31]", function(ch) return string.format("\\u%04x", ch:byte()) end)
  return s
end

-- encode(value, indent) -> string
function M.encode(v, indent)
  indent = indent or 0
  local t = type(v)
  if v == nil then return "null" end
  if t == "boolean" then return v and "true" or "false" end
  if t == "number" then
    if v == math.floor(v) and math.abs(v) < 1e15 then return string.format("%d", v) end
    return tostring(v)
  end
  if t == "string" then return '"' .. esc(v) .. '"' end
  if t == "table" then
    local pad = string.rep("  ", indent)
    local pad2 = string.rep("  ", indent + 1)
    if #v > 0 then
      local parts = {}
      for i = 1, #v do parts[i] = pad2 .. M.encode(v[i], indent + 1) end
      return "[\n" .. table.concat(parts, ",\n") .. "\n" .. pad .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    if #keys == 0 then return "{}" end
    local parts = {}
    for _, k in ipairs(keys) do
      parts[#parts + 1] = pad2 .. '"' .. esc(k) .. '": ' .. M.encode(v[k], indent + 1)
    end
    return "{\n" .. table.concat(parts, ",\n") .. "\n" .. pad .. "}"
  end
  return "null"
end

-- 写文件（带换行）
function M.write_file(path, value)
  local f, err = io.open(path, "w")
  if not f then return nil, err end
  f:write(M.encode(value, 0))
  f:write("\n")
  f:close()
  return true
end

return M
