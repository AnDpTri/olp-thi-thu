param([ValidateSet('main', 'urgent', 'quick')][string]$Scene = 'main', [string]$OutDir, [string]$Prefix = '')
$ErrorActionPreference = 'Stop'
# Chụp màn hình thật của tiện ích trong VS Code cô lập (cửa sổ ẩn): hồ sơ, thư mục tiện ích và dữ liệu riêng dưới work\shots-<tag>.
$project = Split-Path $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $project 'outputs\screenshots-0.7.0' }
$tag = [Guid]::NewGuid().ToString('N').Substring(0, 7)
$root = Join-Path $PSScriptRoot "shots-$tag"
$fixture = Join-Path $root 'fixture'
New-Item -ItemType Directory -Path $root, $fixture | Out-Null
$vsix = Get-ChildItem -LiteralPath (Join-Path $project 'outputs') -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Output "package: $($vsix.Name)"
& "$env:SystemRoot\System32\tar.exe" -xf $vsix.FullName -C $root
if ($LASTEXITCODE -ne 0) { throw 'Unable to extract the package.' }
$entry = Join-Path $root 'extension\extension.js'
[IO.File]::AppendAllText($entry, @'

const shotsActivate = module.exports.activate;
module.exports.activate = context => require('../../olp-shots-entry').boot(context, shotsActivate);
'@)
$profile = Join-Path $root 'profile'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$exe = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'
$arguments = '--user-data-dir "{0}" --extensions-dir "{0}/extensions" --extensionDevelopmentPath="{1}" --disable-workspace-trust --skip-welcome --skip-release-notes --disable-gpu --remote-debugging-port={2} "{3}"' -f $profile, (Join-Path $root 'extension'), $port, $fixture
$arguments += ' --enable-logging=file --log-file="' + (Join-Path $root 'electron.log') + '"'
$env:OLP_SHOTS_SCENE = $Scene
$process = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -WindowStyle Hidden
try {
    Start-Sleep -Milliseconds 800
    if ($process.HasExited) { throw "VS Code exited before capture. See $root\electron.log" }
    node (Join-Path $PSScriptRoot 'olp-shots-capture.js') $fixture $port $OutDir $Prefix
    if ($LASTEXITCODE -ne 0) { throw "Capture failed in $root" }
    $error1 = Join-Path $fixture 'shots-error.txt'
    if (Test-Path -LiteralPath $error1) { Get-Content -LiteralPath $error1; throw "Scene failed in $root" }
    Write-Output "done: $OutDir"
} finally {
    try {
    Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" | Where-Object { $_.CommandLine -like "*$root*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch {
        Write-Warning ('Isolated process inventory unavailable: ' + $_.Exception.Message)
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F }
    }
}
