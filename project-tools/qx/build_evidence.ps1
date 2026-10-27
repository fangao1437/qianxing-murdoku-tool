param(
  [Parameter(Mandatory=$true)][string]$Slot,
  [Parameter(Mandatory=$true)][string]$Ids,
  [int]$Zoom = 3,
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# =====================================================================
#  build_evidence.ps1
#  Proof figure for one slot and one candidate sprite id:
#
#    [ SCREEN ] [ REBUILT from id ] [ |diff| x4 heatmap ] [ sprite file ]
#
#  The rebuild uses the same model as identify_avatars.ps1
#  (flat backdrop + sprite contain-fit into a ~94 px box, centred),
#  and the scale / offset are re-optimised here so the figure is
#  self-contained evidence.
#
#  usage:
#    powershell -ExecutionPolicy Bypass -File tools\qx\build_evidence.ps1 -Slot A -Ids 112042,112041,112040
#    powershell -ExecutionPolicy Bypass -File tools\qx\build_evidence.ps1 -Slot B -Ids 105104,112005
#
#  ASCII-ONLY source (PS 5.1 reads a BOM-less .ps1 as GBK).
# =====================================================================

$Qx = $PSScriptRoot
if ($OutDir -eq "") { $OutDir = Join-Path $Qx "out" }
if (!(Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$S1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"
$S2 = "C:\Users\18182\.dsh\attachments\v1\objects\d9\d98b4737ebc1cbff5812357be42f89d0f5c7d4ae1ca6278112902ecd2e7e8f68"

$SLOTS = @{
  "A"  = @{ src=$S1; tx=127; ty=340; tw=108; th=108 }
  "B"  = @{ src=$S1; tx=127; ty=463; tw=108; th=108 }
  "C"  = @{ src=$S1; tx=127; ty=586; tw=108; th=108 }
  "D"  = @{ src=$S1; tx=127; ty=709; tw=108; th=108 }
  "B2" = @{ src=$S2; tx=133; ty=314; tw=107; th=107 }
  "C2" = @{ src=$S2; tx=133; ty=465; tw=107; th=107 }
  "D2" = @{ src=$S2; tx=133; ty=619; tw=107; th=107 }
}
if(!$SLOTS.ContainsKey($Slot)){ throw "unknown slot $Slot" }
# NOTE: PowerShell variable names are case-insensitive, so a variable called
# $s would silently be the same as $S, and $w the same as $W.  Every name
# below is therefore deliberately distinct, not just differently cased.
$sl = $SLOTS[$Slot]

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
  $rs=New-Object System.Collections.ArrayList; $gs=New-Object System.Collections.ArrayList; $bs=New-Object System.Collections.ArrayList
  for($y=0;$y -lt $h;$y++){
    for($x=0;$x -lt $w;$x++){
      if($x -lt 3 -or $y -lt 3 -or $x -ge $w-3 -or $y -ge $h-3){
        $c=$bmp.GetPixel($x,$y); [void]$rs.Add($c.R); [void]$gs.Add($c.G); [void]$bs.Add($c.B)
      }
    }
  }
  $rs=@($rs|Sort-Object); $gs=@($gs|Sort-Object); $bs=@($bs|Sort-Object)
  $m=[int]($rs.Count/2)
  return [System.Drawing.Color]::FromArgb(255,$rs[$m],$gs[$m],$bs[$m])
}

function Build-Model([System.Drawing.Color]$bgc,$tw,$th,$box,$spritePath,$dx,$dy,[bool]$maskOnly) {
  $bmp = New-Object System.Drawing.Bitmap($tw,$th,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if($maskOnly){ $g.Clear([System.Drawing.Color]::FromArgb(0,0,0,0)) } else { $g.Clear($bgc) }
  $im=[System.Drawing.Image]::FromFile($spritePath)
  $s=[Math]::Min($box/$im.Width,$box/$im.Height)
  $w=$im.Width*$s; $h=$im.Height*$s
  $x=($tw-$w)/2.0+$dx; $y=($th-$h)/2.0+$dy
  $g.DrawImage($im,[System.Drawing.RectangleF]::new([float]$x,[float]$y,[float]$w,[float]$h))
  $im.Dispose(); $g.Dispose()
  return $bmp
}

function Score($tileA,$modelBmp) {
  $A=Get-Argb $modelBmp
  $s=0.0
  for($y=0;$y -lt $tileA.h;$y++){
    $r=$y*$A.stride; $rt=$y*$tileA.stride
    for($x=0;$x -lt $tileA.w;$x++){
      $i=$r+$x*4; $j=$rt+$x*4
      $s += [Math]::Abs([int]$A.buf[$i]  -[int]$tileA.buf[$j])
      $s += [Math]::Abs([int]$A.buf[$i+1]-[int]$tileA.buf[$j+1])
      $s += [Math]::Abs([int]$A.buf[$i+2]-[int]$tileA.buf[$j+2])
    }
  }
  return $s/($tileA.w*$tileA.h*3)
}

function Up($bmp,$z){
  $b = New-Object System.Drawing.Bitmap(($bmp.Width*$z),($bmp.Height*$z),[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.DrawImage($bmp,0,0,($bmp.Width*$z),($bmp.Height*$z))
  $g.Dispose(); return $b
}

# ---------------------------------------------------------------------
$tw=$sl.tw; $th=$sl.th
$tile  = Crop-Tile $sl.src $sl.tx $sl.ty $tw $th
$bgc   = Backdrop-Color $tile $tw $th
$tileA = Get-Argb $tile
Write-Host ("slot {0}: box x={1} y={2} {3}x{4}  backdrop=#{5:X2}{6:X2}{7:X2}" -f $Slot,$sl.tx,$sl.ty,$tw,$th,$bgc.R,$bgc.G,$bgc.B)

$font      = New-Object System.Drawing.Font("Arial",14,[System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font("Arial",11)
$white=[System.Drawing.Brushes]::White
$green=[System.Drawing.Brushes]::LightGreen
$red=[System.Drawing.Brushes]::Salmon

$zoom=$Zoom
$panel=$tw*$zoom
$pad=12; $header=32; $foot=110
$figW=$pad+($panel+$pad)*4
$figH=$header+$panel+$foot

$results=New-Object System.Collections.ArrayList
foreach($idStr in ($Ids.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })){
  $id=[int]$idStr
  $f = Get-ChildItem (Join-Path $Qx "sprites\*\${id}.png") -ErrorAction SilentlyContinue | Select-Object -First 1
  if($null -eq $f){ Write-Host "SKIP $id (file not found)"; continue }
  $spPath=$f.FullName

  $bestD=999.0; $bk=94.0; $bdx=0.0; $bdy=0.0
  foreach($box in @(86.0,88.0,90.0,92.0,94.0,96.0,98.0,100.0,102.0)){
    $m=Build-Model $bgc $tw $th $box $spPath 0 0 $false
    $d=Score $tileA $m; $m.Dispose()
    if($d -lt $bestD){ $bestD=$d; $bk=$box; $bdx=0.0; $bdy=0.0 }
  }
  foreach($dx in @(-2.0,-1.0,0.0,1.0,2.0)){ foreach($dy in @(-2.0,-1.0,0.0,1.0,2.0)){
    if($dx -eq 0.0 -and $dy -eq 0.0){ continue }
    $m=Build-Model $bgc $tw $th $bk $spPath $dx $dy $false
    $d=Score $tileA $m; $m.Dispose()
    if($d -lt $bestD){ $bestD=$d; $bdx=$dx; $bdy=$dy }
  }}

  $model=Build-Model $bgc $tw $th $bk $spPath $bdx $bdy $false
  $MA=Get-Argb $model

  $diffBmp=New-Object System.Drawing.Bitmap($tw,$th,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $tMax=0
  for($y=0;$y -lt $th;$y++){
    $ra=$y*$MA.stride
    for($x=0;$x -lt $tw;$x++){
      $i=$ra+$x*4; $j=$y*$tileA.stride+$x*4
      $dr=[Math]::Abs([int]$MA.buf[$i]  -[int]$tileA.buf[$j])
      $dg=[Math]::Abs([int]$MA.buf[$i+1]-[int]$tileA.buf[$j+1])
      $db=[Math]::Abs([int]$MA.buf[$i+2]-[int]$tileA.buf[$j+2])
      $v=[int](($dr+$dg+$db)/3)
      if($v -gt $tMax){ $tMax=$v }
      $vv=[Math]::Min(255,$v*4)
      $diffBmp.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,$vv,$vv,$vv))
    }
  }

  $plate=New-Object System.Drawing.Bitmap($tw,$th,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gp=[System.Drawing.Graphics]::FromImage($plate)
  $gp.Clear([System.Drawing.Color]::FromArgb(255,32,32,32))
  $im=[System.Drawing.Image]::FromFile($spPath)
  $sc=[Math]::Min($bk/$im.Width,$bk/$im.Height)
  $dw=$im.Width*$sc; $dh=$im.Height*$sc
  $gp.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gp.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gp.DrawImage($im,[System.Drawing.RectangleF]::new([float](($tw-$dw)/2.0+$bdx),[float](($th-$dh)/2.0+$bdy),[float]$dw,[float]$dh))
  $im.Dispose(); $gp.Dispose()

  $fig=New-Object System.Drawing.Bitmap($figW,$figH,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $Gfx=[System.Drawing.Graphics]::FromImage($fig)
  $Gfx.Clear([System.Drawing.Color]::FromArgb(255,18,18,22))
  $Gfx.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $sim=[Math]::Round((1.0-$bestD/255.0)*100.0,2)
  $Gfx.DrawString(("slot {0}   candidate id {1}   mean|dRGB| = {2} / 255   similarity = {3}%   (sprite fit box {4} px, offset {5},{6})" -f $Slot,$id,[Math]::Round($bestD,2),$sim,$bk,$bdx,$bdy),$font,$white,10,7)
  $imgs=@($tile,$model,$diffBmp,$plate)
  $caps=@("SCREEN (real pixels)","REBUILT from id $id","|difference| x4","sprite file $id.png")
  for($i=0;$i -lt 4;$i++){
    $x=$pad+$i*($panel+$pad)
    $up=Up $imgs[$i] $zoom
    $Gfx.DrawImage($up,$x,$header,$panel,$panel)
    $Gfx.DrawRectangle([System.Drawing.Pens]::Gray,$x-1,$header-1,$panel+1,$panel+1)
    $br = if($i -eq 2){ $red } else { $green }
    $Gfx.DrawString($caps[$i],$fontSmall,$br,[float]$x,[float]($header+$panel+6))
    $up.Dispose()
  }
  $Gfx.DrawString(("max per-pixel |diff| = {0}/255.  A near-black heatmap = the screen really is this sprite." -f $tMax),$fontSmall,$white,10,($header+$panel+28))
  $sprIm=[System.Drawing.Image]::FromFile($spPath)
  $Gfx.DrawString(("sprite native {0}x{1} px -> drawn into a {2} px box (scale {3:N3});  heatmap white pixels are the only disagreements" -f $sprIm.Width,$sprIm.Height,$bk,([Math]::Min($bk/$sprIm.Width,$bk/$sprIm.Height))),$fontSmall,[System.Drawing.Brushes]::LightGray,10,($header+$panel+50))
  $sprIm.Dispose()
  $Gfx.Dispose()

  $dst=Join-Path $OutDir ("evidence-{0}-{1}.png" -f $Slot,$id)
  $fig.Save($dst,[System.Drawing.Imaging.ImageFormat]::Png)
  $fig.Dispose(); $model.Dispose(); $diffBmp.Dispose(); $plate.Dispose()

  [void]$results.Add([pscustomobject]@{ slot=$Slot; id=$id; diff=[Math]::Round($bestD,2); similarity=$sim; fitBox=$bk; dx=$bdx; dy=$bdy; maxPixel=$tMax; file=$dst })
  Write-Host ("{0}  id={1}  diff={2}  sim={3}%  fitBox={4}  maxpx={5}  -> {6}" -f $Slot,$id,[Math]::Round($bestD,2),$sim,$bk,$tMax,(Split-Path $dst -Leaf))
}
$tile.Dispose()
$jsonPath=Join-Path $OutDir ("evidence-{0}.json" -f $Slot)
[System.IO.File]::WriteAllText($jsonPath,(ConvertTo-Json @($results) -Depth 5),(New-Object System.Text.UTF8Encoding($false)))
Write-Host ("wrote " + (Split-Path $jsonPath -Leaf))
