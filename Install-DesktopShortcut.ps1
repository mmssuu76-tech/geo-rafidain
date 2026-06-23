Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$svgPath = Join-Path $projectRoot 'assets\iraq-mark.svg'
$iconPath = Join-Path $projectRoot 'assets\geo-rafidain.ico'
$desktopIconPath = Join-Path $projectRoot 'assets\geo-rafidain-desktop.ico'
$previewPath = Join-Path $projectRoot 'assets\geo-rafidain-icon.png'
$pwaIcon192Path = Join-Path $projectRoot 'assets\geo-rafidain-pwa-192.png'
$pwaIcon512Path = Join-Path $projectRoot 'assets\geo-rafidain-pwa-512.png'
$launcherPath = Join-Path $projectRoot 'Start-GeoRafidain.cmd'
$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$siteUrl = 'https://mmssuu76-tech.github.io/geo-rafidain/'
$arabicBaseName = (-join ([char[]](0x062C,0x064A,0x0648,0x20,0x0627,0x0644,0x0631,0x0627,0x0641,0x062F,0x064A,0x0646)))
$shortcutName = 'Geo Rafidain.lnk'
$shortcutPath = Join-Path $desktopPath $shortcutName
$legacyArabicShortcutPath = Join-Path $desktopPath ($arabicBaseName + '.lnk')
$legacyUrlShortcutPath = Join-Path $desktopPath ($arabicBaseName + '.url')
$legacyShortcutPath = Join-Path $desktopPath 'GeoRafidain.lnk'

if (-not (Test-Path -LiteralPath $svgPath -PathType Leaf)) { throw "Iraq mark SVG was not found: $svgPath" }

Add-Type -AssemblyName System.Drawing

[xml]$svg = Get-Content -Raw -Encoding UTF8 -LiteralPath $svgPath
$pathNodes = @($svg.SelectNodes("//*[local-name()='path']"))
if ($pathNodes.Count -lt 1) { throw 'The Iraq SVG does not contain a path.' }

$culture = [Globalization.CultureInfo]::InvariantCulture

function New-BrandTilePath {
  param(
    [single]$X,
    [single]$Y,
    [single]$Width,
    [single]$Height,
    [single]$LargeRadius,
    [single]$SmallRadius
  )

  $path = [Drawing.Drawing2D.GraphicsPath]::new()
  $large = [Math]::Min($LargeRadius * 2, [Math]::Min($Width, $Height))
  $small = [Math]::Min($SmallRadius * 2, [Math]::Min($Width, $Height))

  $path.AddArc($X, $Y, $large, $large, 180, 90)
  $path.AddArc($X + $Width - $large, $Y, $large, $large, 270, 90)
  $path.AddArc($X + $Width - $large, $Y + $Height - $large, $large, $large, 0, 90)
  $path.AddArc($X, $Y + $Height - $small, $small, $small, 90, 90)
  $path.CloseFigure()
  return $path
}

function Convert-SvgLinePath {
  param([string]$PathData)

  $tokens = @([regex]::Matches($PathData, '([MLZ])|(-?\d+(?:\.\d+)?)') | ForEach-Object { $_.Value })
  $graphicsPath = [Drawing.Drawing2D.GraphicsPath]::new([Drawing.Drawing2D.FillMode]::Alternate)
  $command = $null
  $point = $null
  $figureOpen = $false
  $i = 0

  while ($i -lt $tokens.Count) {
    if ($tokens[$i] -match '^[MLZ]$') {
      $command = $tokens[$i]
      $i += 1
    } elseif (-not $command) {
      throw "Unsupported SVG path segment near token $i."
    }

    switch ($command) {
      'M' {
        if ($i + 1 -ge $tokens.Count) { throw 'Incomplete SVG move command.' }
        $x = [single][double]::Parse($tokens[$i], $culture)
        $y = [single][double]::Parse($tokens[$i + 1], $culture)
        $point = [Drawing.PointF]::new($x, $y)
        $graphicsPath.StartFigure()
        $figureOpen = $true
        $i += 2
        $command = 'L'
      }
      'L' {
        if ($i + 1 -ge $tokens.Count) { throw 'Incomplete SVG line command.' }
        $x = [single][double]::Parse($tokens[$i], $culture)
        $y = [single][double]::Parse($tokens[$i + 1], $culture)
        $nextPoint = [Drawing.PointF]::new($x, $y)
        if (-not $figureOpen -or $null -eq $point) {
          $graphicsPath.StartFigure()
          $figureOpen = $true
        } else {
          $graphicsPath.AddLine($point, $nextPoint)
        }
        $point = $nextPoint
        $i += 2
      }
      'Z' {
        if ($figureOpen) {
          $graphicsPath.CloseFigure()
          $figureOpen = $false
        }
        $command = $null
      }
      default {
        throw "Unsupported SVG command: $command"
      }
    }
  }

  return $graphicsPath
}

function New-GeoRafidainIconBitmap {
  param([int]$Size)

  $unit = [single]($Size / 256)
  $bitmap = [Drawing.Bitmap]::new($Size, $Size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([Drawing.Color]::Transparent)

  $tile = New-BrandTilePath -X 0 -Y 0 -Width $Size -Height $Size -LargeRadius ([single](80 * $unit)) -SmallRadius ([single](23 * $unit))
  $backgroundBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 233, 186, 104))
  $mapBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 18, 63, 56))
  $textBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 18, 63, 56))
  $shadowBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(150, 255, 240, 203))
  $borderPen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(255, 255, 240, 203), [single](15))
  $borderPen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
  $borderPen.StartCap = [Drawing.Drawing2D.LineCap]::Round
  $borderPen.EndCap = [Drawing.Drawing2D.LineCap]::Round
  $riverPen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(230, 79, 148, 161), [single](11))
  $riverPen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
  $riverPen.StartCap = [Drawing.Drawing2D.LineCap]::Round
  $riverPen.EndCap = [Drawing.Drawing2D.LineCap]::Round

  $graphics.FillPath($backgroundBrush, $tile)
  $graphics.SetClip($tile)

  $logoSize = [single]($Size * .54)
  $logoOffsetX = [single](($Size - $logoSize) / 2)
  $logoOffsetY = [single]($Size * .06)
  $scale = [single]($logoSize / 720)
  $state = $graphics.Save()
  $graphics.TranslateTransform($logoOffsetX, $logoOffsetY)
  $graphics.ScaleTransform($scale, $scale)

  $mainPath = Convert-SvgLinePath -PathData $pathNodes[0].GetAttribute('d')
  $graphics.FillPath($mapBrush, $mainPath)
  $graphics.DrawPath($borderPen, $mainPath)

  foreach ($pathNode in ($pathNodes | Select-Object -Skip 1)) {
    $riverPath = Convert-SvgLinePath -PathData $pathNode.GetAttribute('d')
    $graphics.DrawPath($riverPen, $riverPath)
    $riverPath.Dispose()
  }

  $graphics.Restore($state)

  $format = [Drawing.StringFormat]::new()
  $format.Alignment = [Drawing.StringAlignment]::Center
  $format.LineAlignment = [Drawing.StringAlignment]::Center
  $format.Trimming = [Drawing.StringTrimming]::None
  $geoFont = [Drawing.Font]::new('Segoe UI', [single](36 * $unit), [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
  $rafidainFont = [Drawing.Font]::new('Segoe UI', [single](25 * $unit), [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
  $geoRect = [Drawing.RectangleF]::new(0, [single]($Size * .585), $Size, [single]($Size * .17))
  $rafidainRect = [Drawing.RectangleF]::new(0, [single]($Size * .715), $Size, [single]($Size * .16))
  $shadowOffset = [single](1.6 * $unit)

  $graphics.DrawString('Geo', $geoFont, $shadowBrush, [Drawing.RectangleF]::new($geoRect.X, $geoRect.Y + $shadowOffset, $geoRect.Width, $geoRect.Height), $format)
  $graphics.DrawString('Geo', $geoFont, $textBrush, $geoRect, $format)
  $graphics.DrawString('Rafidain', $rafidainFont, $shadowBrush, [Drawing.RectangleF]::new($rafidainRect.X, $rafidainRect.Y + $shadowOffset, $rafidainRect.Width, $rafidainRect.Height), $format)
  $graphics.DrawString('Rafidain', $rafidainFont, $textBrush, $rafidainRect, $format)

  $graphics.ResetClip()

  $format.Dispose()
  $geoFont.Dispose()
  $rafidainFont.Dispose()
  $borderPen.Dispose()
  $riverPen.Dispose()
  $mainPath.Dispose()
  $textBrush.Dispose()
  $shadowBrush.Dispose()
  $mapBrush.Dispose()
  $backgroundBrush.Dispose()
  $tile.Dispose()
  $graphics.Dispose()

  return $bitmap
}

function Get-PngBytes {
  param([Drawing.Bitmap]$Bitmap)

  $memory = [IO.MemoryStream]::new()
  $Bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
  $bytes = $memory.ToArray()
  $memory.Dispose()
  return ,$bytes
}

function Save-PngIcon {
  param(
    [string]$Path,
    [int[]]$Sizes
  )

  $entries = @()
  foreach ($size in $Sizes) {
    $entryBitmap = New-GeoRafidainIconBitmap -Size $size
    $entries += [pscustomobject]@{
      Size = $size
      Bytes = (Get-PngBytes -Bitmap $entryBitmap)
    }
    $entryBitmap.Dispose()
  }

  $stream = [IO.File]::Create($Path)
  $writer = [IO.BinaryWriter]::new($stream)
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$entries.Count)

  $offset = 6 + (16 * $entries.Count)
  foreach ($entry in $entries) {
    $sizeByte = if ($entry.Size -ge 256) { [byte]0 } else { [byte]$entry.Size }
    $writer.Write($sizeByte)
    $writer.Write($sizeByte)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$entry.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $entry.Bytes.Length
  }

  foreach ($entry in $entries) {
    $writer.Write([byte[]]$entry.Bytes)
  }

  $writer.Dispose()
  $stream.Dispose()
}

$previewBitmap = New-GeoRafidainIconBitmap -Size 512
$previewBitmap.Save($previewPath, [Drawing.Imaging.ImageFormat]::Png)
$previewBitmap.Save($pwaIcon512Path, [Drawing.Imaging.ImageFormat]::Png)
$previewBitmap.Dispose()

$pwaIcon192 = New-GeoRafidainIconBitmap -Size 192
$pwaIcon192.Save($pwaIcon192Path, [Drawing.Imaging.ImageFormat]::Png)
$pwaIcon192.Dispose()

Save-PngIcon -Path $iconPath -Sizes @(16, 24, 32, 48, 64, 128, 256)
Copy-Item -LiteralPath $iconPath -Destination $desktopIconPath -Force

$shell = New-Object -ComObject WScript.Shell

# Remove only older local shortcuts created by this installer.
Get-ChildItem -LiteralPath $desktopPath -Filter '*.lnk' -File | ForEach-Object {
  $candidate = $shell.CreateShortcut($_.FullName)
  if ($candidate.TargetPath -eq $launcherPath -or $candidate.Arguments -like '*local-server.ps1*' -or $_.FullName -eq $legacyShortcutPath -or $_.FullName -eq $legacyArabicShortcutPath -or $_.FullName -eq $shortcutPath) {
    Remove-Item -LiteralPath $_.FullName -Force
  }
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($candidate)
}

if (Test-Path -LiteralPath $legacyUrlShortcutPath) { Remove-Item -LiteralPath $legacyUrlShortcutPath -Force }
if (Test-Path -LiteralPath $legacyArabicShortcutPath) { Remove-Item -LiteralPath $legacyArabicShortcutPath -Force }
if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Join-Path $env:WINDIR 'explorer.exe')
$shortcut.Arguments = $siteUrl
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$desktopIconPath,0"
$shortcut.Description = 'Open Geo Rafidain platform'
$shortcut.WindowStyle = 1
$shortcut.Save()

[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)

Write-Output $shortcutPath
