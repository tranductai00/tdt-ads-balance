# T Balance v6.1.5 — Fix Outlook Bridge HTTP 500 on Vercel

## Lỗi đã sửa

`/api/outlookBridge` là Vercel Function trực tiếp. Runtime v6.1.4 dùng `res.set(...)` trong `setCors()` trước `try/catch`. `res.set()` là helper của Express, không phải helper chuẩn được đảm bảo cho Vercel Function response. Khi không tồn tại, Function ném exception trước handler và frontend chỉ thấy `Outlook Bridge HTTP 500`.

v6.1.5 chuyển toàn bộ response header sang `res.setHeader(...)` tương thích Node/Vercel/Express, đồng thời thêm helper an toàn cho JSON/text/redirect.

## Chẩn đoán mới

Mở:

`https://TEN-MIEN/api/healthz`

Kiểm tra:
- `dependencies.pg = true`
- `dependencies.webPush = true`
- `config.databaseUrl = true`
- `config.appEncryptionKey = true`
- `config.msClientId = true`
- `config.msClientSecret = true`

Nếu runtime không load được dependency, `/api/outlookBridge` sẽ trả JSON `OUTLOOK_DEPENDENCY_MISSING` thay vì trang 500 trống.

## Biến môi trường Outlook tối thiểu

- `DATABASE_URL`
- `APP_ENCRYPTION_KEY` (hoặc `OUTLOOK_TOKEN_KEY` cũ)
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `MS_TENANT=common`
- `WEB_APP_BASE_URL=https://TEN-MIEN`
- `OUTLOOK_PUBLIC_BASE_URL=https://TEN-MIEN`

Sau khi sửa Environment Variables phải Redeploy.

## Redirect URI Microsoft

Giữ:

`https://TEN-MIEN/outlookOAuthCallback`

Webhook:

`https://TEN-MIEN/outlookWebhook`

Các route này vẫn rewrite sang explicit Vercel Functions.
