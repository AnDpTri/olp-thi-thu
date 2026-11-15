param([string]$Version = '0.4.0')
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot ('gui-' + [Guid]::NewGuid().ToString('N').Substring(0, 7))
$fixture = Join-Path $root 'fixture'
$profile = Join-Path $root 'profile'
$extensions = Join-Path $root 'extensions'
New-Item -ItemType Directory -Path $root, $fixture | Out-Null
New-Item -ItemType Directory -Path (Join-Path $profile 'User') -Force | Out-Null
@{ 'extensions.ignoreRecommendations' = $true; 'chat.disableAIFeatures' = $true; 'window.dialogStyle' = 'custom' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $profile 'User/settings.json')
$vsix = Join-Path (Split-Path $PSScriptRoot) "outputs/olp-thi-thu-$Version.vsix"
$env:OLP_GUI_FIXTURE = $fixture
code --user-data-dir $profile --extensions-dir $extensions --install-extension $vsix --force
if ($LASTEXITCODE -ne 0) { throw 'Installation failed' }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$exe = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'
$launch = '--user-data-dir "{0}" --extensions-dir "{1}" --disable-workspace-trust --skip-welcome --skip-release-notes --remote-debugging-port={2} "{3}"' -f $profile, $extensions, $port, $fixture
$process = Start-Process -FilePath $exe -ArgumentList $launch -WindowStyle Hidden -PassThru
try {
    Write-Output $root
    node (Join-Path $PSScriptRoot 'olp-gui.js') $root $port
    if ($LASTEXITCODE -ne 0) { throw 'GUI test failed' }
} finally {
    if (!$process.HasExited) { Stop-Process -Id $process.Id }
}
