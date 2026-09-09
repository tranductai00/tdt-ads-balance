T Balance • AdsCheck V6 Realtime Sync v6.0.0

Nguồn dữ liệu:
https://adscheckv6.smit.vn/app/adscheck-pro

Chức năng:
- Đọc trực tiếp bảng AdsCheck Pro V6 bằng content script.
- Lấy Account ID, tên TKQC, trạng thái, owner, số dư, ngưỡng, còn lại, 4 số cuối thẻ, limit, currency.
- Tự đồng bộ khi bảng thay đổi và theo chu kỳ dự phòng.
- Có thể tự mở AdsCheck V6 ở tab nền.
- Có thể chỉ gửi các TKQC được chọn.
- Tự thêm TKQC mới, tự gắn nguồn tiền theo 4 số cuối, tự cập nhật ngưỡng.
- Gọi trực tiếp Vercel API của T Balance, không dùng Firebase.

Cài đặt:
1. Deploy T Balance v6.0 lên Vercel và lấy URL dạng https://ten-du-an.vercel.app.
2. Giải nén ZIP Extension.
3. Mở chrome://extensions, bật Developer mode, chọn Load unpacked.
4. Mở popup Extension, dán URL Vercel T Balance.
5. Trên website T Balance tạo mã ghép 8 số và nhập mã vào popup.
6. Mở AdsCheck V6, đăng nhập và tải danh sách tài khoản.
7. Extension sẽ tự đồng bộ về PostgreSQL Cloud qua Vercel API.

Nếu AdsCheck V6 thay đổi cấu trúc bảng, parser content.js có thể cần cập nhật selector.
