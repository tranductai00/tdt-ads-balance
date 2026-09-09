# v7.0.4

- Enrich từng TKQC từ Meta Graph node để lấy funding source / card ổn định hơn.
- Lấy billing activities 90 ngày gần nhất để xác định payment threshold theo payment_amount.
- Ghi threshold, remaining threshold, card brand/last4, next billing date/text vào `adAccounts` và `metaApi`.
- Fix merge Meta-only trước đây bỏ qua `scanned.threshold` và `scanned.nextBillingDate`.
- UI `Nguồn ngưỡng` hiển thị `Meta API · Billing`.
- UI không còn báo `Đủ thanh toán` khi chưa gắn nguồn tiền nội bộ.
- Nếu Meta không trả ngày thu cụ thể, hiển thị chế độ billing thay vì dấu `—`.
