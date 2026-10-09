# resize.ps1 - shrink any image (PNG/JPG/WebP/AVIF...) to a JPEG no larger than MaxDim px. Used so the AI can look at the live viewport
# cheaply. usage: powershell -File resize.ps1 -In <file> -Out <file.jpg> [-MaxDim 900]
param([Parameter(Mandatory=$true)][string]$In, [Parameter(Mandatory=$true)][string]$Out, [int]$MaxDim = 900)
Add-Type -AssemblyName PresentationCore, WindowsBase
$fs = [IO.File]::OpenRead($In)
$dec = [System.Windows.Media.Imaging.BitmapDecoder]::Create($fs, [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
$src = [System.Windows.Media.Imaging.BitmapSource]$dec.Frames[0]
$scale = [math]::Min(1.0, $MaxDim / [double][math]::Max($src.PixelWidth, $src.PixelHeight))
if ($scale -lt 1.0) { $src = New-Object System.Windows.Media.Imaging.TransformedBitmap($src, (New-Object System.Windows.Media.ScaleTransform($scale, $scale))) }
$src = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap($src, [System.Windows.Media.PixelFormats]::Bgr24, $null, 0)
$enc = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder; $enc.QualityLevel = 85
$enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($src))
$o = [IO.File]::Create($Out); $enc.Save($o); $o.Dispose(); $fs.Dispose()
