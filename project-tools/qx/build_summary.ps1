$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# =====================================================================
#  build_summary.ps1
#  One-page summary figure: for each of the four clue-card avatars,
#  [ SCREEN ] [ REBUILT from the concluded id ] [ |difference| x4 ]
#  written to tools\qx\out\evidence-ALL.png
#
#  usage: powershell -ExecutionPolicy Bypass -File tools\qx\build_summary.ps1
#  ASCII-ONLY source (PS 5.1 reads a BOM-less .ps1 as GBK).
# =====================================================================

$Qx  = $PSScriptRoot
$Out = Join-Path $Qx "out"

$S1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"

# letter, id, tile x/y/w/h in s1, label
$ROWS = @(
  [pscustomobject]@{ k="A"; id=112042; tx=127; ty=340; tw=108; th=108; lbl="judge / red top hat" },
  [pscustomobject]@{ k="B"; id=105104; tx=127; ty=463; tw=108; th=108; lbl="mint slime" },
  [pscustomobject]@{ k="C"; id=112031; tx=127; ty=586; tw=108; th=108; lbl="mask + headband" },
  [pscustomobject]@{ k="D"; id=105105; tx=127; ty=709; tw=108; th=108; lbl="cyan slime" }
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

function Build-Img($bgc,$tw,$th,$box,$spritePath,$dx,$dy) {
  $bmp = New-Object System.Drawing.Bitmap($tw,$th,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear($bgc)
  $im=[System.Drawing.Image]::FromFile($spritePath)
  $sc=[Math]::Min($box/$im.Width,$box/$im.Height)
  $dw=$im.Width*$sc; $dh=$im.Height*$sc
  $px=($tw-$dw)/2.0+$dx; $py=($th-$dh)/2.0+$dy
  $g.DrawImage($im,[System.Drawing.RectangleF]::new([float]$px,[float]$py,[float]$dw,[float]$dh))
  $im.Dispose(); $g.Dispose()
  return $bmp
}

function Up($bmp,$z){
  $b = New-Object System.Drawing.Bitmap(($bmp.Width*$z),($bmp.Height*$z),[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.DrawImage($bmp,0,0,($bmp.Width*$z),($bmp.Height*$z))
  $g.Dispose(); return $b
}

$zoom=2
$panel=108*$zoom
$labelW=210
$pad=12
$header=48
$rowH=$panel+30
$figW=$pad+$labelW+($panel+$pad)*3
$figH=$header+$rowH*$ROWS.Count+$pad

$fig=New-Object System.Drawing.Bitmap($figW,$figH,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$Gfx=[System.Drawing.Graphics]::FromImage($fig)
$Gfx.Clear([System.Drawing.Color]::FromArgb(255,18,18,22))
$Gfx.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$fH =New-Object System.Drawing.Font("Arial",17,[System.Drawing.FontStyle]::Bold)
$fS =New-Object System.Drawing.Font("Arial",11)
$fL =New-Object System.Drawing.Font("Arial",12,[System.Drawing.FontStyle]::Bold)
$white=[System.Drawing.Brushes]::White
$green=[System.Drawing.Brushes]::LightGreen
$red  =[System.Drawing.Brushes]::Salmon

$Gfx.DrawString("Clue-card avatars -> official asset id  (left: real screen pixels / middle: rebuilt from the id / right: |difference| x4)",$fS,$white,10,8)
$Gfx.DrawString("SCREEN",$fS,$green,[float]($pad+$labelW),[float]($header-18))
$Gfx.DrawString("REBUILT",$fS,$green,[float]($pad+$labelW+$panel+$pad),[float]($header-18))
$Gfx.DrawString("|diff| x4",$fS,$red,[float]($pad+$labelW+($panel+$pad)*2),[float]($header-18))

$row=0
foreach($r in $ROWS){
  $y=$header+$row*$rowH
  $tile=Crop-Tile $S1 $r.tx $r.ty $r.tw $r.th
  $bgc=Backdrop-Color $tile $r.tw $r.th
  $tileA=Get-Argb $tile
  $sp=(Get-ChildItem (Join-Path $Qx "sprites\*\$( $r.id ).png") -ErrorAction SilentlyContinue | Select-Object -First 1)
  if($null -eq $sp){ Write-Host ("missing sprite " + $r.id); $row++; continue }
  $spPath=$sp.FullName

  $bestD=999.0; $bk=94.0; $bdx=0.0; $bdy=0.0
  foreach($box in @(86.0,88.0,90.0,92.0,94.0,96.0,98.0,100.0)){
    $m=Build-Img $bgc $r.tw $r.th $box $spPath 0 0
    $A=Get-Argb $m; $s=0.0
    for($yy=0;$yy -lt $r.th;$yy++){ $ra=$yy*$A.stride
      for($xx=0;$xx -lt $r.tw;$xx++){ $i=$ra+$xx*4
        $s += [Math]::Abs([int]$A.buf[$i]-[int]$tileA.buf[$i]) + [Math]::Abs([int]$A.buf[$i+1]-[int]$tileA.buf[$i+1]) + [Math]::Abs([int]$A.buf[$i+2]-[int]$tileA.buf[$i+2]) } }
    $d=$s/($r.tw*$r.th*3); $m.Dispose()
    if($d -lt $bestD){ $bestD=$d; $bk=$box; $bdx=0.0; $bdy=0.0 }
  }
  foreach($dx in @(-2.0,-1.0,0.0,1.0,2.0)){ foreach($dy in @(-2.0,-1.0,0.0,1.0,2.0)){
    if($dx -eq 0.0 -and $dy -eq 0.0){ continue }
    $m=Build-Img $bgc $r.tw $r.th $bk $spPath $dx $dy
    $A=Get-Argb $m; $s=0.0
    for($yy=0;$yy -lt $r.th;$yy++){ $ra=$yy*$A.stride
      for($xx=0;$xx -lt $r.tw;$xx++){ $i=$ra+$xx*4
        $s += [Math]::Abs([int]$A.buf[$i]-[int]$tileA.buf[$i]) + [Math]::Abs([int]$A.buf[$i+1]-[int]$tileA.buf[$i+1]) + [Math]::Abs([int]$A.buf[$i+2]-[int]$tileA.buf[$i+2]) } }
    $d=$s/($r.tw*$r.th*3); $m.Dispose()
    if($d -lt $bestD){ $bestD=$d; $bdx=$dx; $bdy=$dy }
  }}

  $model=Build-Img $bgc $r.tw $r.th $bk $spPath $bdx $bdy
  $MA=Get-Argb $model
  $diffBmp=New-Object System.Drawing.Bitmap($r.tw,$r.th,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for($yy=0;$yy -lt $r.th;$yy++){ $ra=$yy*$MA.stride
    for($xx=0;$xx -lt $r.tw;$xx++){ $i=$ra+$xx*4
      $v=[int](([Math]::Abs([int]$MA.buf[$i]-[int]$tileA.buf[$i]) + [Math]::Abs([int]$MA.buf[$i+1]-[int]$tileA.buf[$i+1]) + [Math]::Abs([int]$MA.buf[$i+2]-[int]$tileA.buf[$i+2]))/3)
      $vv=[Math]::Min(255,$v*4)
      $diffBmp.SetPixel($xx,$yy,[System.Drawing.Color]::FromArgb(255,$vv,$vv,$vv)) } }

  $imgs=@($tile,$model,$diffBmp)
  for($i=0;$i -lt 3;$i++){
    $x=$pad+$labelW+$i*($panel+$pad)
    $up=Up $imgs[$i] $zoom
    $Gfx.DrawImage($up,$x,$y,$panel,$panel)
    $Gfx.DrawRectangle([System.Drawing.Pens]::Gray,$x-1,$y-1,$panel+1,$panel+1)
    $up.Dispose()
  }
  $sim=[Math]::Round((1.0-$bestD/255.0)*100.0,2)
  $Gfx.DrawString(("{0}" -f $r.k),$fH,$white,[float]$pad,[float]($y+4))
  $Gfx.DrawString(("id {0}" -f $r.id),$fL,$green,[float]$pad,[float]($y+30))
  $Gfx.DrawString(("diff {0}" -f [Math]::Round($bestD,2)),$fS,$white,[float]$pad,[float]($y+54))
  $Gfx.DrawString(("sim {0}%" -f $sim),$fS,$white,[float]$pad,[float]($y+72))
  $Gfx.DrawString($r.lbl,$fS,[System.Drawing.Brushes]::LightGray,[float]$pad,[float]($y+94))
  $model.Dispose(); $diffBmp.Dispose(); $tile.Dispose()
  Write-Host ("{0} id={1} diff={2} sim={3}%" -f $r.k,$r.id,[Math]::Round($bestD,2),$sim)
  $row++
}
$Gfx.Dispose()
$dst=Join-Path $Out "evidence-ALL.png"
$fig.Save($dst,[System.Drawing.Imaging.ImageFormat]::Png)
$fig.Dispose()
Write-Host ("wrote " + $dst)
