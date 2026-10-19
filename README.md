# Inklingo

*Ink* (mực vẽ) + *lingo* (ngôn ngữ) – vẽ, đoán và nhớ từ vựng TOEIC. Trước đây dự án có tên tạm “Scribble Words”.

Game web vẽ & đoán từ kết hợp lộ trình học **5 từ vựng TOEIC mỗi ngày theo chủ đề công sở** (trình độ B1–B2,
dành cho người chơi đã đạt TOEIC 450+).
Phát triển tiếp từ bản demo `scribble_words_v2.html` (bản gốc giữ tại `docs/scribble_words_v2_original.html`).

## Chạy game

Yêu cầu: Node.js ≥ 20, nên dùng 22 (không cần cài thêm thư viện nào; test WebSocket cần Node 22, bản cũ hơn sẽ bỏ qua các test đó).

```bash
npm start
```

Mở http://localhost:8787. Bạn bè trong cùng mạng LAN mở `http://<IP-máy-bạn>:8787` rồi nhập mã phòng
(hoặc mở link mời `…/#/join/MÃPHÒNG`). Đổi cổng: `PORT=9000 npm start`.

Kiểm thử tự động (luật chơi + server WebSocket thật):

```bash
npm test
```

Kiểm thử engine vẽ trong trình duyệt: mở `http://localhost:8787/dev/draw-test.html`, chạy trong console
`(await import('/dev/engine-tests.js')).run(T)`.

## Deploy (Render)

`render.yaml` mô tả dịch vụ: Node 22 (test tích hợp dùng `WebSocket` có sẵn từ Node 22), gói Starter (chạy liên tục), vùng Singapore, ổ đĩa 1 GB gắn tại `/var/data`
cho file nhóm học (`GROUPS_FILE=/var/data/groups.json`), kiểm tra sức khỏe `/api/health`, build bằng `npm test` (deploy
dừng nếu test lỗi), tự deploy khi push lên `main`, tên miền `inklingo.io.vn` và `www.inklingo.io.vn`.
Bản đang chạy: `GET /api/health` trả `version` (7 ký tự đầu của commit, từ biến `RENDER_GIT_COMMIT`) và `startedAt`.
Server chỉ chạy **1 instance** (phòng chơi realtime nằm trong bộ nhớ). DNS ở Tenten: bản ghi A cho `@` trỏ về IP Render
cung cấp và CNAME `www` trỏ về `<dịch vụ>.onrender.com`.

## Giao diện

- Phong cách “giấy & mực” (lấy cảm hứng từ doodlingam.com, không dùng lại logo, hình hay nội dung của họ): nền giấy kem
  `#f4eddc`, thẻ `#fbf7ec`, chữ nâu mực `#3b2a1e`, một màu nhấn đỏ đất `#bc4b24` và xanh rêu `#1c3a28`; tiêu đề font
  Fraunces (chữ nghiêng làm điểm nhấn), nội dung Source Sans 3 (Google Fonts); viền mảnh, bóng mềm, nút bo tròn.
  Toàn bộ màu nằm trong biến CSS ở đầu `public/css/app.css`.
- Không dùng emoji trong giao diện: mọi biểu tượng là icon SVG dạng nét tự vẽ (`public/js/ui/icons.js`), hiển thị giống
  nhau trên mọi hệ điều hành. Ảnh đại diện là vòng tròn màu với chữ cái đầu của tên (hồ sơ cũ dùng emoji được tự chuyển
  sang màu).
- Bố cục dashboard: **thanh bên** (Trang chủ · Học hôm nay · Chủ đề · Ôn tập · Nhóm · Thống kê | Cài đặt · Trợ giúp)
  và **thanh trên** (tìm kiếm ⌘K/Ctrl K theo từ tiếng Anh, nghĩa tiếng Việt không dấu hoặc chủ đề – từ chưa học bị khóa;
  số ngày học liên tiếp; menu hồ sơ để đổi hồ sơ). Tablet: thanh bên chỉ còn icon; điện thoại: thanh tab ở đáy.
  Trong phòng chơi thanh bên ẩn để bảng vẽ rộng hơn.
- Trang chủ: khối chào với 3 thẻ ảnh thật của từ hôm nay, nút “Bắt đầu học hôm nay” và “Chơi nhanh”; hàng chủ đề cuộn
  ngang; “Học nhanh” (Tạo phòng, Vào phòng, Học từ mới, Ôn tập); cột phải: tiến độ (vòng % chủ đề, số chủ đề, từ đã học,
  đang ôn, ngày liên tiếp) và danh sách 5 từ hôm nay có nút nghe và ô đánh dấu đã học.
- Trang **Thống kê** (tiến độ từng chủ đề, điểm kiểm tra, từ hay quên) và **Trợ giúp** (luật chơi ngắn + phím tắt).
- Không làm các phần của bản thiết kế chưa có cơ chế thật: cấp/XP, chuông thông báo, “Gợi ý chủ đề” (thay bằng “Chơi
  nhanh”); hình minh họa vẽ tay được thay bằng ảnh chụp thật của từ (GDD §12).
- Flashcard: chuyển từ bằng phím ← →; kết quả đúng/sai trong bài kiểm tra và ôn tập có màu và icon rõ ràng.

## Tài khoản & Cài đặt

- **Tài khoản** (`#/account`, của hồ sơ đang dùng): tên hiển thị; ảnh đại diện là **màu + chữ cái đầu** hoặc **tự vẽ**
  (khung vẽ tròn: bút, tẩy, đổ nền, hoàn tác; lưu PNG 128 px); các hồ sơ trên máy (đổi, tạo, xóa); nhóm học (mở trang nhóm,
  mã khôi phục, rời nhóm); xóa tiến độ.
  Ảnh tự vẽ có mã `p` + 16 hex (SHA-256 của PNG) và đi qua phòng chơi/nhóm như mã màu `c0…c11`; server lưu ảnh ở
  `POST /api/avatar` → `GET /api/avatar/<mã>` (thư mục `AVATAR_DIR`, mặc định cạnh `GROUPS_FILE`, tối đa 24 KB/ảnh, chỉ PNG,
  30 lần/giờ/IP). Khi offline ảnh vẫn hiện trên máy mình và được tải lên lại khi mở app có mạng.
- **Cài đặt** (`#/settings`, của thiết bị, lưu ở `localStorage` `sw:prefs`): giao diện **Sáng / Tối / Theo hệ thống**, cỡ chữ
  Nhỏ/Vừa/Lớn (không đổi kích thước phòng vẽ), giảm hiệu ứng chuyển động; **ngôn ngữ giao diện Tiếng Việt / English**;
  giọng đọc (chọn giọng tiếng Anh của trình duyệt, tốc độ, tự đọc từ khi hiện đáp án); nguồn ảnh; ngày giả lập (kiểm thử).
- **Ngôn ngữ:** chữ giao diện viết bằng tiếng Việt trong `tr('…')` (`public/js/i18n.js`), bản tiếng Anh ở
  `public/js/i18n/en.js` (giá trị có thể là `[số ít, số nhiều]`); câu server gửi về được dịch bằng `tServer()`. Đổi ngôn ngữ
  tải lại trang (giữ nguyên tiến độ và trang đang mở). Nghĩa/giải thích từ vựng vẫn bằng tiếng Việt. Kiểm tra thiếu bản dịch:
  `python3 tools/i18n_keys.py` (test `tests/i18n.test.js` cũng kiểm tra).

## Vẽ & đoán: chọn từ, Từ thông dụng

- **Chọn 1 trong 3 thẻ:** đầu mỗi lượt người vẽ thấy 3 thẻ từ: 2 từ của phòng + 1 **từ dễ** (phòng "Từ thông dụng": cả 3
  là từ dễ). Online có 10 s (`CHOOSE_MS`), hết giờ tự lấy thẻ đầu (từ của phòng). Thẻ chỉ gửi cho người vẽ; người khác thấy
  "… đang chọn từ". Từ của phòng không được chọn quay lại hàng chờ. Người vẽ rời phòng trước khi chọn thì sang lượt mới, không
  có màn đáp án. Cùng một thiết bị: chọn thẻ sau khi bấm "xem từ", không giới hạn giờ.
- **Từ thông dụng:** 1000 từ dễ vẽ được, ai cũng biết (động vật, đồ ăn, nhà cửa…), nguồn `tools/easy_words/*.txt`
  (`en | vi | ipa | pos`, `## nhóm`), danh sách duyệt ở `docs/easy-words.md`. `build_vocab.mjs` ghi vào `vocab.json` ở khóa
  `easy` (id `e-…`, không trùng từ TOEIC), **không** nằm trong `topics`: không ảnh, không mẫu nét, không trợ lý vẽ, không bài
  học/kiểm tra/Word Recall và không ghi tiến độ. Luôn mở: thẻ đầu trang Chủ đề → "Chơi vẽ" (`#/play/easy`), hoặc chọn "Từ thông
  dụng" khi tạo phòng (online gửi `{ type: 'create', easy: true }`).

## Vẽ & đoán: gợi ý

- **Gợi ý chữ cái cho người đoán:** khi chưa ai đoán đúng ở 50 %, 70 % và 85 % thời gian vẽ, server mở thêm 1 chữ cái của từ
  (ô chữ hiện đúng chữ ở đúng vị trí, chat báo "Gợi ý: hiện thêm 1 chữ cái"). Tối đa 1/3 số chữ cái, từ ≤ 3 chữ cái không có
  gợi ý, và không bao giờ mở hết từ. Có người đoán đúng rồi thì dừng gợi ý.
- **Ghost Sketch (trợ lý vẽ cấp 5):** mặc định là **hình mẫu nét** vẽ tay riêng cho từng từ (nét viền sạch, ít chi tiết), hiện
  mờ dưới canvas chỉ người vẽ thấy. Vẫn chọn được "Đường viền từ ảnh thật" (lọc cạnh từ ảnh) hoặc bố cục người que.
  486/486 từ có mẫu nét: nguồn ở `tools/ghost_src/<chủ đề>.txt` (`=== <id>` + thân SVG 1600×1000), build bằng
  `python3 tools/ghosts.py build` ra `public/data/ghosts/<id>.svg`; `python3 tools/ghosts.py sheet <chủ đề>` dựng bảng duyệt,
  `missing` liệt kê từ thiếu mẫu. Mẫu do Inklingo tự vẽ bằng mã, không dùng AI hay tài sản của trò chơi khác.

## Ôn tập: Word Recall

Ôn bằng cách **tự nhớ lại và gõ từ** (không trắc nghiệm), mỗi phiên tối đa 10 từ, 2–4 phút.

- **3 thử thách luân phiên** cho mỗi từ: *Nghe và viết* (chỉ có âm thanh + số chữ cái) · *Nhớ nghĩa* (nghĩa và giải thích
  tiếng Việt → gõ từ) · *Điền vào câu* (câu ví dụ có chỗ trống, gõ đúng dạng từ trong câu; từ không có câu phù hợp chỉ dùng 2
  dạng đầu).
- **Ôn giãn cách:** từ học hôm nay được kiểm tra lần đầu vào **ngày hôm sau** (không chấm khi vừa nhìn thấy từ). Đúng → lịch
  ngày 2 → 4 → 8 → 15 → 30 (sau đó 60 ngày/lần); sai → ôn lại ngày mai và lùi 2 bậc, đồng thời được hỏi lại một lần cuối phiên
  (lần hỏi lại không tính). Từ sai trong bài kiểm tra chủ đề luôn đến hạn; nhớ đúng là gỡ khỏi danh sách cần ôn.
- **Không lộ đáp án trước khi trả lời:** không có ảnh hay chữ tiếng Anh trên màn câu hỏi; ô trả lời chặn dán/kéo thả, tắt tự
  sửa chính tả. Ảnh thật, IPA và câu ví dụ chỉ hiện sau khi trả lời.
- **Nói đáp án** (dạng *Nhớ nghĩa* và *Điền vào câu*; *Nghe và viết* chỉ gõ vì kiểm tra chính tả): nút **Nói** dùng bộ nhận
  dạng giọng nói có sẵn của trình duyệt (Web Speech API – Chrome, Edge, Safari; Firefox không có nên nút bị ẩn; Chrome gửi
  âm thanh lên dịch vụ nhận dạng của Google). Đúng nếu 1 trong 3 phương án máy nghe được là đáp án; được nói 2 lần, lần 1 sai
  chỉ báo "máy nghe thành …" (chưa lộ đáp án). Kết quả: **% phát âm** = độ giống từng chữ cái giữa câu máy nghe và đáp án ×
  độ tin cậy của máy (Safari không báo độ tin cậy), kèm **ô từng chữ**: xanh = đúng, đỏ = sai (ghi chữ máy nghe thành) hoặc
  thiếu, và số chữ thừa. Đây là so khớp chữ cái, không phải chấm từng âm như ELSA. Sau khi trả lời có nút **Luyện phát âm**
  (không tính điểm). Logic chấm: `public/js/shared/speech-match.js` (có unit test).
- Không có từ đến hạn → **Luyện thêm** (từ yếu nhất), không tính điểm và không đổi lịch.
- Màn chính: số từ đến hạn, **Lịch nhớ** (số từ ở mỗi bậc), **Tỷ lệ nhớ** theo từng dạng và sau ≥ 7 ngày, **Tuần này**
  (trong nhóm: xếp hạng số từ nhớ đúng trong tuần). Tranh vẽ đã lưu chuyển sang trang Thống kê.

## Nhóm học

Một nhóm (tối đa 12 người) học chung lộ trình chủ đề, có bảng xếp hạng và mini-game cuối chủ đề.

- **Tạo / vào nhóm:** tab **Nhóm** → đặt tên nhóm, hoặc nhập mã 6 ký tự / mở link `#/group/join/MÃ`. Không cần tài
  khoản: mỗi hồ sơ giữ một mã bí mật trên máy (server chỉ lưu bản băm). **Mã khôi phục** dùng để tiếp tục trên máy khác.
  Trưởng nhóm mời được người khác ra; trưởng nhóm rời thì người vào sớm nhất thay.
- **Cùng nhịp:** server phát cho cả nhóm cùng 5 từ mỗi ngày (Thứ Hai–Thứ Sáu, theo múi giờ của người tạo nhóm);
  cuối tuần ôn tập. Hồ sơ trong nhóm dùng lịch này cho mọi màn hình (Học hôm nay, Ôn tập, từ trong phòng vẽ).
- **Bảng xếp hạng (Tuần này / Tổng):** học đủ 5 từ trong ngày +10 (+2 mỗi ngày liên tiếp, tối đa +10); Word Recall nhớ đúng +1/từ
  (chỉ từ đến hạn, tối đa 20/ngày; luyện thêm không tính); ván vẽ mở từ trang nhóm: điểm ván ÷ 10 (tối đa 30/ngày); mini-game: điểm × 0,15 (tối đa 300).
  Kèm tỷ lệ nhớ bài và nhãn "Cần ôn". Màn Word Recall có thêm xếp hạng tuần theo số từ nhớ đúng.
- **Mini-game “Đấu trường chủ đề”** (mở khi đã phát hết từ của chủ đề, mở trong 48 giờ, mỗi người chơi 1 lần, cùng
  bộ câu hỏi): 4 vòng phủ toàn bộ từ của chủ đề – Nhìn ảnh (chọn từ), Nghe & gõ, Điền câu (kiểu TOEIC Part 5), Nghĩa →
  gõ từ. Đúng +50, nhanh thêm tối đa +50. Chơi **cùng nhau** (phòng chờ, từ 2 người, chung đồng hồ, thấy ai đã trả lời)
  hoặc **một mình** bất cứ lúc nào trong 48 giờ; đồng hồ không dừng khi thoát ra, tải lại trang thì chơi tiếp.
- **Kết thúc:** khi mọi người đã chơi hoặc hết 48 giờ → bảng kết quả, “Từ cả nhóm hay quên”, cả nhóm sang chủ đề mới.
  Ai dưới 80 % (hoặc vắng) có nhãn “Cần ôn” và phải ôn bù các từ sai (Ôn tập → các từ chưa nhớ).
- **Chống gian lận:** server giữ đáp án, tính giờ và chấm điểm; câu hỏi không chứa đáp án, ảnh câu hỏi phát qua
  `/api/qimg/…` để giấu tên tệp. Giới hạn: vòng Nghe phải gửi chữ (đã làm rối) để trình duyệt đọc, người cố ý mở công cụ
  dev vẫn có thể giải mã; điểm học/ôn hằng ngày do máy người chơi báo về (có giới hạn mỗi ngày).
- Dữ liệu nhóm: `server/data/groups.json` (đổi bằng biến `GROUPS_FILE`). Kiểm thử lịch học: chạy với `SW_DEV=1` để
  server nhận “ngày giả lập” từ Cài đặt (cấu hình `scribble-words-dev` trong `.claude/launch.json`, cổng 8788).

## Cấu trúc

```
server/server.js         HTTP tĩnh + phòng chơi realtime (WebSocket /ws), server quyết định lượt, giờ, đáp án, điểm
server/ws.js             WebSocket RFC 6455 tự viết (không phụ thuộc thư viện)
server/groups.js         nhóm học: lịch chung, điểm, mini-game (lưu file JSON)
public/js/shared/        game-core.js – luật chơi dùng chung cho server và chế độ cùng thiết bị; quiz-core.js – câu hỏi & lượt chơi mini-game
public/js/drawing/       engine.js (bản vẽ vector + raster), flood.js, toolbar.js, colorpicker.js
public/js/game/          room-view.js (sảnh, gameplay, kết quả), assistant.js, ghost.js, quiz-view.js (mini-game nhóm)
public/js/vocab/         data.js (từ vựng, ảnh + ghi công + ảnh dự phòng), progress.js (lộ trình theo hồ sơ)
public/js/screens/       Home, Daily, Topics/Quiz, Review, Play, Group, Settings/Credits
public/js/net/           online.js (WebSocket), sessions.js, groups.js (API nhóm, đồng bộ lịch, báo điểm)
public/js/ui/            dom.js (helper DOM, hộp thoại), icons.js (bộ icon SVG tự vẽ + avatar màu/chữ cái đầu)
public/js/ui/speech.js   nhận dạng giọng nói của trình duyệt (Word Recall)
public/data/ghosts/      hình mẫu nét Ghost Sketch (build từ tools/ghost_src/)
public/js/store/         drawings.js – lưu tranh mỗi lượt (IndexedDB), xem ở trang Thống kê
public/data/vocab.json   dữ liệu từ vựng đã build (chỉ gồm từ có ảnh thật đã xác minh)
public/img/w/            ảnh minh họa đã tải về (cache cục bộ) – nguồn Wikimedia Commons
content/*.json           nội dung 12 chủ đề (nghĩa, IPA, ví dụ, ý tưởng vẽ, các bước, mẫu ghost)
tools/                   pipeline tuyển chọn ảnh thật + build dữ liệu
tests/                   test Node (node:test)
docs/COMPARISON.md       bảng đối chiếu Scribble It! ↔ Inklingo
```

## Quy trình ảnh minh họa (GDD §12)

1. `python3 tools/curate_images.py candidates` – lấy ứng viên từ ảnh đầu bài Wikipedia và tìm kiếm Wikimedia Commons;
   tự động loại: không phải JPEG ảnh chụp, < 600 px, giấy phép ngoài CC0/PD/CC BY/CC BY-SA, danh mục AI-generated /
   tranh vẽ / minh họa / hoạt hình, mô tả có nhắc tới AI.
2. `python3 tools/sheet_rows.py <topic>` / `tools/sheet_words.py` – tạo contact sheet để **duyệt bằng mắt**. Toàn bộ
   504 từ TOEIC đã được duyệt; bộ lọc tự động bỏ sót khá nhiều tranh sơn dầu, tranh khắc, tượng, poster, ảnh Muybridge…
   (API chỉ trả một phần danh mục khi tìm theo lô) nên bước duyệt thủ công là bắt buộc.
   Từ khó tìm ảnh: `python3 tools/curate_images.py more <từ> "truy vấn" "Category:…"`. Với từ mà chính chủ đề bị bộ lọc
   chặn (vd. **poster**), `WORD_ALLOW` trong `curate_images.py` nới đúng từ khóa đó cho riêng từ ấy.
3. Ghi lựa chọn vào `tools/image_choices.json` (ảnh chính + ảnh dự phòng).
4. `python3 tools/curate_images.py finalize` – tải ảnh 640 px về `public/img/w/` dạng **WebP** (q78, nhẹ hơn JPEG ~30 %;
   ảnh cũ chuyển bằng `python3 tools/to_webp.py`), ghi `public/data/images.json`
   (URL nguồn, tác giả, giấy phép, link giấy phép).
5. `node tools/build_vocab.mjs` – build `vocab.json`; **từ nào chưa có ảnh thật đã xác minh sẽ không được đưa vào game**.

Ảnh lỗi → thử bản gốc trên Wikimedia → ảnh dự phòng đã xác minh của cùng từ → ảnh bìa (ảnh thật) của chủ đề.
Service worker cache ảnh (cache-first) và **tải trước ảnh chính của cả chủ đề đang học** vài giây sau khi mở app (bỏ qua khi
bật tiết kiệm dữ liệu), nên học offline được cả những từ chưa mở. Danh sách tác giả/giấy phép: màn hình **Cài đặt → Nguồn ảnh & giấy phép**.

## Trạng thái dữ liệu

- 12 chủ đề TOEIC × 42 từ trong `content/` (B1–B2, ưu tiên đồ vật/cảnh vẽ được): Office & Workplace · Airport & Travel ·
  Hotels & Restaurants · Shopping & Delivery · Housing & Maintenance · Health & Medical · Professions ·
  Meetings & Presentations · Manufacturing & Logistics · Banking & Finance · Marketing & Media · Workplace Concepts.
  20 từ gốc + 22 từ thông dụng bổ sung mỗi chủ đề (soạn ở `tools/new_words/*.txt`, thêm bằng `python3 tools/add_words.py`).
- 496/504 từ có ảnh chụp thật đã duyệt bằng mắt (ảnh chính + ảnh dự phòng cho nhiều từ); mỗi chủ đề 39–42 từ trong game.
- Bị loại theo §12.6 vì chưa tìm được ảnh chụp thật đúng nghĩa, rõ nguồn và giấy phép trên Wikimedia Commons sau 3 lượt tìm
  (kết quả chỉ có tranh vẽ, biểu đồ đồ họa, chân dung người thật/người nổi tiếng, ảnh sai nghĩa):
  Professions: **lawyer** · Meetings: **bar-chart**, **nameplate** · Finance: **salary**, **financial-advisor** ·
  Concepts: **mentor**, **leadership**, **internship**.
  Bổ sung bằng cách thêm ảnh vào `tools/image_choices.json` rồi chạy lại bước 4–5.
- Từ mới được nối vào cuối mỗi chủ đề: người đang học một chủ đề sẽ nhận tiếp các từ mới trước bài kiểm tra; chủ đề đã qua
  giữ nguyên trạng thái "đã qua" và không phát lại từ mới của nó.
- Bộ từ cơ bản cũ (12 chủ đề đời sống) lưu tại `docs/old-content/`. Tiến độ lưu dưới khóa mới `sw:v4`, nên tiến độ của bộ từ cũ
  không được chuyển sang.
