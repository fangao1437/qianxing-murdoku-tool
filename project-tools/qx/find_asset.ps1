# =====================================================================
#  SUPERSEDED - DO NOT TRUST THESE NUMBERS   (marked 2026-10-08)
#
#  This was the first attempt at finding the clue-avatar asset ids.
#  It is wrong for a fundamental reason: the library sprites are
#  transparent PNGs, and drawing a transparent PNG onto a fresh Bitmap
#  leaves the transparent pixels black.  That differs from the real
#  on-screen backdrop by 40+, so every "difference" it printed was
#  noise (hence 37..49 and no known id ever being hit).  It also used
#  wrong crop boxes and, in places, scored a hard-coded y=0 window.
#
#  The verified replacement is:
#      tools\qx\identify_avatars.ps1     (full scan + ranking)
#      tools\qx\verify_final.ps1         (four independent residuals)
#      tools\qx\build_evidence.ps1       (side-by-side proof images)
#  Conclusions: tools\qx\known_assets.json
# =====================================================================
﻿Add-Type -AssemblyName System.Drawing
$shots = @{
  s1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"
  s2 = "C:\Users\18182\.dsh\attachments\v1\objects\d9\d98b4737ebc1cbff5812357be42f89d0f5c7d4ae1ca6278112902ecd2e7e8f68"
}
# 两张截图里 4 个头像的裁剪框（★ 左栏卡片左侧的小头像 ✓ 1920x864 坐标 ✓）
$crops = @(
  @{k="A"; s="s2"; x=155; y=370; w=95; h=70},
  @{k="B"; s="s1"; x=155; y=350; w=95; h=70},
  @{k="C"; s="s1"; x=155; y=485; w=95; h=70},
  @{k="D"; s="s1"; x=155; y=600; w=95; h=70}
)
$N = 16
function Sig($bmp, $x, $y, $w, $h) {
  $t = New-Object System.Drawing.Bitmap($N, $N)
  $g = [System.Drawing.Graphics]::FromImage($t)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0,0,$N,$N)), (New-Object System.Drawing.Rectangle($x,$y,$w,$h)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $a = New-Object 'double[]' ($N*$N*3)
  $i = 0
  for ($yy=0; $yy -lt $N; $yy++) { for ($xx=0; $xx -lt $N; $xx++) {
    $c = $t.GetPixel($xx,$yy); $a[$i]=$c.R; $a[$i+1]=$c.G; $a[$i+2]=$c.B; $i+=3 } }
  $t.Dispose(); return ,$a
}
# 素材库：全部 sprites/*.png
$sprites = Get-ChildItem -Recurse -File -Path 'tools\qx\sprites' -Filter *.png -ErrorAction SilentlyContinue
Write-Host ("  素材库 png = " + $sprites.Count + " 张")
$sigs = @{}
$bmps = @{}
foreach ($kv in $shots.GetEnumerator()) { $bmps[$kv.Key] = [System.Drawing.Image]::FromFile($kv.Value) }
foreach ($c in $crops) {
  $bmp = $bmps[$c.s]
  $ref = Sig $bmp $c.x $c.y $c.w $c.h
  $best = @()
  foreach ($f in $sprites) {
    $id = [int]($f.BaseName)
    if ($id -lt 100000 -or $id -gt 199999) { continue }
    if (-not $sigs.ContainsKey($id)) {
      try { $im = [System.Drawing.Image]::FromFile($f.FullName); $sigs[$id] = Sig $im 0 0 $im.Width $im.Height; $im.Dispose() } catch { $sigs[$id] = $null }
    }
    $s = $sigs[$id]; if ($null -eq $s) { continue }
    $d = 0.0
    for ($i=0; $i -lt $ref.Length; $i++) { $d += [Math]::Abs($ref[$i] - $s[$i]) }
    $d = $d / $ref.Length
    $best += [pscustomobject]@{ id=$id; diff=[Math]::Round($d,1) }
  }
  $top = $best | Sort-Object diff | Select-Object -First 5
  Write-Host ("  ★ " + $c.k + " 裁自 " + $c.s + "  候选：" + (($top | ForEach-Object { $_.id.ToString() + "(差" + $_.diff + ")" }) -join '  '))
}
foreach ($b in $bmps.Values) { $b.Dispose() }