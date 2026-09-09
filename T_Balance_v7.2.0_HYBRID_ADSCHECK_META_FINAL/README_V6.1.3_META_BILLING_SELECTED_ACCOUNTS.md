# T Balance v6.1.3 — Meta Billing Amount + Selected Accounts

## 1. Fix lỗi “Meta có billing event nhưng chưa trả số tiền đủ tin cậy”

Parser v6.1.3 nhận amount từ nhiều cấu trúc an toàn hơn:

- `extra_data.amount`
- `charge_amount`, `charged_amount`, `payment_amount`, `billing_amount`, `invoice_amount`, `total_amount`, `amount_charged`, `transaction_amount`, `amount_paid`
- JSON lồng dưới `new_value`, `payment`, `billing`, ... kể cả khi JSON bị encode thành chuỗi
- chuỗi có dấu tiền tệ rõ ràng như `1.250.000 VND`, `₫750.000`, `$12.34`
- `translated_event_type` nếu câu billing chứa amount có dấu tiền tệ rõ ràng

Event cũ đã bị lưu `parse_error` sẽ được thử xử lý lại ở lần quét kế tiếp. Không cần xóa PostgreSQL hoặc xóa lịch sử bill.

Hệ thống vẫn không tự suy đoán amount từ balance delta hoặc Account ID để tránh trừ nhầm.

## 2. Chỉ quét TKQC được chọn

Trong `Meta API / Ads` → `Phạm vi tài khoản cần quét bill`:

1. Bấm **Tải lại TKQC**.
2. Chọn **Chỉ quét TKQC được chọn**.
3. Tích các tài khoản cần theo dõi.
4. Bấm **Lưu API**.

Có ô tìm theo tên/Account ID, nút **Chọn tất cả** và **Bỏ chọn**.

Backend lưu riêng:

- `metaBillingSelectionMode`
- `metaBillingSelectedAccountIds`

Danh sách này độc lập với bộ lọc AdsCheck. Khi quét, backend vẫn gọi `/me/adaccounts` để xác nhận tài khoản còn truy cập được, nhưng chỉ gọi `/act_<id>/activities` cho các TKQC được chọn.

Nếu chọn chế độ `selected` nhưng không chọn TKQC nào, sync sẽ dừng và báo lỗi; không tự quét tất cả.

## 3. Deploy

Giữ nguyên toàn bộ Environment Variables của v6.1.2. Chỉ thay source và Redeploy Vercel. Không cần migration database.

Sau deploy:

1. mở web và hard refresh một lần;
2. vào Meta Billing API;
3. bấm **Tải lại TKQC**;
4. chọn phạm vi quét;
5. **Lưu API**;
6. bấm **Lấy bill ngay** để retry cả các event `parse_error` cũ.
