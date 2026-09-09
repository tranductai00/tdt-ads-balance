# v6.1.9 - Fix sửa tài khoản quảng cáo

- Fix nút **Sửa**/Lưu tài khoản quảng cáo hoạt động ổn định với tài khoản chưa gắn ngân hàng.
- Ngân hàng liên kết trong modal Sửa không còn bắt buộc.
- Thêm manual override cho tên, ngân hàng và ngưỡng để AdsCheck/Billing sync không ghi đè giá trị người dùng vừa sửa.
- Để trống/0 ngưỡng sẽ bỏ manual threshold override và cho phép đồng bộ tự động cập nhật lại ngưỡng.
- Khi đổi Account ID, ID cũ được thêm vào danh sách bỏ qua để auto-import không tạo lại tài khoản cũ.
- Lưu sửa dùng workspaceSet ngay lập tức và xử lý conflict merge trước khi đóng modal.

# v6.1.8 — Facebook Billing Tool-compatible amount fix

- Map chính xác `ad_account_billing_charge + type=payment_amount + action=67 + new_value` thành số tiền bill.
- `transaction_id` được dùng làm ID giao dịch; tạo link PDF bill tương thích Billing Summary.
- Manual sync backfill toàn bộ `lookbackDays`, không còn bị cursor 20 phút chặn các event parse_error cũ.
- One-time parser revision backfill sau deploy để tự sửa lịch sử gần đây.
- UI hiển thị nguồn `FB Billing Tool · payment_amount/action 67/new_value` và nút mở PDF bill.

# v6.1.6 — Meta Billing Amount Recovery Engine

- Fix các `ad_account_billing_charge` Meta chỉ trả “Đã lập hóa đơn cho tài khoản” nhưng không có amount rõ ràng.
- Deep parser cho `new_value/current_value/event_value`, HTML entity, URL-encoded JSON, single-quote object và chuỗi key:value/key=value.
- Đối chiếu amount từ giao dịch/biên lai Outlook theo TKQC + transaction/reference + thời gian; giao dịch Outlook đã trừ sẽ không bị trừ lần hai.
- Lưu snapshot balance + amount_spent và suy luận payment delta cho VND/zero-decimal currency khi chỉ có một charge mới.
- Fallback payment threshold để hiển thị amount ước tính khi Meta không trả amount; estimate không được auto-deduct.
- Event `parse_error/estimated/recovered` tiếp tục được retry để tự nâng lên nguồn amount chính xác hơn khi dữ liệu mới xuất hiện.
- UI thêm trạng thái `Đã đối chiếu Outlook`, `Đã phục hồi amount`, `Amount ước tính`, dấu `≈` và nút xem raw `extra_data`.

# v6.1.3 — Meta Billing Amount + Selected Accounts Fix

- Fix parser: `extra_data.amount`/`payment_amount`/`charge_amount` dạng số hoặc chuỗi được nâng độ tin cậy đúng mức.
- Decode JSON lồng/URL-encoded trong `extra_data`; đọc thêm amount có dấu tiền tệ từ `translated_event_type`.
- Billing event cũ có `status=parse_error` được tự retry ở lần quét mới thay vì bị bỏ qua vì `processed=true`.
- Thêm phạm vi Meta Billing riêng: `Quét tất cả TKQC` hoặc `Chỉ quét TKQC được chọn`.
- Danh sách TKQC tải trực tiếp từ `/me/adaccounts`, có tìm kiếm, chọn tất cả/bỏ chọn và lưu lựa chọn server-side.
- Khi chế độ `selected` không có tài khoản được chọn, hệ thống dừng với lỗi rõ ràng, tuyệt đối không fallback sang quét tất cả.
- Chỉ gọi `/activities` cho các TKQC đã chọn; vẫn giữ toàn bộ AdsCheck/Outlook/Meta API/multi-device hiện có.

# v6.1.2 — Auto Device Authorization Fix

- Fix `DEVICE_NOT_AUTHORIZED` sau redeploy/đổi domain.
- Web cùng-origin tự khôi phục/cấp quyền syncKey vào workspace.
- Pairing code vẫn giữ cho Extension.
- Thêm `DEVICE_PAIRING_REQUIRED=true` nếu muốn bật lại chế độ ghép bắt buộc cho web.
- Đồng bộ cùng UI cho `/`, `/adscheck`, `/sodu`.

# v6.1.1 — Vercel root route fix

- Fix triệt để `Cannot GET /` trên Vercel.
- Thêm rewrite `/ -> /index.html` để Vercel CDN phục vụ `public/index.html`.
- Thêm route Express dự phòng cho `/`, `/adscheck`, `/sodu` và static assets khi chạy Node/local.
- Giữ nguyên toàn bộ API, Outlook webhook, Meta Billing API, AdsCheck, PostgreSQL/Neon và cron.

# Changelog

## v6.1.0 — Meta Billing API trực tiếp trên web

- Thêm module **Meta Billing API** trong giao diện `Meta API / Ads`; nhập/lưu/xóa Access Token, Graph version, chu kỳ quét và lookback ngay trên web.
- Meta Access Token được mã hóa server-side bằng `APP_ENCRYPTION_KEY`; không lưu token plaintext trong localStorage và không trả token đầy đủ về frontend.
- Backend tự gọi `/{ad-account-id}/activities`, lọc billing event và phân tích `extra_data` để lấy amount/currency/transaction/reference/card last4 khi Meta cung cấp.
- Tự lấy bill theo tất cả TKQC hoặc danh sách tài khoản đã chọn; scan theo batch/cursor để hạn chế rate limit.
- Chống trùng bill bằng fingerprint/event id và dedupe transaction theo `sourceEventId`.
- Bill charge thành công có amount đủ tin cậy có thể tự ghi giao dịch `ad_payment`; mặc định chỉ tự trừ VND.
- Chỉ `ad_account_billing_charge` được phép đi vào luồng tự trừ. Bill failed/decline/refund/chargeback/funding hoặc event thiếu amount chỉ được ghi nhận, không tự trừ sai.
- Thêm `metaBillingStatus`, `metaBillingConfigure`, `metaBillingTest`, `metaBillingSync` vào API bridge.
- Thêm `/cron/meta-billing` và scheduler nội bộ; kèm GitHub Actions workflow mẫu chạy mỗi 5 phút cho Vercel Hobby.
- Giữ nguyên Outlook, AdsCheck V6, Meta balance sync, multi-device, Web Push, transaction và toàn bộ chức năng v6.0.
- Thêm test parser Meta Billing VND/USD và trạng thái payment failure.

## v6.0.0 — Vercel No-Firebase

- Thay Firestore bằng PostgreSQL/Neon document adapter.
- Bỏ `firebase-admin`, Firebase Functions SDK, Firebase client SDK và FCM.
- Thay push notification bằng Web Push VAPID.
- Chuyển frontend/API sang same-origin Vercel.
- Giữ Outlook OAuth/webhook, Meta API, AdsCheck V6, multi-device, pairing, cloud sync và dashboard.
- Extension AdsCheck V6 và Meta Billing lên v6.0, nhập được URL Vercel.
- Thêm `healthz`, distributed cron lock, Vercel Fluid Compute config.
- Sửa timestamp Firestore legacy (`toMillis`) sang timestamp độc lập backend.
- Sửa semantics xóa document để không xóa nhầm subcollection.
- Kiểm tra thông báo số dư ngay sau cloud write và Outlook auto-deduct; cron balance chỉ còn là fallback.

## v6.1.4 — Outlook Bridge 404 Fix
- Added explicit Vercel Functions for Outlook Bridge, OAuth callback and webhook.
- Frontend now calls `/api/outlookBridge` directly.
- Added legacy route rewrites so existing Microsoft redirect/webhook URLs keep working.
- Added Express aliases for both legacy and `/api/...` paths.
- Added `/api/healthz` route for platform routing diagnostics.

## v6.1.5 — Outlook Bridge HTTP 500 Fix
- Fix `res.set()` Express-only trong explicit Vercel Functions.
- Dùng `setHeader/statusCode/end` tương thích Express + VercelResponse.
- Fix cùng lỗi ở Microsoft webhook validation.
- Lazy-load Outlook runtime trong `/api/outlookBridge`, `/api/outlookWebhook`, `/api/outlookOAuthCallback`.
- Runtime/dependency init error giờ trả JSON có `code` + diagnostic thay vì HTTP 500 trống.
- `/api/healthz` bổ sung kiểm tra dependency `pg`, `web-push` và trạng thái biến môi trường (chỉ boolean, không lộ secret).
