# Setup VaultStreaming Isolated qBittorrent Profile & Scheduled Task

$ErrorActionPreference = "Stop"

$ProfileDir = "$env:APPDATA\qBittorrent_VaultStreaming"
$ConfigDir = "$ProfileDir\qBittorrent"
$DataDir = "$ProfileDir\data"
$IniPath = "$ConfigDir\qBittorrent.ini"

Write-Host "Creating VaultStreaming qBittorrent profile directory at: $ProfileDir"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
New-Item -ItemType Directory -Force -Path "$DataDir\BT_backup" | Out-Null
New-Item -ItemType Directory -Force -Path "G:\Music\Downloads" | Out-Null

$lines = @(
    "[BitTorrent]",
    "Session\DefaultSavePath=G:/Music/Downloads",
    "Session\Port=19450",
    "Session\Categories=@Invalid()",
    "Session\TempPath=G:/Music/Downloads/temp",
    "Session\TempPathEnabled=false",
    "",
    "[Core]",
    "AutoDeleteAddedTorrentFile=Never",
    "",
    "[Legal]",
    "AcceptedLegalNotice=true",
    "",
    "[Network]",
    "Cookies=@Invalid()",
    "",
    "[Preferences]",
    "Bittorrent\MaxConns=500",
    "Bittorrent\MaxConnsPerTorrent=100",
    "Bittorrent\MaxRatioAction=0",
    "Connection\PortRangeMin=19450",
    "Downloads\SavePath=G:/Music/Downloads",
    "Downloads\TempPath=G:/Music/Downloads/temp",
    "General\Locale=en",
    "Queueing\MaxActiveDownloads=10",
    "Queueing\MaxActiveTorrents=20",
    "Queueing\MaxActiveUploads=10",
    "Queueing\QueueingEnabled=true",
    "WebUI\Address=127.0.0.1",
    "WebUI\AuthSubnetWhitelist=@Invalid()",
    "WebUI\AuthSubnetWhitelistEnabled=false",
    "WebUI\BannedIPs=",
    "WebUI\CSRFProtection=false",
    "WebUI\ClickjackingProtection=false",
    "WebUI\CustomHTTPHeaders=",
    "WebUI\Enabled=true",
    "WebUI\HostHeaderValidation=false",
    "WebUI\HTTPS\CertificatePath=",
    "WebUI\HTTPS\Enabled=false",
    "WebUI\HTTPS\KeyPath=",
    "WebUI\LocalHostAuth=false",
    "WebUI\MaxAuthenticationFailCount=10",
    "WebUI\Port=8082",
    "WebUI\ReverseProxySupportEnabled=false",
    "WebUI\SecureCookie=false",
    "WebUI\ServerDomains=*",
    "WebUI\SessionTimeout=3600",
    "WebUI\TrustPanel=false",
    "WebUI\UseUPnP=false",
    "WebUI\Username=vault-music"
)

Set-Content -Path $IniPath -Value ($lines -join "`r`n") -Encoding UTF8
Set-Content -Path "$ProfileDir\qBittorrent.ini" -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host "Wrote isolated qBittorrent.ini configuration to $IniPath and $ProfileDir\qBittorrent.ini"

# Register Scheduled Task
$TaskName = "VaultStreaming-qBittorrent"
$ExePath = "C:\Program Files\qBittorrent\qbittorrent.exe"
$Arguments = "--profile `"$ProfileDir`" --webui-port=8082"

Write-Host "Registering Scheduled Task '$TaskName'..."
$Action = New-ScheduledTaskAction -Execute $ExePath -Argument $Arguments
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances Parallel -ExecutionTimeLimit (New-TimeSpan -Days 365)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Principal $Principal -Settings $Settings -Description "Dedicated VaultStreaming isolated qBittorrent instance (Port 8082)" | Out-Null

Write-Host "VaultStreaming qBittorrent instance configured and scheduled task registered successfully."
