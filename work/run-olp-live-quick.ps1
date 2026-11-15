param(
    [Parameter(Mandatory)][string]$ContestUrl,
    [ValidateRange(0,180)][int]$KeepOpenMinutes = 0
)
$ErrorActionPreference = 'Stop'
$url = $null
if (-not [Uri]::TryCreate($ContestUrl, [UriKind]::Absolute, [ref]$url) -or $url.Scheme -ne 'https' -or $url.Host -ne 'oj.vnoi.info' -or -not $url.IsDefaultPort -or $url.UserInfo -or $url.Query -or $url.Fragment -or $url.AbsolutePath -notmatch '^/contest/[\w-]+(?:/all)?/?$') { throw 'Cần link https://oj.vnoi.info/contest/<mã> (không query, không thông tin đăng nhập).' }
. (Join-Path $PSScriptRoot 'olp-live-common.ps1')
Write-Host '==============================================================================='
Write-Host ' THI THỬ NGAY — KIỂM TRA THẬT TRÊN oj.vnoi.info'
Write-Host ' VS Code cô lập sẽ nhận link kỳ thi, đăng nhập bằng hộp cookie thật, tải đề và tách PDF.'
Write-Host ' Bạn tự dán cookie trong hộp "Đăng nhập VNOJ bằng cookie"; chờ tối đa 5 phút.'
Write-Host ' Esc hoặc hết hạn: dừng sạch. Bộ thử chỉ GET, KHÔNG tự nộp bài, KHÔNG tham gia kỳ thi.'
Write-Host " Sau kiểm tra: giữ cửa sổ $KeepOpenMinutes phút để bạn tự thao tác (tự bấm nộp nếu muốn)."
Write-Host ' Chỉ cửa sổ/hồ sơ của lần thử này được đóng/xóa. Báo cáo: outputs\live-quick\report.md'
Write-Host '==============================================================================='
$options = @{ contestUrl=$url.AbsoluteUri; keepOpenMinutes=$KeepOpenMinutes } | ConvertTo-Json -Compress
$ok = Invoke-OlpLive -RunOptions $options -TimeoutMinutes (9+$KeepOpenMinutes) -TestModule olp-integration-live-quick -CaptureOut (Join-Path (Split-Path $PSScriptRoot) 'outputs\live-quick') -CleanupProfile
if (-not $ok) { exit 1 }
