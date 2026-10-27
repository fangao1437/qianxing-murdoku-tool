# tools/open_script_root.ps1
# Print (and open in Explorer) every sandbox "script root" folder:
#   ...\BeyondLocal\<uid>\Beyond_Local_Save_Level\<levelSaveId>\external_lua_file\
#
# The LIVE one is under AppData\LocalLow (NOT AppData\Local).
# A root is "live" when its parent folder also contains <levelSaveId>.gil (the level save itself).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\open_script_root.ps1
#   powershell -ExecutionPolicy Bypass -File tools\open_script_root.ps1 -NoOpen

param([switch]$NoOpen)

$ErrorActionPreference = 'SilentlyContinue'

$bases = @(
  (Join-Path $env:USERPROFILE 'AppData\LocalLow\miHoYo'),
  (Join-Path $env:LOCALAPPDATA 'miHoYo')
)

$roots = @()
foreach ($b in $bases) {
  if (Test-Path $b) {
    $hit = Get-ChildItem -Path $b -Directory -Recurse -Filter 'external_lua_file' -ErrorAction SilentlyContinue
    if ($hit) { $roots += $hit }
  }
}

if (-not $roots) {
  Write-Output "no script root found. Open Client Script Resource Manager in the editor once."
  exit 2
}

Write-Output "=== sandbox script roots ==="

# Rank the live roots by modification time so the NEWEST one (the level you are
# working on right now) can be marked. There can be several level saves, and
# pointing the editor at the wrong one looks exactly like "the script does nothing".
$newest = $null
foreach ($r in $roots) {
  if ($r.FullName -notlike '*\LocalLow\*') { continue }
  $t = (Get-Item -LiteralPath (Split-Path $r.FullName -Parent) -ErrorAction SilentlyContinue).LastWriteTime
  if ($t -and ($newest -eq $null -or $t -gt $newest.t)) { $newest = @{ t = $t; p = $r.FullName } }
}

foreach ($r in $roots) {
  $kind = 'Local   '
  if ($r.FullName -like '*\LocalLow\*') { $kind = 'LocalLow' }

  $levelDir = Split-Path $r.FullName -Parent
  $levelTime = (Get-Item -LiteralPath $levelDir -ErrorAction SilentlyContinue).LastWriteTime
  $gil = @(Get-ChildItem -Path $levelDir -File -Filter '*.gil' -ErrorAction SilentlyContinue)
  $live = 'WRONG ROOT (no .gil here)'
  if ($gil.Count -gt 0) { $live = 'LIVE (level save: ' + $gil[0].Name + ')' }
  if ($newest -ne $null -and $r.FullName -eq $newest.p) {
    $live = $live + '   <== NEWEST, this is the one you are probably using'
  }

  $lua = @(Get-ChildItem -Path $r.FullName -File -Filter '*.lua' -ErrorAction SilentlyContinue)
  $files = 'empty'
  if ($lua.Count -gt 0) { $files = ($lua | ForEach-Object { $_.Name + ' (' + $_.Length + 'B)' }) -join ', ' }

  Write-Output ""
  Write-Output ("[" + $kind + "]  " + $live)
  Write-Output ("  path : " + $r.FullName)
  Write-Output ("  files: " + $files)
  Write-Output ("  level folder last modified : " + $levelTime)
}

if (-not $NoOpen) {
  foreach ($r in $roots) {
    if ($r.FullName -like '*\LocalLow\*') { Start-Process explorer.exe $r.FullName | Out-Null }
  }
}
