$ErrorActionPreference = 'Stop'
$fixture = Join-Path $PSScriptRoot ('compiler-smoke-' + [Guid]::NewGuid().ToString('N').Substring(0, 7))
New-Item -ItemType Directory -Path $fixture | Out-Null
$compiler = (Get-Command g++).Source
$source = Join-Path $fixture 'main.cpp'
$binary = Join-Path $fixture 'main.exe'
$inputFile = Join-Path $fixture 'input.txt'
$outputFile = Join-Path $fixture 'output.txt'
$errorFile = Join-Path $fixture 'stderr.txt'
[IO.File]::WriteAllText($inputFile, "2 40`n")
function Compile([string]$text) {
    [IO.File]::WriteAllText($source, $text)
    $arguments = '-std=c++20 -O2 -Wall "{0}" -o "{1}"' -f $source, $binary
    $p = Start-Process -FilePath $compiler -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait -RedirectStandardError (Join-Path $fixture 'compile.txt')
    return $p.ExitCode
}
function Run([int]$timeout = 5000) {
    $p = Start-Process -FilePath $binary -WorkingDirectory $fixture -WindowStyle Hidden -PassThru -RedirectStandardInput $inputFile -RedirectStandardOutput $outputFile -RedirectStandardError $errorFile
    $null = $p.Handle
    if (-not $p.WaitForExit($timeout)) {
        # Same owned-child fallback as runner.js when the sandbox denies taskkill /T.
        $beforeErrorAction = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & taskkill.exe /PID $p.Id /T /F 2> (Join-Path $fixture 'taskkill.txt') | Out-Null
        } finally {
            $ErrorActionPreference = $beforeErrorAction
            if (-not $p.HasExited) { $p.Kill() }
        }
        if (-not $p.WaitForExit(3000)) { throw 'Timeout process survived direct kill.' }
        return 'TLE'
    }
    $p.WaitForExit()
    return $p.ExitCode
}
if ((Compile '#include <iostream>
int main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\n";}') -ne 0) { throw 'Compile failed.' }
if ((Run) -ne 0 -or [IO.File]::ReadAllText($outputFile).Trim() -ne '42') { throw 'Wrong result.' }
Write-Output 'compiler smoke correct PASS (42)'
if ((Compile '#include <iostream>
int main(){long long a,b;std::cin>>a>>b;std::cout<<a+b+1<<"\n";}') -ne 0) { throw 'Compile failed.' }
if ((Run) -ne 0 -or [IO.File]::ReadAllText($outputFile).Trim() -ne '43') { throw 'Wrong WA fixture.' }
Write-Output 'compiler smoke wrong-answer fixture PASS (43)'
if ((Compile 'int main(){ int a = ; }') -eq 0) { throw 'CE fixture compiled.' }
if ([IO.File]::ReadAllText((Join-Path $fixture 'compile.txt')) -notmatch 'error:') { throw 'No compiler error text.' }
Write-Output 'compiler smoke compile-error PASS'
if ((Compile 'int main(){return 7;}') -ne 0 -or (Run) -ne 7) { throw 'RTE fixture did not exit 7.' }
Write-Output 'compiler smoke runtime-error PASS (exit 7)'
if ((Compile 'int main(){volatile int x=0;for(;;)x++;}') -ne 0 -or (Run 700) -ne 'TLE') { throw 'TLE fixture did not time out.' }
Write-Output 'compiler smoke timeout-kill PASS'
Write-Output 'compiler smoke PASS 5 (PowerShell process boundary; not the Node runner)'
