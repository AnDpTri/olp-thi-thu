param([switch]$KeepOpen)
$ErrorActionPreference = 'Stop'
$review = Join-Path $PSScriptRoot ('review-' + [Guid]::NewGuid().ToString('N').Substring(0, 7))
$fixture = Join-Path $review 'fixture'
New-Item -ItemType Directory -Path $review, $fixture | Out-Null
$vsix = Join-Path (Split-Path $PSScriptRoot) 'outputs/olp-thi-thu-0.4.0.vsix'
tar.exe -xf $vsix -C $review
if ($LASTEXITCODE -ne 0) { throw 'Could not extract extension' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'olp-preview/De-OLP-2024-Khong-chuyen.pdf') -Destination $fixture
$extension = Join-Path $review 'extension'
$entry = Join-Path $extension 'extension.js'
$append = @'

const currentActivate = module.exports.activate;
module.exports.activate = context => require('../../olp-review-entry').review(context, currentActivate);
'@
[IO.File]::AppendAllText($entry, $append)
$profile = Join-Path $review 'profile'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$exe = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'
$arguments = '--user-data-dir "{0}" --extensions-dir "{0}/extensions" --extensionDevelopmentPath="{1}" --disable-workspace-trust --skip-welcome --skip-release-notes --remote-debugging-port={2} "{3}"' -f $profile, $extension, $port, $fixture
$style = if ($KeepOpen) { 'Normal' } else { 'Hidden' }
$env:OLP_PREVIEW_ONLY = if ($KeepOpen) { '1' } else { '0' }
$test = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -WindowStyle $style
try {
  node (Join-Path $PSScriptRoot 'olp-review-capture.js') $review $port
  if ($LASTEXITCODE -ne 0) { throw "Capture failed in $review" }
  Write-Output $review
} finally {
  if (!$KeepOpen -and !$test.HasExited) { Stop-Process -Id $test.Id }
}
