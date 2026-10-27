# tools/run_smoke.ps1 -- 先打包、再跑入口冒烟。
#
# 为什么要有这个包装脚本：
#   `tests\entry_smoke.lua` 读的是 **dist\client_script.lua**，不是 lua\ 源码。
#   我手动跑冒烟时**忘了先打包**，已经踩了 3 次 —— 结果是"测的是旧包"，
#   改了源码却看到旧行为，白折腾一轮（最惨的一次是整整一轮试玩）。
#   `check_all.ps1` 里顺序是对的（第 4 步打包、第 5b 步冒烟），
#   但只要我单独跑冒烟就会中招。所以把"打包 + 冒烟"绑成一个命令。
#
# 用法：powershell -ExecutionPolicy Bypass -File tools\run_smoke.ps1
# 退出码：打包失败或冒烟失败 → 非 0

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$lua = Join-Path $env:LOCALAPPDATA 'Programs\Lua\bin\lua.exe'
if (-not (Test-Path $lua)) {
  # 退回到 PATH 里的 lua
  $cmd = Get-Command lua -ErrorAction SilentlyContinue
  if ($cmd) { $lua = $cmd.Source } else { Write-Host "找不到 lua.exe"; exit 2 }
}

Push-Location $root
try {
  Write-Host "--- 1/2 打包（冒烟读的是 dist，必须先打包）---"
  & $lua 'tools\bundle_client_script.lua'
  if ($LASTEXITCODE -ne 0) { Write-Host "打包失败"; exit 1 }

  Write-Host "--- 2/2 入口冒烟 ---"
  & $lua 'tests\entry_smoke.lua'
  $code = $LASTEXITCODE
  if ($code -ne 0) { Write-Host "冒烟失败（exit $code）"; exit $code }
  Write-Host "run_smoke: 通过"
  exit 0
} finally {
  Pop-Location
}
