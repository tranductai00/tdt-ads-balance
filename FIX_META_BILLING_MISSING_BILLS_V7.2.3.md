# Fix Meta Billing Missing Bills — v7.2.3

## Nguyên nhân gốc

1. `metaApiStatus.lastScannedAtMs` đọc nhầm `state.lastScannedAtMs` của luồng legacy/AdsCheck, nên UI có thể hiện Meta API cũ nhiều ngày dù sync vừa chạy.
2. `/act_<id>/activities` bị dừng cứng sau 4 trang (tối đa khoảng 400 activity). Bill ở trang sau bị bỏ qua.
3. Dù pagination bị cắt, code cũ vẫn cập nhật `metaBillingAccountCursors[accountId] = now`, khiến lần sau không quay lại vùng dữ liệu bị bỏ sót.
4. Lookback mặc định 3 ngày nhỏ hơn khoảng trống 11/9 → 15/9 trong tình huống lỗi thực tế.
5. Parser revision cũ là cấp workspace; với nhiều TKQC và scan theo batch, batch đầu có thể nâng revision khiến batch sau mất one-time backfill.

## Sửa

- Timestamp Meta có field riêng: `metaLastReceivedAtMs`, `metaLastScannedAtMs`, `metaLastReason`.
- Billing pagination mặc định 50 trang, giới hạn an toàn 4–100.
- Trạng thái fetch có cờ `complete`; cursor chỉ advance khi quét hoàn tất.
- Per-account parser revision v9 + one-time backfill tối thiểu 7 ngày.
- Lookback UI/backend: 7/14/30 ngày.
- Cursor overlap: 60 phút.
- Partial scan không còn ghi `lastSuccessAt` mới và có `metaBillingLastError`.
