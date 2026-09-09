# T Balance v6.1.9 — Fix sửa tài khoản quảng cáo

## Lỗi đã sửa

Trước v6.1.9, `saveAdEdit()` bắt buộc `bankId`. Vì vậy các TKQC được import từ AdsCheck/Billing nhưng đang **Chưa gắn ngân hàng** có thể mở modal Sửa nhưng không lưu được nếu chưa chọn ngân hàng. Ngoài ra threshold từ scan mới hơn có thể ghi đè threshold người dùng vừa sửa khi workspace conflict-merge.

## Hành vi mới

- Tên TKQC vẫn bắt buộc.
- Mã TKQC có kiểm tra trùng như cũ.
- Ngân hàng liên kết **không bắt buộc** khi sửa.
- Threshold > 0 được coi là manual override và không bị AdsCheck/Billing ghi đè.
- Threshold trống/0 trả tài khoản về chế độ threshold tự động.
- Tên sửa thủ công không bị tên từ AdsCheck/Billing ghi đè.
- Ngân hàng đã chọn thủ công được giữ khi sync.
- Các field động như số dư, trạng thái, 4 số thẻ, ngày billing vẫn tiếp tục cập nhật.
- Lưu cloud thực hiện ngay; nếu có conflict hệ thống merge rồi pull lại dữ liệu mới nhất.

## Deploy

Redeploy source lên Vercel. Không cần migration PostgreSQL/Neon và không xóa dữ liệu.
