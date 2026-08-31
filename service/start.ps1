# start.ps1 — start the VaultMusic scheduled task
Start-ScheduledTask -TaskName 'VaultMusic'
Start-Sleep -Seconds 1
Get-ScheduledTask -TaskName 'VaultMusic' | Format-List TaskName, State
