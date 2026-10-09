# install-apple-music-refresh.ps1 — register the daily Apple Music snapshot refresh.
#
# Default schedule: 11:00 local, hard 30 minute execution cap. The task is
# skipped (not queued) if a previous run is still going, and starts late if the
# machine was asleep at the scheduled time.

[CmdletBinding()]
param(
    [string]$Time = '11:00'
)

$ErrorActionPreference = 'Stop'

$TaskName = 'VaultMusic-AppleMusicRefresh'
$ScriptPath = Join-Path $PSScriptRoot 'refresh-apple-music-snapshot.ps1'

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Target script not found: $ScriptPath"
}

Get-ScheduledTask -TaskName $TaskName -TaskPath '\VaultWares\' -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false

$argString = '--headless pwsh.exe -NoProfile -WindowStyle Hidden -NonInteractive -ExecutionPolicy Bypass -File "' + $ScriptPath + '"'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $argString
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
    -TaskName $TaskName -TaskPath '\VaultWares\' `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Daily Apple Music snapshot refresh into G:\Music\AppleMusic_Backup (11:00, 30 minute cap)' `
    -Force | Out-Null

Write-Host "Scheduled task '$TaskName' registered daily at $Time (30 minute cap)." -ForegroundColor Green
