<#
.SYNOPSIS
  Gestiona Cloudflare WARP en modo Proxy local (SOCKS5 en 127.0.0.1:40000) para Windows.
  Esto asegura que SOLO el indexador use la red de Cloudflare sin afectar al resto de tu PC.

.USAGE
  .\warp-proxy.ps1 start    # Activa el modo proxy local y genera proxies.txt
  .\warp-proxy.ps1 stop     # Desconecta WARP
  .\warp-proxy.ps1 status   # Comprueba el estado del proxy
#>

param(
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action = 'start'
)

$warpCli = "C:\Program Files\Cloudflare\Cloudflare WARP\warp-cli.exe"
if (-not (Test-Path $warpCli)) {
  Write-Error "No se encontró warp-cli en '$warpCli'. Asegúrate de que Cloudflare WARP esté instalado."
  exit 1
}

$proxyFile = Join-Path $PSScriptRoot "proxies.txt"

switch ($Action) {
  'start' {
    Write-Host "Configurando Cloudflare WARP en modo Proxy local (puerto SOCKS5 40000)..." -ForegroundColor Cyan
    & $warpCli mode proxy 2>$null
    if ($LASTEXITCODE -ne 0) {
      & $warpCli set-mode proxy 2>$null
    }
    Write-Host "Conectando WARP..." -ForegroundColor Cyan
    & $warpCli connect
    Start-Sleep -Seconds 2

    # Escribir la configuración de proxy para el indexador
    Set-Content -Path $proxyFile -Value "socks5://127.0.0.1:40000" -Encoding utf8
    Write-Host "Archivo '$proxyFile' generado con éxito (socks5://127.0.0.1:40000)." -ForegroundColor Green
    Write-Host ""
    Write-Host "¡Listo! Tu conexión de Windows normal NO pasa por Cloudflare." -ForegroundColor Yellow
    Write-Host "Solo el indexador usará el túnel al pasar: --proxy --proxy-file proxies.txt" -ForegroundColor Green
  }

  'stop' {
    Write-Host "Desconectando Cloudflare WARP..." -ForegroundColor Cyan
    & $warpCli disconnect
    Write-Host "WARP desconectado." -ForegroundColor Green
  }

  'status' {
    Write-Host "--- Estado de Cloudflare WARP ---" -ForegroundColor Cyan
    & $warpCli status
    if (Test-Path $proxyFile) {
      $content = (Get-Content $proxyFile -Raw).Trim()
      Write-Host "proxies.txt configurado como: $content" -ForegroundColor Yellow
    }
  }
}
