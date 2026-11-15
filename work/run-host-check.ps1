param([Parameter(Mandatory)][ValidateSet('unit-submit','unit-core','unit-v7','replay','submit','practice','live-mock','live-quick-mock','v6-main','v6-migrate','v7-main','v7-crash','shots-main','shots-urgent','shots-quick')][string]$Name)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot
$logDir=Join-Path $project 'outputs\host-logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$log=Join-Path $logDir ($Name+'.log')
$encoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=$encoding
[IO.File]::WriteAllText($log,'',$encoding)
function Write-HostLog {
    [CmdletBinding()]param([Parameter(ValueFromPipeline=$true)]$InputObject)
    process { [IO.File]::AppendAllText($log,($InputObject | Out-String -Width 500),$encoding); Write-Output $InputObject }
}
Set-Location -LiteralPath $project
# Capture native stderr without aborting the child before its own cleanup.
$ErrorActionPreference='Continue'
$ok=$false
try {
    if($Name-eq 'unit-submit'){& node work\test-submit.js 2>&1 | Write-HostLog}
    elseif($Name-eq 'unit-core'){& node work\test-olp-core.js 2>&1 | Write-HostLog}
    elseif($Name-eq 'unit-v7'){
        & node work\test-layout-view.js 2>&1 | Write-HostLog
        if($LASTEXITCODE-ne 0){throw 'Layout model failed'}
        & node work\test-runner-process.js 2>&1 | Write-HostLog
        if($LASTEXITCODE-ne 0){throw 'Process boundary tests failed'}
        & node work\test-v7.js 2>&1 | Write-HostLog
    }
    elseif($Name-eq 'replay'){
        & node outputs\sample-export-0.7.0\tools\replay.js verify 2>&1 | Write-HostLog
        if($LASTEXITCODE-ne 0){throw 'JavaScript replay failed'}
        & "$env:SystemRoot\System32\tar.exe" -tf outputs\sample-export-0.7.0.zip 2>&1 | Write-HostLog
        if($LASTEXITCODE-ne 0){throw 'Windows tar could not open ZIP'}
        & python work\verify-export-v7.py 2>&1 | Write-HostLog
    } else {
        $scriptPath='';$extra=@()
        switch($Name){
            'submit' {$scriptPath='work\run-olp-submit.ps1'}
            'practice' {$scriptPath='work\run-olp-integration.ps1'}
            'live-quick-mock' {$scriptPath='work\run-olp-live-quick-mock.ps1'}
            'live-mock' {$scriptPath='work\run-olp-live-mock.ps1';$extra=@('-Scenario','ok')}
            'v6-main' {$scriptPath='work\run-olp-v6.ps1';$extra=@('-Phase','main')}
            'v6-migrate' {$scriptPath='work\run-olp-v6.ps1';$extra=@('-Phase','migrate')}
            'v7-main' {$scriptPath='work\run-olp-v7.ps1';$extra=@('-Scenario','main')}
            'v7-crash' {$scriptPath='work\run-olp-v7.ps1';$extra=@('-Scenario','crash')}
            'shots-main' {$scriptPath='work\olp-shots.ps1';$extra=@('-Scene','main')}
            'shots-urgent' {$scriptPath='work\olp-shots.ps1';$extra=@('-Scene','urgent')}
            'shots-quick' {$scriptPath='work\olp-shots.ps1';$extra=@('-Scene','quick')}
        }
        & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath @extra 2>&1 | Write-HostLog
    }
    if($LASTEXITCODE-ne 0){throw "Runner exit code $LASTEXITCODE"}
    $ok=$true
}catch{
    ($_ | Out-String) | Write-HostLog | Write-Output
}finally{
    $line=if($ok){"HOST $Name PASS"}else{"HOST $Name FAIL: see outputs\host-logs\$Name.log"}
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    Write-Output $line
}
if(-not $ok){exit 1}
