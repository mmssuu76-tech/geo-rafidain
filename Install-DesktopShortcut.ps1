Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$svgPath = Join-Path $projectRoot 'assets\iraq-mark.svg'
$iconPath = Join-Path $projectRoot 'assets\geo-rafidain.ico'
$previewPath = Join-Path $projectRoot 'assets\geo-rafidain-icon.png'
$launcherPath = Join-Path $projectRoot 'Start-GeoRafidain.cmd'
$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$siteUrl = 'https://mmssuu76-tech.github.io/geo-rafidain/'
$arabicBaseName = (-join ([char[]](0x062C,0x064A,0x0648,0x20,0x0627,0x0644,0x0631,0x0627,0x0641,0x062F,0x064A,0x0646)))
$arabicShortcutName = $arabicBaseName + '.url'
$arabicShortcutPath = Join-Path $desktopPath $arabicShortcutName
$legacyArabicShortcutPath = Join-Path $desktopPath ($arabicBaseName + '.lnk')
$legacyShortcutPath = Join-Path $desktopPath 'GeoRafidain.lnk'

if (-not (Test-Path -LiteralPath $svgPath -PathType Leaf)) { throw "Iraq mark SVG was not found: $svgPath" }

Add-Type -AssemblyName System.Drawing

[xml]$svg = Get-Content -Raw -Encoding UTF8 -LiteralPath $svgPath
$pathNode = $svg.SelectSingleNode("//*[local-name()='path']")
if (-not $pathNode) { throw 'The Iraq SVG does not contain a path.' }

$mainPathData = ($pathNode.GetAttribute('d') -split 'Z')[0]
$matches = [regex]::Matches($mainPathData, '(?<command>[ML])(?<x>\d+(?:\.\d+)?),(?<y>\d+(?:\.\d+)?)')
if ($matches.Count -lt 3) { throw 'The Iraq outline could not be read from the SVG.' }

$culture = [Globalization.CultureInfo]::InvariantCulture
$rawPoints = foreach ($match in $matches) {
  [Drawing.PointF]::new(
    [single][double]::Parse($match.Groups['x'].Value, $culture),
    [single][double]::Parse($match.Groups['y'].Value, $culture)
  )
}

$minX = ($rawPoints | Measure-Object X -Minimum).Minimum
$maxX = ($rawPoints | Measure-Object X -Maximum).Maximum
$minY = ($rawPoints | Measure-Object Y -Minimum).Minimum
$maxY = ($rawPoints | Measure-Object Y -Maximum).Maximum
$scale = [Math]::Min(196 / ($maxX - $minX), 196 / ($maxY - $minY))
$offsetX = (256 - (($maxX - $minX) * $scale)) / 2
$offsetY = (256 - (($maxY - $minY) * $scale)) / 2

[Drawing.PointF[]]$iconPoints = foreach ($point in $rawPoints) {
  [Drawing.PointF]::new(
    [single](($point.X - $minX) * $scale + $offsetX),
    [single](($point.Y - $minY) * $scale + $offsetY)
  )
}

$bitmap = [Drawing.Bitmap]::new(256, 256, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::Transparent)

$tile = [Drawing.Drawing2D.GraphicsPath]::new()
$tile.AddArc(8, 8, 56, 56, 180, 90)
$tile.AddArc(192, 8, 56, 56, 270, 90)
$tile.AddArc(192, 192, 56, 56, 0, 90)
$tile.AddArc(8, 192, 56, 56, 90, 90)
$tile.CloseFigure()

$backgroundBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 18, 63, 56))
$mapBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 255, 240, 203))
$mapPen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(255, 201, 156, 73), 5)
$mapPen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round

$graphics.FillPath($backgroundBrush, $tile)
$graphics.FillPolygon($mapBrush, $iconPoints)
$graphics.DrawPolygon($mapPen, $iconPoints)
$bitmap.Save($previewPath, [Drawing.Imaging.ImageFormat]::Png)

$iconHandle = $bitmap.GetHicon()
$icon = [Drawing.Icon]::FromHandle($iconHandle)
$iconStream = [IO.File]::Create($iconPath)
$icon.Save($iconStream)
$iconStream.Dispose()
$icon.Dispose()
$mapPen.Dispose()
$mapBrush.Dispose()
$backgroundBrush.Dispose()
$tile.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

$shell = New-Object -ComObject WScript.Shell

# Remove only older local shortcuts created by this installer.
Get-ChildItem -LiteralPath $desktopPath -Filter '*.lnk' -File | ForEach-Object {
  $candidate = $shell.CreateShortcut($_.FullName)
  if ($candidate.TargetPath -eq $launcherPath -or $candidate.Arguments -like '*local-server.ps1*' -or $_.FullName -eq $legacyShortcutPath -or $_.FullName -eq $legacyArabicShortcutPath) {
    Remove-Item -LiteralPath $_.FullName -Force
  }
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($candidate)
}

if (Test-Path -LiteralPath $arabicShortcutPath) {
  Remove-Item -LiteralPath $arabicShortcutPath -Force
}

$urlShortcutLines = @(
  '[InternetShortcut]'
  "URL=$siteUrl"
  "IconFile=$iconPath"
  'IconIndex=0'
)

[IO.File]::WriteAllLines($arabicShortcutPath, $urlShortcutLines, [Text.Encoding]::ASCII)
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)

Write-Output $arabicShortcutPath
