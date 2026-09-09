# T Balance v7.0.3 — Fix sửa TKQC + không tự trừ khi chưa có nguồn tiền

## 1. Fix sửa thủ công tài khoản quảng cáo

Nguyên nhân thật ở v7.0.2: `adAccountManualUpdate` chỉ đọc workspace primary. Một số dữ liệu nâng cấp vẫn được `workspaceGet` đọc từ workspace legacy, vì vậy UI nhìn thấy TKQC nhưng backend Sửa lại không tìm thấy tài khoản.

v7.0.3 dùng `getWorkspaceSnapshot()` cho thao tác sửa, hỗ trợ cả primary + legacy và tự ghi dữ liệu đã sửa vào workspace chính. Việc nhận diện tài khoản khi sửa ưu tiên `id`, sau đó `metaAccountId` ổn định, rồi mới fallback `currentAccountId`.

## 2. Fix báo “Đã tự trừ” khi chưa gắn nguồn tiền

Một Meta billing event chỉ được `auto_deducted` khi TKQC đã có `bankId` và `bankId` đó thật sự tồn tại trong `banks`.

Nếu chưa có nguồn tiền:
- không tạo transaction `ad_payment`;
- trạng thái là `pending_source` / “Chưa gắn nguồn tiền”;
- hiển thị bill/amount bình thường nhưng không trừ tiền;
- sau khi gắn nguồn tiền, event có thể retry ở lần quét tiếp theo.

v7.0.3 cũng tự sửa dữ liệu sai do các bản cũ tạo ra: transaction Meta Billing không có `bankIdSnapshot` sẽ được gỡ khỏi workspace và billing event được chuyển về `pending_source`, tránh việc sau này vừa gắn ngân hàng thì một transaction cũ bỗng trừ ngược số dư.

## 3. Giao diện

Dòng billing phân biệt rõ:
- `Nguồn tiền`: ngân hàng/nguồn tiền thực tế đã gắn;
- `Nguồn dữ liệu`: nguồn parser amount như Facebook Billing Tool.

Không còn gọi parser `FB Billing Tool` là “Nguồn tiền”.

## Deploy

Không cần migration database. Deploy ZIP mới lên Vercel và hard refresh trình duyệt một lần.
