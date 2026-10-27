$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# ASCII-only script: never embed non-ASCII literals (PS 5.1 reads BOM-less files as GBK).
$Qx  = $PSScriptRoot
$Out = Join-Path $Qx "out\avatars"
if (!(Test-Path $Out)) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }

$S1 = "C:\Users\18182\.dsh\attachments\v1\objects\93\93f31f24b7ee79798dc7d39efd8d94e6a06046f0ffa7d0733b87fbc69bcd6c98"
$S2 = "C:\Users\18182\.dsh\attachments\v1\objects\d9\d98b4737ebc1cbff5812357be42f89d0f5c7d4ae1ca6278112902ecd2e7e8f68"

function CropSave($src, $x, $y, $w, $h, $dst, $scale) {
  $img = [System.Drawing.Image]::FromFile($src)
  try {
    $ow = [int]($w * $scale); $oh = [int]($h * $scale)
    $bmp = New-Object System.Drawing.Bitmap($ow, $oh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0,0,$ow,$oh)), (New-Object System.Drawing.Rectangle($x,$y,$w,$h)), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  } finally { $img.Dispose() }
}

CropSave $S1 80 260 520 620 (Join-Path $Out "s1_cluebar.png") 1
CropSave $S2 80 260 520 620 (Join-Path $Out "s2_cluebar.png") 1
CropSave $S1 110 280 320 620 (Join-Path $Out "s1_avatars_x3.png") 3
CropSave $S2 110 280 320 620 (Join-Path $Out "s2_avatars_x3.png") 3

Write-Host "Qx=$Qx"
Get-ChildItem $Out | Select-Object Length, Name | Format-Table -AutoSize
