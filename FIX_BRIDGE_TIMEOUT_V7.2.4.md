# T Balance v7.2.4 — Fix Bridge timeout

## Nguyên nhân gốc

Frontend dùng `AbortController` với timeout cố định **22.000 ms** cho mọi request Bridge. Trong khi backend Meta Graph cho phép một HTTP request riêng lẻ chờ tới **25.000 ms**, và `metaBillingSync` còn có thể phải quét nhiều tài khoản / nhiều trang activity. Kết quả là trình duyệt tự hủy request hợp lệ trước khi server kịp trả lời.

Bản cũ còn tự retry tối đa 3 lần. Khi browser abort, request đang chạy trên Vercel không nhất thiết dừng ngay, nên retry có thể tạo nhiều lần Meta Billing sync chạy song song, làm server càng chậm và tăng nguy cơ tranh chấp dữ liệu.

## Cách sửa v7.2.4

- `metaBillingSync`: timeout client 250 giây, chỉ 1 attempt.
- `metaApiSync`, Google Sheets job nặng: 180 giây, 1 attempt.
- Cấu hình/test billing: 90 giây, tối đa 2 attempt.
- Action nhẹ: 45 giây, tối đa 3 attempt.
- Backend `metaBridge`: timeout runtime 240 giây.
- Vercel `/api/metaBridge` và `/api/outlookBridge`: maxDuration 300 giây.
- Thêm sync lease 6 phút theo workspace. Nếu đã có billing sync đang chạy, request mới bị chặn bằng HTTP 409 `META_BILLING_SYNC_IN_PROGRESS` thay vì khởi chạy job thứ hai.
- Status API trả `syncInProgress`, `syncStartedAtMs`, `syncLeaseUntilMs`, `syncDeviceName`; UI khóa nút sync khi server đang làm việc.

## Sau khi deploy

Không cần reset dữ liệu hoặc token. Redeploy source v7.2.4, hard refresh trang, sau đó bấm **Lấy bill ngay**. Với lần backfill nhiều dữ liệu, cứ để tab chờ đến khi server trả kết quả; không mở nhiều tab để bấm sync đồng thời.
