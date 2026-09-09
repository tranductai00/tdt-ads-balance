# Deploy T Balance v6.1.3 lên Vercel — không Firebase + Meta Billing API

## 1. Tạo project Vercel

1. Đưa toàn bộ thư mục source này lên một Git repository hoặc dùng Vercel CLI.
2. Import project vào Vercel.
3. Để Vercel tự nhận diện **Express** từ `server.js`; không cần Build Command hay Output Directory.
4. Node.js: dùng Node 22.x hoặc mới hơn theo `package.json`.

`server.js` export Express app bằng CommonJS. `public/**` được Vercel phục vụ trực tiếp qua CDN; `vercel.json` chỉ giữ alias `/adscheck`, `/sodu`, Fluid Compute và cron renewal hằng ngày.

## 2. Tạo PostgreSQL/Neon miễn phí

Trong Vercel:

**Project → Storage / Marketplace → Neon → Create database**

Kết nối database vào project. Bảo đảm project có biến:

```text
DATABASE_URL=postgresql://...
```

Không cần chạy migration SQL bằng tay. Lần đầu `/healthz` được gọi, backend tự tạo:

```text
tb_documents
```

## 3. Environment Variables bắt buộc

Vào **Project → Settings → Environment Variables** và thêm:

```text
DATABASE_URL=<Neon pooled connection string>
APP_ENCRYPTION_KEY=<base64 32-byte key>
# OUTLOOK_TOKEN_KEY=<khóa cũ, chỉ cần nếu đang tương thích dữ liệu/token Outlook cũ>
VAPID_PUBLIC_KEY=<VAPID public key>
VAPID_PRIVATE_KEY=<VAPID private key>
VAPID_SUBJECT=mailto:your-email@example.com
CRON_SECRET=<chuỗi bí mật dài, tối thiểu 16 ký tự>
WEB_APP_BASE_URL=https://TEN-DU-AN.vercel.app
OUTLOOK_PUBLIC_BASE_URL=https://TEN-DU-AN.vercel.app
```

Nếu dùng Outlook:

```text
MS_CLIENT_ID=<Microsoft App Client ID>
MS_CLIENT_SECRET=<Microsoft App Client Secret>
MS_TENANT=common
```

### Tạo APP_ENCRYPTION_KEY

Sau `npm install`:

```bash
npm run token-key
```

Dán kết quả vào `APP_ENCRYPTION_KEY`. Khóa này dùng để mã hóa Meta Access Token/secret lưu trong PostgreSQL. Nếu đang nâng cấp từ bản cũ và cần giải mã token Outlook đã lưu bằng `OUTLOOK_TOKEN_KEY`, giữ nguyên khóa cũ đó; backend ưu tiên `APP_ENCRYPTION_KEY` cho dữ liệu mới.

### Tạo VAPID keys

```bash
npm run vapid:generate
```

Dán hai giá trị vào `VAPID_PUBLIC_KEY` và `VAPID_PRIVATE_KEY`.

> Không commit `.env`, token, client secret hay database password lên Git.
> **Nâng cấp từ v6.0:** nếu đã có `OUTLOOK_TOKEN_KEY`, hãy giữ nguyên biến này. v6.1 có cơ chế giải mã fallback bằng khóa cũ, còn secret mới ưu tiên `APP_ENCRYPTION_KEY`; vì vậy thêm khóa mới không làm mất khả năng đọc token Outlook cũ.


## 4. Cấu hình Microsoft Outlook

Trong Microsoft Entra / App Registration, thêm Redirect URI dạng Web:

```text
https://TEN-DU-AN.vercel.app/outlookOAuthCallback
```

Backend tự dùng webhook:

```text
https://TEN-DU-AN.vercel.app/outlookWebhook
```

Sau khi đổi domain production, cập nhật cả `WEB_APP_BASE_URL`, `OUTLOOK_PUBLIC_BASE_URL` và Redirect URI rồi Redeploy.

## 5. Deploy

Sau khi thêm Environment Variables, Redeploy production.

Kiểm tra:

```text
https://TEN-DU-AN.vercel.app/healthz
```

Mẫu phản hồi:

```json
{
  "ok": true,
  "service": "T Balance v6.1 Meta Billing API",
  "storage": "postgresql",
  "database": { "ok": true }
}
```

Sau đó mở trang chính:

```text
https://TEN-DU-AN.vercel.app/
```

## 6. Cài Meta Billing API trực tiếp trên web

Sau khi deploy, mở **Meta API / Ads → Tự động lấy bill thanh toán từ Meta API**.

1. Dán **Meta Access Token** có quyền đọc các tài khoản quảng cáo cần theo dõi.
2. Chọn Graph API version, chu kỳ quét và số ngày dò lại.
3. Bật **Tự động quét bill**.
4. Khuyến nghị giữ **Chỉ tự trừ bill VND** để tránh quy đổi sai tiền tệ.
5. Bấm **Lưu API**, sau đó **Kiểm tra kết nối** và **Lấy bill ngay**.

Meta Access Token không được trả ngược lại trình duyệt sau khi lưu; backend mã hóa bằng `APP_ENCRYPTION_KEY` rồi lưu trong PostgreSQL.

## 7. Extension v6.0 vẫn được giữ

Trong source có hai ZIP:

```text
T_Balance_AdsCheckV6_Sync_Extension_v6.0.0.zip
T_Balance_Meta_Billing_Extension_v6.0.0.zip
```

Giải nén extension cần dùng → Chrome `chrome://extensions` → bật **Developer mode** → **Load unpacked**.

Trong popup extension, nhập:

```text
https://TEN-DU-AN.vercel.app
```

Sau đó ghép thiết bị bằng mã ghép của T Balance.

## 8. Tự động lấy bill 24/7 / Cron trên Vercel Hobby

`vercel.json` chỉ đăng ký **Outlook renewal 1 lần/ngày**, vì Hobby không cho cron chạy nhiều hơn 1 lần/ngày.

Các luồng realtime chính không cần cron mỗi phút:

- Outlook dùng Microsoft Graph webhook.
- AdsCheck extension có `chrome.alarms` và tự sync theo khoảng thời gian đã cài.
- Thông báo biến động số dư được kiểm tra ngay sau `workspaceSet` và sau Outlook auto-deduct.

Để giữ các job dự phòng/server-only hoạt động khi trình duyệt đóng, dùng một HTTP scheduler có hỗ trợ custom header và gọi:

```text
GET https://TEN-DU-AN.vercel.app/cron/balance
GET https://TEN-DU-AN.vercel.app/cron/meta
GET https://TEN-DU-AN.vercel.app/cron/meta-billing
GET https://TEN-DU-AN.vercel.app/cron/outlook-scan
```

Header cho mỗi request:

```text
Authorization: Bearer <CRON_SECRET>
```

Gợi ý cadence tương thích bản cũ:

```text
/cron/balance       mỗi 1–5 phút (dự phòng)
/cron/meta          mỗi 5 phút
/cron/meta-billing  mỗi 5 phút (Meta bill trực tiếp)
/cron/outlook-scan  mỗi 5 phút (dự phòng webhook)
/cron/outlook-renew 1 lần/ngày (đã có Vercel Cron)
```

Các endpoint có distributed lock trong PostgreSQL nên request trùng không làm job chạy song song.

### GitHub Actions scheduler có sẵn

Source có `.github/workflows/meta-billing-cron.yml`. Nếu muốn dùng nó, tạo Repository Secrets:

```text
TBALANCE_BASE_URL=https://TEN-DU-AN.vercel.app
TBALANCE_CRON_SECRET=<giống CRON_SECRET trên Vercel>
```

Workflow gọi `/cron/meta-billing` mỗi 5 phút. Nếu không dùng GitHub Actions, có thể dùng HTTP scheduler khác với cùng header Bearer.

## 9. Chuyển dữ liệu từ browser cũ

Nếu cùng trình duyệt vẫn còn dữ liệu local T Balance:

1. Deploy bản v6.1.
2. Mở URL Vercel mới.
3. Kết nối cloud.
4. Nếu PostgreSQL chưa có workspace, frontend tự đưa dữ liệu local hiện tại lên cloud mới.

Outlook/Meta token server-side cần kết nối lại vì bản mới không đọc Firebase.

## 10. Lỗi thường gặp

### `DATABASE_URL_REQUIRED`
Chưa kết nối Neon hoặc chưa có `DATABASE_URL`. Thêm DB rồi Redeploy.

### `/healthz` trả 503
Mở `database.error` trong JSON và kiểm tra `DATABASE_URL`/Neon.

### Outlook redirect lỗi
Kiểm tra chính xác Redirect URI trong Microsoft App Registration và `OUTLOOK_PUBLIC_BASE_URL`.

### Web Push không bật được
Kiểm tra đủ `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`; site phải chạy HTTPS (Vercel có HTTPS mặc định).

### Extension báo chưa nhập server
Mở popup extension và nhập URL production `https://...vercel.app`.


### Meta Billing báo `META_TOKEN_REQUIRED`
Mở **Meta API / Ads**, nhập Access Token và bấm **Lưu API**. Token không cần đặt trong Environment Variables.

### Meta API đọc được tài khoản nhưng không có amount
Một số billing activity của Meta không cung cấp amount có cấu trúc ổn định trong `extra_data`. v6.1 sẽ lưu event ở trạng thái chờ/lỗi đọc và **không tự trừ** để tránh sai số dư.
