# Đối chiếu Scribble It! ↔ Inklingo

## 1. Phạm vi nghiên cứu và giới hạn nguồn

Trong môi trường phát triển, **store.steampowered.com, steamcommunity.com và api.steampowered.com bị chặn DNS**, nên không mở được trực tiếp trang Steam, ảnh chụp màn hình, video hay toàn văn patch notes. Thông tin dưới đây lấy từ **kết quả tìm kiếm công khai** (tiêu đề + trích đoạn các bài Steam News) và bài viết của bên thứ ba. Mọi điểm không xác minh được được đánh dấu rõ.

Nguồn đã dùng:
- Steam store page *Scribble It!* (app 1088150) – qua trích đoạn kết quả tìm kiếm.
- Steam News: Patch Notes 0.12 (Scribble Library, Scoring), 1.0.9 (Votekick), 1.1.2 (Color Picker Triangle), 1.2.0 (Invite Codes, New Color Palette, Opacity, Equilateral Shapes, Toolbar Overhaul, Vietnamese UI), 1.3.3, 1.3.4, 1.4.0.0, 1.5.2.0 – qua trích đoạn.
- player.one: “Scribble It!: Patch 1.5.2.0 Allows Players to Change In-Game UI Color”.
- Giant Bomb (trích đoạn): các chế độ Scribble It!/Guess It!/Rate It!, chủ phòng chọn số vòng khi tạo lobby.
- detach-entertainment.com (trang nhà phát triển).

Ký hiệu: ✅ đã xác minh từ nguồn công khai · ❔ không xác minh được (suy luận/thiết kế riêng) · 🆕 tính năng riêng của Inklingo theo GDD.

## 2. Hệ thống vẽ

| Chức năng | Scribble It! | Demo v2 (trước) | Inklingo (hiện tại) | Kiểm thử |
|---|---|---|---|---|
| Bút vẽ tự do | ✅ (brush) | Có, nét thẳng từng đoạn | Đường cong bậc 2 qua trung điểm, round cap/join, `getCoalescedEvents` | Tự động: nét liền khi chuột nhảy xa, round cap |
| Tẩy | ✅ | Tô màu trắng | **Xóa thật** (`destination-out`, alpha = 0) | Tự động: alpha = 0 sau khi tẩy |
| Đổ màu (Fill bucket) | ✅ (flood fill; patch sửa lỗi “fill cả canvas”) | Stack flood fill, có thể hở viền | Scanline flood fill, so màu premultiplied, vành 1px vẽ *phía sau* nét để không hở viền trắng | Tự động: vùng kín, không tràn, không hở viền, đổ toàn bảng 1600×1000 trung bình ~150 ms |
| Hút màu (Eyedropper) | ✅ (patch sửa trên Linux) | Có | Có, quay về công cụ trước sau khi hút | Tự động |
| Bánh xe màu | ✅ “Color Picker Triangle” | `<input type=color>` | Vòng Hue + tam giác S/V tự vẽ, ô HEX | Thủ công (chuột thật) |
| Bảng màu nhanh | ✅ (“New Color Palette” 1.2.0) | 16 màu | 24 màu (bảng tự thiết kế, không sao chép) | Thủ công |
| Opacity | ✅ (1.2.0) | Có, nhưng nét chồng bị đậm | Opacity cả nét (render lớp riêng rồi composite một lần) | Tự động: alpha ≈ 128 và không đậm khi chồng |
| Cỡ nét | ✅ (1.3.3: chọn cỡ cho từng công cụ) | Slider | Slider + 4 cỡ nhanh + cuộn chuột + `[` `]` | Tự động (cuộn chuột) |
| Đường thẳng / Chữ nhật / Elip | ✅ shapes | Có | Có, preview khi kéo | Tự động |
| Hình đều (Shift) | ✅ “Equilateral Shapes” (1.2.0) | Không | Shift: vuông/tròn, đường thẳng bắt góc 15° | Tự động |
| Hình tô kín | ❔ | 2 nút riêng | Nút bật/tắt “tô kín” (phím U) | Tự động |
| Giữ Ctrl để xoay hình | ❔ (không tìm thấy trong nguồn công khai) | Không | Giữ Ctrl khi kéo để xoay; Shift + Ctrl bắt góc 15° | Tự động |
| Hình không vẽ ra ngoài canvas | ✅ (1.3.3 sửa lỗi) | — | Mọi nét nằm trong tài liệu logic, cắt tự nhiên | — |
| Undo / Redo nhiều bước | ❔ (undo có trong thể loại) | 30 snapshot ảnh, lỗi khi clear | Log thao tác + checkpoint, áp dụng cho vẽ/tô/tẩy/xóa bảng (tối đa 400 thao tác) | Tự động: undo tẩy, undo fill, undo clear khớp từng byte |
| Xóa bảng | ❔ | `confirm()` chặn trình duyệt | Hộp xác nhận không chặn, có thể Undo | Tự động |
| Lưu tranh | ✅ (save hotkey, thư mục Drawings) | PNG | PNG (Ctrl+S) + tự lưu tranh mỗi lượt vào IndexedDB | Thủ công |
| Phím tắt | ✅ có hotkey (tùy chỉnh được) | B E F I L R O | B/P E F/G I L R O U `[` `]` Delete, Ctrl+Z/Y/Shift+Z/S – **mapping riêng** (không có nguồn về phím mặc định của Scribble It!) | Tự động |
| Chuột / cảm ứng / bút | ❔ | Pointer events cơ bản | Pointer events + pointer capture, ngón thứ hai hủy nét (tránh vẽ nhầm khi zoom) | Chuột thật; cảm ứng chưa thử trên thiết bị thật |
| Retina / HiDPI | — | Không | Backing store = CSS × devicePixelRatio, tài liệu 1600×1000 | Tự động |
| Resize không mất hình, không lệch tọa độ | — | Tọa độ đúng nhưng mờ | Tài liệu cố định, chỉ vẽ lại lớp hiển thị | Tự động |
| Đồng bộ realtime | ✅ (multiplayer) | Không có | Thao tác dạng vector + preview nét đang vẽ (40 ms), người vào giữa lượt nhận lại log | Tự động: canvas người đoán trùng từng pixel; test WebSocket |
| Hiển thị công cụ đang chọn | ❔ | Viền nút | Nút sáng + nhãn nổi góc canvas + con trỏ tròn đúng kích thước | Thủ công |

> Ghi chú kỹ thuật: Chrome có thể rasterize các path được gom nhóm khác với path vẽ đơn lẻ (lệch anti-alias vài pixel). Engine flush sau mỗi thao tác để bản vẽ của người vẽ, bản replay của người đoán và bản undo luôn **trùng khớp từng byte**.

## 3. Gameplay

| Chức năng | Scribble It! | Inklingo | Ghi chú |
|---|---|---|---|
| Một người vẽ, người khác đoán | ✅ | ✅ | Giữ nguyên luật cốt lõi |
| Chọn từ để vẽ | ✅ người vẽ chọn từ (1.5.2.0 hiện tên gói từ khi chọn) | Hệ thống giao từ theo lộ trình học | **Khác có chủ đích**: GDD §3.2 “Người vẽ nhận một từ bí mật”; ưu tiên 5 từ mới hôm nay |
| Số vòng do chủ phòng chọn | ✅ | ✅ 1–5 (online), 1–4 (cùng thiết bị) | |
| Thời gian vẽ | ❔ (một review nhắc 60 s) | 60/80/100/120 s (online), 60–180 s (cùng máy) | |
| Lobby tối đa 16 người | ✅ | 4/6/8/12 | Giới hạn thấp hơn để vừa bố cục |
| Mã mời / link mời | ✅ (1.2.0 Invite Codes, 1.3.4 Invite Button) | ✅ mã 5 ký tự + link `#/join/MÃ` | |
| Phòng công khai / chơi nhanh | ✅ (tìm lobby) | ✅ “Chơi nhanh” vào phòng công khai đang mở hoặc tạo mới | |
| Gợi ý chữ cái theo thời gian | ❔ | Không làm | Không có trong GDD |
| Điểm theo tốc độ đoán | ✅ có hệ thống điểm, giải thích điểm mỗi vòng (0.12), làm lại (1.4.0.0) | 40 + 160 × thời gian còn lại | Công thức riêng (không công bố công thức gốc) |
| Điểm người vẽ | ❔ | 50% điểm cơ bản của mỗi người đoán đúng × hệ số trợ lý | 🆕 GDD §3.3 |
| Combo | ❔ | +10 điểm/lần liên tiếp (tối đa +50) | 🆕 GDD §3.3 |
| Bảng xếp hạng cuối trận | ✅ | ✅ bục 1-2-3 + danh sách | |
| Vote kick / report | ✅ (1.0.9, 1.4.0.0) | Không làm | Không có trong GDD |
| Thư viện tranh / tranh được bình chọn | ✅ Scribble Library, best-rated popup (0.12) | Lưu tranh mỗi lượt, xem lại ở trang Thống kê | 🆕 GDD §8 |
| Chế độ Guess It! / Rate It! / đội | ✅ | Không làm | Ngoài phạm vi GDD |
| Đổi màu giao diện | ✅ (1.5.2.0) | Không làm | Ngoài phạm vi GDD |

## 4. Tính năng riêng của Inklingo (🆕 theo GDD)

- Lộ trình 12 chủ đề từ vựng TOEIC (B1–B2, chủ đề công sở), 5 từ/ngày (Thứ Hai–Thứ Sáu), cuối tuần ôn tập, kiểm tra cuối chủ đề ≥ 80% mới mở chủ đề sau.
- Flashcard: từ, nghĩa tiếng Việt, phiên âm IPA, phát âm (Web Speech API), ảnh chụp thật có ghi công, câu ví dụ, ý tưởng vẽ.
- Drawing Assistant 4 cấp + Idea Shuffle + Ghost Sketch (chỉ người vẽ thấy, lớp overlay riêng, không gửi đi, không lưu).
- Ôn tập Word Recall: tự gõ lại từ qua 3 thử thách (nghe và viết, nhớ nghĩa, điền vào câu), lịch ôn giãn cách ngày 2 → 4 → 8 → 15 → 30, thống kê tỷ lệ nhớ theo dạng và sau ≥ 7 ngày.
- Chế độ chuyền máy (giữ lại từ demo v2) chạy cùng luật với server.
- Nhóm học: lịch 5 từ/ngày chung cho cả nhóm, bảng xếp hạng tuần/tổng, mini-game cuối chủ đề không vẽ (4 vòng:
  ảnh, nghe, điền câu Part 5, nghĩa → từ), chơi cùng nhau hoặc một mình trong 48 giờ, ôn bù cho người dưới 80 %.
- Giao diện không dùng emoji: bộ icon SVG dạng nét tự vẽ, avatar là vòng tròn màu + chữ cái đầu; thanh điều hướng cố định
  (thanh tab ở đáy trên điện thoại).
- Phong cách “giấy & mực” riêng (nền kem, chữ nâu, nhấn đỏ đất, tiêu đề serif) – khác hẳn giao diện Scribble It!.
