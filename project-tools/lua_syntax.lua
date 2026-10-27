-- tools/lua_syntax.lua —— 只读：批量语法检查（loadfile 编译，不执行）
--   用法：lua tools/lua_syntax.lua <file.lua> [file2.lua …]
--   为什么要它：本工程 Lua 体量大（单文件 6000+ 行），手改后**先编译一遍**
--   比等模拟器/真机报错便宜得多；也能抓到"顶层 local 超过 200 个"这类隐性上限。
local bad = 0
for i = 1, #arg do
  local f = arg[i]
  local fn, err = loadfile(f)
  if fn then
    print("OK   " .. f)
  else
    bad = bad + 1
    print("ERR  " .. f .. "\n     " .. tostring(err))
  end
end
print(bad == 0 and ("全部通过（" .. #arg .. " 个文件）") or (bad .. " 个文件编译失败"))
os.exit(bad == 0 and 0 or 1)
