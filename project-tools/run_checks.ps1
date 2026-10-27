# tools/run_checks.ps1 — 一条命令跑完离线自检（Windows PowerShell 5.1 兼容）
#
# 为什么写成脚本：本机 pwsh 进程创建会间歇性失败（0xC0000142），每个"窗口"只够
# 几次 spawn，所以把"找 Lua -> 跑 selftest -> 跑 validate_levels"压进一次调用，
# 并且把输出同时写进日志文件，即使进程中途挂掉也能从磁盘读到结果。
#
# 用法（任选）：
#   powershell -ExecutionPolicy Bypass -File tools\run_checks.ps1
#   Invoke-Expression (Get-Content "$env:TEMP\dsh_lua_tests.ps1" -Raw)   # 绕开脚本策略
#   & "$env:TEMP\dsh_lua_tests.ps1"        # 仅当执行策略允许运行脚本时
#
# ⚠️ 本机 ExecutionPolicy 是 Restricted：直接 `& xxx.ps1` 会报
#    "无法加载文件……因为在此系统上禁止运行脚本"。上面两种写法都能绕过。
#
# 注意：本文件内容全部为 ASCII，避免 PowerShell 5.1 在无 BOM 时的编码问题。

$ErrorActionPreference = 'Continue'

# 让控制台与管道按 UTF-8 处理：Lua 输出的是 UTF-8 字节，若按 GBK 解码会变乱码，
# 而且 Tee 到日志的内容也会一起被写坏（本次实测就踩到了）
try { & chcp 65001 | Out-Null } catch { }
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false } catch { }
try { $OutputEncoding = [Console]::OutputEncoding } catch { }

$log = Join-Path $env:TEMP 'dsh_lua_tests.log'
"=== run $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8

function Say([string]$text) {
  $text | Tee-Object -FilePath $log -Append
}

# ---------- 1. 定位工程目录（不要在脚本里写非 ASCII 路径） ----------
$root = $null
foreach ($d in (Get-ChildItem 'D:\' -Directory -ErrorAction SilentlyContinue)) {
  $cand = Join-Path $d.FullName 'miHoYo Launcher\qianxing-murdoku'
  if (Test-Path $cand) { $root = $cand; break }
}
Say "ROOT=$root"
if (-not $root) { Say 'NO_PROJECT'; exit 9 }

# ---------- 2. 定位 Lua ----------
$lua = $null
$cheap = @(
  (Join-Path $env:ProgramFiles 'Lua\bin\lua54.exe'),
  (Join-Path $env:ProgramFiles 'Lua\lua54.exe'),
  (Join-Path $env:ProgramFiles 'Lua\bin\lua.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Lua\bin\lua54.exe')
)
foreach ($c in $cheap) { if ($c -and (Test-Path $c)) { $lua = $c; break } }

if (-not $lua) {
  $mp = ([Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'))
  foreach ($seg in ($mp -split ';')) {
    if (-not $seg) { continue }
    foreach ($exe in @('lua54.exe','lua.exe','lua5.4.exe')) {
      $p = Join-Path $seg $exe
      if (Test-Path $p) { $lua = $p; break }
    }
    if ($lua) { break }
  }
}

if (-not $lua) {
  $hit = Get-ChildItem -Path $env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') `
         -Filter 'lua*.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { $lua = $hit.FullName }
}

Say "LUA=$lua"
if (-not $lua) { Say 'NO_LUA'; exit 8 }

& $lua -v 2>&1 | Tee-Object -FilePath $log -Append

Set-Location $root

# ---------- 3. 离线自检 ----------
Say '==== SELFTEST ===='
& $lua (Join-Path $root 'tests\selftest.lua') 2>&1 | Tee-Object -FilePath $log -Append
Say "SELFTEST_EXIT=$LASTEXITCODE"

# ---------- 4. 关卡批量校验 ----------
Say '==== VALIDATE_LEVELS ===='
& $lua (Join-Path $root 'tools\validate_levels.lua') 2>&1 | Tee-Object -FilePath $log -Append
Say "VALIDATE_EXIT=$LASTEXITCODE"

Say "LOG=$log"
Say '=== done ==='
