# tools/make_placeholder_assets.ps1
# Generate placeholder PNG art for every kind of client control the project uses,
# so you can import them into the editor and actually SEE the UI before real art exists.
#
# Why this is needed (official rule, and we verified it the hard way):
#   - A 客户端控件容器 is a transparent canvas; a 容器节点 draws nothing at all
#     (it is only an attachment point).
#   - A 预设按钮 draws nothing by itself. Its look comes from the child control
#     referenced by its 状态节点 (默认 / 悬停 / 按下 / 不可用).
#   So with zero images the whole UI is invisible even though every control exists
#   and the script works fine.
#
# Output: assets/placeholder/*.png   (plus a README.md mapping file -> where to use it)
#
# Usage (from the project root):
#   powershell -ExecutionPolicy Bypass -File tools\make_placeholder_assets.ps1
#
# Note: ASCII-only on purpose (PowerShell 5.1 reads BOM-less files as GBK and
#       non-ASCII would corrupt the script).

$ErrorActionPreference = 'Continue'

$root = $PSScriptRoot
if ($root) { $root = Split-Path -Parent $root } else { $root = (Get-Location).Path }
$out = Join-Path $root 'assets\placeholder'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$ff = Join-Path $env:TEMP 'ffs\node_modules\ffmpeg-static\ffmpeg.exe'
if (-not (Test-Path $ff)) {
  $ff = 'ffmpeg'
  Write-Output "warning: bundled ffmpeg not found, using PATH 'ffmpeg'"
}

# ffmpeg color syntax: color=c=0xRRGGBB@alpha:s=WxH
# drawbox draws the 1px-ish frame so the control edges are visible while laying out.
function New-Solid {
  param(
    [string]$Name,
    [int]$W, [int]$H,
    [string]$Color,        # 0xRRGGBB
    [double]$Alpha,
    [string]$BorderColor,  # 0xRRGGBB  (empty = no border)
    [int]$Border = 3
  )
  $file = Join-Path $out $Name
  # ⚠️ 滤镜串里所有变量都必须写成 ${Var}：PowerShell 会把 "$Border:" 当成
  #    "作用域限定的变量名"（$Border:），结果数字被吃掉、表达式拼坏
  #    （踩过：报 Undefined constant or missing '(' in '==iw-2*=...'）。
  $vf = 'format=rgba'
  if ($BorderColor -ne '') {
    $vf = 'drawbox=x=0:y=0:w=iw:h=ih:color=' + ${BorderColor} + '@1.0:t=' + ${Border} + ',format=rgba'
  }
  & $ff -y -loglevel error -f lavfi -i ('color=c=' + ${Color} + '@' + ${Alpha} + ':s=' + ${W} + 'x' + ${H}) `
        -vf $vf -frames:v 1 $file
  if ((Test-Path $file) -and ((Get-Item $file).Length -gt 40)) {
    Write-Output ("  ok   " + $Name.PadRight(28) + " " + $W + "x" + $H)
  } else {
    Write-Output ("  FAIL " + $Name)
  }
}

Write-Output ("output -> " + $out)
Write-Output ""
Write-Output "== 1. cell (board square) + its 4 button states =="
# 这些是「底板」类：真机上**只有底板 / 分稿线**支持【图片类型 = 拉伸】，
# 所以格子底图必须走底板，尺寸写大一点没关系（拉伸会填满控件）。
New-Solid 'cell_face.png'     256 256 '0xFFFFFF' 0.16 '0xFFFFFF' 4
New-Solid 'cell_hover.png'    256 256 '0xFFFFFF' 0.28 '0xFFFFFF' 6
New-Solid 'cell_pressed.png'  256 256 '0x66CCFF' 0.55 '0xFFFFFF' 6
New-Solid 'cell_disabled.png' 256 256 '0x808080' 0.12 '0x808080' 4

Write-Output ""
Write-Output "== 2. generic button (also used for tray cards / modal buttons) =="
New-Solid 'btn_default.png'  256 96 '0xFFFFFF' 0.18 '0xFFFFFF' 3
New-Solid 'btn_hover.png'    256 96 '0xFFFFFF' 0.30 '0xFFFFFF' 4
New-Solid 'btn_pressed.png'  256 96 '0x66CCFF' 0.55 '0xFFFFFF' 4
New-Solid 'btn_disabled.png' 256 96 '0x808080' 0.10 '0x808080' 3

Write-Output ""
Write-Output "== 3. tray card background (also a 底板 -> stretchable) =="
New-Solid 'card_face.png'    160 200 '0xFFFFFF' 0.14 '0xFFFFFF' 3

Write-Output ""
Write-Output "== 4. portraits (one per character id) =="
# ⚠️ 头像属于「功能图标」类，**只能选【基础】**（不能拉伸）。
#    如果"基础"是按原始像素画，那么大图会溢出控件 ——
#    头像卡最窄只有 68px 宽（7 人关），所以这里按 64x64 出，保证不溢出。
#    Distinct colors so you can tell who is who while testing.
$portraits = @{
  'A' = '0xE07070'; 'B' = '0x70C070'; 'C' = '0x7090E0'; 'D' = '0xE0C060'
  'E' = '0xC070D0'; 'F' = '0x60C0C0'; 'V' = '0xE0E0E0'
}
foreach ($k in ($portraits.Keys | Sort-Object)) {
  New-Solid ("portrait_" + $k + ".png") 64 64 $portraits[$k] 0.85 '0xFFFFFF' 2
}

Write-Output ""
Write-Output "== 5. X mark (cell.*.x) =="
# ⚠️ 同上：X 图标属于「功能图标」类，**只能【基础】**，不能拉伸。
#    它要放进格子里，而格子最小是 97x97（7x7 关卡）——所以出 88x88，
#    这样即使引擎按原始像素画，也不会盖到旁边的格子。
New-Solid 'x_mark.png' 88 88 '0xFF4040' 0.70 '0xFF2020' 8

Write-Output ""
Write-Output "== 6. panels (stretch these; 9-slice is better if you have real art) =="
New-Solid 'panel_topbar.png' 512 64  '0x102030' 0.85 '0xFFFFFF' 2
New-Solid 'panel_side.png'   512 512 '0x102030' 0.80 '0xFFFFFF' 2

Write-Output ""
Write-Output "== 7. full-screen background (optional) =="
New-Solid 'bg_screen.png' 1600 900 '0x0A1420' 1.0 ''

Write-Output ""
Write-Output "done. files written to: $out"
