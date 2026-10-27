# tools/sync_to_editor.ps1 —— 把打包产物同步到【编辑器真正读取的目录】
#
# ★ 为什么需要它：编辑器不读项目里的 dist/client_script.lua ✗
#   它读的是关卡目录下的 external_lua_file\client_script.lua ✓
# ★ 为什么不用 Lua 做：脚本沙箱里 os.* 只剩 time/date/clock/difftime ✗
#   ⇒ 而且 io.open 打开这个含中文的绝对路径会失败（已实测 ✓）
#   ⇒ 所以放在打包【之后】用 PowerShell 做一步 ✓
param(
  [string]$Src = "$PSScriptRoot\..\dist\client_script.lua",
  [string]$Dst = "C:\Users\18182\AppData\LocalLow\miHoYo\原神\BeyondLocal\153793556\Beyond_Local_Save_Level\1073742003\external_lua_file\client_script.lua"
)
if (-not (Test-Path $Src)) { Write-Host "✗ 找不到打包产物：$Src"; exit 1 }
Copy-Item -LiteralPath $Src -Destination $Dst -Force
$s = (Get-FileHash $Src -Algorithm SHA256).Hash
$d = (Get-FileHash $Dst -Algorithm SHA256).Hash
if ($s -eq $d) {
  $i = Get-Item $Dst
  Write-Host ("✅ 已同步到编辑器目录：{0} KB  {1}" -f [math]::Round($i.Length/1024,1), $i.LastWriteTime.ToString('MM-dd HH:mm:ss'))
} else { Write-Host "✗ 同步后哈希不一致"; exit 1 }