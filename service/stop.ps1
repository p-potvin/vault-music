# stop.ps1 — stop the VaultMusic scheduled task and kill listener on port 8733
Stop-ScheduledTask -TaskName 'VaultMusic' -TaskPath '\VaultWares\' -ErrorAction SilentlyContinue

# Reclaim port 8733
$portOwners = (netstat -ano | Select-String ':8733\s.*LISTENING') |
    ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
foreach ($owner in $portOwners) {
    try {
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    } catch {}
}

Start-Sleep -Seconds 1
Get-ScheduledTask -TaskName 'VaultMusic' -TaskPath '\VaultWares\' | Format-List TaskName, State
