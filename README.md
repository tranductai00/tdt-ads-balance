# T Balance v6.1.3 — Vercel + PostgreSQL/Neon + Meta Billing API (không Firebase)

Phiên bản này giữ nguyên luồng nghiệp vụ của T Balance v5.8.6/v6.0, đồng thời bổ sung **Meta Billing API tự động** và phần cài đặt API trực tiếp trên giao diện web. Hạ tầng vẫn hoàn toàn không dùng Firebase:

- **Vercel**: web + Express API + webhook + cron endpoint.
- **PostgreSQL/Neon**: dữ liệu cloud, thiết bị, Outlook, AdsCheck/Meta, trạng thái thông báo.
- **Web Push VAPID**: thông báo trình duyệt thay Firebase Cloud Messaging.
- **Microsoft Graph**: Outlook OAuth, webhook và quét dự phòng.
- **Meta Billing API trực tiếp**: web lưu Meta Access Token đã mã hóa ở server, backend tự đọc billing activities và tự ghi nhận/tự trừ bill đủ điều kiện.
- **Chrome Extension v6.0**: AdsCheck V6 và Meta Billing cũ vẫn được giữ như nguồn bổ sung/dự phòng.

Không có `firebase`, `firebase-admin`, Firestore SDK, Cloud Functions SDK, FCM hay `cloudfunctions.net` trong runtime.

## Chức năng được giữ lại

- Quản lý ngân hàng, số dư, tài khoản quảng cáo và giao dịch.
- Tự đồng bộ cloud nhiều thiết bị, khóa thiết bị, ghép thiết bị, thu hồi thiết bị.
- AdsCheck V6 realtime/auto-sync, chọn tài khoản, tự ghép tài khoản, xóa tài khoản đã mất.
- Meta Marketing API / Billing data và cảnh báo thiếu tiền.
- **Meta Billing API v6.1:** nhập Access Token/Graph version ngay trên web; kiểm tra kết nối; lấy bill ngay; tự quét; chống trùng; tự khớp TKQC; chỉ tự trừ khi amount đủ tin cậy; bill lỗi/refund chỉ ghi nhận.
- Outlook OAuth, nhận email Meta, webhook, tự khấu trừ, quét thủ công và quét dự phòng.
- Web Push thông báo biến động số dư và cảnh báo AdsCheck.
- Dashboard, UI/UX và các route cũ `/`, `/adscheck`, `/sodu`.
- Các API bridge cũ được giữ tên để extension/frontend không phải đổi luồng: `/outlookBridge`, `/outlookOAuthCallback`, `/outlookWebhook`.
- Các job: `/cron/balance`, `/cron/meta`, `/cron/meta-billing`, `/cron/outlook-scan`, `/cron/outlook-renew`.

## Cấu trúc chính

```text
server.js                       # Express app / Vercel entry + API + cron routes
server/store.js                 # PostgreSQL adapter tương thích logic Firestore cũ
server/outlook-runtime.js       # Outlook / AdsCheck / Meta / Meta Billing API / Web Push
public/index.html               # web app
public/adscheck/index.html      # route tương thích
public/sodu/index.html          # route tương thích
public/push-sw.js               # Web Push service worker
extension_adscheck_sync/        # extension AdsCheck v6.0
extension_meta_billing/         # extension Meta Billing v6.0
vercel.json                     # Vercel config
.env.example                    # biến môi trường mẫu
```

## Deploy nhanh

Xem **DEPLOY_VERCEL.md** và **README_V6.1_META_BILLING_API.md**. Không cần tạo bảng SQL thủ công: `server/store.js` tự tạo bảng `tb_documents` và index ở lần chạy đầu.

## Dữ liệu từ bản cũ

Database PostgreSQL mới bắt đầu trống. Tuy nhiên nếu trình duyệt đang giữ dữ liệu T Balance trong localStorage, lần kết nối đầu tiên tới cloud mới sẽ tự đẩy snapshot local lên PostgreSQL khi cloud chưa có dữ liệu.

Các secret/token chỉ từng nằm phía server (ví dụ refresh token Outlook, Meta API token, subscription server-side) không tự chuyển từ Firebase sang PostgreSQL. Hãy kết nối lại Outlook và nhập lại Meta Access Token trên giao diện web sau khi deploy nếu cần.

## Kiểm tra sau deploy

Mở:

```text
https://TEN-DU-AN.vercel.app/healthz
```

Kết quả đúng phải có `ok: true`, `storage: "postgresql"` và `database.ok: true`.
