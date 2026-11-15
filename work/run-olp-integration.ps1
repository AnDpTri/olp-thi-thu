$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot
$tag = [Guid]::NewGuid().ToString('N').Substring(0, 7)
$testRoot = Join-Path $PSScriptRoot "e2e-$tag"
$extension = Join-Path $testRoot 'extension'
$fixture = Join-Path $testRoot 'fixture'
New-Item -ItemType Directory -Path $testRoot, $extension, $fixture | Out-Null

$vsix = Get-ChildItem -LiteralPath (Join-Path $project 'outputs') -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
& "$env:SystemRoot\System32\tar.exe" -xf $vsix.FullName -C $testRoot
if ($LASTEXITCODE -ne 0) { throw 'Unable to extract the installed package for testing.' }
$entry = Join-Path $extension 'extension.js'
$instrumented = [IO.File]::ReadAllText($entry).Replace("require('vscode')", "require('../../test-boundary').vscode").Replace('Date.now()', "require('../../test-boundary').now()")
$instrumented += @'

const originalActivate = module.exports.activate;
module.exports.activate = context => {
  const boundary = require('../../test-boundary');
  boundary.context = context;
  if (process.env.OLP_TEST_PHASE === 'restore') {
    boundary.ui.now += 181 * 60 * 1000;
  }
  originalActivate(context);
  setImmediate(async () => {
    try {
      await require('../../olp-integration').run();
    } catch (error) {
      console.error(error);
    } finally {
      await require('vscode').commands.executeCommand('workbench.action.closeWindow');
    }
  });
};
'@
[IO.File]::WriteAllText($entry, $instrumented)
$profile = Join-Path $testRoot 'profile'
$extensions = Join-Path $testRoot 'installed'
$code = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'
$launch = '--user-data-dir "{0}" --extensions-dir "{1}" --extensionDevelopmentPath="{2}" --skip-welcome --skip-release-notes --disable-workspace-trust --disable-gpu --enable-logging=file --log-file="{4}" "{3}"' -f $profile, $extensions, $extension, $fixture, (Join-Path $testRoot 'electron.log')
try {
foreach ($phase in 'practice', 'restore') {
    $env:OLP_TEST_PHASE = $phase
    $process = Start-Process -FilePath $code -ArgumentList $launch -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(180000)) { throw "Timed out in $phase. Test directory is $testRoot." }
    $result = Join-Path $fixture "$phase.result"
    if (Test-Path -LiteralPath $result) {
        $outcome = Get-Content -LiteralPath $result -Raw -Encoding UTF8
        Write-Output "$phase $outcome"
        $networkLog=Join-Path $fixture 'network.log'
        if(Test-Path -LiteralPath $networkLog){Get-Content -LiteralPath $networkLog -Encoding UTF8 | ForEach-Object {Write-Output "GET trace: $_"}}
    }
    if ($process.ExitCode -ne 0 -or $outcome -ne 'PASS') {
        throw "Test failed in $phase ($($process.ExitCode)). Test directory is $testRoot."
    }
    $outcome = $null
}

} finally {
    Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" | Where-Object { $_.CommandLine -like "*$testRoot*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
