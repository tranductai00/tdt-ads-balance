# Fix Google OAuth: Project đã bị xóa — v7.2.2

## Lỗi
`Project #448232912482 has been deleted.`

Nguyên nhân là Google OAuth Client ID cũ thuộc Cloud project `448232912482` đã bị xóa. Project number không được hard-code trong source; credential có thể đang lưu trong database/runtime.

## Đã sửa
- Chặn OAuth Client ID thuộc project đã xóa trước khi redirect sang Google.
- Khi đổi Client ID, tự xóa access/refresh token cũ để không dùng token gắn với OAuth client trước.
- Thêm **Xóa OAuth cũ** để xóa Client ID, Secret và token cũ nhưng giữ cấu hình Spreadsheet.
- Hỗ trợ cấu hình credential qua biến môi trường `GOOGLE_OAUTH_CLIENT_ID` và `GOOGLE_OAUTH_CLIENT_SECRET` (ưu tiên hơn database).
- Hiển thị Project Number và nguồn credential (ENV/database) trong trạng thái Google Sheets.
- Xóa `googleSheetLastError` cũ khi lưu/reset OAuth credential.

## Cấu hình Vercel khuyến nghị
Tạo một Google Cloud project đang hoạt động, bật Google Sheets API, tạo OAuth 2.0 Client loại **Web application**, thêm Authorized redirect URI:

`https://TEN-MIEN-CUA-BAN/auth/google/callback`

Sau đó chọn một trong hai cách:
1. Nhập Client ID + Client Secret ở giao diện Google Sheets và bấm **Lưu OAuth**; hoặc
2. Đặt Vercel Environment Variables: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

Nếu database đang giữ OAuth cũ: bấm **Xóa OAuth cũ** trước, sau đó lưu credential mới và **Kết nối Google**.
