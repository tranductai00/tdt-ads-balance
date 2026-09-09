# T Balance v6.2.0 — Fix sửa thủ công TKQC

## Thay đổi chính

- Thêm backend action `adAccountManualUpdate` để patch atomically đúng một tài khoản quảng cáo trên workspace hiện tại.
- Không còn gửi lại toàn bộ workspace khi bấm **Lưu thay đổi**, tránh conflict với AdsCheck / Meta Billing / Outlook sync.
- Giữ nguyên các field realtime như balance, card last4, billing date, AdsCheck status khi sửa tay.
- Tên, Account ID, ngân hàng, ngưỡng được lưu trực tiếp trên cloud.
- Cho phép chọn **không gắn ngân hàng** và vẫn coi đó là lựa chọn thủ công (`manualBankOverride=true`).
- Ngưỡng > 0 là manual override; ngưỡng 0 trả về chế độ tự động cập nhật threshold.
- Nếu đổi Account ID, ID cũ được tombstone để extension không import lại tài khoản cũ.
- Thêm event delegation dự phòng cho nút **Sửa**, nên nút vẫn mở modal ngay cả khi một vòng `render()` khác gặp lỗi sau khi danh sách đã hiển thị.
- Nút Sửa/Xóa trong danh sách được đặt `type="button"` rõ ràng.

## Deploy

Deploy lại toàn bộ source v6.2.0 lên Vercel. Không cần xóa PostgreSQL/Neon và không cần migration database.

Sau deploy:
1. Hard refresh trình duyệt một lần (`Ctrl+Shift+R`).
2. Vào **Danh sách tài khoản quảng cáo**.
3. Bấm **Sửa**.
4. Sửa tên / Account ID / ngân hàng / ngưỡng.
5. Bấm **Lưu thay đổi**.
6. Tải lại trang để kiểm tra dữ liệu đã giữ nguyên.
