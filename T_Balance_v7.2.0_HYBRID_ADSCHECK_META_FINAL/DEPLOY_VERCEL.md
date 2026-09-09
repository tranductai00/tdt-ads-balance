# Deploy T Balance v7.1 lên Vercel

## 1. PostgreSQL / Neon

Tạo database và đặt connection string vào `DATABASE_URL`.

## 2. Environment Variables

```text
DATABASE_URL=postgresql://...
APP_ENCRYPTION_KEY=<base64 32-byte>
WEB_APP_BASE_URL=https://your-domain.vercel.app
CRON_SECRET=<chuỗi bí mật dài>
```

Tạo khóa:

```bash
npm run token-key
```

`WEB_APP_BASE_URL` phải là domain thực bạn dùng vì Google OAuth Redirect URI được tạo từ biến này.

## 3. Deploy source

Root Directory là thư mục có:

```text
server.js
package.json
vercel.json
api/
public/
server/
```

Không đặt Output Directory thành `public`.

## 4. Tạo Google OAuth Web Client

Trong Google Cloud Console:

1. Tạo/Chọn project.
2. Bật **Google Sheets API**.
3. Cấu hình OAuth consent screen.
4. Tạo OAuth Client loại **Web application**.
5. Authorized redirect URI:

```text
https://YOUR-DOMAIN/auth/google/callback
```

URI chính xác cũng được hiển thị trong tab **Google Sheet** của T Balance.

Nếu OAuth app đang ở Testing, thêm tài khoản Google bạn sẽ đăng nhập vào danh sách Test users.

## 5. Cấu hình trên giao diện T Balance

Vào **Google Sheet**:

1. Nhập Google Client ID.
2. Nhập Google Client Secret.
3. Bấm **Lưu OAuth**.
4. Bấm **Kết nối Google** và đăng nhập tài khoản có quyền sửa Sheet.
5. Dán link Google Sheet.
6. Nhập tên sheet và mapping cột.
7. Bấm **Lưu cấu hình Sheet**.
8. Bấm **Kiểm tra Sheet**.
9. Bấm **Bắt đầu tự động từ bây giờ**.

## 6. Cấu trúc báo cáo mặc định

```text
Tên sheet: Chi tiết dòng tiền
Dòng tiêu đề ngày: 2
Cột Account ID: C
Cột ngày bắt đầu: G
Cột ngày kết thúc: AK
Dòng tối đa: 5000
```

Hàng tiêu đề ngày có thể là `9/9`, `09/09`, `09-09`...; backend chuẩn hóa về `DD/MM`.

Cột Account ID nên đặt định dạng **Plain text** để ID dài không bị Google Sheets làm tròn.

## 7. Chạy tự động 24/7

Workflow `.github/workflows/meta-billing-cron.yml` đã có sẵn. Nó gọi:

- `/cron/meta-accounts`
- `/cron/meta-billing`

Google Sheet auto-fill chạy bên trong Meta Billing sync nên không cần cron riêng.

GitHub repository secrets:

```text
TBALANCE_BASE_URL=https://your-domain.vercel.app
TBALANCE_CRON_SECRET=<giống CRON_SECRET trên Vercel>
```
