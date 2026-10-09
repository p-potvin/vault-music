# start.ps1 — start the VaultMusic scheduled task
Start-ScheduledTask -TaskName 'VaultMusic' -TaskPath '\VaultWares\'
Start-Sleep -Seconds 1
Get-ScheduledTask -TaskName 'VaultMusic' -TaskPath '\VaultWares\' | Format-List TaskName, State
