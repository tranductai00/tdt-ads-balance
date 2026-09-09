# Deploy T Balance v7.0 Meta-only lên Vercel

## 1. Tạo PostgreSQL/Neon

Tạo database và đặt connection string vào biến `DATABASE_URL` trong Vercel.

## 2. Environment Variables

Tối thiểu:

```text
DATABASE_URL=postgresql://...
APP_ENCRYPTION_KEY=<base64 32-byte>
CRON_SECRET=<chuỗi bí mật dài>
WEB_APP_BASE_URL=https://your-project.vercel.app
```

Tạo APP_ENCRYPTION_KEY:

```bash
npm run token-key
```

Không cần `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `OUTLOOK_PUBLIC_BASE_URL`, Firebase credential hoặc AdsCheck.

## 3. Deploy

Import repo/source vào Vercel. Root Directory phải là thư mục có:

```text
server.js
package.json
vercel.json
api/
public/
server/
```

Không đặt Output Directory thành `public`.

## 4. Kiểm tra

```text
https://your-domain/api/healthz
```

Phải có:

```json
{
  "ok": true,
  "integrations": {
    "metaGraphApi": true,
    "outlook": false,
    "adscheck": false
  }
}
```

## 5. Cấu hình Meta API trên web

Vào `Meta API` → nhập Access Token → `Lưu API` hoặc `Kiểm tra kết nối`.

Ngay khi backend lấy được `/me/adaccounts`, TKQC chưa có sẽ tự động được thêm vào data.

## 6. Chạy tự động khi đóng trình duyệt

Có sẵn GitHub Actions `.github/workflows/meta-billing-cron.yml` gọi cả:

- `/cron/meta-accounts`
- `/cron/meta-billing`

Cấu hình GitHub repository secrets:

```text
TBALANCE_BASE_URL=https://your-domain.vercel.app
TBALANCE_CRON_SECRET=<giống CRON_SECRET trên Vercel>
```
