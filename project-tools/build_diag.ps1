# tools/build_diag.ps1
# Build a DIAGNOSTIC variant of the client script:
#     dist/client_script.lua  +  tools/hello_probe.lua   ->  dist/client_script_diag.lua
# and copy it over the mapped file name (client_script.lua) in every script root.
#
# Why: the editor knows the mapping by FILE NAME/PATH, so replacing the content of
#      client_script.lua is enough -- no editor clicks needed. Save the level, play,
#      and the probe prints extra [probe] ... lines that bisect "did the script run".
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\build_diag.ps1            # probe build
#   powershell -ExecutionPolicy Bypass -File tools\build_diag.ps1 -Restore   # back to normal
#
# This file is intentionally ASCII-only (PowerShell 5.1 reads BOM-less .ps1 as ANSI).

param([switch]$Restore)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$root = $PSScriptRoot
if ($root) { $root = Split-Path -Parent $root } else { $root = (Get-Location).Path }

$distDir   = Join-Path $root 'dist'
$bundle    = Join-Path $distDir 'client_script.lua'
$probe     = Join-Path $root 'tools\hello_probe.lua'
$diag      = Join-Path $distDir 'client_script_diag.lua'

if (-not (Test-Path $bundle)) { Write-Output ("missing: " + $bundle); exit 1 }

if ($Restore) {
  $payload = [System.IO.File]::ReadAllText($bundle, [System.Text.Encoding]::UTF8)
  $mode = 'NORMAL (probe removed)'
} else {
  if (-not (Test-Path $probe)) { Write-Output ("missing: " + $probe); exit 1 }
  $a = [System.IO.File]::ReadAllText($bundle, [System.Text.Encoding]::UTF8)
  $b = [System.IO.File]::ReadAllText($probe,  [System.Text.Encoding]::UTF8)
  $payload = $a + "`n`n" + $b
  [System.IO.File]::WriteAllText($diag, $payload, $utf8)
  $mode = 'DIAG (with probe)'
}

Write-Output ("mode   : " + $mode)
Write-Output ("payload: " + $payload.Length + " chars, sha256 " +
  (Get-FileHash -InputStream ([System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes($payload))) -Algorithm SHA256).Hash.Substring(0,16))

# --- locate every script root (LocalLow first; that is the live one) ---
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
$ordered = @()
foreach ($prefer in @('LocalLow','Local')) {
  foreach ($d in $found) {
    if ($d.FullName -like ('*\' + $prefer + '\*') -and $ordered -notcontains $d.FullName) { $ordered += $d.FullName }
  }
}
foreach ($d in $found) { if ($ordered -notcontains $d.FullName) { $ordered += $d.FullName } }

if (-not $ordered) { Write-Output "no script root found"; exit 2 }

$n = 0
foreach ($dir in $ordered) {
  $tag = 'Local'
  if ($dir -like '*\LocalLow\*') { $tag = 'LocalLow' }
  $dst = Join-Path $dir 'client_script.lua'
  [System.IO.File]::WriteAllText($dst, $payload, $utf8)
  Write-Output ("[" + $tag + "] written -> " + $dst + "  (" + (Get-Item $dst).Length + " bytes)")
  $n++
}
Write-Output ("done: " + $n + " root(s).")
Write-Output "next: in the editor -> Save Level -> Play, then open Window > Log and read the [probe] lines."
