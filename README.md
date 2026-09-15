# T Balance v7.2.4 — Fix timeout Bridge + chống đồng bộ Meta Billing trùng

## Kiến trúc nguồn dữ liệu

- **AdsCheck V6 Extension v7.2.1**: đồng bộ realtime balance, threshold, remaining threshold, thẻ, trạng thái, limit, currency và next billing date nếu AdsCheck hiển thị.
- **Meta Graph API**: nguồn duy nhất cho billing events, payment amount, transaction ID, PDF bill, tự trừ ngân hàng và Google Sheets.

Extension không tạo transaction bill và không gọi logic tự trừ.


## Fix chính v7.2.4

- Sửa lỗi giao diện tự `AbortController.abort()` sau **22 giây** trong khi một request Meta Graph riêng lẻ có thể chờ tới **25 giây**.
- `metaBillingSync` được chờ tối đa **250 giây** ở trình duyệt và **không tự retry** để tránh tạo nhiều job billing chạy song song.
- Các action nặng khác dùng timeout theo loại tác vụ thay vì một mốc 22 giây cho tất cả.
- `metaBridge` runtime nâng giới hạn lên **240 giây**; Vercel Function giữ `maxDuration: 300`.
- Thêm **server-side sync lease 6 phút**: chỉ một Meta Billing sync được chạy trên mỗi workspace tại một thời điểm.
- `metaBillingStatus` trả thêm `syncInProgress`, thời gian bắt đầu và lease; nút **Lấy bill ngay** tự khóa khi server đang quét.
- Giữ nguyên toàn bộ fix v7.2.3: timestamp Meta API, pagination billing, cursor safety, backfill 7/14/30 ngày và recovery bill bị thiếu.

## Fix chính v7.2.3

- Sửa trạng thái `Meta API` lấy nhầm timestamp legacy/AdsCheck.
- Tách `metaLastReceivedAtMs` và `metaLastScannedAtMs` để UI hiển thị đúng thời gian đồng bộ Meta.
- Billing `/activities` không còn dừng cứng ở 4 trang/400 activity; mặc định quét tối đa 50 trang, có thể cấu hình bằng `META_BILLING_MAX_ACTIVITY_PAGES` (4–100).
- Nếu pagination chưa quét hết, **không advance cursor** để tránh bỏ mất bill cũ.
- Parser revision theo từng TKQC, nên workspace nhiều tài khoản vẫn được backfill đầy đủ theo từng batch.
- Lookback tối thiểu 7 ngày, hỗ trợ 14/30 ngày; overlap cursor tăng từ 20 lên 60 phút.
- Lần nâng parser lên revision 9 tự backfill tối thiểu 7 ngày cho từng TKQC.
- Tích hợp AdsCheck V6 extension v7.2.1 đã sửa timestamp chẩn đoán realtime.

## Cài extension

1. Giải nén `T_Balance_AdsCheckV6_Realtime_Extension_v7.2.1_FIXED.zip`.
2. Chrome → Extensions → Developer mode → Load unpacked.
3. Chọn thư mục vừa giải nén.
4. Nhập URL Vercel của T Balance.
5. Tạo mã ghép trên web và nhập vào extension.
6. Mở AdsCheck V6. Extension tự đọc và đồng bộ theo thời gian thực.

## Sau khi deploy backend

1. Mở T Balance → Meta Billing.
2. Đảm bảo `Dò lại lịch sử` là 7 ngày hoặc lớn hơn.
3. Bấm **Đồng bộ Meta Billing** một lần để chạy repair/backfill ngay.
4. Kiểm tra `accountErrors`; nếu một TKQC có quá nhiều activity, hệ thống giữ cursor để lần sau không bỏ bill.

Nguồn bill thanh toán vẫn là **Meta API**.
