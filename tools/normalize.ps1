# normalize.ps1 - decode any reference image (jpg/png/bmp/tif/gif/webp/avif/heic/jxl, via Windows WIC codecs) and write a
# size-limited PNG copy into <OutDir>, plus a contact sheet. Never touches the originals.
# usage: powershell -File normalize.ps1 -Folder <style folder> -OutDir <cache dir> [-MaxDim 900]
param([Parameter(Mandatory=$true)][string]$Folder, [Parameter(Mandatory=$true)][string]$OutDir, [int]$MaxDim = 900)
Add-Type -AssemblyName PresentationCore, WindowsBase, System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null
$exts = '.jpg','.jpeg','.png','.bmp','.tif','.tiff','.gif','.webp','.avif','.heic','.heif','.jxl'
$results = @()
foreach ($f in Get-ChildItem $Folder -File | Where-Object { $exts -contains $_.Extension.ToLower() } | Sort-Object Name) {
  $out = Join-Path $OutDir ($f.BaseName + '.png')
  try {
    if ((Test-Path $out) -and ((Get-Item $out).LastWriteTime -gt $f.LastWriteTime)) { $results += [pscustomobject]@{ name=$f.Name; png=$out; status='cached' }; continue }
    $fs = [IO.File]::OpenRead($f.FullName)
    $dec = [System.Windows.Media.Imaging.BitmapDecoder]::Create($fs, [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
    $frame = $dec.Frames[0]; $w = $frame.PixelWidth; $h = $frame.PixelHeight
    $scale = [math]::Min(1.0, $MaxDim / [double][math]::Max($w, $h))
    $src = [System.Windows.Media.Imaging.BitmapSource]$frame
    if ($scale -lt 1.0) { $src = New-Object System.Windows.Media.Imaging.TransformedBitmap($src, (New-Object System.Windows.Media.ScaleTransform($scale, $scale))) }
    $src = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap($src, [System.Windows.Media.PixelFormats]::Bgr24, $null, 0)
    $enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($src))
    $o = [IO.File]::Create($out); $enc.Save($o); $o.Dispose(); $fs.Dispose()
    $results += [pscustomobject]@{ name=$f.Name; png=$out; status='ok'; w=$w; h=$h }
  } catch { $results += [pscustomobject]@{ name=$f.Name; png=$null; status='error: ' + $_.Exception.Message.Split("`n")[0] } }
}
# contact sheet (so a human / model can look at the whole style in one image)
$ok = $results | Where-Object { $_.png -and (Test-Path $_.png) }
if ($ok.Count -gt 0) {
  $cell = 360; $cols = [math]::Min(5, $ok.Count); $rows = [math]::Ceiling($ok.Count / $cols)
  $bmp = New-Object System.Drawing.Bitmap ($cols * $cell), ($rows * $cell); $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(24,26,30)); $g.InterpolationMode = 'HighQualityBicubic'
  $i = 0
  foreach ($r in $ok) {
    $img = [System.Drawing.Image]::FromFile($r.png); $s = [math]::Min(($cell - 8) / $img.Width, ($cell - 8) / $img.Height)
    $dw = [int]($img.Width * $s); $dh = [int]($img.Height * $s); $x = ($i % $cols) * $cell + [int](($cell - $dw) / 2); $y = [math]::Floor($i / $cols) * $cell + [int](($cell - $dh) / 2)
    $g.DrawImage($img, $x, $y, $dw, $dh); $img.Dispose(); $i++
  }
  $g.Dispose(); $bmp.Save((Join-Path $OutDir '_contact_sheet.png'), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
$results | ConvertTo-Json -Compress
