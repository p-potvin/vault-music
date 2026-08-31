# status.ps1 — check VaultMusic scheduled task status and HTTP health
Get-ScheduledTask -TaskName 'VaultMusic' | Format-List TaskName, State, Actions

$listening = netstat -ano | Select-String ':8733\s.*LISTENING'
if ($listening) {
    Write-Host "Port 8733 is LISTENING:`n$listening" -ForegroundColor Green
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8733/health' -TimeoutSec 3
        Write-Host "Health Check: $($health.status) (Tracks: $($health.library.tracks), Albums: $($health.library.albums), Artists: $($health.library.artists))" -ForegroundColor Cyan
    } catch {
        Write-Host "HTTP health check failed: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "Port 8733 is NOT listening." -ForegroundColor Yellow
}
