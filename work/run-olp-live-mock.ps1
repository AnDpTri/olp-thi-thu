# Kiểm chứng logic của bộ thử live: chạy CÙNG olp-integration-live.js nhưng VNOJ được thay bằng mock-vnoj.js
# và hộp cookie được điền sẵn cookie của mock. Không bao giờ chạm mạng thật.
#   -Scenario ok          mock trả AC (mặc định)
#   -Scenario pdf         như ok, mock còn phục vụ một đề PDF
#   -Scenario wa          mock trả WA 40/100: bộ thử phải báo LỖI ở bước 7
#   -Scenario badcookie   mock từ chối cookie: bộ thử phải báo LỖI ở bước 2
param([ValidateSet('ok', 'pdf', 'wa', 'badcookie')][string]$Scenario = 'ok')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'olp-live-common.ps1')
$ok = Invoke-OlpLive -RunOptions "{ mock: true, scenario: '$Scenario' }" -TimeoutMinutes 4
if (-not $ok) { exit 1 }
