# T Balance v6.1.4 — Fix Outlook Bridge HTTP 404 trên Vercel

## Nguyên nhân
Bản v6.1.3 gọi trực tiếp `/outlookBridge` và phụ thuộc Vercel tự nhận diện toàn bộ `server.js` là một Express Function. Trên một số deployment, static UI vẫn chạy nhưng request `/outlookBridge` bị Vercel trả 404 trước khi tới Express runtime.

## Cách sửa v6.1.4
- Thêm Vercel Function rõ ràng: `api/outlookBridge.js`.
- Thêm function riêng cho `api/outlookOAuthCallback.js` và `api/outlookWebhook.js`.
- Frontend gọi trực tiếp `/api/outlookBridge`.
- Giữ các đường dẫn tương thích cũ bằng rewrite:
  - `/outlookBridge` → `/api/outlookBridge`
  - `/outlookOAuthCallback` → `/api/outlookOAuthCallback`
  - `/outlookWebhook` → `/api/outlookWebhook`
- Express local/server vẫn hỗ trợ cả route cũ và `/api/...`.

## Microsoft Entra / Azure Redirect URI
Giữ URI callback công khai như cũ:

`https://TEN-MIEN-CUA-BAN/outlookOAuthCallback`

Không bắt buộc đổi sang `/api/outlookOAuthCallback` vì Vercel rewrite sẽ chuyển request vào function mới.

## Environment Variables cần có
- `DATABASE_URL`
- `APP_ENCRYPTION_KEY` (hoặc `OUTLOOK_TOKEN_KEY` tương thích cũ)
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `MS_TENANT=common`
- `WEB_APP_BASE_URL=https://TEN-MIEN-CUA-BAN`
- `OUTLOOK_PUBLIC_BASE_URL=https://TEN-MIEN-CUA-BAN`

Sau khi đổi domain, cập nhật 2 biến URL trên và Redeploy.

## Kiểm tra sau deploy
1. Mở `/api/healthz` → phải trả JSON `{ "ok": true, ... }`.
2. Mở `/api/outlookBridge` → không được trả Vercel 404; nếu thiếu tham số/DB có thể trả JSON lỗi ứng dụng, điều đó chứng tỏ function đã được invoke.
3. Mở web và bấm Kết nối Outlook.
4. Nếu Microsoft báo redirect URI mismatch, thêm đúng `https://TEN-MIEN-CUA-BAN/outlookOAuthCallback` vào App Registration.

## Không thay đổi dữ liệu
Không cần xóa Neon/PostgreSQL, không cần reset workspace, không cần ghép lại thiết bị chỉ vì bản fix này.
