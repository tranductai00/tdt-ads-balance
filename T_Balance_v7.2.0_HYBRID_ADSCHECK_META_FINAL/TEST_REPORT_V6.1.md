# TEST REPORT — T Balance v6.1 Meta Billing API

## Phạm vi

Kiểm tra bản Vercel + PostgreSQL/Neon không Firebase sau khi bổ sung Meta Billing API trực tiếp trên giao diện web.

## Kiểm tra đã chạy

- `node --check server.js`
- `node --check server/outlook-runtime.js`
- kiểm tra cú pháp JavaScript module nhúng trong `public/index.html`
- `npm run check`
- `NODE_ENV=test node tests/test_meta_billing_parser.js`
- `node tests/test_billing_parser_en.js`
- `node tests/test_billing_parser_vi.js`
- validate `package.json`, `vercel.json`, extension manifests và workflow YAML ở mức cấu trúc/tĩnh
- so sánh mirror `public/index.html` và `sodu.html`
- scan source runtime cho Firebase package/API URL cũ

## Meta Billing parser

PASS các tình huống chính:

- charge VND dạng `1.234.567 VND` → amount `1234567`
- transaction/reference/card last4 được trích xuất khi có trong `extra_data`
- USD dạng `$12.34` được đọc đúng giá trị thập phân
- failed billing event được nhận diện nhưng không tự trừ
- `funding_event_successful` được nhận diện nhưng **không** coi là bill charge để tự trừ
- cấu hình interval/lookback/max account được clamp về phạm vi an toàn
- **key rotation fallback:** token cũ mã hóa bằng `OUTLOOK_TOKEN_KEY` vẫn giải mã được sau khi thêm `APP_ENCRYPTION_KEY`; secret mới dùng khóa APP ưu tiên

## An toàn nghiệp vụ

- Chỉ billing event thuộc allow-list mới được xử lý.
- Successful charge mới có khả năng tạo giao dịch.
- Thiếu amount hoặc confidence thấp → không tự trừ.
- Currency ngoài VND mặc định → chỉ ghi nhận, không tự trừ.
- failed/decline/refund/chargeback → không tự trừ.
- fingerprint/event id + `sourceEventId` chống ghi trùng transaction.
- Meta token lưu mã hóa server-side; frontend chỉ nhận token hint.

## Tự động hóa

- Web đang mở: kiểm tra trạng thái định kỳ và tự gọi sync khi đến hạn.
- Server thường (không Vercel): scheduler nội bộ gọi Meta Billing mỗi 5 phút.
- Vercel: `/cron/meta-billing` có Bearer `CRON_SECRET` và distributed lock.
- Có `.github/workflows/meta-billing-cron.yml` để gọi endpoint mỗi 5 phút khi cần chạy 24/7 trên Vercel Hobby.

## Ghi chú giới hạn API

Meta billing activities có thể không trả amount/currency theo cùng cấu trúc trên mọi tài khoản. Bản v6.1 ưu tiên an toàn: event không đủ dữ liệu được lưu để kiểm tra nhưng không tự thay đổi số dư.
## v6.1.1 — Fix `Cannot GET /`

- PASS `node --check server.js`.
- PASS `npm run check`.
- PASS JSON parse `vercel.json`.
- Xác nhận có rewrite `/ -> /index.html`.
- Xác nhận Express có route dự phòng `/`, `/adscheck`, `/sodu`.
- Không thay đổi các route API/cron/webhook hiện có.

