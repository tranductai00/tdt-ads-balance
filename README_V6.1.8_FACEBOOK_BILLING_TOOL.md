# T Balance v6.1.8 — Facebook Billing Tool-compatible billing parser

## Fix chính

Facebook Billing Tool (FBT) xuất billing activity theo cấu trúc đã xử lý gồm `eventType`, `currency`, `value`, `totalValue`, `transactionId`, `action`, `type` và link PDF hóa đơn.

v6.1.8 áp dụng mapping trực tiếp cho payload Meta:

- `event_type = ad_account_billing_charge`
- `extra_data.type = payment_amount`
- `extra_data.action = 67`
- `extra_data.currency = VND/USD/...`
- `extra_data.new_value` = **số tiền bill**
- `extra_data.transaction_id` = **ID giao dịch**

Ví dụ:

```json
{
  "type": "payment_amount",
  "action": 67,
  "currency": "VND",
  "new_value": "116651",
  "transaction_id": "28526254503727057-28472574245761751"
}
```

sẽ được đọc thành `116651 VND` với confidence `high`.

## Fix lịch sử parse_error

Bản trước lưu cursor theo thời điểm quét. Vì vậy sau khi nâng parser, nút **Lấy bill ngay** chỉ tải lại khoảng 20 phút gần nhất và các bill cũ vẫn kẹt `Meta không trả amount`.

v6.1.8 thay đổi:

- Manual sync luôn backfill toàn bộ khoảng `lookbackDays`.
- Lần auto-sync đầu tiên sau khi nâng parser cũng backfill một lần bằng `metaBillingParserRevision=8`.
- Các event cũ `parse_error/estimated/recovered` được retry và cập nhật tại chỗ.

Không cần xóa PostgreSQL/Neon.

## PDF bill

Khi có `transaction_id`, hệ thống tạo link PDF tương thích Billing Summary:

`https://business.facebook.com/ads/manage/billing_transaction/?act=<ACCOUNT_ID>&pdf=true&source=billing_summary&tx_type=3&txid=<TRANSACTION_ID>`

UI hiển thị nút **Mở bill PDF**.

## Sau deploy

1. Giữ nguyên database và Environment Variables.
2. Redeploy Vercel.
3. Vào Meta Billing API.
4. Đặt `Số ngày dò lại` đủ bao phủ bill cũ cần sửa (ví dụ 7 ngày).
5. Bấm **Lấy bill ngay**.
6. Các event `payment_amount/action 67/new_value` sẽ được sửa thành amount thật.
