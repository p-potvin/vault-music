# install-task.ps1 — Register the VaultMusic scheduled task on local PC.
# Mirrors VaultStreamingWeb task settings and policies.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$TaskName = 'VaultMusic'
$ScriptPath = Join-Path $PSScriptRoot 'start-service.ps1'

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Target script not found: $ScriptPath"
}

# Unregister existing task if present
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false

$argString = '--headless pwsh.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $ScriptPath + '"'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $argString

$trigger = New-ScheduledTaskTrigger -AtLogOn

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -Priority 7

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Vault Music local audio server (tailnet-only, fronted by greencloud nginx at music.vaultwares.ca)' `
    -Force | Out-Null

Write-Host "Scheduled task '$TaskName' registered successfully." -ForegroundColor Green
