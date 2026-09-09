# T Balance v7.0 — Meta API Only

Phiên bản này chỉ dùng **Meta Graph API** làm nguồn dữ liệu tự động cho tài khoản quảng cáo và billing.

## Đã loại bỏ

- Outlook OAuth / Outlook Bridge / Outlook webhook / quét email.
- AdsCheck / AdsCheck Extension / Billing Extension / browser scraping.
- Các endpoint Outlook và AdsCheck.

## Giữ lại

- Vercel + PostgreSQL/Neon.
- Quản lý nguồn tiền, tài khoản quảng cáo, giao dịch.
- Sửa thủ công TKQC bằng atomic patch.
- Meta Access Token cài trực tiếp trên web và mã hóa ở backend.
- Đồng bộ danh sách TKQC trực tiếp từ `/me/adaccounts`.
- Meta Billing Activities + parser `payment_amount/action=67/new_value`.
- Chỉ quét billing của các TKQC được chọn nếu muốn.
- Tự trừ bill charge khi amount đủ tin cậy và khớp đúng TKQC.

## Auto-import TKQC

Mỗi lần Meta API trả danh sách tài khoản, backend chạy merge theo `metaAccountId/accountId`:

- Nếu chưa có → tự thêm vào `data.adAccounts`.
- Nếu đã có → cập nhật balance/status/currency/amount_spent/funding data.
- Không ghi đè tên, ngân hàng hoặc ngưỡng đã đặt manual override.
- Nếu người dùng đổi `accountId` hiển thị thủ công, `metaAccountId` vẫn giữ ID gốc từ Meta để tránh import trùng.

Auto-import chạy khi:

- Lưu Meta API lần đầu.
- Kiểm tra kết nối.
- Bấm “Tải lại TKQC”.
- Bấm “Đồng bộ TKQC ngay”.
- Quét Meta Billing.
- Cron `/cron/meta-accounts`.
- Cron `/cron/meta-billing`.

## Environment Variables

```text
DATABASE_URL=postgresql://...
APP_ENCRYPTION_KEY=<base64 32-byte>
CRON_SECRET=<random secret>
WEB_APP_BASE_URL=https://your-domain.vercel.app
```

Tạo khóa mã hóa:

```bash
npm run token-key
```

Không cần Microsoft/Outlook credentials. Không cần Firebase. Không cần AdsCheck Extension.

## Endpoint

```text
POST /api/metaBridge
GET  /api/healthz
GET/POST /cron/meta-accounts
GET/POST /cron/meta-billing
```

## Deploy

Xem `DEPLOY_VERCEL.md`.
