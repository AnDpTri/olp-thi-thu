# Thi thử OLP · SYNTHETIC OLP demonstration

- Bắt đầu 2026-11-15 02:00:00 (UTC+07:00, giờ địa phương)
- Trạng thái Đã kết thúc
- Thời lượng 00:00:30.000 / 03:00:00.000

Thời gian từ mô hình tiêu điểm/idle/ngoài cửa sổ. Cùng nguồn với summary.json. Tổng các loại đã phân bổ của bài bằng tổng bài; các bài + không gán bài bằng thời lượng phiên. Mốc AC tính từ đầu phiên. Đơn vị HH:MM:SS.mmm; giờ địa phương (UTC+07:00).

| Bài | Tổng thời gian | Lần nộp đã ghi | Kết quả gần nhất | Mốc AC đầu | Đọc / phân tích | Viết mã | Thử I/O | Chưa gán hoạt động | Lần chạy input | Chạy mẫu đúng hết | Chạy mẫu có sai | Lỗi biên dịch | Tệp khác | Ngoài VS Code | Không thao tác |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A · Synthetic addition | 00:00:29.000 | 1 | AC | +00:00:24.000 | 00:00:04.000 | 00:00:17.000 | 00:00:00.000 | 00:00:00.000 | 1 | 1 | 0 | 0 | 00:00:00.000 | 00:00:05.000 | 00:00:03.000 |

- Chưa gán bài: 00:00:01.000; toàn phiên: 00:00:30.000.

# Tóm tắt phiên — SYNTHETIC / DỮ LIỆU GIẢ LẬP

Thời lượng 00:00:30.000 / 03:00:00.000; cùng dữ liệu với report.md và summary.json.

| Bài | Tổng | Đọc đề | Viết mã | Input | Output | Tệp khác | Chưa gán | Ngoài VS Code | Không thao tác | Chạy | Lượt mẫu đúng/sai | Từng mẫu đúng/sai |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A | 00:00:29.000 | 00:00:04.000 | 00:00:17.000 | 00:00:00.000 | 00:00:00.000 | 00:00:00.000 | 00:00:00.000 | 00:00:05.000 | 00:00:03.000 | 1 | 1/0 | 1/0 |
| Không gán bài | 00:00:01.000 | 00:00:00.000 | 00:00:00.000 | 00:00:00.000 | 00:00:00.000 | 00:00:00.000 | 00:00:01.000 | 00:00:00.000 | 00:00:00.000 | 0 | 0/0 | 0/0 |
| Toàn phiên | 00:00:30.000 | 00:00:04.000 | 00:00:17.000 | 00:00:00.000 | 00:00:00.000 | 00:00:00.000 | 00:00:01.000 | 00:00:05.000 | 00:00:03.000 | 1 | 1/0 | 1/0 |

Đơn vị hiển thị HH:MM:SS.mmm, dữ liệu gốc là ms nguyên. Tổng các loại của một bài bằng Tổng; tổng các bài + Không gán bài bằng thời lượng phiên. Lượt mẫu là batch; Từng mẫu là kết quả từng test. Mốc AC tính từ đầu phiên, không phải đồng hồ riêng của bài.

Mốc tự động (ms từ đầu phiên):
```json
{
  "A": {
    "A:first_statement": 1000,
    "A:first_keystroke": 6000,
    "A:first_compile": 7300,
    "A:first_clean_compile": 7300,
    "A:first_sample_pass": 8200,
    "A:first_submission": 22000,
    "A:first_AC": 24000
  }
}
```


| Bài | Từ lúc bắt đầu | Giờ (UTC+07:00) | Bài nộp | Liên kết | Kết quả |
| --- | ---: | --- | --- | --- | --- |
| A | +00:00:22.000 | 2026-11-15 02:00:22 | #1000 | https://oj.vnoi.info/submission/1000 | AC |

| Từ lúc bắt đầu | Giờ (UTC+07:00) | Bài | Mốc |
| ---: | --- | --- | --- |
| +00:00:00.000 | 2026-11-15 02:00:00 | — | Bắt đầu |
| +00:00:22.000 | 2026-11-15 02:00:22 | A | Đã nộp (tự động) · #1000 · https://oj.vnoi.info/submission/1000 |
| +00:00:24.000 | 2026-11-15 02:00:24 | A | Kết quả (lấy từ VNOJ) · #1000 · AC |
| +00:00:30.000 | 2026-11-15 02:00:30 | — | Kết thúc |
