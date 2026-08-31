# Start Dedicated VaultStreaming qBittorrent Instance

$ProfileDir = "$env:APPDATA\qBittorrent_VaultStreaming"
$ExePath = "C:\Program Files\qBittorrent\qbittorrent.exe"

$existing = Get-Process qbittorrent -ErrorAction SilentlyContinue | Where-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
        $cmd -like "*qBittorrent_VaultStreaming*"
    } catch { $false }
}

if ($existing) {
    Write-Host "VaultStreaming qBittorrent is already running (PID $($existing.Id))."
} else {
    Write-Host "Starting isolated VaultStreaming qBittorrent..."
    Start-Process -FilePath $ExePath -ArgumentList @("--profile", $ProfileDir, "--webui-port=8082")
    Start-Sleep -Seconds 3
    Write-Host "VaultStreaming qBittorrent started successfully on port 8082."
}
