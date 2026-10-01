# Start Dedicated VaultStreaming qBittorrent Instance

$ErrorActionPreference = 'Stop'
$ProfileDir = Join-Path $env:APPDATA 'qBittorrent_VaultStreaming'
$WebUiUrl = 'http://127.0.0.1:8082/api/v2/app/version'
$ExePath = 'C:\Program Files\qBittorrent\qbittorrent.exe'

if (-not (Test-Path -LiteralPath $ExePath)) {
    throw "qBittorrent executable not found: $ExePath"
}
if (-not (Test-Path -LiteralPath (Join-Path $ProfileDir 'qBittorrent\qBittorrent.ini'))) {
    throw "VaultStreaming qBittorrent profile is not configured: $ProfileDir"
}

$existing = Get-Process qbittorrent -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        $cmd -like '*qBittorrent_VaultStreaming*'
    }
    catch { $false }
}

if ($existing) {
    Write-Host "VaultStreaming qBittorrent process already exists (PID $($existing.Id))."
}
else {
    Write-Host 'Starting isolated VaultStreaming qBittorrent...'
    Start-Process -FilePath $ExePath -ArgumentList @("--profile=`"$ProfileDir`"", '--webui-port=8082')
}

$version = $null
for ($i = 0; $i -lt 20; $i++) {
    try {
        $version = (Invoke-RestMethod -Uri $WebUiUrl -TimeoutSec 2).Trim()
        if ($version) { break }
    }
    catch { }
    Start-Sleep -Seconds 1
}

if (-not $version) {
    throw 'VaultStreaming qBittorrent did not become ready on 127.0.0.1:8082.'
}
Write-Host "VaultStreaming qBittorrent ready on port 8082 (version $version)."
