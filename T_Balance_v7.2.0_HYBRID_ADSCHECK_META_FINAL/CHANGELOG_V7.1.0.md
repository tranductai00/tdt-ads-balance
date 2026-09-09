# Changelog v7.1.0

- Thêm Google Sheets OAuth trực tiếp trên giao diện web.
- Không dùng Firebase, Apps Script hoặc Service Account.
- Mã hóa Google Client Secret, access token và refresh token bằng APP_ENCRYPTION_KEY.
- Thêm mapping Google Sheet theo Account ID × ngày.
- Thêm baseline chống cộng trùng và bảo toàn số liệu có sẵn trong ô.
- Thêm manual reconciliation theo khoảng ngày.
- Thêm mốc “Bắt đầu tự động từ bây giờ”.
- Tự ghi Google Sheet sau mỗi Meta Billing sync và qua cron hiện có.
- Thêm explicit Vercel function `/api/googleOAuthCallback` và rewrite `/auth/google/callback`.
- Giữ nguyên Meta-only, auto-import TKQC, billing parser, nguồn tiền, sửa TKQC và PostgreSQL/Neon.
