T Balance • Meta Billing Sync v6.0.0

Mục đích:
- Meta API vẫn có thể cung cấp balance, amount_spent, trạng thái, currency.
- Extension bổ sung các field Billing Hub: Payment Threshold, ngày thanh toán kế tiếp, loại thẻ + 4 số cuối và balance trên Billing Hub.
- Gọi trực tiếp Vercel API của T Balance, không dùng Firebase.

Cài đặt:
1. Deploy T Balance v6.0 lên Vercel và lấy URL dạng https://ten-du-an.vercel.app.
2. Mở chrome://extensions → bật Developer mode → Load unpacked thư mục extension_meta_billing.
3. Mở popup extension, dán URL Vercel T Balance.
4. Trên website tạo mã ghép Extension 8 số, nhập mã và bấm Ghép.
5. Nếu dùng Meta API, đồng bộ API trước để có danh sách Account ID.
6. Bấm Quét hàng loạt hoặc mở Billing Hub rồi bấm Quét tab đang mở.

Lưu ý:
- Facebook phải đang đăng nhập trong cùng Chrome profile.
- Quét hàng loạt mở tab Billing Hub nền theo từng Account ID rồi tự đóng.
- Nếu Meta đổi giao diện Billing Hub, parser content.js có thể cần cập nhật.
