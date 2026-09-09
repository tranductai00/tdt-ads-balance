# T Balance v7.1 — Meta API + Google Sheets

Phiên bản này giữ kiến trúc **Meta-only** của v7.0.5 và bổ sung **Google Sheets OAuth + tự động điền báo cáo** theo cơ chế của source mẫu `meta-outlook-google-sheet-firebase 10.zip`, nhưng không dùng Firebase, Outlook, AdsCheck, Apps Script hay Service Account.

## Nguồn dữ liệu

- Meta Graph API: danh sách TKQC, số dư, billing activities, bill amount.
- PostgreSQL / Neon: dữ liệu ứng dụng, cấu hình Meta, Google OAuth token, trạng thái chống ghi trùng.
- Google Sheets API v4: đọc cấu trúc báo cáo và ghi số tiền.

## Google Sheet tự động

Mỗi billing charge hợp lệ được map theo:

```text
Meta billing event
  → Account ID
  → ngày thanh toán (Asia/Ho_Chi_Minh)
  → tìm dòng Account ID
  → tìm cột ngày DD/MM
  → ghi tổng tiền vào giao điểm
```

Cơ chế baseline tương thích website mẫu:

- Không cộng trùng event đã ghi.
- Không phá số tiền đã tồn tại trong ô trước khi bật automation.
- Nút **Điền lại báo cáo** ghi lại chính xác tổng bill đã quét theo khoảng ngày.
- Sau khi reconcile thủ công, bill mới vẫn tiếp tục cộng đúng.

## Tính năng Google Sheets

- Nhập Google OAuth Client ID/Secret trực tiếp trên web.
- Client Secret và OAuth token được mã hóa AES-256-GCM trong PostgreSQL.
- Đăng nhập Google bằng tài khoản có quyền chỉnh sửa Sheet.
- Dán link Spreadsheet và chọn tên sheet.
- Cấu hình:
  - dòng tiêu đề ngày;
  - cột Account ID;
  - cột ngày bắt đầu / kết thúc;
  - số dòng tối đa cần dò;
  - chỉ ghi bill VND.
- Nút **Bắt đầu tự động từ bây giờ**.
- Nút **Điền lại báo cáo** theo khoảng ngày.
- Kiểm tra quyền truy cập Sheet.
- Tự ghi Sheet ngay sau Meta Billing sync.
- Cron `/cron/meta-billing` cũng tự ghi Sheet khi browser đóng.

## Environment Variables

```text
DATABASE_URL=postgresql://...
APP_ENCRYPTION_KEY=<base64 32-byte>
WEB_APP_BASE_URL=https://your-domain.vercel.app
CRON_SECRET=<random secret>
```

Google Client ID/Secret không cần đặt trong Vercel Environment Variables; nhập trực tiếp ở tab **Google Sheet**.

## API chính

```text
POST /api/metaBridge
GET  /auth/google/callback
GET  /api/healthz
GET/POST /cron/meta-accounts
GET/POST /cron/meta-billing
```

## Deploy

Xem `DEPLOY_VERCEL.md`.
