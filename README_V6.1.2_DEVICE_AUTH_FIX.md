# T Balance v6.1.2 — Fix quyền thiết bị trên Vercel

## Lỗi đã sửa

Trước đây mỗi browser/domain tạo một `syncKey` riêng. Khi PostgreSQL đã có workspace từ lần deploy hoặc thiết bị trước, browser mới bị trả `DEVICE_NOT_AUTHORIZED` và giao diện hiện:

> Thiết bị này chưa được cấp quyền. Hãy dùng mã ghép từ thiết bị đã đăng nhập.

## Cơ chế mới

- Web UI gọi backend cùng origin gửi `clientType=web`.
- Backend kiểm tra request thực sự same-origin trước khi tự cấp quyền.
- Nếu workspace đã tồn tại nhưng syncKey của browser chưa nằm trong danh sách, backend tự thêm thiết bị web vào `authorizedKeyHashes`.
- Cơ chế này hoạt động ở `deviceStatus`, `workspaceGet`, `workspaceSet` và các API web dùng `ensureWorkspaceKey`.
- Extension vẫn dùng pairing code như trước.
- Thiết bị đã bị bấm **Xóa quyền** được ghi vào `revokedKeyHashes` và sẽ **không** tự cấp lại bằng cùng syncKey.
- Nếu muốn bắt buộc mọi thiết bị web cũng phải ghép thủ công, đặt `DEVICE_PAIRING_REQUIRED=true` trên Vercel. Mặc định để trống/false để tránh tự khóa sau redeploy hoặc đổi domain.

## Sau khi deploy

Không cần xóa database hoặc localStorage. Mở lại trang web; thiết bị web hiện tại sẽ tự được thêm lại vào workspace.
