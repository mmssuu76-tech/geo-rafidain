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

$bitmap = [Drawing.Bitmap]::new(256, 256, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
$graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([Drawing.Color]::Transparent)

$tile = New-BrandTilePath -X 0 -Y 0 -Width 256 -Height 256 -LargeRadius 80 -SmallRadius 23
$backgroundBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 233, 186, 104))
$mapBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 18, 63, 56))
$borderPen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(255, 255, 240, 203), 15)
$borderPen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
$borderPen.StartCap = [Drawing.Drawing2D.LineCap]::Round
$borderPen.EndCap = [Drawing.Drawing2D.LineCap]::Round
$riverPen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(230, 79, 148, 161), 11)
$riverPen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
$riverPen.StartCap = [Drawing.Drawing2D.LineCap]::Round
$riverPen.EndCap = [Drawing.Drawing2D.LineCap]::Round

$graphics.FillPath($backgroundBrush, $tile)

$logoSize = [single](256 * 33 / 45)
$logoOffset = [single]((256 - $logoSize) / 2)
$scale = [single]($logoSize / 720)
$state = $graphics.Save()
$graphics.TranslateTransform($logoOffset, $logoOffset)
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
$bitmap.Save($previewPath, [Drawing.Imaging.ImageFormat]::Png)

$iconHandle = $bitmap.GetHicon()
$icon = [Drawing.Icon]::FromHandle($iconHandle)
$iconStream = [IO.File]::Create($iconPath)
$icon.Save($iconStream)
$iconStream.Dispose()
$icon.Dispose()
$borderPen.Dispose()
$riverPen.Dispose()
$mainPath.Dispose()
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
