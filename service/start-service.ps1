# start-service.ps1 — launch Vault Music server as a persistent supervised service.
#
# Run by the "VaultMusic" scheduled task at logon/boot.
# Fronted by greencloud nginx at https://music.vaultwares.ca and direct tailnet at 100.71.101.21:8733.

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $RepoRoot 'logs'
$LogFile = Join-Path $LogDir 'server.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format 'ddd, dd MMM yyyy HH:mm'), $msg
    Add-Content -Path $LogFile -Value $line
}

trap {
    try { Write-Log "FATAL: $($_.Exception.Message)" } catch { }
    exit 1
}

$tailscale = 'C:\Program Files\Tailscale\tailscale.exe'
$tailnetIp = $null
for ($i = 0; $i -lt 60; $i++) {
    try {
        $candidate = (& $tailscale ip -4 2>$null | Select-Object -First 1)
        if ($candidate -match '^\d+\.\d+\.\d+\.\d+$') { $tailnetIp = $candidate.Trim(); break }
    } catch { }
    Start-Sleep -Seconds 5
}

if (-not $tailnetIp) {
    Write-Log 'FATAL: Tailscale address never appeared after 5 minutes; not starting.'
    exit 1
}

Write-Log "Tailnet up ($tailnetIp); starting Vault Music server on 0.0.0.0:8733 (repo: $RepoRoot)"

Set-Location $RepoRoot

# Reclaim port 8733 before starting. Kills any stale node process holding the port.
$portOwners = (netstat -ano | Select-String ':8733\s.*LISTENING') |
    ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
foreach ($owner in $portOwners) {
    try {
        Write-Log "Killing stale listener on 8733 (pid $owner)"
        Stop-Process -Id $owner -Force -ErrorAction Stop
    } catch { Write-Log "Could not kill pid ${owner}: $_" }
}
if ($portOwners) { Start-Sleep -Seconds 2 }

# Supervise rather than exit.
$backoff = 2
$recentFailures = 0
$lastStart = Get-Date

while ($true) {
    # Keep the child attached through cmd redirection. A PowerShell pipeline to
    # Out-File can throw a broken-pipe console error under a detached conhost
    # task and terminate this supervisor after the child exits.
    & cmd.exe /d /c "node src/server.js >> `"$LogFile`" 2>&1"
    $code = $LASTEXITCODE
    $ranFor = (Get-Date) - $lastStart

    Write-Log "Server exited with code $code after $([int]$ranFor.TotalSeconds)s"

    if ($ranFor.TotalSeconds -lt 60) { $recentFailures++ } else { $recentFailures = 0; $backoff = 2 }
    if ($recentFailures -ge 5) {
        Write-Log 'FATAL: five failures inside a minute each — crash loop, not restarting.'
        exit 1
    }

    Start-Sleep -Seconds $backoff
    $backoff = [Math]::Min($backoff * 2, 60)
    $lastStart = Get-Date
    Write-Log 'Restarting server...'
}
