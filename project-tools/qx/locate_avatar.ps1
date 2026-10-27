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
$N = 16
function Sig($bmp,$x,$y,$w,$h){ $t=New-Object System.Drawing.Bitmap($N,$N); $g=[System.Drawing.Graphics]::FromImage($t)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($bmp,(New-Object System.Drawing.Rectangle(0,0,$N,$N)),(New-Object System.Drawing.Rectangle($x,$y,$w,$h)),[System.Drawing.GraphicsUnit]::Pixel); $g.Dispose()
  $a=New-Object 'double[]' ($N*$N*3); $i=0
  for($yy=0;$yy -lt $N;$yy++){for($xx=0;$xx -lt $N;$xx++){$c=$t.GetPixel($xx,$yy);$a[$i]=$c.R;$a[$i+1]=$c.G;$a[$i+2]=$c.B;$i+=3}}
  $t.Dispose(); return ,$a }
function SigDiff($a,$b){ $d=0.0; for($i=0;$i -lt $a.Length;$i++){$d+=[Math]::Abs($a[$i]-$b[$i])}; return $d/$a.Length }
$sp = Get-ChildItem -Recurse -File -Path 'tools\qx\sprites' -Filter *.png -ErrorAction SilentlyContinue
$sig = @{}
function SpriteSig($id){ if($sig.ContainsKey($id)){return $sig[$id]}
  $f = $sp | Where-Object { $_.BaseName -eq "$id" } | Select-Object -First 1
  if(-not $f){ $sig[$id]=$null; return $null }
  $im=[System.Drawing.Image]::FromFile($f.FullName); $s=Sig $im 0 0 $im.Width $im.Height; $im.Dispose(); $sig[$id]=$s; return $s }
$img1=[System.Drawing.Image]::FromFile($s1); $img2=[System.Drawing.Image]::FromFile($s2)
Write-Host "  === 已知三张 id 反查行位置（★ 改名 SigDiff 避开别名 Diff ✓）（x=150..250 滑窗，step 8，窗 72x64）==="
foreach($known in 105104,112031,105105){
  $k = SpriteSig $known
  if($null -eq $k){ Write-Host ("    id=" + $known + " 素材库没有 ✗"); continue }
  foreach($pair in @(@{n="s2";im=$img2}, @{n="s1";im=$img1})){
    $bestY=0; $bestD=999
    for($y=300; $y -le 800; $y+=8){
      $r = Sig $pair.im 150 $y 72 64
      $d = SigDiff $r $k
      if($d -lt $bestD){ $bestD=$d; $bestY=$y }
    }
    Write-Host ("    id=" + $known + "  截" + $pair.n + "  最佳 y=" + $bestY + "  差=" + [Math]::Round($bestD,1))
  }
}
Write-Host "  === 用最佳位置跑全库（4 行）==="
$rows = @(@{k="A";im=$img2;y=0},@{k="B";im=$img1;y=0},@{k="C";im=$img1;y=0},@{k="D";im=$img1;y=0})
foreach($known in 105104,112031,105105){ $k=SpriteSig $known; if($null -eq $k){continue}
  $im = $img1; $t=0
  for($y=300;$y -le 800;$y+=8){ $d=SigDiff (Sig $im 150 $y 72 64) $k; if($d -lt $t -or $t -eq 0){$t=$d;$best=$y} }
}
foreach($r in $rows){
  $ref = Sig $r.im 150 $r.y 72 64
  $list=@()
  foreach($f in $sp){ $id=[int]$f.BaseName; if($id -lt 100000 -or $id -gt 199999){continue}
    $s=SpriteSig $id; if($null -eq $s){continue}
    $list += [pscustomobject]@{id=$id; d=[Math]::Round((SigDiff $ref $s),1)} }
  $top = $list | Sort-Object d | Select-Object -First 5
  Write-Host ("    " + $r.k + " → " + (($top | ForEach-Object { $_.id.ToString() + "(差" + $_.d + ")" }) -join '  '))
}
$img1.Dispose(); $img2.Dispose()