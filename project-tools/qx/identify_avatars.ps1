$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# =====================================================================
#  identify_avatars.ps1
#  Identify the official sprite id behind each clue-card avatar slot in
#  the two supplied game screenshots.
#  (supersedes the untrusted find_asset.ps1 / locate_avatar.ps1 /
#   match_avatar2.ps1, whose results were never validated)
#
#  Facts established by find_slots.ps1 / probe_backdrop.ps1
#  --------------------------------------------------------
#  * Each clue card shows a ~108x108 avatar box at x=127 (screenshot 1)
#    with row pitch 123 (rows y = 340 / 463 / 586 / 709 -> A / B / C / D).
#  * Inside that box the background is an almost flat dark colour
#    (~#262528, JPEG noise +-3) that differs from the card background.
#  * The sprites are TRANSPARENT pngs, so the screen shows
#    "flat backdrop + sprite drawn on top".
#  * The sprite is centred and scaled to fit a box of roughly 94 px
#    (NOT the full 108 px of the avatar box), aspect ratio preserved.
#
#  Metric: mean absolute RGB difference (0..255) between the rebuilt
#  composite and the real screen pixels, over the whole avatar box.
#  Also reported: alpha-masked difference and sprite coverage, an
#  independent check that does not depend on the backdrop model at all.
#
#  Stage 1 : all 1408 sprites x 3 box sizes, 32x32 model  -> shortlist
#  Stage 2 : shortlist, 54x54 model, box size + sub-pixel offset search
#  Stage 3 : top 8 at the native 108x108 + mask diagnostics
#  Stage 4 : B/C/D re-checked against the second screenshot
#
#  ASCII-ONLY source on purpose: Windows PowerShell 5.1 reads a
#  BOM-less .ps1 as GBK and would mangle any non-ASCII literal.
# =====================================================================

$Qx  = $PSScriptRoot
$Out = Join-Path $Qx "out"
if (!(Test-Path $Out)) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }

$S1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"
$S2 = "C:\Users\18182\.dsh\attachments\v1\objects\d9\d98b4737ebc1cbff5812357be42f89d0f5c7d4ae1ca6278112902ecd2e7e8f68"

$SLOTS1 = @(
  [pscustomobject]@{ k="A"; src=$S1; tx=127; ty=340; tw=108; th=108 },
  [pscustomobject]@{ k="B"; src=$S1; tx=127; ty=463; tw=108; th=108 },
  [pscustomobject]@{ k="C"; src=$S1; tx=127; ty=586; tw=108; th=108 },
  [pscustomobject]@{ k="D"; src=$S1; tx=127; ty=709; tw=108; th=108 }
)
$SLOTS2 = @(
  [pscustomobject]@{ k="B2"; src=$S2; tx=133; ty=314; tw=107; th=107 },
  [pscustomobject]@{ k="C2"; src=$S2; tx=133; ty=465; tw=107; th=107 },
  [pscustomobject]@{ k="D2"; src=$S2; tx=133; ty=619; tw=107; th=107 }
)

function Get-Argb([System.Drawing.Bitmap]$bmp) {
  $w=$bmp.Width; $h=$bmp.Height
  $d=$bmp.LockBits([System.Drawing.Rectangle]::new(0,0,$w,$h),[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride=$d.Stride; $buf=New-Object byte[] ($stride*$h)
  [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0,$buf,0,$buf.Length)
  $bmp.UnlockBits($d)
  return [pscustomobject]@{ w=$w; h=$h; stride=$stride; buf=$buf }
}

function MeanAbsRGB($A,$B) {
  $bufa=$A.buf; $bufb=$B.buf; $sa=$A.stride; $sb=$B.stride
  $w=$A.w; $h=$A.h; $s=0.0
  for($y=0;$y -lt $h;$y++){
    $ra=$y*$sa; $rb=$y*$sb
    for($x=0;$x -lt $w;$x++){
      $ia=$ra+($x*4); $ib=$rb+($x*4)
      $s += [Math]::Abs([int]$bufa[$ia]   - [int]$bufb[$ib])
      $s += [Math]::Abs([int]$bufa[$ia+1] - [int]$bufb[$ib+1])
      $s += [Math]::Abs([int]$bufa[$ia+2] - [int]$bufb[$ib+2])
    }
  }
  return $s / ($w*$h*3)
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

function Resize-Bmp($srcBmp,$nw,$nh) {
  $bmp = New-Object System.Drawing.Bitmap($nw,$nh,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($srcBmp,[System.Drawing.Rectangle]::new(0,0,$nw,$nh))
  $g.Dispose()
  return $bmp
}

function Build-Model([System.Drawing.Color]$bgc,$tw,$th,$box,$spritePath,$dx,$dy,[bool]$maskOnly) {
  $bmp = New-Object System.Drawing.Bitmap($tw,$th,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if($maskOnly){ $g.Clear([System.Drawing.Color]::FromArgb(0,0,0,0)) } else { $g.Clear($bgc) }
  try { $im=[System.Drawing.Image]::FromFile($spritePath) } catch { $g.Dispose(); $bmp.Dispose(); return $null }
  $s = [Math]::Min($box/$im.Width, $box/$im.Height)
  $w = $im.Width*$s; $h=$im.Height*$s
  $x = ($tw-$w)/2.0 + $dx; $y = ($th-$h)/2.0 + $dy
  $g.DrawImage($im,[System.Drawing.RectangleF]::new([float]$x,[float]$y,[float]$w,[float]$h))
  $im.Dispose(); $g.Dispose()
  return $bmp
}

function Prepare-Slots($slots,$K) {
  foreach($s in $slots){
    $tileFull = Crop-Tile $s.src $s.tx $s.ty $s.tw $s.th
    $bgc = Backdrop-Color $tileFull $s.tw $s.th
    $s | Add-Member -NotePropertyName tileFull -NotePropertyValue $tileFull -Force
    $s | Add-Member -NotePropertyName bgColor  -NotePropertyValue $bgc -Force
    $s | Add-Member -NotePropertyName tileArgbFull -NotePropertyValue (Get-Argb $tileFull) -Force
    $sm = Resize-Bmp $tileFull $K $K
    $s | Add-Member -NotePropertyName tileArgbK -NotePropertyValue (Get-Argb $sm) -Force
  }
  return $slots
}

# ---------------- inventory ----------------
$sprites = @()
foreach($dir in Get-ChildItem (Join-Path $Qx "sprites") -Directory){
  foreach($f in Get-ChildItem $dir.FullName -Filter *.png){
    $sprites += [pscustomobject]@{ id=[int]$f.BaseName; path=$f.FullName }
  }
}
$sprites = @($sprites | Sort-Object id)
$byId=@{}; foreach($sp in $sprites){ $byId[$sp.id]=$sp.path }
Write-Host ("sprites: {0}" -f $sprites.Count)

# ---------------- stage 1 ----------------
$K1 = 32
$BOXES1 = @(86.0, 94.0, 102.0)
Write-Host "== preparing stage-1 slots =="
$SLOTS1 = Prepare-Slots $SLOTS1 $K1
foreach($s in $SLOTS1){
  $b=$s.bgColor
  Write-Host ("  {0}: box=({1},{2},{3},{4}) backdrop=#{5:X2}{6:X2}{7:X2}" -f $s.k,$s.tx,$s.ty,$s.tw,$s.th,$b.R,$b.G,$b.B)
}

Write-Host ("== stage 1: {0} sprites x {1} boxes x {2} slots @ {3}x{3} ==" -f $sprites.Count,$BOXES1.Count,$SLOTS1.Count,$K1)
$sw=[System.Diagnostics.Stopwatch]::StartNew()
$stage1=@{}
foreach($s in $SLOTS1){ $stage1[$s.k]=New-Object System.Collections.ArrayList }
$done=0
foreach($sp in $sprites){
  $done++
  if($done % 200 -eq 0){ Write-Host ("   {0}/{1}  {2:N0}s" -f $done,$sprites.Count,$sw.Elapsed.TotalSeconds) }
  foreach($s in $SLOTS1){
    $bd=999.0; $bb=94.0
    $Kf = $K1 / [double]$s.tw
    foreach($box in $BOXES1){
      $m = Build-Model $s.bgColor $K1 $K1 ($box*$Kf) $sp.path 0 0 $false
      if($null -eq $m){ continue }
      $d = MeanAbsRGB $s.tileArgbK (Get-Argb $m); $m.Dispose()
      if($d -lt $bd){ $bd=$d; $bb=$box }
    }
    [void]$stage1[$s.k].Add([pscustomobject]@{ id=$sp.id; d=$bd; box=$bb })
  }
}
Write-Host ("   stage 1 finished in {0:N0}s" -f $sw.Elapsed.TotalSeconds)

# ---------------- stage 2 ----------------
$K2 = 54
$TOPN = 30
$BOXES2 = @(86.0,88.0,90.0,92.0,94.0,96.0,98.0,100.0,102.0)
$OFF = @(-4.0,-2.0,0.0,2.0,4.0)
Write-Host "== preparing stage-2 slots =="
$SLOTS1 = Prepare-Slots $SLOTS1 $K2

$refined=@{}
foreach($s in $SLOTS1){
  $short = @($stage1[$s.k] | Sort-Object d | Select-Object -First $TOPN)
  $lst = New-Object System.Collections.ArrayList
  foreach($c in $short){
    $p=$byId[$c.id]
    $Kf = $K2 / [double]$s.tw
    $bd=999.0; $bb=94.0
    foreach($box in $BOXES2){
      $m = Build-Model $s.bgColor $K2 $K2 ($box*$Kf) $p 0 0 $false
      if($null -eq $m){ continue }
      $d = MeanAbsRGB $s.tileArgbK (Get-Argb $m); $m.Dispose()
      if($d -lt $bd){ $bd=$d; $bb=$box }
    }
    $bdx=0.0; $bdy=0.0
    foreach($dx in $OFF){ foreach($dy in $OFF){
      if($dx -eq 0.0 -and $dy -eq 0.0){ continue }
      $m = Build-Model $s.bgColor $K2 $K2 ($bb*$Kf) $p $dx $dy $false
      if($null -eq $m){ continue }
      $d = MeanAbsRGB $s.tileArgbK (Get-Argb $m); $m.Dispose()
      if($d -lt $bd){ $bd=$d; $bdx=$dx; $bdy=$dy }
    }}
    [void]$lst.Add([pscustomobject]@{ id=$c.id; d2=$bd; d1=$c.d; box=$bb; dx=$bdx; dy=$bdy })
  }
  $refined[$s.k]=@($lst | Sort-Object d2)
}
Write-Host "== stage 2 done =="

# ---------------- stage 3 ----------------
Write-Host "== stage 3: native 108x108 re-score =="
$final=@{}
foreach($s in $SLOTS1){
  $lst=New-Object System.Collections.ArrayList
  # normalise: the ranking value may come back wrapped in an extra array
  $cand = @($refined[$s.k])
  if($cand.Count -eq 1 -and $cand[0] -is [array]){ $cand = @($cand[0]) }
  $cand = @($cand | Select-Object -First 8)
  Write-Host ("   slot {0}: {1} candidates at native resolution" -f $s.k,$cand.Count)
  foreach($c in $cand){
    if($c -is [array]){ $c = $c[0] }
    $p=$byId[[int]$c.id]
    $bb=[double]($c.box); $bd=999.0; $bdx=0.0; $bdy=0.0
    foreach($box in @(($bb-2.0),($bb-1.0),$bb,($bb+1.0),($bb+2.0))){
      $m = Build-Model $s.bgColor $s.tw $s.th $box $p 0 0 $false
      $d = MeanAbsRGB $s.tileArgbFull (Get-Argb $m); $m.Dispose()
      if($d -lt $bd){ $bd=$d; $bb=$box; $bdx=0.0; $bdy=0.0 }
    }
    foreach($dx in @(-2.0,-1.0,1.0,2.0)){ foreach($dy in @(-2.0,-1.0,1.0,2.0)){
      $m = Build-Model $s.bgColor $s.tw $s.th $bb $p $dx $dy $false
      $d = MeanAbsRGB $s.tileArgbFull (Get-Argb $m); $m.Dispose()
      if($d -lt $bd){ $bd=$d; $bdx=$dx; $bdy=$dy }
    }}
    $mMask = Build-Model $s.bgColor $s.tw $s.th $bb $p $bdx $bdy $true
    $mMod  = Build-Model $s.bgColor $s.tw $s.th $bb $p $bdx $bdy $false
    $MA = Get-Argb $mMask; $MM = Get-Argb $mMod
    $sSum=0.0; $cov=0
    for($y=0;$y -lt $s.th;$y++){
      $ra=$y*$MA.stride
      for($x=0;$x -lt $s.tw;$x++){
        $i=$ra+$x*4
        if($MA.buf[$i+3] -ge 250){
          $cov++
          $sSum += [Math]::Abs([int]$MM.buf[$i]  -[int]$s.tileArgbFull.buf[$i])
          $sSum += [Math]::Abs([int]$MM.buf[$i+1]-[int]$s.tileArgbFull.buf[$i+1])
          $sSum += [Math]::Abs([int]$MM.buf[$i+2]-[int]$s.tileArgbFull.buf[$i+2])
        }
      }
    }
    $maskDiff = if($cov -gt 0){ $sSum/($cov*3) } else { 999.0 }
    $coverage = $cov/[double]($s.tw*$s.th)
    $mMask.Dispose(); $mMod.Dispose()
    [void]$lst.Add([pscustomobject]@{ id=$c.id; dFull=[Math]::Round($bd,2); box=$bb; dx=$bdx; dy=$bdy; maskDiff=[Math]::Round($maskDiff,2); coverage=[Math]::Round($coverage,3); d2=[Math]::Round($c.d2,2); d1=[Math]::Round($c.d1,2) })
  }
  $final[$s.k]=@($lst | Sort-Object dFull)
}

# ---------------- stage 4 ----------------
Write-Host "== stage 4: cross-check in screenshot 2 =="
$SLOTS2 = Prepare-Slots $SLOTS2 $K2
$cross=@{}
foreach($s in $SLOTS2){
  $letter=$s.k.Substring(0,1)
  $lst=New-Object System.Collections.ArrayList
  foreach($c in @($final[$letter] | Select-Object -First 5)){
    $p=$byId[$c.id]
    $Kf=$K2/[double]$s.tw
    $bd=999.0; $bb=94.0
    foreach($box in $BOXES2){
      $m = Build-Model $s.bgColor $K2 $K2 ($box*$Kf) $p 0 0 $false
      $d = MeanAbsRGB $s.tileArgbK (Get-Argb $m); $m.Dispose()
      if($d -lt $bd){ $bd=$d; $bb=$box }
    }
    $bdx=0.0;$bdy=0.0
    foreach($dx in $OFF){ foreach($dy in $OFF){
      if($dx -eq 0.0 -and $dy -eq 0.0){ continue }
      $m = Build-Model $s.bgColor $K2 $K2 ($bb*$Kf) $p $dx $dy $false
      $d = MeanAbsRGB $s.tileArgbK (Get-Argb $m); $m.Dispose()
      if($d -lt $bd){ $bd=$d; $bdx=$dx; $bdy=$dy }
    }}
    [void]$lst.Add([pscustomobject]@{ id=$c.id; d2=[Math]::Round($bd,2); box=$bb })
  }
  $cross[$s.k]=@($lst | Sort-Object d2)
}

# ---------------- report ----------------
$lines=New-Object System.Collections.ArrayList
function Say($t){ Write-Host $t; [void]$lines.Add($t) }
Say ""
Say "================ RESULTS ================"
Say "metric: mean absolute RGB difference (0..255) over the whole 108x108 avatar box; lower = better"
foreach($s in $SLOTS1){
  Say ""
  Say ("--- slot {0}   (screenshot s1, box x={1} y={2} {3}x{4}, backdrop #{5:X2}{6:X2}{7:X2}) ---" -f $s.k,$s.tx,$s.ty,$s.tw,$s.th,$s.bgColor.R,$s.bgColor.G,$s.bgColor.B)
  $i=0
  foreach($c in $final[$s.k]){
    $i++
    Say ("  #{0}  id={1}   diff={2}   maskedDiff={3} (coverage {4})   spriteBox={5}  off=({6},{7})" -f $i,$c.id,$c.dFull,$c.maskDiff,$c.coverage,$c.box,$c.dx,$c.dy)
  }
}
Say ""
Say "--- cross-check of the same suspects in screenshot 2 ---"
foreach($k in @("B2","C2","D2")){
  $t=($cross[$k] | ForEach-Object { "id=$($_.id) d=$($_.d2)" }) -join "   |   "
  Say ("  {0}: {1}" -f $k,$t)
}

$report=[pscustomobject]@{
  generated=(Get-Date).ToString("o")
  method="composite model (flat backdrop + sprite contain-fit into a ~94px box) vs real screen pixels; mean absolute RGB diff 0..255 over the whole avatar box"
  slots1=$SLOTS1 | ForEach-Object { [pscustomobject]@{ k=$_.k; src=(Split-Path $_.src -Leaf).Substring(0,8); x=$_.tx; y=$_.ty; w=$_.tw; h=$_.th; backdrop=("#{0:X2}{1:X2}{2:X2}" -f $_.bgColor.R,$_.bgColor.G,$_.bgColor.B) } }
  ranking=$final
  crossCheck=$cross
}
[System.IO.File]::WriteAllText((Join-Path $Out "avatar_match_report.json"),(ConvertTo-Json $report -Depth 6),(New-Object System.Text.UTF8Encoding($false)))
[System.IO.File]::WriteAllLines((Join-Path $Out "avatar_match_console.txt"),$lines,(New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "wrote out\avatar_match_report.json + out\avatar_match_console.txt"
