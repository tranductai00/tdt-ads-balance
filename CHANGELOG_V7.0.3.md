# v7.0.3

- Fix `adAccountManualUpdate` đọc được workspace primary + legacy.
- Thêm fallback nhận diện tài khoản bằng `metaAccountId` ổn định.
- Frontend gửi `metaAccountId` khi lưu chỉnh sửa thủ công.
- Chỉ cho phép `auto_deducted` khi TKQC có nguồn tiền hợp lệ.
- Thêm trạng thái `pending_source` / “Chưa gắn nguồn tiền”.
- Tự dọn transaction Meta Billing cũ bị tạo khi chưa có nguồn tiền.
- `pending_source` được retry sau khi người dùng gắn nguồn tiền.
- UI tách “Nguồn tiền” và “Nguồn dữ liệu” để không nhầm FB Billing Tool với ngân hàng.
