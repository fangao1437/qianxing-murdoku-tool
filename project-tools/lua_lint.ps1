# tools/lua_lint.ps1 —— Lua 静态检查 / 格式体检（只读，**不改任何 .lua**）
#
# 跑法（在工程根目录）：
#   powershell -ExecutionPolicy Bypass -File tools\lua_lint.ps1
#   powershell -ExecutionPolicy Bypass -File tools\lua_lint.ps1 -Strict    # 有 error 就 exit 1
#   powershell -ExecutionPolicy Bypass -File tools\lua_lint.ps1 -Target lua
#
# 做两件事：
#   ① selene  —— 静态检查（未定义全局/空分支/漏写 local/未用变量…）
#   ② stylua  —— 格式体检（`--check`，**只报告有多少文件会被重排**）
#
# ⚠️ 本脚本**永远不写文件**。它存在的意义是「让信号浮出来」，不是「自动改代码」：
#   · selene 的配置见 tools/lua-tooling/selene.toml（风格类规则已按本工程现状关掉，
#     否则 1000+ 条噪音会把 3 条真问题埋掉）。
#   · stylua 只跑 --check：本工程 lua/** 是手写对齐风格，格式化器一定想重排，
#     真要落地必须人工过目，不能在自检里自动改写。
#
# 工具位置：tools/bin/{selene,stylua}（下载方式见 docs/插件与工具-调研与安装记录.md）
# 工具不在时**只警告、不失败** —— 换一台机器不该因为没下二进制就红。
#
# ⚠️ 改过本文件（或任何含中文的 .ps1）之后，先跑一次
#      powershell -ExecutionPolicy Bypass -File tools\normalize_encoding.ps1
#    因为编辑工具会剥掉 BOM，而 PowerShell 5.1 会把无 BOM 的文件按 GBK 读 → 直接解析失败。

param(
  [string]$Target = 'lua',
  [switch]$Strict
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$tooling = Join-Path $root 'tools\lua-tooling'
$selene = Join-Path $root 'tools\bin\selene\selene.exe'
$stylua = Join-Path $root 'tools\bin\stylua\stylua.exe'
$reportDir = Join-Path $tooling 'out'
$report = Join-Path $reportDir 'selene-report.txt'
$targetDir = Join-Path $root $Target

if (-not (Test-Path $targetDir)) {
  Write-Host "!! 找不到目标目录：$targetDir" -ForegroundColor Red
  exit 1
}

$missing = @()
if (-not (Test-Path $selene)) { $missing += "selene  ($selene)" }
if (-not (Test-Path $stylua)) { $missing += "stylua  ($stylua)" }

# ── ① selene ─────────────────────────────────────────────────────────────────
Write-Host ("=" * 70)
Write-Host ">> Lua 静态检查（selene，只报告）" -ForegroundColor Cyan
Write-Host ("=" * 70)
$seleneErrors = 0
$seleneTotal = 0
if (Test-Path $selene) {
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
  # 用 Json（JSONL）拿结构化结果，自己数 —— 比解析 Rich 的彩色文本可靠。
  & $selene --config (Join-Path $tooling 'selene.toml') --display-style json $targetDir 2>$null 1>"$report"
  $raw = @()
  if (Test-Path $report) { $raw = [System.IO.File]::ReadAllLines($report) }
  $byCode = @{}
  foreach ($line in $raw) {
    $t = $line.Trim()
    if (-not $t.StartsWith('{')) { continue }
    try { $d = $t | ConvertFrom-Json } catch { continue }
    if (-not $d.code) { continue }
    $seleneTotal++
    if ($d.severity -eq 'Error') { $seleneErrors++ }
    $byCode[$d.code] = 1 + [int]$byCode[$d.code]
  }
  Write-Host "找到 $seleneTotal 条（其中 error $seleneErrors 条）："
  $byCode.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object {
    Write-Host ("    {0,5}  {1}" -f $_.Value, $_.Key)
  }
  Write-Host ""
  Write-Host "  ── 需要人看的（风格类已按工程现状关掉，剩下的都值得扫一眼）──" -ForegroundColor Yellow
  # 只把「非 unused_variable」的挑出来：未用变量数量大、多半是刻意的（用于打印/占位），
  # 而 empty_if / unscoped_variables / parse_error 每一条都指向真问题。
  $notable = @()
  foreach ($line in $raw) {
    $t = $line.Trim()
    if (-not $t.StartsWith('{')) { continue }
    try { $d = $t | ConvertFrom-Json } catch { continue }
    if (-not $d.code) { continue }
    if ($d.code -eq 'unused_variable') { continue }
    $f = Split-Path -Leaf $d.primary_label.filename
    $notable += ("    {0}:{1}:{2}  [{3}] {4}" -f $f, $d.primary_label.span.start_line, $d.primary_label.span.start_column, $d.code, $d.message)
  }
  if ($notable.Count -eq 0) { Write-Host "    （无）" -ForegroundColor Green }
  else { $notable | ForEach-Object { Write-Host $_ } }
  Write-Host ""
  Write-Host "  完整报告：$report" -ForegroundColor DarkGray
} else {
  Write-Host "  （跳过：没找到 selene）" -ForegroundColor Yellow
}

# ── ② stylua ─────────────────────────────────────────────────────────────────
Write-Host ("=" * 70)
Write-Host ">> Lua 格式体检（stylua --check，只报告不判失败）" -ForegroundColor Cyan
Write-Host ("=" * 70)
if (Test-Path $stylua) {
  $config = Join-Path $tooling 'stylua.toml'
  $all = Get-ChildItem $targetDir -Recurse -File -Filter *.lua
  # stylua --check 会把「需要改的整份文件 diff」打到 stdout，几百 KB ——
  # 这里只需要「哪些文件不一致」，所以收进变量只取文件名行。
  $out = & $stylua --config-path $config --check $targetDir 2>&1 | Out-String
  $diffFiles = [regex]::Matches($out, '(?m)^Diff in (.+?):\s*$') | ForEach-Object { $_.Groups[1].Value.Trim() }
  $diffFiles = $diffFiles | Sort-Object -Unique
  Write-Host ("lua 文件 {0} 个，stylua 想重排 {1} 个。" -f $all.Count, $diffFiles.Count)
  if ($diffFiles.Count -gt 0) {
    Write-Host "  ⚠️ 本工程 lua/** 是手写对齐风格（等号对齐/表字段对齐/注释成块），" -ForegroundColor Yellow
    Write-Host "     格式化器一定想重排。**不要**直接跑不带 --check 的 stylua。" -ForegroundColor Yellow
    $diffFiles | Select-Object -First 20 | ForEach-Object { Write-Host ("    " + $_) }
    if ($diffFiles.Count -gt 20) { Write-Host ("    …（其余 " + ($diffFiles.Count - 20) + " 个见上文数字）") }
  }
} else {
  Write-Host "  （跳过：没找到 stylua）" -ForegroundColor Yellow
}

# ── 收尾 ─────────────────────────────────────────────────────────────────────
Write-Host ""
if ($missing.Count -gt 0) {
  Write-Host "⚠️ 以下工具不在 tools\bin 下，本次已跳过（不影响结果判定）：" -ForegroundColor Yellow
  $missing | ForEach-Object { Write-Host ("    " + $_) }
  Write-Host "    下载与安装方式见 docs\插件与工具-调研与安装记录.md" -ForegroundColor DarkGray
  Write-Host ""
}

# 默认**只报告**：本工程 lua/** 里现存 1 处 BOM parse_error + 2 处漏写 local，
# 都是**先于本脚本存在**的既成事实。自检不该因为「历史遗留」就变红 ——
# 那正是本工程反复吃过的「断言锁死现状」。要收紧就显式加 -Strict。
if ($Strict -and $seleneErrors -gt 0) {
  Write-Host "lua_lint：-Strict 模式下有 $seleneErrors 条 error。" -ForegroundColor Red
  exit 1
}
Write-Host "lua_lint：完成（只报告模式）。" -ForegroundColor Green
exit 0
