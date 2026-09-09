# T Balance v6.1.6 — Meta Billing Amount Recovery Engine

## Lỗi được sửa

Một số `ad_account_billing_charge` từ Meta chỉ trả `translated_event_type` kiểu **“Đã lập hóa đơn cho tài khoản”** và `extra_data` không có field `amount` rõ ràng. v6.1.5 vì vậy giữ bill ở `parse_error` / “Chưa đọc được tiền”.

v6.1.6 thay bằng cơ chế phục hồi amount nhiều lớp:

1. **Deep extra_data parser**
   - `amount`, `payment_amount`, `charge_amount`, `billing_amount`, ...
   - `new_value`, `current_value`, `event_value` khi event chắc chắn là `ad_account_billing_charge`.
   - JSON lồng, JSON bị encode URL, HTML entity (`&quot;`), single-quote object và chuỗi `key:value` / `key=value`.
   - VND/USD/... có dấu tiền tệ hoặc currency của Ad Account.

2. **Đối chiếu Outlook**
   - Match cùng `account_id` + transaction/reference hoặc timestamp gần nhất.
   - Nếu Outlook đã tự trừ: Meta event hiển thị lại đúng amount và trạng thái **Đã đối chiếu Outlook**, không trừ lần 2.
   - Nếu mới có receipt Outlook: hiển thị amount phục hồi nhưng không tự trừ để tránh duplicate.

3. **Balance delta snapshot (VND/zero-decimal currencies)**
   - Lưu snapshot `balance + amount_spent` mỗi lần Meta Billing sync.
   - Nếu chỉ có 1 billing charge mới giữa hai snapshot, ước tính:
     `payment = previousBalance + spendDelta - currentBalance`.
   - Nguồn này chỉ hiển thị `≈ amount`, không auto-deduct.

4. **Payment threshold fallback**
   - Nếu workspace đã có `threshold` từ AdsCheck/Billing Extension, bill chưa có amount sẽ hiển thị amount ước tính theo threshold.
   - Không auto-deduct từ threshold estimate.

## Sau khi deploy

Không cần xóa PostgreSQL/Neon. Các event cũ `parse_error` sẽ tự retry ở lần bấm **Lấy bill ngay** hoặc lần auto-sync kế tiếp.

Trên giao diện:

- **Đã đối chiếu Outlook**: amount chắc chắn từ giao dịch Outlook đã ghi nhận.
- **Đã phục hồi amount**: amount từ receipt Outlook, chưa auto-deduct để tránh trùng.
- **Amount ước tính**: từ balance delta hoặc threshold; có dấu `≈` và không auto-deduct.
- **Meta chưa trả amount**: Meta thực sự không cung cấp đủ dữ liệu và hệ thống chưa có nguồn phụ để phục hồi.

Nếu vẫn còn dòng `Meta chưa trả amount`, mở **Xem extra_data Meta** ngay trên bill để xem raw payload mà Meta trả về.
