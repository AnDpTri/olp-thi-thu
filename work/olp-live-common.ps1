# Dùng chung cho run-olp-live.ps1 và run-olp-live-mock.ps1: mở một VS Code cô lập (hồ sơ và thư mục tiện ích riêng
# dưới work\e2e-<tag>), chạy olp-integration-live.js trong extension host và chuyển nhật ký về console này.
function Invoke-OlpLive {
    param(
        [Parameter(Mandatory)][string]$RunOptions,   # đoạn JS truyền cho run(...)
        [Parameter(Mandatory)][int]$TimeoutMinutes,
        [Scriptblock]$BeforeLaunch,
        [ValidateSet('olp-integration-live','olp-integration-live-quick')][string]$TestModule = 'olp-integration-live',
        [string]$CaptureOut,
        [switch]$CleanupProfile
    )
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $work = $PSScriptRoot
    $project = Split-Path $work
    $tag = [Guid]::NewGuid().ToString('N').Substring(0, 7)
    $testRoot = Join-Path $work "e2e-$tag"
    $extension = Join-Path $testRoot 'extension'
    $fixture = Join-Path $testRoot 'fixture'
    $profileDir = Join-Path $testRoot 'profile'
    New-Item -ItemType Directory -Path $testRoot, $extension, $fixture | Out-Null

    $vsix = Get-ChildItem -LiteralPath (Join-Path $project 'outputs') -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Write-Host "Gói thử: $($vsix.Name)"
    & "$env:SystemRoot\System32\tar.exe" -xf $vsix.FullName -C $testRoot
    if ($LASTEXITCODE -ne 0) { throw 'Unable to extract the package for testing.' }
    $entry = Join-Path $extension 'extension.js'
    # Chỉ đổi require('vscode') sang lớp bọc test-boundary; không đổi Date.now, không đổi fetch ở đây.
    $instrumented = [IO.File]::ReadAllText($entry).Replace("require('vscode')", "require('../../test-boundary').vscode")
    $instrumented += @'

const originalActivate = module.exports.activate;
module.exports.activate = context => {
  require('../../test-boundary').context = context;
  originalActivate(context);
  setImmediate(async () => {
    try {
      await require('../../olp-integration-live').run(__OPTIONS__);
    } catch (error) {
      console.error(error);
    } finally {
      await require('vscode').commands.executeCommand('workbench.action.closeWindow');
    }
  });
};
'@.Replace('__OPTIONS__', $RunOptions).Replace("../../olp-integration-live'", "../../$TestModule'")
    [IO.File]::WriteAllText($entry, $instrumented)

    $code = Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code/Code.exe'
    $launch = '--user-data-dir "{0}" --extensions-dir "{1}" --extensionDevelopmentPath="{2}" --skip-welcome --skip-release-notes --disable-workspace-trust --disable-gpu --enable-logging=file --log-file="{4}" "{3}"' -f $profileDir, (Join-Path $testRoot 'installed'), $extension, $fixture, (Join-Path $testRoot 'electron.log')
    if ($CaptureOut) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
        $launch += " --remote-debugging-port=$port"
    }
    if ($BeforeLaunch) { & $BeforeLaunch }

    $log = Join-Path $testRoot 'live.log'
    $resultFile = Join-Path $testRoot 'live.result'
    $stepFile = Join-Path $testRoot 'live.step'
    $script:offset = 0
    function Relay {
        if (-not (Test-Path -LiteralPath $log)) { return }
        $stream = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
        try {
            $length = [int]($stream.Length - $script:offset)
            if ($length -le 0) { return }
            $buffer = New-Object byte[] $length
            [void]$stream.Seek($script:offset, 'Begin')
            $read = $stream.Read($buffer, 0, $length)
            $last = [Array]::LastIndexOf($buffer, [byte]10, $read - 1)
            if ($last -lt 0) { return }
            $script:offset += $last + 1
            Write-Host -NoNewline ([Text.Encoding]::UTF8.GetString($buffer, 0, $last + 1))
        } finally { $stream.Dispose() }
    }

    $process = Start-Process -FilePath $code -ArgumentList $launch -PassThru -WindowStyle Hidden
    $capture = $null
    $started = Get-Date
    $failure = $null
    try {
        if ($CaptureOut) {
            $captureArgs = '"{0}" "{1}" {2} "{3}" "" {4}' -f (Join-Path $work 'olp-shots-capture.js'), $fixture, $port, $CaptureOut, ($TimeoutMinutes*60000)
            $capture = Start-Process -FilePath (Get-Command node).Source -ArgumentList $captureArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $testRoot 'capture.log') -RedirectStandardError (Join-Path $testRoot 'capture-error.log')
        }
        while (-not $process.HasExited) {
            Relay
            if (((Get-Date) - $started).TotalMinutes -gt $TimeoutMinutes) { $failure = 'quá thời gian'; break }
            # Có kết quả mà cửa sổ chưa đóng sau 20 giây thì đóng nốt (chỉ cửa sổ của lần chạy này).
            if ((Test-Path -LiteralPath $resultFile) -and ((Get-Item -LiteralPath $resultFile).LastWriteTime -lt (Get-Date).AddSeconds(-20))) { break }
            Start-Sleep -Milliseconds 400
        }
    } finally {
        if ($capture -and -not $capture.HasExited) { Stop-Process -Id $capture.Id -Force -ErrorAction SilentlyContinue }
        # Chỉ đóng các tiến trình khởi động bằng hồ sơ cô lập này, tuyệt đối không đụng VS Code của bạn.
        try {
        Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" | Where-Object { $_.CommandLine -like "*$testRoot*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        } catch {
            Write-Warning ('Isolated process inventory unavailable: ' + $_.Exception.Message)
            if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F }
        }
        if ($CleanupProfile) {
            Start-Sleep -Seconds 2
            $resolvedProfile = [IO.Path]::GetFullPath($profileDir)
            $expectedRoot = [IO.Path]::GetFullPath($testRoot) + [IO.Path]::DirectorySeparatorChar
            if (-not $resolvedProfile.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Profile cleanup target escaped this run directory.' }
            for ($attempt=0; $attempt -lt 5 -and (Test-Path -LiteralPath $resolvedProfile); $attempt++) {
                Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
                if (Test-Path -LiteralPath $resolvedProfile) { Start-Sleep -Seconds 1 }
            }
            if (Test-Path -LiteralPath $resolvedProfile) { throw "Cannot remove isolated profile: $resolvedProfile" }
            & node (Join-Path $work 'live-quick-tools.js') scan $testRoot
            if ($LASTEXITCODE -ne 0) { throw 'Sensitive-pattern scan failed; see file paths above (no values printed).' }
        }
    }
    Start-Sleep -Milliseconds 500
    Relay
    $outcome = if (Test-Path -LiteralPath $resultFile) { (Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8).Trim() } else { $null }
    # Hồ sơ cô lập có thể giữ cookie đã dán (được mã hóa); xóa luôn thư mục hồ sơ của lần chạy này.
    Start-Sleep -Seconds 1
    if ($outcome -eq 'PASS') {
        Write-Host 'KẾT QUẢ: ĐẠT'
        return $true
    }
    if ($outcome -eq 'CANCELLED') {
        Write-Host 'KẾT QUẢ: ĐÃ DỪNG (hủy/hết hạn hộp cookie; không nộp bài)'
        return $false
    }
    $number = if ($outcome -match '^FAIL (\d+)') { $Matches[1] } elseif (Test-Path -LiteralPath $stepFile) { (Get-Content -LiteralPath $stepFile -Raw).Trim() } else { '1' }
    if (-not $outcome) { Write-Host "(Không có tệp kết quả: $(if ($failure) { $failure } else { 'cửa sổ VS Code đã bị đóng sớm' }). Thư mục thử: $testRoot)" }
    Write-Host "KẾT QUẢ: LỖI ở bước $number"
    return $false
}
