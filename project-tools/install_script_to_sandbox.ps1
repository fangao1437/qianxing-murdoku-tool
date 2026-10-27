# tools/install_script_to_sandbox.ps1
# Copy the bundled client script into the sandbox "script root" folder(s).
#
# IMPORTANT (this is the bug that cost hours):
#   The LIVE script root is under  %USERPROFILE%\AppData\LocalLow\miHoYo\...
#   NOT under %LOCALAPPDATA% (\AppData\Local\miHoYo\...).
#   Genshin keeps its real player/editor data in LocalLow; the Local tree is only
#   created if someone copies files there by mistake, and the editor's file picker
#   will then show an EMPTY folder ("no items match your search").
#
#   Root layout (one per level save id):
#     C:\Users\<you>\AppData\LocalLow\miHoYo\<game>\BeyondLocal\<uid>\
#         Beyond_Local_Save_Level\<levelSaveId>\external_lua_file\
#
#   This script searches BOTH LocalLow (preferred) and Local, and syncs into every
#   external_lua_file folder it finds. Re-run it whenever the level save id changes.
#
# Usage (from the project root):
#   powershell -ExecutionPolicy Bypass -File tools\install_script_to_sandbox.ps1
#
# Note: keep this file free of non-ASCII in strings; paths with CJK are matched
#       with wildcards so PowerShell 5.1 encoding cannot break them.

$ErrorActionPreference = 'Continue'

# Locate project root: prefer the script's own location; fall back to cwd.
$root = $PSScriptRoot
if ($root) { $root = Split-Path -Parent $root } else { $root = (Get-Location).Path }
$src  = Join-Path $root 'dist\client_script.lua'

if (-not (Test-Path $src)) {
  Write-Output ("bundle not found: " + $src)
  Write-Output "run first:  lua tools\bundle_client_script.lua"
  exit 1
}
$srcLen = (Get-Item $src).Length
# ★ 2026-10-07 源哈希只算一次，后面每个 root 都拿它跟目标比。
#   "字节数一致" != "内容一致"：改一字符换一字符、或编码差异，长度可以完全相同。
#   这个项目已经因为「只看长度」绕过一次弯 ⇒ 判定一律「长度 + SHA256」双条件。
$srcHash   = (Get-FileHash $src -Algorithm SHA256).Hash
$srcHash16 = $srcHash.Substring(0, 16)
Write-Output ("source : " + $src + "  (" + $srcLen + " bytes, sha " + $srcHash16 + ")")

# Candidate miHoYo data roots, LocalLow first (that is the live one).
$bases = @(
  (Join-Path $env:USERPROFILE 'AppData\LocalLow\miHoYo'),
  (Join-Path $env:LOCALAPPDATA 'miHoYo')
)

$found = @()
foreach ($b in $bases) {
  if (Test-Path $b) {
    $hit = Get-ChildItem -Path $b -Directory -Recurse -Filter 'external_lua_file' -ErrorAction SilentlyContinue
    if ($hit) { $found += $hit }
  }
}

if (-not $found) {
  Write-Output "no script root (external_lua_file) found."
  Write-Output "fix: open Client Script Resource Manager in the editor once, then re-run."
  exit 2
}

# LocalLow first, then Local; drop duplicates.
$ordered = @()
foreach ($prefer in @('LocalLow','Local')) {
  foreach ($d in $found) {
    if ($d.FullName -like ('*\' + $prefer + '\*')) {
      if ($ordered -notcontains $d.FullName) { $ordered += $d.FullName }
    }
  }
}
foreach ($d in $found) { if ($ordered -notcontains $d.FullName) { $ordered += $d.FullName } }

$n = 0
$bad = 0
foreach ($dir in $ordered) {
  $tag = 'Local'
  if ($dir -like '*\LocalLow\*') { $tag = 'LocalLow' }
  $dst = Join-Path $dir 'client_script.lua'
  # ---------------------------------------------------------------
  # Archive the OLD script before overwriting it (user request, 2026-10-09).
  #
  # Why this exists: importing a .gil creates a NEW level save folder, and
  #   the script that appears inside it is the copy EMBEDDED in that .gil.
  #   That copy can be very old -- measured: folder 1073742018 held v075
  #   while the newest build was v093, so the device ran month-old code and
  #   the log looked like the new work had never been applied.
  #   Once overwritten there is no way to tell which build was running, so
  #   archive first. Content already identical => skip, so repeated syncs do
  #   not pile up duplicates.
  #   Name carries level id + build marker + timestamp.
  #
  # NOTE: strings here stay ASCII on purpose (see the header note). The build
  #   marker is matched by pattern vNNN followed by a date, not by its label.
  # ---------------------------------------------------------------
  if (Test-Path -LiteralPath $dst) {
    $alreadySame = $false
    try { $alreadySame = ((Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash -eq $srcHash) } catch { $alreadySame = $false }
    if (-not $alreadySame) {
      $bakDir = Join-Path $root '_backup\sandbox-scripts'
      if (-not (Test-Path -LiteralPath $bakDir)) { New-Item -ItemType Directory -Force -Path $bakDir | Out-Null }
      $marker = 'unknown'
      try {
        $txt = [System.IO.File]::ReadAllText($dst)
        $m = [regex]::Match($txt, 'v\d{2,4}(?= / 20\d\d-)')
        if ($m.Success) { $marker = $m.Value }
      } catch { }
      $lvId = Split-Path (Split-Path $dir -Parent) -Leaf
      $stamp = (Get-Date).ToString('yyyy-MM-dd_HHmmss')
      $bakName = $lvId + '__' + $marker + '__' + $stamp + '.lua'
      try {
        Copy-Item -LiteralPath $dst -Destination (Join-Path $bakDir $bakName) -Force -ErrorAction Stop
        Write-Output ('[' + $tag + '] old script archived -> _backup\sandbox-scripts\' + $bakName)
      } catch {
        Write-Output ('[' + $tag + '] WARNING: could not archive old script: ' + $_.Exception.Message)
      }
    }
  }
  $copyErr = $null
  try { Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop }
  catch { $copyErr = $_.Exception.Message }
  if (-not (Test-Path -LiteralPath $dst)) {
    $bad++
    Write-Output ("[" + $tag + "] FAILED  -> " + $dir + "  (" + $copyErr + ")")
    continue
  }
  # ★★★★★ 2026-10-02 **BOM 必须剥掉**。
  #
  #   引擎日志（`%LOCALAPPDATA%Low\miHoYo\原神\output_log.txt`，2026-10-02 22:39:47）写着：
  #       Read text file with BOM header may cause Lua error, file is 93b17eac / f668c022 / 2109080b
  #   而当天真的踩到了：`Beyond_Local_Save_Level\1073741929\external_lua_file\client_script.lua`
  #   比别处多 **正好 3 字节**（EF BB BF）⇒ 那一份是**带 BOM 的**，而用户当时测的就是它。
  #   ⇒ 每次同步后**就地检查并剥掉**，并且**写回后再验一次**（不能只信"我剥了"）。
  $bytes = [System.IO.File]::ReadAllBytes($dst)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    [System.IO.File]::WriteAllBytes($dst, $bytes[3..($bytes.Length - 1)])
    $after = [System.IO.File]::ReadAllBytes($dst)
    $stillBom = ($after.Length -ge 3 -and $after[0] -eq 0xEF -and $after[1] -eq 0xBB -and $after[2] -eq 0xBF)
    $recheck = 'OK'
    if ($stillBom) { $recheck = 'STILL-BOM' }
    Write-Output ("[" + $tag + "] BOM stripped -> " + $dst + "  (" + $bytes.Length + " -> " + $after.Length + " bytes, recheck=" + $recheck + ")")
  }
  # ★ 2026-10-07 判定 = 字节数 + SHA256 双条件（原实现只比长度，是漏报盲区：
  #   长度一致而内容不同完全可能）。任一不符 ⇒ MISMATCH + 非 0 退出。
  #   ★ 每轮必须重置：否则上一轮的值会残留，读失败时拿旧哈希去比 ⇒ 假 ok。
  $dstLen = $null; $dstHash = $null; $sha16 = '<unreadable>'
  try { $dstLen = (Get-Item -LiteralPath $dst).Length } catch { $dstLen = $null }
  try { $dstHash = (Get-FileHash -LiteralPath $dst -Algorithm SHA256 -ErrorAction Stop).Hash } catch { $dstHash = $null }
  if ($dstHash) { $sha16 = $dstHash.Substring(0, 16) }
  if (-not $dstHash -or $null -eq $dstLen) {
    $bad++
    Write-Output ("[" + $tag + "] UNREADABLE -> " + $dst + "  (dst size=" + $dstLen + ", sha unreadable | src " + $srcLen + " bytes, sha " + $srcHash16 + ")")
  } elseif ($dstLen -eq $srcLen -and $dstHash -eq $srcHash) {
    Write-Output ("[" + $tag + "] synced  -> " + $dst + "  (" + $dstLen + " bytes, sha " + $sha16 + ", ok)")
    if ($copyErr) { Write-Output ("[" + $tag + "] WARN  copy failed but destination already == source: " + $copyErr) }
  } else {
    $bad++
    Write-Output ("[" + $tag + "] MISMATCH -> " + $dst + "  (dst " + $dstLen + " bytes, sha " + $sha16 + " | src " + $srcLen + " bytes, sha " + $srcHash16 + ")")
  }
  $n++
}

Write-Output ("done: synced " + $n + " root(s).")
if ($bad -gt 0) {
  Write-Output ("FAILED: " + $bad + " root(s) MISMATCH/FAILED -- do NOT trust this sync.")
  exit 1
}
Write-Output "back in the editor: Client Script Resource Manager -> the script record -> edit the file path -> pick client_script.lua"
Write-Output "if the picker is already open, click the refresh (circular arrow) button."
