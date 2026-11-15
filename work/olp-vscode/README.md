# OLP Thi thử · 0.7.0

Thi thử trong VS Code Desktop với một thư mục cục bộ. Không cần npm/build. Mặc định C++ khi **Thi thử ngay**, 180 phút; giữ được các bộ đề/phiên 0.5.1 và 0.6.0.

## Một lần chuẩn bị

Chạy **OLP: Thi thử ngay**, dán link kỳ thi/bài trên https://oj.vnoi.info. Nếu chưa có phiên hợp lệ, tiện ích mở thẳng hộp dán cookie `sessionid` (mật khẩu được che). Lấy cookie bằng cách đăng nhập trên web → F12 → Application/Storage → Cookies → https://oj.vnoi.info; tiện ích không đọc kho cookie trình duyệt. Sau đó tải bài, PDF, mẫu HTML, tách phạm vi đề, tạo lời giải từ template, mở bài A và hỏi **Bắt đầu … phút ngay?**. Có thể đổi thời lượng ngay trong thông báo. Nhớ 5 link và ngôn ngữ; lần sau không phải chọn lại. **Chọn lại loại tệp lời giải cho bộ đề mới** để đổi ngôn ngữ.

Hộp **Bắt đầu ngay?** giữ trên màn hình đến khi bạn chọn hoặc hủy, để không bỏ lỡ lúc bộ đề đã sẵn sàng. GET tải đề bị lỗi kết nối hoặc HTTP 5xx sẽ thử lại một lần với hạn chờ mới; nếu vẫn lỗi, thông báo có mã nguyên nhân để kiểm tra mạng.

Nếu đề chỉ đọc được khi đã tham gia/đăng nhập, tiện ích thử GET công khai trước, rồi thử lại GET bằng phiên đã lưu. Cookie chỉ đến đúng https://oj.vnoi.info, không tự theo chuyển hướng ra ngoài, không POST khi tải đề. Bạn vẫn phải tham gia kỳ thi trên web nếu VNOJ yêu cầu.

Có thể dùng **Tải đề VNOJ**, **Chuẩn bị phiên ngoại tuyến A–D** hoặc **Nhận đề từ Competitive Companion** riêng. Với Companion, thêm cổng 27177 vào Custom ports, chạy lệnh nhận đề, chọn Chờ nhận đề rồi bấm + trên trang VNOJ. Cổng loopback chỉ mở trong lúc chờ.

## Làm bài và đọc đề riêng

Lúc làm: mã rộng bên trái, **input.txt trên output.txt** bên phải. Không nhét PDF cạnh mã. **Ctrl+Alt+D** chuyển sang đề riêng, chiếm toàn bộ vùng soạn thảo; bấm lại để về mã và bố cục input/output. Đề có tên bài trên tab, được giữ sống khi ẩn nên các lần mở sau dùng lại ngay. Có thể bấm tab đề/mã trực tiếp. Bấm bài trong cây hoặc Ctrl+Alt+1…4 đổi bài; các nhóm được dùng lại.

Sau Chạy, Chạy test mẫu hoặc quay lại từ đề, con trỏ trở về mã để viết tiếp. Output được ghi một lần bằng LF rồi chờ tab tải lại; nhật ký không có bước CRLF trung gian do tiện ích tạo ra.

Mã trong editor phải khớp tệp đã lưu trước và sau biên dịch. Nếu mã thay đổi trong lúc chuẩn bị/chạy mẫu, tiện ích yêu cầu chạy lại; nhật ký biên dịch có SHA256 của đúng mã đã dùng. Sự kiện thay đổi rỗng của VS Code không được tính là sửa tệp. Sau sự cố, phần chưa lưu vẫn còn trong lịch sử; mốc `resume_baseline` và snapshot `resume` ghi rõ nội dung thực sự được mở lại, kể cả khi tệp trên đĩa đã mất phần chưa lưu.

Đầu trang đề có khoảng trang gốc và đồng hồ **Đọc đề** theo bài; đồng hồ chỉ cộng các khoảng đọc có tiêu điểm, loại trừ rời cửa sổ/không thao tác. Nếu đang hiển thị PDF đầy đủ do chưa tách chắc chắn, nút **Gán trang đề** nằm ngay ở đầu trang. Diff mẫu mở ở nhóm trái rộng. **Nhật ký** mặc định thu gọn để các tác vụ/báo cáo dễ tìm.

PDF gộp nhiều bài được nhận diện theo tiêu đề. Với đề OLP 2024: A Đăng ký học phần bắt đầu trang 3, B Đường đi ở phần dưới trang 5, C Ba số nguyên tố ở phần trên trang 5, D Đố vui bắt đầu trang 1. Khi hai bài chung trang, ảnh và văn bản được cắt theo vị trí tiêu đề, không chỉ số trang. **Trang chung** mở phần hướng dẫn trước bài đầu. `pages.json` trong bộ đề lưu phạm vi. Nếu không chắc chắn, hiển thị PDF đầy đủ và nút/lệnh **Gán trang đề cho bài** (`olp.assignPages`) để nhớ khoảng trang thủ công. Khoảng thủ công nhận số trang từ 1, ví dụ `3-4`.

Trong ZIP, PDF vẫn là bản gốc đầy đủ kèm phạm vi/crop trong manifest; `statement.txt` là văn bản riêng. Thư mục `statement-pages/` có PNG cắt đúng từng bài, dùng được ngay không cần renderer. PDF gốc không được ghi lại thành PDF con. Khi chuẩn bị bộ đề, tiện ích tạo trước ảnh để lần mở đề đầu tiên cũng dùng được ngay.

## Chạy, mẫu và nộp

- **Ctrl+Alt+R**: lưu mã và tệp bài, biên dịch C++/C hoặc chạy Python/Java, dùng input.txt làm stdin, cập nhật output.txt bằng **kết quả thực tế lần chạy gần nhất**. Binary trong `build` của bộ đề. Thanh trạng thái/thông báo có mã thoát, thời gian, stderr; Output → OLP có chi tiết. Lỗi biên dịch hiện trong Problems. Có nút Dừng; quá hạn tự dừng.
- **Ctrl+Alt+T**: chạy mọi cặp `mau-N.in/out`, bỏ qua khoảng trắng cuối dòng/dòng trống cuối. Cây hiện ĐÚNG/SAI/TLE/RTE và thời gian. Bấm mẫu sai để xem diff mong đợi ↔ thực tế.
- **Lưu input/output hiện tại thành test mẫu**: tạo cặp mẫu mới. Hãy chắc output.txt đang là đáp án đúng trước khi lưu.
- Mẫu HTML được trích từ các khối Input/Output rõ ràng. Mẫu PDF chỉ trích khi cấu trúc rất rõ, có nhãn **từ PDF, cần kiểm tra** và không chặn nộp. Không có mẫu thì tiện ích chỉ cách thêm.
- **Ctrl+Alt+S**: nộp một lần khi đang thi. Nếu có mẫu đáng tin mà chưa chạy đúng hết cho mã/mẫu/cài đặt hiện tại, chạy trước rồi hỏi một lần nếu còn sai. Mã đổi trong lúc kiểm tra/chọn ngôn ngữ thì dừng, yêu cầu bấm Nộp lại. Một lần bấm gửi tối đa một POST nộp; không tự nộp lại.
- Kết quả được hỏi tự động mỗi 3 giây, tối đa khoảng 3 phút. Cây có thời điểm nộp, link, verdict và kết quả tốt nhất. **Lấy lại kết quả** cho bài còn chờ. Thanh trạng thái: `A ✓  B 40  C –  D –`. ✓ = AC; số = điểm tốt nhất; … = đang chờ; ✗ = đã có kết quả chưa đạt; – = chưa nộp.

Nút Chạy, Mẫu, Nộp, Đề có trên thanh tiêu đề tệp lời giải; Chạy/Nộp cạnh đồng hồ. Đăng nhập cookie là lựa chọn đầu tiên. Cookie bị từ chối mở thẳng hộp dán cookie mới, rồi bạn bấm Nộp lại. Captcha dùng đường trình duyệt: sao chép mã, mở form, bạn tự nộp. Các lệnh ghi đã nộp/kết quả bằng tay vẫn có. Không lưu mật khẩu; phiên trong kho bí mật VS Code, không xuất vào ZIP.

## Template và phím

**Sửa template lời giải** mở template trong global storage của tiện ích; dùng `${problem}`, `${name}`, `${contest}`, `${date}`, `${cursor}`. Tệp đã có nội dung không bị ghi đè. Template mặc định trung tính, không có thuật toán.

| Phím | Tác vụ |
| --- | --- |
| Ctrl+Alt+R | Chạy input.txt |
| Ctrl+Alt+T | Chạy mẫu |
| Ctrl+Alt+S | Nộp khi đang thi |
| Ctrl+Alt+D | Đổi đề ↔ mã |
| Ctrl+Alt+1…4 | Chuyển A…D |
| Ctrl+Alt+K | Mốc Bị kẹt |
| Ctrl+Alt+M | Mốc thời gian, nhãn tùy chọn |

**Ghi chú vào nhật ký** nhận ghi chú tự do. Cây có các mốc tự động: đọc đề đầu, sửa mã đầu, biên dịch đầu/sạch đầu, đúng hết mẫu đầu, nộp đầu và AC đầu. “Gõ mã đầu” là lần sửa nội dung đầu tiên, có thể là dán; không suy ra một lần bấm phím vật lý.

## Thời gian và ghi lại quá trình

Chỉ ghi cục bộ trong bộ đề `OLP-<id>`. Không ghi màn hình/video, không theo dõi phím ngoài VS Code, không đọc tệp ngoài bộ đề, không thu clipboard ngoài phần thực sự dán vào tệp bài, không telemetry, không gửi ZIP đi đâu.

Mỗi phiên có `.olp/<session-id>/events.jsonl`, `edits.jsonl`, `snapshots.jsonl`, `blobs/` và `assets/`. Nhật ký append-only, ghi và fsync ngay từng batch chỉnh sửa/sự kiện; ảnh chụp văn bản được lưu theo hash. Khi mở lại, tiếp tục cùng nhật ký; đuôi JSONL bị ghi dở được giữ làm bằng chứng và cắt về bản ghi hoàn chỉnh cuối. Khoảng đóng/crash được gắn `recording_gap`, tính ngoài VS Code vì không biết bạn thực sự làm gì lúc đó.

Thời gian quan sát trong summary/report mới dựa vào tab **thực sự active/visible** và trạng thái cửa sổ:

- Đề active + cửa sổ có tiêu điểm → Đọc đề; mã → Viết mã; input/output → Thử I/O.
- Tệp khác/không có tệp có mục riêng; chỉ ghi loại, không ghi đường dẫn tệp ngoài bộ đề.
- Rời cửa sổ → ngoài VS Code. Đây là khoảng không quan sát, không suy ra ứng dụng bạn dùng.
- Sau `olp.idleSeconds` không có sửa tệp, chọn/con trỏ, cuộn hay lệnh OLP → không thao tác. Đây là ước lượng tương tác, có thể bạn vẫn đang suy nghĩ/đọc; không đo sự chú ý.
- Đề gửi danh sách trang đang nhìn thấy, được throttle; chọn/con trỏ được lấy mẫu tối đa 2 lần/giây. Các tệp tự mở để sắp bố cục không tạo mốc đọc giả.

Edits ghi toàn bộ thay đổi nội dung lời giải/input/output: offset/độ dài UTF-16, phần bị xóa, phần chèn, version, undo/redo, cờ chèn lớn giống dán. Không thể biết chính xác từng phím vật lý hay nguồn đoạn dán. Ghi save và thay đổi ngoài editor; output do tiện ích ghi có cờ generated, không cộng vào thống kê gõ. Snapshot ở đầu, mỗi chạy/chạy mẫu/nộp, mỗi 60 giây nếu thay đổi và cuối phiên. Phiên cũ không có lịch sử trước khi nâng cấp. Report, summary và thời gian trong cây dùng chung mô hình tiêu điểm/idle/ngoài cửa sổ; các mốc cũ chỉ giữ trong nhật ký. Phiên cũ thiếu dữ liệu quan sát được ghi rõ, không suy đoán thời gian đọc/viết.

## Xuất ZIP cho agent

**Xuất gói phiên (.zip)** (`olp.export`) ghi ZIP cạnh bộ đề. Mặc định tự xuất khi kết thúc/hết giờ, mở thông báo **Mở thư mục** và sao chép đường dẫn ZIP. Báo cáo Markdown vẫn lưu/mở bên cạnh; **Sao chép báo cáo Markdown** để lấy riêng báo cáo thay cho đường dẫn ZIP.

Agent chỉ cần giải nén, đọc `README_AGENT.md` và `SCHEMA.md`, rồi `manifest.json`, `summary.md/json`, `report.md`, `timeline/timeline.md` và thư mục `problems/A...`. Có đề/văn bản, mẫu, mã cuối, lịch sử snapshot/diff/index, input/output từng lần chạy, compile output/diagnostics, source nộp chính xác và metadata/verdict. Timeline chung và edit log đủ để replay. Manifest chỉ rõ SHA256/bytes mỗi tệp, schema, phiên bản, múi giờ, metadata và sai lệch replay. Mọi snapshot được kiểm tra so với edit log khi xuất; sai lệch được công khai trong manifest.

Schema 2: mọi thời gian trong report/summary và báo cáo sao chép dùng cùng số ms nguyên, hiển thị `HH:MM:SS.mmm`. Tổng các loại (đọc, mã, input, output, tệp khác, chưa gán, ngoài VS Code, không thao tác) bằng tổng của bài; tổng các bài + thời gian chưa gán bài bằng thời lượng phiên. `limitMs` là giới hạn thi, `elapsedMs` là thời gian đã trôi qua; không dùng lẫn hai số.

Phiên 0.5.1 được ghi rõ **phiên cũ – không có nhật ký chi tiết**: thời lượng/giới hạn giữ từ phiên cũ, thời gian bài/phase tính theo journal focus/phase cũ. Idle/ngoài VS Code không biết, hiển thị `—`, không giả thành 0. Phần sau khi nâng cấp có log mới được tính riêng theo quan sát. Mở báo cáo qua **Lịch sử phiên** rồi dùng **Sao chép báo cáo** hoặc **Xuất gói phiên** để lấy đúng phiên đang xem. Xuất lịch sử không đổi recorder của phiên đang thi. ZIP cũ có `legacy: true`, `missingData` và journal gốc; không lấy mã hiện tại giả làm mã của phiên cũ nếu không có snapshot lịch sử.

PDF chung chỉ nằm một lần ở `statement/full.pdf`; mỗi bài có `statement.json` ghi nguồn, trang/crop, số bài gốc và cách gán. Ảnh PNG là đề để đối chiếu; text tiện tra cứu, có `^{...}` / `_{...}`, vẫn có thể sai bố cục toán/bảng. Mẫu ghi rõ nguồn VNOJ/Companion/tự thêm/không rõ và hash để nhận ra mẫu đã sửa. Không đoán nguồn của bộ đề cũ.

Mỗi lần chạy có một `meta.json` kèm kết quả biên dịch; tệp rỗng được bỏ và metadata ghi `empty`. Template chưa sửa chỉ có giải thích trong index lịch sử, không nhân snapshot/diff thừa. Nhật ký dễ đọc có `worklog.md` riêng từng bài; raw JSONL vẫn đầy đủ. Ghi chú/mốc có nội dung, bài và phase lúc gọi. Tên ZIP bỏ dấu đúng từ, ví dụ `Khong-chuyen`.

Trong thư mục đã giải nén:

```
node tools/replay.js verify
python tools/replay.py verify
node tools/replay.js file A/A.cpp 15000 out.cpp
python tools/replay.py file A/A.cpp 15000 out.cpp
node tools/replay.js snapshots
python tools/replay.py snapshots
node tools/replay.js submissions sources-at-submission
python tools/replay.py submissions sources-at-submission-python
```

`15000` là số ms từ đầu phiên (chọn mốc nằm trong phiên thật; README_AGENT.md tự chọn mốc phù hợp), bao gồm các edit tại thời điểm đó. Không cần thư viện ngoài. Lịch sử dùng diff toàn tệp để chắc chắn đúng, không đảm bảo hunk tối thiểu. Stdout/stderr lưu trong artifacts giới hạn 200 KB/luồng, giữ đầu/cuối và cờ truncation; thay đổi văn bản và snapshot phải giữ đủ để replay, nên input/output cực lớn hay dán khối lớn liên tục vẫn có thể làm gói vượt vài chục MB. ZIP không có cookie, session, header xác thực hay clipboard tùy tiện. Nội dung bạn tự ghi vào mã/input/output có thể nhạy cảm; hãy xem trước khi chia sẻ.

## Cài đặt mặc định

| Tên | Mặc định |
| --- | --- |
| olp.layout.auto | true |
| olp.duration | 180 phút |
| olp.cpp.compiler / olp.cpp.flags | g++ / -std=c++20 -O2 -Wall |
| olp.c.compiler / olp.c.flags | gcc / -std=c17 -O2 -Wall |
| olp.python.command | python |
| olp.run.timeoutMs | 5000 |
| olp.submit.checkSamples | true |
| olp.timer.warnings | [60,30,10,5] |
| olp.idleSeconds | 90 |
| olp.export.auto | true |
| olp.language | ask; quick mặc định C++ và nhớ |

Cần compiler/interpreter trên máy; thiếu công cụ sẽ báo cách đặt đường dẫn. Java cần javac/java trong PATH. Cache biên dịch không theo dõi header cục bộ: xóa `.stamp` tương ứng khi sửa header. Đồng hồ vẫn theo hạn chót khi đóng VS Code; cảnh báo 60/30/10/5 phút và đổi màu 10/5 phút cuối. Bản PDF renderer hiện phụ thuộc Windows x64. Khi Windows từ chối taskkill /T, dùng kill tiến trình con trực tiếp; không đảm bảo dọn được tiến trình cháu trong môi trường bị hạn chế.
