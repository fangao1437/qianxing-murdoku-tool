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
$s1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"
$s2 = "C:\Users\18182\.dsh\attachments\v1\objects\d9\d98b4737ebc1cbff5812357be42f89d0f5c7d4ae1ca6278112902ecd2e7e8f68"
$N = 12
$img1=[System.Drawing.Image]::FromFile($s1)
$img2=[System.Drawing.Image]::FromFile($s2)
function SigR($bmp,$x,$y,$w,$h){ $t=New-Object System.Drawing.Bitmap($N,$N); $g=[System.Drawing.Graphics]::FromImage($t)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bmp,(New-Object System.Drawing.Rectangle(0,0,$N,$N)),(New-Object System.Drawing.Rectangle($x,$y,$w,$h)),[System.Drawing.GraphicsUnit]::Pixel); $g.Dispose()
  $a=New-Object 'double[]' ($N*$N*3); $i=0
  for($yy=0;$yy -lt $N;$yy++){for($xx=0;$xx -lt $N;$xx++){$c=$t.GetPixel($xx,$yy);$a[$i]=$c.R;$a[$i+1]=$c.G;$a[$i+2]=$c.B;$i+=3}}
  $t.Dispose(); return ,$a }
function SigDiff2($a,$b){ $d=0.0; for($i=0;$i -lt $a.Length;$i++){$d+=[Math]::Abs($a[$i]-$b[$i])}; return $d/$a.Length }
# 屏幕上的 4 行（★ 用上一轮已知 id 命中的 y ✓ A 只在 s2 ✓）
$rows = @(
  @{k="A"; im=$img2; x=150; y=340; w=72; h=64},
  @{k="B"; im=$img1; x=150; y=484; w=72; h=64},
  @{k="C"; im=$img1; x=150; y=604; w=72; h=64},
  @{k="D"; im=$img1; x=150; y=724; w=72; h=64}
)
foreach($r in $rows){ $r.sig = SigR $r.im $r.x $r.y $r.w $r.h }
$sp = Get-ChildItem -Recurse -File -Path 'tools\qx\sprites' -Filter *.png -ErrorAction SilentlyContinue | Where-Object { [int]$_.BaseName -ge 100000 -and [int]$_.BaseName -le 199999 }
Write-Host ("  素材 = " + $sp.Count + " 张   屏幕块 = " + $rows.Count + " 个   比对尺度 = 60/80/100%")
$res = @{}
foreach($r in $rows){ $res[$r.k] = @() }
foreach($f in $sp){
  $id=[int]$f.BaseName
  $im=$null
  try { $im=[System.Drawing.Image]::FromFile($f.FullName) } catch { continue }
  $W=$im.Width; $H=$im.Height
  $variants=@()
  foreach($sc in 0.60,0.80,1.00){
    $w=[int]($W*$sc); $h=[int]($H*$sc); $x=[int](($W-$w)/2); $y=[int](($H-$h)/2)
    if($w -ge 4 -and $h -ge 4){ $variants += ,(SigR $im $x $y $w $h) }
  }
  $im.Dispose()
  foreach($r in $rows){
    $bd=999.0
    foreach($v in $variants){ $d=SigDiff2 $r.sig $v; if($d -lt $bd){$bd=$d} }
    $res[$r.k] += [pscustomobject]@{id=$id; d=[Math]::Round($bd,1)}
  }
}
$known=@{A=105104; B=112031; C=105105}
foreach($r in $rows){
  $top = $res[$r.k] | Sort-Object d | Select-Object -First 5
  $hit = ($top | Where-Object { $_.id -eq $known[$r.k] } | Select-Object -First 1)
  $tag = if($hit){ "  ★已知命中 id=" + $known[$r.k] + " 差=" + $hit.d } else { "  ✗未命中已知 id=" + $known[$r.k] }
  Write-Host ("  " + $r.k + " → " + (($top | ForEach-Object { $_.id.ToString() + "(差" + $_.d + ")" }) -join '  ') + $tag)
}