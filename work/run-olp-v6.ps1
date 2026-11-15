param([ValidateSet('main', 'migrate')][string]$Phase = 'main', [int]$TimeoutSeconds = 540)
$ErrorActionPreference = 'Stop'
# Chạy olp-integration-v6.js trong VS Code thật (hồ sơ và thư mục tiện ích riêng), VNOJ được thay bằng mock-vnoj.js.
$project = Split-Path $PSScriptRoot
$tag = [Guid]::NewGuid().ToString('N').Substring(0, 7)
$testRoot = Join-Path $PSScriptRoot "e2e-$tag"
$extension = Join-Path $testRoot 'extension'
$fixture = Join-Path $testRoot 'fixture'
New-Item -ItemType Directory -Path $testRoot, $extension, $fixture | Out-Null

$vsix = Get-ChildItem -LiteralPath (Join-Path $project 'outputs') -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Output "package: $($vsix.Name)"
& "$env:SystemRoot\System32\tar.exe" -xf $vsix.FullName -C $testRoot
if ($LASTEXITCODE -ne 0) { throw 'Unable to extract the package for testing.' }
$entry = Join-Path $extension 'extension.js'
$instrumented = [IO.File]::ReadAllText($entry).Replace("require('vscode')", "require('../../test-boundary').vscode").Replace('Date.now()', "require('../../test-boundary').now()")
$instrumented += @'

const originalActivate = module.exports.activate;
module.exports.activate = context => {
  const boundary = require('../../test-boundary');
  boundary.context = context;
  const suite = require('../../olp-integration-v6');
  if (process.env.OLP_TEST_PHASE === 'migrate') suite.seed(context);
  boundary.api = originalActivate(context);
  setImmediate(async () => {
    try {
      await suite.run();
    } catch (error) {
      console.error(error);
    } finally {
      const vscode = require('vscode');
      for (const document of vscode.workspace.textDocuments.filter(item => item.isDirty)) {
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand('workbench.action.files.revert');
      }
      await vscode.commands.executeCommand('workbench.action.closeWindow');
    }
  });
  return boundary.api;
};
'@
[IO.File]::WriteAllText($entry, $instrumented)
$profile = Join-Path $testRoot 'profile'
$extensions = Join-Path $testRoot 'installed'
$code = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'
$launch = '--user-data-dir "{0}" --extensions-dir "{1}" --extensionDevelopmentPath="{2}" --skip-welcome --skip-release-notes --disable-workspace-trust --disable-gpu --enable-logging=file --log-file="{4}" "{3}"' -f $profile, $extensions, $extension, $fixture, (Join-Path $testRoot 'electron.log')
$env:OLP_TEST_PHASE = $Phase
$process = Start-Process -FilePath $code -ArgumentList $launch -PassThru -WindowStyle Hidden
try {
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) { throw "Timed out. Test directory is $testRoot." }
    $result = Join-Path $fixture "$Phase.result"
    $outcome = if (Test-Path -LiteralPath $result) { Get-Content -LiteralPath $result -Raw -Encoding UTF8 } else { 'no result file' }
    Write-Output "$Phase $outcome"
    $steps = Join-Path $fixture 'steps.log'
    if (Test-Path -LiteralPath $steps) { Get-Content -LiteralPath $steps -Encoding UTF8 | Select-Object -Last 8 | ForEach-Object { Write-Output "  $_" } }
    if ($outcome -ne 'PASS') { throw "Test failed. Test directory is $testRoot." }
} finally {
    # Close only processes started with this isolated profile.
    try {
    Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" | Where-Object { $_.CommandLine -like "*$testRoot*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch {
        Write-Warning ('Isolated process inventory unavailable: ' + $_.Exception.Message)
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F }
    }
}
