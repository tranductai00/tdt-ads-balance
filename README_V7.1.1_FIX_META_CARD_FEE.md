# T Balance v7.1.1 — Fix Meta Billing Card Fee

## Lỗi đã sửa

Bản v7.1.0 dùng `deductionMode: exact` cho Meta Billing, nên mỗi bill chỉ trừ đúng số tiền Meta trả về. Trường `Phí thanh toán thẻ (%)` dù đã cấu hình vẫn không được cộng vào số tiền trừ ngân hàng.

v7.1.1 chuyển Meta Billing sang `with_fee`:

`Tổng trừ ngân hàng = Tiền bill + round(Tiền bill × Phí thẻ % / 100)`

Ví dụ bill `116.651 đ`, phí `3%`:
- Tiền bill: `116.651 đ`
- Phí thẻ: `3.500 đ`
- Tổng trừ nguồn tiền: `120.151 đ`

## Sửa dữ liệu cũ

Ở đầu mỗi lần Meta Billing sync, hệ thống kiểm tra các transaction `source=meta_billing_api` đã auto-deduct nhưng có `fee=0`, `feePercent=0` và `amount == rawAmount`. Nếu hiện tại `cardFeePercent > 0`, hệ thống cập nhật chính transaction cũ thành bill + phí, không tạo transaction mới nên không bị trừ lặp.

Receipt và Meta billing event tương ứng cũng được cập nhật `fee`, `feePercent`, `deductedAmount`.

## Gắn đúng ngân hàng lịch sử

Số dư ngân hàng giờ ưu tiên `tx.bankIdSnapshot` trước `ad.bankId`. Vì vậy nếu sau này TKQC đổi nguồn tiền, bill cũ vẫn được tính vào đúng ngân hàng đã thanh toán tại thời điểm phát sinh.

## Cách dùng

1. Vào **Cài đặt** → nhập **Phí thanh toán thẻ (%)**.
2. Đảm bảo TKQC đã gắn đúng nguồn tiền.
3. Vào **Meta API & Billing** → bật **Tự trừ billing charge + phí thẻ ngân hàng**.
4. Bấm **Lấy bill ngay** một lần sau khi deploy để sửa các bill cũ thiếu phí.

Không cần migration PostgreSQL/Neon.
