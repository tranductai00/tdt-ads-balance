# T Balance v7.0.4 — Meta Full Billing Info

Bản Meta-only bổ sung đầy đủ dữ liệu cho card tài khoản quảng cáo.

## Nguồn dữ liệu

- **Số dư**: `AdAccount.balance` qua Meta Graph API.
- **Thẻ liên kết**: `funding_source_details` / `funding_source`, đọc riêng từng account để một account thiếu quyền không làm mất dữ liệu của toàn bộ danh sách.
- **Ngưỡng**: suy ra từ các billing activity `ad_account_billing_charge` có `type=payment_amount`, ưu tiên cụm payment amount gần nhất có giá trị lặp/ổn định; nếu chưa đủ mẫu thì dùng giá trị charge lớn nhất gần đây với confidence `medium`.
- **Còn lại**: `max(0, threshold - balance)`.
- **Ngày thu tiếp**: ưu tiên field ngày trong `extra_data` (`next_billing_date`, `billing_date`, `due_date`, ...). Nếu Meta không trả ngày cụ thể, UI hiển thị `Khi đạt ngưỡng hoặc kỳ thanh toán tháng`, không giả lập một ngày không có trong API.
- **Nguồn ngưỡng**: `Meta API · Billing` khi lấy từ Billing Activities; `Thủ công` nếu người dùng khóa ngưỡng thủ công.

## Cách cập nhật

Sau deploy: Meta API → **Đồng bộ TKQC ngay**. Backend sẽ enrich từng account và lưu các field mới vào PostgreSQL.

Không cần migration database.
