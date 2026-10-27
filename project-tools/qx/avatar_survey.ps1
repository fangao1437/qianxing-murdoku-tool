$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Qx  = $PSScriptRoot
$Out = Join-Path $Qx "out"

# Fast alpha-aware metrics for one or more sprite ids (or a whole block).
function Get-Metrics([string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($path)
  $w = $bmp.Width; $h = $bmp.Height
  $r = New-Object System.Drawing.Rectangle(0,0,$w,$h)
  $d = $bmp.LockBits($r, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $d.Stride
  $buf = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0, $buf, 0, $buf.Length)
  $bmp.UnlockBits($d)
  $minX=$w; $minY=$h; $maxX=-1; $maxY=-1; $n=0; $sr=0.0; $sg=0.0; $sb=0.0
  for($y=0;$y -lt $h;$y++){
    $row=$y*$stride
    for($x=0;$x -lt $w;$x++){
      $i=$row+$x*4
      $a=$buf[$i+3]
      if($a -ge 8){
        if($x -lt $minX){$minX=$x}; if($x -gt $maxX){$maxX=$x}
        if($y -lt $minY){$minY=$y}; if($y -gt $maxY){$maxY=$y}
        if($a -ge 250){ $sr+=$buf[$i+2]; $sg+=$buf[$i+1]; $sb+=$buf[$i]; $n++ }
      }
    }
  }
  $bmp.Dispose()
  $mr = if($n -gt 0){[Math]::Round($sr/$n,1)}else{-1}
  $mg = if($n -gt 0){[Math]::Round($sg/$n,1)}else{-1}
  $mb = if($n -gt 0){[Math]::Round($sb/$n,1)}else{-1}
  return [pscustomobject]@{ w=$w; h=$h; bx=$minX; by=$minY; bw=($maxX-$minX+1); bh=($maxY-$minY+1); opaque=$n; R=$mr; G=$mg; B=$mb }
}

$sp = Join-Path $Qx "sprites"
$targets = @()
foreach($dir in Get-ChildItem $sp -Directory){
  foreach($f in Get-ChildItem $dir.FullName -Filter *.png){
    $targets += $f
  }
}
Write-Host ("scanning {0} sprites..." -f $targets.Count)
$rows = New-Object System.Collections.ArrayList
foreach($f in $targets){
  $id = [int]$f.BaseName
  $m = Get-Metrics $f.FullName
  [void]$rows.Add([pscustomobject]@{ id=$id; dir=$f.Directory.Name; w=$m.w; h=$m.h; bx=$m.bx; by=$m.by; bw=$m.bw; bh=$m.bh; opaque=$m.opaque; R=$m.R; G=$m.G; B=$m.B })
}
$json = ConvertTo-Json -InputObject @{ generated=(Get-Date).ToString("o"); rows=$rows } -Depth 5 -Compress
[System.IO.File]::WriteAllText((Join-Path $Out "sprite_metrics.json"), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("wrote sprite_metrics.json  rows=" + $rows.Count)

# Console table for the 112 block
$rows | Where-Object { $_.id -ge 112000 -and $_.id -lt 113000 } | Sort-Object id |
  Format-Table id,w,h,bw,bh,opaque,R,G,B -AutoSize
