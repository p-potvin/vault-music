const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const targetDir = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\VaultStreaming-qBittorrent';
const appDataDir = 'C:\\Users\\Administrator\\AppData\\Roaming\\qBittorrent_VaultStreaming';
const localAppDataDir = 'C:\\Users\\Administrator\\AppData\\Local\\qBittorrent_VaultStreaming';

fs.mkdirSync(targetDir, { recursive: true });
fs.mkdirSync(path.join(appDataDir, 'qBittorrent'), { recursive: true });
fs.mkdirSync(path.join(localAppDataDir, 'qBittorrent'), { recursive: true });
fs.mkdirSync('G:\\Music\\Downloads', { recursive: true });

const srcExe = 'C:\\Program Files\\qBittorrent\\qbittorrent.exe';
const destExe = path.join(targetDir, 'qbittorrent-vaultstreaming.exe');

fs.copyFileSync(srcExe, destExe);
if (fs.existsSync('C:\\Program Files\\qBittorrent\\qt.conf')) {
    fs.copyFileSync('C:\\Program Files\\qBittorrent\\qt.conf', path.join(targetDir, 'qt.conf'));
}

console.log('Copied isolated executable to:', destExe);

const iniContent = `[BitTorrent]
Session\\DefaultSavePath=G:\\\\Music\\\\Downloads
Session\\Port=19450
Session\\Categories=@Invalid()
Session\\TempPath=G:\\\\Music\\\\Downloads\\\\temp
Session\\TempPathEnabled=false
Session\\StartPaused=false
Session\\TorrentContentLayout=NoSubfolder
Session\\MaxUploads=40
Session\\MaxUploadsPerTorrent=10
Session\\AddTorrentStopped=false

[Core]
AutoDeleteAddedTorrentFile=Never

[LegalNotice]
Accepted=true

[Network]
Cookies=@Invalid()
PortForwardingEnabled=true

[Preferences]
General\\Locale=en
General\\ExitConfirm=false
General\\MinimizeToTray=false
General\\CloseToTrayNotified=false
Queueing\\QueueingEnabled=true
Queueing\\MaxActiveDownloads=10
Queueing\\MaxActiveTorrents=20
Queueing\\MaxActiveUploads=10
Connection\\PortRangeMin=19450
Downloads\\SavePath=G:\\\\Music\\\\Downloads
Downloads\\TempPath=G:\\\\Music\\\\Downloads\\\\temp
WebUI\\Address=127.0.0.1
WebUI\\Port=8082
WebUI\\Enabled=true
WebUI\\LocalHostAuth=false
WebUI\\HostHeaderValidation=false
WebUI\\CSRFProtection=false
WebUI\\ClickjackingProtection=false
WebUI\\AlternativeUIEnabled=false
WebUI\\RootFolder=
WebUI\\Username=vault-music
WebUI\\Password_PBKDF2="@ByteArray(0+58VsM3wME5HHsWaWWmog==:pNw7P1ImxGR4JiUPnPRvfO5P67lEH2o77cLssu47bJREQM7IsLQExFdTiVqUoLUtiJRIlN4LCdHJEK9HU7BikQ==)"
WebUI\\MaxAuthenticationFailCount=20
WebUI\\SessionTimeout=3600
WebUI\\UseUPnP=false
`;

fs.writeFileSync(path.join(appDataDir, 'qBittorrent', 'qBittorrent.ini'), iniContent, 'utf8');
fs.writeFileSync(path.join(appDataDir, 'qBittorrent.ini'), iniContent, 'utf8');
console.log('Configuration saved in isolated profile directories.');
