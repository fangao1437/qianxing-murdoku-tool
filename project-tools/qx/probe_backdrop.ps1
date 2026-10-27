$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# --- 1. why did New-Object Rectangle fail? -------------------------------
Write-Host "=== New-Object syntax tests ==="
foreach($t in @(
   'New-Object System.Drawing.Rectangle(0,5,10,1)',
   'New-Object System.Drawing.Rectangle(2+3,5,10,1)',
   'New-Object System.Drawing.Rectangle -ArgumentList 0,5,10,1',
   '[System.Drawing.Rectangle]::new(0,5,10,1)'
)){
  try { $r = Invoke-Expression $t; Write-Host ("  OK   {0}   -> {1}" -f $t,$r) }
  catch { Write-Host ("  FAIL {0}   -> {1}" -f $t,$_.Exception.Message) }
}

# --- 2. what does the avatar-slot backdrop really look like? -------------
$S1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"
$img = [System.Drawing.Bitmap]::FromFile($S1)

function Grid($tx,$ty,$tw,$th,$tag,$step){
  Write-Host ("--- $tag  tile at ($tx,$ty) $tw x $th   sampled every $step px ---")
  $head = "      "
  for($x=0;$x -lt $tw;$x+=$step){ $head += ("{0,-8}" -f $x) }
  Write-Host $head
  for($y=0;$y -lt $th;$y+=$step){
    $line = ("{0,-6}" -f $y)
    for($x=0;$x -lt $tw;$x+=$step){
      $c=$img.GetPixel($tx+$x,$ty+$y)
      $line += ("{0:X2}{1:X2}{2:X2}  " -f $c.R,$c.G,$c.B)
    }
    Write-Host $line
  }
}
Grid 127 340 108 108 "A (judge)" 12
Grid 127 463 108 108 "B (slime)" 12
$img.Dispose()
