# tools/lua_quote_scan.ps1 -- 扫 Lua 源码里「一行内 ASCII 双引号个数为奇数」的行。
#
# 为什么需要：我在 Lua 字符串里误用 ASCII 双引号当中文引号，已经踩了 4 次
#   （把 "找不到控件" 写进 "..." 里 → 字符串提前结束 → 语法错误，
#     而报错行号指向别处，很难一眼看出）。
# 这类错误的特征就是：那一行的 ASCII 双引号是**奇数个**。
# 注释里的也算命中（Lua 忽略它，但顺手清掉能让这个扫描保持"零输出"，
# 这样它才能真正当防线用 —— 一旦有输出就一定是新问题）。
#
# 用法：powershell -ExecutionPolicy Bypass -File tools\lua_quote_scan.ps1
# 退出码：0 = 干净；1 = 有可疑行

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$bad = 0
$total = 0
foreach ($f in (Get-ChildItem (Join-Path $root 'lua') -Filter *.lua -File)) {
  $i = 0
  foreach ($line in [System.IO.File]::ReadAllLines($f.FullName)) {
    $i++
    $total++
    $n = ([regex]::Matches($line, '"')).Count
    if ($n % 2 -ne 0) {
      Write-Host ("  [{0}:{1}] ASCII 双引号 {2} 个（奇数）" -f $f.Name, $i, $n) -ForegroundColor Red
      Write-Host ("      " + $line.Trim())
      $bad++
    }
  }
}
if ($bad -gt 0) {
  Write-Host ""
  Write-Host "有 $bad 行可疑。八成是把 ASCII 双引号当中文引号写进了 Lua 字符串 —— 改成「」即可。"
  exit 1
}
Write-Host ("lua_quote_scan: {0} 行全部干净" -f $total)
exit 0
