# refresh-apple-music-snapshot.ps1 — refresh the Apple Music snapshot and playlist index.
#
# Runs as the daily "VaultMusic-AppleMusicRefresh" scheduled task. The refresh is
# incremental: only files whose size or mtime changed are copied.

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $RepoRoot 'logs'
$LogFile = Join-Path $LogDir 'apple-music-refresh.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format 'ddd, dd MMM yyyy HH:mm'), $msg
    Add-Content -Path $LogFile -Value $line
}

try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:8733/api/v1/downloads/apple-music-local/backup-and-scan' `
        -Method Post -TimeoutSec 1500

    $manifest = $response.snapshot.manifest
    if ($response.snapshot.success) {
        Write-Log ("Snapshot refreshed: {0} file(s) ({1} copied, {2} skipped, {3} removed), {4} playlist(s) indexed." -f `
            $manifest.fileCount, $manifest.copiedCount, $manifest.skippedCount, $manifest.removedCount, $response.totalPlaylists)
    } else {
        Write-Log "Refresh failed: $($response.snapshot.error)"
        exit 1
    }
} catch {
    Write-Log "Refresh failed: $($_.Exception.Message)"
    exit 1
}
