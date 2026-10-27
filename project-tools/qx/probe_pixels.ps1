$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Qx  = $PSScriptRoot
$Out = Join-Path $Qx "out\avatars"
$S1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"

$img = [System.Drawing.Bitmap]::FromFile($S1)
Write-Host ("image {0}x{1}" -f $img.Width, $img.Height)

function HexAt($bmp,$x,$y){ $c=$bmp.GetPixel($x,$y); return ("{0:X2}{1:X2}{2:X2}" -f $c.R,$c.G,$c.B) }

# find the left/right edges of the avatar slot by scanning a bright-content row
foreach($spec in @(@{n="A";y=395}, @{n="B";y=530}, @{n="C";y=645}, @{n="D";y=770})){
  $n=$spec.n; $y=$spec.y
  Write-Host ""
  Write-Host ("=== row y=$y ($n) horizontal profile x=95..300 step5 ===")
  $line = ""
  for($x=95; $x -le 300; $x+=5){ $line += ("{0}:{1} " -f $x, (HexAt $img $x $y)) }
  Write-Host $line
}

foreach($spec in @(@{n="B";x=175;y0=455;y1=600}, @{n="D";x=175;y0=700;y1=840})){
  $n=$spec.n
  Write-Host ""
  Write-Host ("=== column x=$($spec.x) ($n) vertical profile y=$($spec.y0)..$($spec.y1) step5 ===")
  $line=""
  for($y=$spec.y0; $y -le $spec.y1; $y+=5){ $line += ("{0}:{1} " -f $y, (HexAt $img $spec.x $y)) }
  Write-Host $line
}
$img.Dispose()
