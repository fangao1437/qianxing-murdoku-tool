# tools/restore_backup.ps1 —— 从快照恢复代码（事故回退用）
#   为什么需要：2026-09-28 我误删了 set_property 的 rect 分支函数体，
#   而工程没有 git、没有备份 —— 只能靠读代码重建，风险很高。
#   用法：powershell -File tools\restore_backup.ps1            # 列出所有快照
#         powershell -File tools\restore_backup.ps1 -Stamp 20260928-2130
param([string]$Stamp)
$root = Split-Path -Parent $PSScriptRoot
$bk = Join-Path $root '_backup'
if (-not (Test-Path $bk)) { Write-Host "没有快照目录"; exit 1 }
$all = Get-ChildItem $bk -Directory | Sort-Object Name -Descending
if (-not $Stamp) {
  Write-Host "可用快照（新→旧）："
  $all | ForEach-Object { Write-Host ("  " + $_.Name) }
  Write-Host "`n恢复：powershell -File tools\restore_backup.ps1 -Stamp <名字>"
  exit 0
}
$src = Join-Path $bk $Stamp
if (-not (Test-Path $src)) { Write-Host "找不到快照 $Stamp"; exit 1 }
foreach ($d in @('lua','tools','tests','docs')) {
  $s = Join-Path $src $d
  if (Test-Path $s) {
    Remove-Item (Join-Path $root $d) -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item $s (Join-Path $root $d) -Recurse -Force
    Write-Host "  已恢复 $d"
  }
}
Write-Host "恢复完成（快照 $Stamp）—— 记得重新打包：lua tools\bundle_client_script.lua"
