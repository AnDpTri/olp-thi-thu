# Thử nghiệm THẬT trên https://oj.vnoi.info bên trong một VS Code cô lập (hồ sơ và thư mục tiện ích riêng).
# Chạy từ PowerShell:  powershell -NoProfile -ExecutionPolicy Bypass -File work\run-olp-live.ps1
# Không có công tắc nào chuyển sang mock: tệp này luôn dùng mạng thật. Bản mock nằm ở run-olp-live-mock.ps1.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'olp-live-common.ps1')

Write-Host ''
Write-Host '=============================================================================='
Write-Host ' THỬ NGHIỆM THẬT TRÊN oj.vnoi.info'
Write-Host ' Một cửa sổ VS Code sẽ mở ra (hồ sơ riêng, không đụng tới VS Code của bạn).'
Write-Host ' Khi hộp "Đăng nhập VNOJ bằng cookie" hiện lên, hãy DÁN giá trị cookie sessionid'
Write-Host ' vào đó rồi nhấn Enter. Không làm gì khác trong cửa sổ đó.'
Write-Host ' Bạn có tối đa 5 phút. Nhấn Esc hoặc để quá hạn thì thử nghiệm dừng, không nộp gì.'
Write-Host ' Chương trình sẽ nộp đúng MỘT bài (icpc26_na_e) bằng tài khoản của cookie đó,'
Write-Host ' rồi tự đóng cửa sổ và xóa hồ sơ thử.'
Write-Host '=============================================================================='
Write-Host ''

$ok = Invoke-OlpLive -RunOptions '{}' -TimeoutMinutes 14
if (-not $ok) { exit 1 }
