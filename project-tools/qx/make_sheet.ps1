# tools/qx/make_sheet.ps1 —— 把一类 sprite 拼成"接触表"，供看图挑素材
#
# 用法： powershell -File tools\qx\make_sheet.ps1 -Dir tools\qx\sprites\9 -Out tools\qx\out\sheet-props.png -Cols 14
#
# 为什么用 System.Drawing 而不是 npm 包：Windows 自带，不用装依赖。
param(
  [Parameter(Mandatory=$true)][string]$Dir,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Cols = 14,
  [int]$Cell = 96
)
Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem $Dir -Filter *.png | Sort-Object Name
if ($files.Count -eq 0) { Write-Host "  没有 png"; exit 1 }
$pad = 4
$rows = [Math]::Ceiling($files.Count / $Cols)
$W = $Cols * ($Cell + $pad) + $pad
$H = $rows * ($Cell + $pad + 18) + $pad
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(40, 40, 48))
$g.InterpolationMode = 'HighQualityBicubic'
$font = New-Object System.Drawing.Font('Consolas', 7)
for ($i = 0; $i -lt $files.Count; $i++) {
  $c = $i % $Cols; $r = [Math]::Floor($i / $Cols)
  $x = $pad + $c * ($Cell + $pad); $y = $pad + $r * ($Cell + $pad + 18)
  try { $img = [System.Drawing.Image]::FromFile($files[$i].FullName); $g.DrawImage($img, $x, $y, $Cell, $Cell); $img.Dispose() } catch { }
  $g.DrawString($files[$i].BaseName, $font, [System.Drawing.Brushes]::White, $x, $y + $Cell + 1)
}
$g.Dispose()
$dir2 = Split-Path $Out -Parent
if ($dir2 -and -not (Test-Path $dir2)) { New-Item -ItemType Directory -Path $dir2 -Force | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "  拼好 $Out : $($files.Count) 张  ${W}x${H}"
