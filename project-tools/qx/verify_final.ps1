$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# =====================================================================
#  verify_final.ps1
#  Second, independent pass over the four conclusions produced by
#  identify_avatars.ps1.  It re-fits every candidate from scratch and
#  reports FOUR different residuals, so the verdict cannot hinge on a
#  single metric:
#
#    fullDiff      over the whole avatar box          (backdrop + sprite)
#    insetDiff     over the box shrunk by 8 px        (drops card borders)
#    maskedDiff    only where the sprite is opaque    (backdrop-free)
#    interiorDiff  only where the sprite is opaque AND a 3x3 erosion of
#                  that mask is still opaque.  Edges are excluded, so
#                  resampling / anti-aliasing / JPEG ringing cannot
#                  influence it.  This is the decisive number: if the
#                  screen really shows this sprite, flat interiors must
#                  match almost exactly.
#
#  usage: powershell -ExecutionPolicy Bypass -File tools\qx\verify_final.ps1
#  ASCII-ONLY source (PS 5.1 reads a BOM-less .ps1 as GBK).
# =====================================================================

$Qx  = $PSScriptRoot
$Out = Join-Path $Qx "out"

$S1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"
$S2 = "C:\Users\18182\.dsh\attachments\v1\objects\d9\d98b4737ebc1cbff5812357be42f89d0f5c7d4ae1ca6278112902ecd2e7e8f68"

$SLOTS = @(
  [pscustomobject]@{ k="A";  src=$S1; tx=127; ty=340; tw=108; th=108; top=@(112042,107016,107258,107283) },
  [pscustomobject]@{ k="B";  src=$S1; tx=127; ty=463; tw=108; th=108; top=@(105104,105105,112005,112004) },
  [pscustomobject]@{ k="C";  src=$S1; tx=127; ty=586; tw=108; th=108; top=@(112031,107356,111025,112030) },
  [pscustomobject]@{ k="D";  src=$S1; tx=127; ty=709; tw=108; th=108; top=@(105105,105104,111137,112004) },
  [pscustomobject]@{ k="B2"; src=$S2; tx=133; ty=314; tw=107; th=107; top=@(105104,105105,112005,112004) },
  [pscustomobject]@{ k="C2"; src=$S2; tx=133; ty=465; tw=107; th=107; top=@(112031,107356,111025,112030) },
  [pscustomobject]@{ k="D2"; src=$S2; tx=133; ty=619; tw=107; th=107; top=@(105105,105104,111137,112004) }
)

function Get-Argb([System.Drawing.Bitmap]$bmp) {
  $w=$bmp.Width; $h=$bmp.Height
  $d=$bmp.LockBits([System.Drawing.Rectangle]::new(0,0,$w,$h),[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride=$d.Stride; $buf=New-Object byte[] ($stride*$h)
  [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0,$buf,0,$buf.Length)
  $bmp.UnlockBits($d)
  return [pscustomobject]@{ w=$w; h=$h; stride=$stride; buf=$buf }
}

function Crop-Tile($srcFile,$tx,$ty,$tw,$th) {
  $img=[System.Drawing.Bitmap]::FromFile($srcFile)
  $bmp = New-Object System.Drawing.Bitmap($tw,$th,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img,[System.Drawing.Rectangle]::new(0,0,$tw,$th),[System.Drawing.Rectangle]::new($tx,$ty,$tw,$th),[System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $img.Dispose()
  return $bmp
}

function Backdrop-Color($bmp,$w,$h) {
  $c1=New-Object System.Collections.ArrayList; $c2=New-Object System.Collections.ArrayList; $c3=New-Object System.Collections.ArrayList
  for($y=0;$y -lt $h;$y++){ for($x=0;$x -lt $w;$x++){
    if($x -lt 3 -or $y -lt 3 -or $x -ge $w-3 -or $y -ge $h-3){
      $c=$bmp.GetPixel($x,$y); [void]$c1.Add($c.R); [void]$c2.Add($c.G); [void]$c3.Add($c.B) } } }
  $c1=@($c1|Sort-Object); $c2=@($c2|Sort-Object); $c3=@($c3|Sort-Object)
  $m=[int]($c1.Count/2)
  return [System.Drawing.Color]::FromArgb(255,$c1[$m],$c2[$m],$c3[$m])
}

function Build-Img($bgc,$tw,$th,$box,$spritePath,$dx,$dy,[bool]$maskOnly) {
  $bmp = New-Object System.Drawing.Bitmap($tw,$th,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if($maskOnly){ $g.Clear([System.Drawing.Color]::FromArgb(0,0,0,0)) } else { $g.Clear($bgc) }
  $im=[System.Drawing.Image]::FromFile($spritePath)
  $sc=[Math]::Min($box/$im.Width,$box/$im.Height)
  $dw=$im.Width*$sc; $dh=$im.Height*$sc
  $px=($tw-$dw)/2.0+$dx; $py=($th-$dh)/2.0+$dy
  $g.DrawImage($im,[System.Drawing.RectangleF]::new([float]$px,[float]$py,[float]$dw,[float]$dh))
  $im.Dispose(); $g.Dispose()
  return $bmp
}

function FullDiff($tileA,$mo) {
  $M=Get-Argb $mo; $s=0.0
  for($y=0;$y -lt $tileA.h;$y++){
    $rm=$y*$M.stride; $rt=$y*$tileA.stride
    for($x=0;$x -lt $tileA.w;$x++){
      $i=$rm+$x*4; $j=$rt+$x*4
      $s += [Math]::Abs([int]$M.buf[$i]  -[int]$tileA.buf[$j])
      $s += [Math]::Abs([int]$M.buf[$i+1]-[int]$tileA.buf[$j+1])
      $s += [Math]::Abs([int]$M.buf[$i+2]-[int]$tileA.buf[$j+2])
    }
  }
  return $s/($tileA.w*$tileA.h*3)
}

$lines = New-Object System.Collections.ArrayList
function Say($t){ Write-Host $t; [void]$lines.Add($t) }
$all = New-Object System.Collections.ArrayList

foreach($sl in $SLOTS){
  $tile = Crop-Tile $sl.src $sl.tx $sl.ty $sl.tw $sl.th
  $bgc  = Backdrop-Color $tile $sl.tw $sl.th
  $tileA= Get-Argb $tile
  Say ""
  Say ("=== slot {0}  (box {1},{2} {3}x{4}, backdrop #{5:X2}{6:X2}{7:X2}) ===" -f $sl.k,$sl.tx,$sl.ty,$sl.tw,$sl.th,$bgc.R,$bgc.G,$bgc.B)
  Say ("    {0,-8} {1,8} {2,9} {3,10} {4,12} {5,7} {6,7} {7,9}" -f "id","fullDiff","insetDiff","maskedDiff","interiorDiff","cov","box","within12")
  foreach($id in $sl.top){
    $f = Get-ChildItem (Join-Path $Qx "sprites\*\${id}.png") -ErrorAction SilentlyContinue | Select-Object -First 1
    if($null -eq $f){ continue }
    $p=$f.FullName
    $bd=999.0; $bb=94.0; $bdx=0.0; $bdy=0.0
    foreach($box in @(84.0,86.0,88.0,90.0,92.0,94.0,96.0,98.0,100.0,102.0,104.0)){
      $m=Build-Img $bgc $sl.tw $sl.th $box $p 0 0 $false
      $d=FullDiff $tileA $m; $m.Dispose()
      if($d -lt $bd){ $bd=$d; $bb=$box; $bdx=0.0; $bdy=0.0 }
    }
    foreach($dx in @(-2.0,-1.0,0.0,1.0,2.0)){ foreach($dy in @(-2.0,-1.0,0.0,1.0,2.0)){
      if($dx -eq 0.0 -and $dy -eq 0.0){ continue }
      $m=Build-Img $bgc $sl.tw $sl.th $bb $p $dx $dy $false
      $d=FullDiff $tileA $m; $m.Dispose()
      if($d -lt $bd){ $bd=$d; $bdx=$dx; $bdy=$dy }
    }}
    $moMod  = Build-Img $bgc $sl.tw $sl.th $bb $p $bdx $bdy $false
    $moMask = Build-Img $bgc $sl.tw $sl.th $bb $p $bdx $bdy $true
    $MM=Get-Argb $moMod; $MK=Get-Argb $moMask

    # precompute an opacity bitmap
    $op = New-Object 'bool[,]' $sl.tw, $sl.th
    for($y=0;$y -lt $sl.th;$y++){ $r=$y*$MK.stride
      for($x=0;$x -lt $sl.tw;$x++){ if($MK.buf[$r+$x*4+3] -ge 250){ $op[$x,$y]=$true } } }

    $mS=0.0; $mN=0; $iS=0.0; $iN=0; $nS=0.0; $nN=0; $closeN=0
    for($y=0;$y -lt $sl.th;$y++){
      $r=$y*$MM.stride
      for($x=0;$x -lt $sl.tw;$x++){
        $i=$r+$x*4
        $dr=[Math]::Abs([int]$MM.buf[$i]  -[int]$tileA.buf[$i])
        $dg=[Math]::Abs([int]$MM.buf[$i+1]-[int]$tileA.buf[$i+1])
        $db=[Math]::Abs([int]$MM.buf[$i+2]-[int]$tileA.buf[$i+2])
        $sum=$dr+$dg+$db
        if($op[$x,$y]){ $mS+=$sum; $mN++ }
        if($x -ge 8 -and $y -ge 8 -and $x -lt $sl.tw-8 -and $y -lt $sl.th-8){ $nS+=$sum; $nN++ }
        if($op[$x,$y] -and $x -ge 1 -and $y -ge 1 -and $x -lt $sl.tw-1 -and $y -lt $sl.th-1){
          # NB: in PowerShell the comma binds tighter than '-', so every index
          # expression here must be parenthesised: $op[$x-1,$y-1] would be
          # parsed as $x - (1, $y-1) and blow up.
          $xm=[int]($x-1); $xp=[int]($x+1); $ym=[int]($y-1); $yp=[int]($y+1)
          $allIn = $op[$xm,$ym] -and $op[$x,$ym] -and $op[$xp,$ym] -and $op[$xm,$y] -and $op[$xp,$y] -and $op[$xm,$yp] -and $op[$x,$yp] -and $op[$xp,$yp]
          if($allIn){ $iS+=$sum; $iN++; if(($sum/3.0) -le 12.0){ $closeN++ } }
        }
      }
    }
    $masked   = if($mN -gt 0){ [Math]::Round($mS/($mN*3),2) }   else { -1 }
    $interior = if($iN -gt 0){ [Math]::Round($iS/($iN*3),2) }   else { -1 }
    $inset    = if($nN -gt 0){ [Math]::Round($nS/($nN*3),2) }   else { -1 }
    $cov      = if($iN -gt 0){ [Math]::Round($iN/[double]($sl.tw*$sl.th),3) } else { 0 }
    $closePct = if($iN -gt 0){ [Math]::Round(100.0*$closeN/$iN,1) } else { 0 }
    Say ("    {0,-8} {1,8} {2,9} {3,10} {4,12} {5,7} {6,7} {7,9}" -f $id,[Math]::Round($bd,2),$inset,$masked,$interior,$cov,$bb,("$closePct%"))
    [void]$all.Add([pscustomobject]@{ slot=$sl.k; id=$id; fullDiff=[Math]::Round($bd,2); insetDiff=$inset; maskedDiff=$masked; interiorDiff=$interior; interiorCoverage=$cov; pctInteriorWithin12=$closePct; fitBox=$bb; dx=$bdx; dy=$bdy })
    $moMod.Dispose(); $moMask.Dispose()
  }
  $tile.Dispose()
}

Say ""
Say "interiorDiff uses only pixels whose full 3x3 sprite-mask neighbourhood is opaque, so it is immune"
Say "to resampling, anti-aliasing and JPEG ringing.  The interior artwork must match almost exactly."

[System.IO.File]::WriteAllText((Join-Path $Out "verify_final.json"),(ConvertTo-Json @($all) -Depth 5),(New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllLines((Join-Path $Out "verify_final_console.txt"),$lines,(New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "wrote out\verify_final.json + out\verify_final_console.txt"
