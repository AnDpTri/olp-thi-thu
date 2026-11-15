# Same quick-flow test; this entry point alone redirects extension GETs to a local mock.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'olp-live-common.ps1')
Write-Host 'THI THỬ NGAY — MOCK: đề cần cookie, PDF chung thật; không chạm VNOJ thật.'
$ok = Invoke-OlpLive -RunOptions '{"mock":true,"contestUrl":"https://oj.vnoi.info/contest/olp24","keepOpenMinutes":0}' -TimeoutMinutes 8 -TestModule olp-integration-live-quick -CaptureOut (Join-Path (Split-Path $PSScriptRoot) 'outputs\live-quick') -CleanupProfile
if (-not $ok) { exit 1 }
