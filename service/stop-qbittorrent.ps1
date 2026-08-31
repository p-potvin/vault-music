# Stop Dedicated VaultStreaming qBittorrent Instance Only

$allQbit = Get-Process qbittorrent -ErrorAction SilentlyContinue
foreach ($p in $allQbit) {
    try {
        $procInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.Id)" -ErrorAction SilentlyContinue
        if ($procInfo -and $procInfo.CommandLine -like "*qBittorrent_VaultStreaming*") {
            Write-Host "Stopping VaultStreaming qBittorrent process (PID $($p.Id))..."
            Stop-Process -Id $p.Id -Force
        }
    } catch {}
}

Write-Host "VaultStreaming stop check complete. Pre-existing instance untouched."
