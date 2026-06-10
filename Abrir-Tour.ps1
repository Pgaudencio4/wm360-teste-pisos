$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8765
for ($p = 8765; $p -le 8780; $p++) {
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
    $listener.Start(); $port = $p; break
  } catch { $listener = $null }
}
if (-not $listener) { Write-Host 'Sem porta livre.'; pause; exit 1 }
$mime = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8';
  '.js'='application/javascript'; '.css'='text/css'; '.json'='application/json';
  '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.png'='image/png';
  '.svg'='image/svg+xml'; '.gif'='image/gif'; '.txt'='text/plain; charset=utf-8';
  '.woff'='font/woff'; '.woff2'='font/woff2'
}
Write-Host ''
Write-Host '  Tour 360 a correr em  http://127.0.0.1:'$port'/'
Write-Host '  NAO FECHES esta janela enquanto estiveres a ver o tour.'
Write-Host ''
Start-Process "http://127.0.0.1:$port/"
while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream)
    $line = $reader.ReadLine()
    if ($line -match '^(GET|HEAD)\s+(\S+)') {
      $verb = $matches[1]
      $req = [Uri]::UnescapeDataString($matches[2].Split('?')[0])
      if ($req -eq '/') { $req = '/index.html' }
      $rel = ($req.TrimStart('/') -replace '/', '\')
      $file = Join-Path $root $rel
      $full = [System.IO.Path]::GetFullPath($file)
      if ($full.StartsWith([System.IO.Path]::GetFullPath($root)) -and (Test-Path $full -PathType Leaf)) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $ct = $mime[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
        $hdr = "HTTP/1.0 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
        $hb = [System.Text.Encoding]::ASCII.GetBytes($hdr)
        $stream.Write($hb, 0, $hb.Length)
        if ($verb -eq 'GET') { $stream.Write($bytes, 0, $bytes.Length) }
      } else {
        $nf = "HTTP/1.0 404 Not Found`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
        $hb = [System.Text.Encoding]::ASCII.GetBytes($nf)
        $stream.Write($hb, 0, $hb.Length)
      }
    }
    $stream.Flush(); $stream.Close()
  } catch { }
  finally { $client.Close() }
}
