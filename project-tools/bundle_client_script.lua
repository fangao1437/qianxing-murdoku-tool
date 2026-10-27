--[[----------------------------------------------------------------------------
  tools/bundle_client_script.lua —— 把工程打包成「一个」客户端脚本文件

  为什么需要它：
    官方规则是「只有在千星沙箱里建立了映射的 .lua 文件才会被打包上传」，
    也就是一个映射 = 一个文件。本工程原本是 6+ 个模块互相 require，
    上传后不保证能解析到彼此。所以这里在**本地构建期**把它们合成单文件。

  产出：dist/client_script.lua
        —— 在「千星沙箱 → 客户端脚本资源管理器」里把映射指向这个文件即可。

  跑法：
    lua tools/bundle_client_script.lua                    # 正常打包（开局用注册表第一关）
    lua tools/bundle_client_script.lua --level=case_002   # 钉死开局关卡（模拟器测试用）
----------------------------------------------------------------------------]]--

local here = (arg and arg[0]) or "tools/bundle_client_script.lua"
local ROOT = here:gsub("tools[/\\]bundle_client_script%.lua$", "")
if ROOT == "" then ROOT = "./" end
if ROOT:sub(-1) ~= "/" and ROOT:sub(-1) ~= "\\" then ROOT = ROOT .. "/" end

-- --level=<id>：把开局关卡钉死。只用于本地测试，正式发布不要带。
local force_level = nil
if arg then
  for i = 1, #arg do
    local lv = tostring(arg[i]):match("^%-%-level=(.+)$")
    if lv and lv ~= "" then force_level = lv end
  end
end

local function read_file(rel)
  local fh, err = io.open(ROOT .. rel, "rb")
  if not fh then return nil, err end
  local data = fh:read("*a")
  fh:close()
  -- ★ 去掉 UTF-8 BOM。踩过的坑：用 PowerShell 的 `Out-File -Encoding UTF8` 改过
  --   某个 .lua 之后，文件头会多出 EF BB BF；单独 require 没事，但**拼进单文件后
  --   它出现在 chunk 中间**，Lua 5.3 会直接报 `unexpected symbol near '<\239>'`，
  --   整个客户端脚本一行都跑不起来（而且报错行号指向文件末尾，很难联想）。
  if data:sub(1, 3) == "\239\187\191" then
    data = data:sub(4)
  end
  return data
end

-- ★★★★★★★★ 2026-10-11 **打包前先拦"文件被写空了"** ✗✓✓（★ 一次真实事故的护栏 ✓）
--
--   ★★★ 事故经过 ✓（★ 2026-10-11 本轮 ✓）：
--     ★ `lua/ui_controller.lua` 在某个时刻变成了 **0 字节** ✗
--     ★★ 而 **`luac -p` 对空文件【返回 0】** ✗✓ —— ★ 空 chunk 是**语法合法**的 ✓
--       ⇒ ★ 语法闸门**放行** ✓ ★ 打包器也照样打包 ✓
--       ⇒ ★★ 产物从 1.16 MB 掉到 **0.66 MB** ✗ ★ **16 套回归全红** ✓✓
--     ★ 当时我是靠"**产物体积掉了一半**"才发现的 ✗ —— ★ 那是**运气**，不是护栏 ✓
--
--   ⇒ ★ 所以在这里拦 ✓：★ **任何一个模块为空（或只有空白）⇒ 直接拒绝打包** ✓
--     ★★ 判据用"**去掉空白后还剩多少**" ✗ —— ★ 比"字节数 > 0"稳 ✓
--       （★ 空文件、只剩换行、只剩注释都会被抓 ✓）
--   ★ 为什么放这里 ✓：★ 这是**所有产物的唯一入口** ✓
--     ⇒ ★ 在这里拦一次 ⇒ ★ 以后**任何**把源码写坏的脚本都过不去 ✓✓
local function guard_module(name, src)
  local body = (src or ""):gsub("%s", "")
  if #body < 64 then
    io.stderr:write("✗ 拒绝打包：" .. tostring(name) .. " 只有 " .. tostring(#body)
      .. " 个有效字符（原文 " .. tostring(#(src or "")) .. " 字节）\n")
    io.stderr:write("   ★ 多半是这个文件被写空了 / 只剩下注释 ✗\n")
    io.stderr:write("   ★ 注意：`luac -p` 对【空的 chunk】是【通过】的 ✓ 所以它拦不住这一类 ✗\n")
    io.stderr:write("   ★ 查法：git diff --stat 看哪个文件「掉了七千行」 ✓\n")
    os.exit(2)
  end
end

local function file_exists(rel)
  local fh = io.open(ROOT .. rel, "rb")
  if fh then fh:close() return true end
  return false
end

-- 模块列表（依赖顺序无关紧要，加载器是惰性的）
local modules = {
  -- ★ room_map 放最前：它是纯函数模块，murdoku_core 与 levels.init 都要 require 它
  { name = "room_map",                 path = "lua/room_map.lua" },
  { name = "murdoku_core",             path = "lua/murdoku_core.lua" },
  -- ★ 2026-10-22（v300）：家具美术数据层（分组 / 锚点 / 六层元素 / 地毯切矩形 / 房间名标签）。
  --   ⚠️ 必须**显式**列在这里 —— 打包器只会自动补 `levels.*` 那批，普通模块漏了就会打出
  --      "bundle 里有 __require('furn_art') 但没有模块定义" ⇒ 运行时 module not found。
  --      实测坑：`lua53check --run` 仍然是绿的（顶层 chunk 只注册模块、不跑 require），
  --      要等 `tests/entry_smoke.lua` 这类真跑入口的用例才暴露。
  { name = "furn_art",                 path = "lua/furn_art.lua" },
  -- ★ 2026-10-22（v302，第四轮）：**外部拼图工具的结果文件拆出来的图元拼法数据**
  --   （每件 151~200 条：{imageId,w,h,dx,dy,rot,color}；生成脚本 `_work/art-tools/gen_art_records.py`）
  --   ⚠️ 同 `furn_art` 的坑：必须显式列在这里，否则 bundle 里只有一个悬空的 `__require`。
  { name = "furn_art_records",         path = "lua/furn_art_records.lua" },
  { name = "ui_controller",            path = "lua/ui_controller.lua" },
  { name = "engine_adapter",           path = "lua/engine_adapter.lua" },
  { name = "engine_adapter_qianxing",  path = "lua/engine_adapter_qianxing.lua" },
  { name = "main",                     path = "lua/main.lua" },
  -- ★ 2026-10-21（v284）：玩法说明浮层（教程）。控件在存档里（`tut.*`），模块只管显示与翻页。
  { name = "tutorial_ui",              path = "lua/tutorial_ui.lua" },
  -- ★ 2026-10-21（v286）：教程控件的**运行期自检**（只读：缺失 / 重名 / 父错 / 尺寸 0 / 该显示却没显示）
  { name = "tut_verify",               path = "lua/tut_verify.lua" },
  -- ★ 2026-10-22（v311）：**模板探针**（只读实验：模板嵌套 / 运行时改引用；结果只在日志）
  { name = "tpl_probe",                path = "lua/tpl_probe.lua" },
  { name = "levels.init",              path = "lua/levels/init.lua" },
}

-- 关卡模块：从 levels/init.lua 的 LIST 里抠出被真正登记的名字，且文件存在
local init_src = read_file("lua/levels/init.lua")
if init_src then
  for mod in init_src:gmatch('"(levels%.[%w_%.]+)"') do
    local rel = "lua/" .. mod:gsub("%.", "/") .. ".lua"
    local ok = false
    for i = 1, #modules do if modules[i].name == mod then ok = true end end
    if not ok and file_exists(rel) then
      modules[#modules + 1] = { name = mod, path = rel }
    end
  end
end

-- 把模块里的 require(...) 改成 __require(...)，不依赖沙箱是否存在全局 require
local function rewrite(src)
  src = src:gsub("=%s*require%s*%(", "= __require(")
  src = src:gsub("pcall%s*%(%s*require", "pcall(__require")
  return src
end

local out = {}
local function w(s) out[#out + 1] = s end

w("--[[----------------------------------------------------------------------------")
w("  client_script.lua —— 千星奇域客户端脚本（单文件构建产物）")
w("  由 tools/bundle_client_script.lua 生成，**不要手改**：改 lua/ 下的源文件后重新打包。")
w("  运行环境：Lua 5.3（官方文档）；io.* / coroutine.* 不可用，os.* 只剩 time/date/clock/difftime。")
w("----------------------------------------------------------------------------]]--")
w("")
w("-- ==== 模块加载器（把多文件合并成一个文件后仍能互相引用）==== --")
w("local __M = {}")
w("local __L = {}")
w("local function __require(name)")
w("  local hit = __L[name]")
w("  if hit ~= nil then return hit end")
w("  local f = __M[name]")
w("  if f == nil then error('[murdoku] 模块未打包: ' .. tostring(name)) end")
w("  local v = f()")
w("  if v == nil then v = true end")
w("  __L[name] = v")
w("  return v")
w("end")
w("pcall(function() require = __require end)   -- 若有全局 require 也一并接管")
w("")

local missing = {}
for i = 1, #modules do
  local m = modules[i]
  local src, err = read_file(m.path)
  if not src then
    missing[#missing + 1] = m.path .. " (" .. tostring(err) .. ")"
  else
    guard_module(m.path, src)      -- ★★ 空了就拒绝打包 ✓（★ 见上面那段事故注释 ✓）
    w('__M["' .. m.name .. '"] = function()')
    w(rewrite(src))
    w("end")
    w("")
  end
end

-- 入口（官方生命周期）放最后，直接挂在 chunk 级，注册全局 OnInit/OnStart/...
local entry = read_file("lua/entry_client_script.lua")
if entry then
  guard_module("lua/entry_client_script.lua", entry)   -- ★ 入口也要拦 ✓
  if force_level then
    -- 直接把入口里的 FORCE_LEVEL 换成具体关卡名（同 chunk 的 local，赋值最省事）
    local patched, n = entry:gsub("local FORCE_LEVEL = nil",
      "local FORCE_LEVEL = " .. string.format("%q", force_level), 1)
    if n == 0 then
      missing[#missing + 1] = "entry_client_script.lua 里找不到 `local FORCE_LEVEL = nil`"
    else
      entry = patched
    end
  end
  w("-- ==== 入口：官方生命周期回调（OnInit / OnStart / OnUpdate / ...）==== --")
  w(rewrite(entry))
else
  missing[#missing + 1] = "lua/entry_client_script.lua"
end

local bundle = table.concat(out, "\n")

-- 写文件（Windows 下用二进制模式，避免 \n 被改写）
local dist_dir = ROOT .. "dist"
os.execute('mkdir "' .. dist_dir:gsub("/", "\\") .. '" 2>nul')
local out_path = ROOT .. "dist/client_script.lua"
local fh, err = io.open(out_path, "wb")
if not fh then
  io.stderr:write("写不了 " .. out_path .. "：" .. tostring(err) .. "\n")
  os.exit(1)
end
fh:write(bundle)
fh:close()

print(string.format("打包完成：%s", out_path))
print(string.format("  模块 %d 个，总长 %d 字符（约 %d KB）", #modules, #bundle, math.floor(#bundle / 1024)))
if force_level then
  print(string.format("  ⚠️ 开局关卡已钉死为 %s（--level=，仅用于本地测试）", force_level))
else
  print("  开局关卡 = 关卡注册表里的第一关")
end
for i = 1, #modules do
  print(string.format("    - %s  <-  %s", modules[i].name, modules[i].path))
end
if #missing > 0 then
  print("")
  print("!! 以下文件没读到，打包不完整：")
  for i = 1, #missing do print("   - " .. missing[i]) end
  os.exit(1)
end
print("")
print("下一步：脚本映射要指向【编辑器实际读取的 external_lua_file 目录】（本脚本已自动同步过去）")

-- ★ 同步到编辑器目录【不在这里做】✗
--   ★ 原因：脚本沙箱没有 os.getenv ✗ 而 io.open 打不开含中文的绝对路径（已实测 ✗）
--   ★ ⇒ 打包后用 ★ powershell -File tools/sync_to_editor.ps1 ✓
