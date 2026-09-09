# T Balance v4.7.3 — Đăng nhập nhiều thiết bị

## Lỗi đã sửa

Bản cũ lưu một `keyHash` duy nhất cho workspace. Thiết bị thứ hai tự tạo khóa mới nên máy chủ trả về `Khóa đồng bộ Outlook không đúng`. Bản v4.7.3 lưu danh sách khóa thiết bị được cấp quyền. Mỗi máy có khóa riêng và không làm thiết bị còn lại bị đăng xuất.

## Nâng cấp từ v4.7.2

Thiết bị đang hoạt động với khóa cũ vẫn truy cập bình thường. Khi gọi máy chủ lần đầu, khóa cũ tự được thêm vào `authorizedKeyHashes`. Không cần xóa document Outlook và không cần kết nối lại Microsoft.

## Ghép thiết bị thứ hai

1. Trên thiết bị thứ nhất mở `https://taidt.web.app` → **Outlook Meta**.
2. Bấm **Tạo mã ghép thiết bị**.
3. Sao chép mã 8 chữ số. Mã chỉ dùng một lần và hết hạn sau 10 phút.
4. Trên thiết bị thứ hai mở cùng website → **Outlook Meta**.
5. Nhập tên thiết bị và mã 8 chữ số.
6. Bấm **Đăng nhập thiết bị này**.
7. Dữ liệu ngân hàng, tài khoản QC, giao dịch và trạng thái Outlook sẽ được tải về.

Không bấm **Kết nối Outlook** trên thiết bị thứ hai trước khi ghép. Tài khoản Microsoft chỉ cần kết nối một lần cho workspace.

## Deploy

```bash
cd T_Balance_v4.7.3_Multi_Device_Fix
cd functions
rm -rf node_modules
npm install
cd ..

npx --yes firebase-tools@latest deploy \
  --only functions:outlookBridge \
  --project tran-duc-tai-0

npx --yes firebase-tools@latest deploy \
  --only hosting:taidt \
  --project tran-duc-tai-0
```

Chỉ `outlookBridge` cần cập nhật cho cơ chế ghép thiết bị. Các function webhook, OAuth, auto scan và notification có thể giữ nguyên nếu chúng đã deploy thành công. Tuy nhiên source `outlookOAuthCallback` cũng đã được cập nhật để giữ danh sách thiết bị khi kết nối lại Outlook, nên nên deploy thêm callback:

```bash
npx --yes firebase-tools@latest deploy \
  --only "functions:outlookBridge,functions:outlookOAuthCallback,hosting:taidt" \
  --project tran-duc-tai-0
```

## Firestore bổ sung

- `t_balance_outlook/{workspace}`: thêm `authorizedKeyHashes` và `devices`.
- `t_balance_device_pairings/{hash}`: mã ghép tạm thời.

Các collection này được truy cập bằng Firebase Admin SDK phía Cloud Functions, không cần mở Firestore Rules cho trình duyệt.


## Quản lý / xóa thiết bị — v5.8.5

Mở **Cài đặt → Quản lý thiết bị đã ghép nối** để xem toàn bộ trình duyệt/Extension đã được cấp quyền. Có thể xóa từng thiết bị khác hoặc chọn **Xóa tất cả thiết bị khác**. Thiết bị hiện tại được bảo vệ khỏi tự xóa.

Thiết bị bị thu hồi sẽ nhận `DEVICE_NOT_AUTHORIZED` ở lần đồng bộ kế tiếp và phải ghép lại bằng mã 8 số mới.
