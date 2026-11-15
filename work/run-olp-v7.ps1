param([ValidateSet('main','crash')][string]$Scenario='main')
$ErrorActionPreference='Stop'
$testRoot=Join-Path $PSScriptRoot ('e2e-v7-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
$fixture=Join-Path $testRoot 'fixture'
New-Item -ItemType Directory -Path $fixture -Force | Out-Null
& "$env:SystemRoot\System32\tar.exe" -xf (Join-Path (Split-Path $PSScriptRoot) 'outputs\olp-thi-thu-0.7.0.vsix') -C $testRoot
if($LASTEXITCODE -ne 0){throw 'Cannot extract 0.7.0 VSIX'}
$entry=Join-Path $testRoot 'extension\extension.js'
$source=[IO.File]::ReadAllText($entry).Replace("require('vscode')","require('../../test-boundary').vscode")
$source+=@'

const v7Activate=module.exports.activate;
module.exports.activate=context=>{
 const boundary=require('../../test-boundary');boundary.context=context;boundary.api=v7Activate(context);
 setImmediate(async()=>{try{await require('../../olp-integration-v7').run();}catch(error){console.error(error);}finally{
  if(process.env.OLP_TEST_PHASE!=='crash-prepare'){
   const vscode=require('vscode');for(const d of vscode.workspace.textDocuments.filter(d=>d.isDirty)){await vscode.window.showTextDocument(d);await vscode.commands.executeCommand('workbench.action.files.revert');}
   await vscode.commands.executeCommand('workbench.action.closeWindow');
  }
 }});return boundary.api;
};
'@
[IO.File]::WriteAllText($entry,$source)
$profile=Join-Path $testRoot 'profile'
$exe=Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'
$arguments='--user-data-dir "{0}" --extensions-dir "{1}" --extensionDevelopmentPath="{2}" --disable-workspace-trust --skip-welcome --skip-release-notes --disable-gpu --enable-logging=file --log-file="{3}" "{4}"' -f $profile,(Join-Path $testRoot 'installed'),(Join-Path $testRoot 'extension'),(Join-Path $testRoot 'electron.log'),$fixture
function Close-Owned {
    Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" | Where-Object {$_.CommandLine -like "*$testRoot*"} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
}
function Launch([string]$phase) {
    $env:OLP_TEST_PHASE=$phase
    $script:process=Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -WindowStyle Hidden
    $null=$script:process.Handle
}
function Await-Result([string]$phase,[int]$seconds=300) {
    $end=(Get-Date).AddSeconds($seconds);$result=Join-Path $fixture "$phase.result"
    while((Get-Date)-lt $end -and -not(Test-Path -LiteralPath $result) -and -not $script:process.HasExited){Start-Sleep -Milliseconds 300}
    if(-not(Test-Path -LiteralPath $result)){throw "Step ${phase}: no result. Exit=$($script:process.ExitCode). See $testRoot\electron.log and fixture\steps.log"}
    $text=[IO.File]::ReadAllText($result)
    if($text-ne 'PASS'){throw "Step $phase failed:`n$text`nTest directory $testRoot"}
    Write-Output "$phase PASS"
}
try {
    if($Scenario-eq 'crash'){
        Launch 'crash-prepare'
        $deadline=(Get-Date).AddSeconds(120)
        $prepareResult=Join-Path $fixture 'crash-prepare.result'
        while((Get-Date)-lt $deadline -and -not(Test-Path (Join-Path $fixture 'crash.ready')) -and -not(Test-Path -LiteralPath $prepareResult) -and -not $process.HasExited){Start-Sleep -Milliseconds 200}
        if(-not(Test-Path (Join-Path $fixture 'crash.ready'))){$details=if(Test-Path -LiteralPath $prepareResult){[IO.File]::ReadAllText($prepareResult)}else{'No preparation result; inspect electron.log'};throw "Crash preparation failed:`n$details`nSee $testRoot"}
        Close-Owned
        Start-Sleep -Seconds 1
        Launch 'crash-resume'
        Await-Result 'crash-resume' 180
    } else {Launch 'main';Await-Result 'main' 420}
    if(-not $process.WaitForExit(20000)){throw "Test passed assertions but isolated window failed to close: $testRoot"}
    Write-Output "v7 $Scenario PASS"
} finally {Close-Owned}
