$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Qx = $PSScriptRoot
$S1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"
$S2 = "C:\Users\18182\.dsh\attachments\v1\objects\d9\d98b4737ebc1cbff5812357be42f89d0f5c7d4ae1ca6278112902ecd2e7e8f68"

function Find-Slots([string]$path, [string]$tag) {
  $bmp = New-Object System.Drawing.Bitmap($path)
  $w=$bmp.Width; $h=$bmp.Height
  $d=$bmp.LockBits((New-Object System.Drawing.Rectangle(0,0,$w,$h)), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride=$d.Stride; $buf=New-Object byte[] ($stride*$h)
  [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0,$buf,0,$buf.Length); $bmp.UnlockBits($d); $bmp.Dispose()

  # "purple tile background" test: blue channel notably above red, dark overall
  $X0=100; $X1=300; $Y0=300; $Y1=860
  $mask = New-Object 'bool[,]' ($X1-$X0+1), ($Y1-$Y0+1)
  $colCount = New-Object int[] ($Y1-$Y0+1)
  for($y=$Y0;$y -le $Y1;$y++){
    $row=$y*$stride
    for($x=$X0;$x -le $X1;$x++){
      $i=$row+$x*4
      $b=$buf[$i]; $g=$buf[$i+1]; $r=$buf[$i+2]
      $lum = 0.299*$r + 0.587*$g + 0.114*$b
      $ok = (($b - $r) -ge 4) -and ($lum -lt 95) -and ($b -ge 20)
      if($ok){ $mask[($x-$X0),($y-$Y0)]=$true; $colCount[($y-$Y0)]++ }
    }
  }
  # rows where most of the x-range is purple => inside a tile band
  Write-Host ("--- $tag : rows with >=30 purple px in x[$X0..$X1] ---")
  $runStart=-1
  for($y=$Y0;$y -le $Y1;$y++){
    $c=$colCount[($y-$Y0)]
    if($c -ge 30){ if($runStart -lt 0){$runStart=$y} }
    else { if($runStart -ge 0){ Write-Host ("  band y {0}..{1}  (h={2})" -f $runStart,($y-1),($y-$runStart)); $runStart=-1 } }
  }
  if($runStart -ge 0){ Write-Host ("  band y {0}..{1} (h={2})" -f $runStart,$Y1,($Y1-$runStart+1)) }

  # within the first band, find x extent
  Write-Host ("--- $tag : x extent per band ---")
  $runStart=-1
  for($y=$Y0;$y -le $Y1;$y++){
    $c=$colCount[($y-$Y0)]
    if($c -ge 30){ if($runStart -lt 0){$runStart=$y} }
    else {
      if($runStart -ge 0){
        $ym=[int](($runStart+$y-1)/2)
        $xs=-1;$xe=-1
        for($x=$X0;$x -le $X1;$x++){ if($mask[($x-$X0),($ym-$Y0)]){ if($xs -lt 0){$xs=$x}; $xe=$x } }
        Write-Host ("  band y {0}..{1}: x {2}..{3}  (w={4})" -f $runStart,($y-1),$xs,$xe,($xe-$xs+1))
        $runStart=-1
      }
    }
  }
}

Find-Slots $S1 "s1"
Find-Slots $S2 "s2"
