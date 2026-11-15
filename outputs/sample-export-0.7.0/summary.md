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
