param([int]$Port = 8765, [switch]$NoLaunch)

$rootPath = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$rootPrefix = $rootPath + [System.IO.Path]::DirectorySeparatorChar
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.geojson' = 'application/geo+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.md'   = 'text/plain; charset=utf-8'
}

function Send-Response {
  param(
    $Stream,
    [int]$Status,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType,
    [bool]$HeadOnly = $false
  )

  $securityHeaders = @(
    "Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    'X-Content-Type-Options: nosniff'
    'X-Frame-Options: DENY'
    'Referrer-Policy: no-referrer'
    'Permissions-Policy: camera=(), microphone=(), geolocation=()'
    'Cross-Origin-Opener-Policy: same-origin'
  ) -join "`r`n"

  $header = "HTTP/1.1 $Status $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n$securityHeaders`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
  $Stream.Flush()
}

try {
  $listener.Start()
} catch {
  Write-Host "Port $Port is already in use. Opening the existing local site..." -ForegroundColor Yellow
  if (-not $NoLaunch) { Start-Process "http://127.0.0.1:$Port/" }
  exit 0
}

Write-Host "GeoRafidain is running securely on this computer:" -ForegroundColor Green
Write-Host "http://127.0.0.1:$Port/" -ForegroundColor Cyan
Write-Host "Keep this window open. Close it or press Ctrl+C to stop the platform." -ForegroundColor DarkGray
if (-not $NoLaunch) { Start-Process "http://127.0.0.1:$Port/" }

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $client.SendTimeout = 5000
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 2048, $true)
      $requestLine = $reader.ReadLine()
      $headerLines = 0
      while (($line = $reader.ReadLine()) -ne '') {
        if ($null -eq $line) { break }
        $headerLines++
        if ($headerLines -gt 100) { throw 'Too many request headers.' }
      }

      if ($requestLine -notmatch '^(GET|HEAD)\s+([^\s]+)') {
        Send-Response $stream 405 'Method Not Allowed' ([byte[]]::new(0)) 'text/plain; charset=utf-8'
        continue
      }

      $method = $Matches[1]
      $requestPath = ($Matches[2] -split '\?')[0]
      $relativePath = [Uri]::UnescapeDataString($requestPath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = 'index.html' }
      $filePath = [System.IO.Path]::GetFullPath((Join-Path $rootPath $relativePath))

      if (-not $filePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $notFound = [System.Text.Encoding]::UTF8.GetBytes('Not found')
        Send-Response $stream 404 'Not Found' $notFound 'text/plain; charset=utf-8' ($method -eq 'HEAD')
        continue
      }

      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
      $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
      Send-Response $stream 200 'OK' $bytes $contentType ($method -eq 'HEAD')
    }
    catch {
      # Close malformed or stalled connections without stopping the local server.
    }
    finally {
      $client.Close()
    }
  }
}
finally {
  $listener.Stop()
}
