# T Balance v7.2.0 — AdsCheck V6 realtime + Meta API Billing

## Kiến trúc nguồn dữ liệu

- **AdsCheck V6 Extension**: chỉ đồng bộ dữ liệu realtime của tài khoản quảng cáo: balance, threshold, remaining threshold, card last4/brand, status, limit, currency và next billing date nếu AdsCheck hiển thị.
- **Meta Graph API**: vẫn là nguồn duy nhất cho billing events, payment amount, transaction ID, PDF bill, tự trừ ngân hàng và Google Sheets.

Extension không tạo transaction bill và không gọi logic tự trừ.

## Cài extension

1. Giải nén `T_Balance_AdsCheckV6_Realtime_Extension_v7.2.0.zip`.
2. Chrome → Extensions → Developer mode → Load unpacked.
3. Chọn thư mục vừa giải nén.
4. Nhập URL Vercel của T Balance.
5. Tạo mã ghép trên web và nhập vào extension.
6. Mở AdsCheck V6. Extension tự đọc và đồng bộ theo thời gian thực.

Hỗ trợ:
- `https://adscheckv6.smit.vn/app/adscheck-pro*`
- `https://adscheck.smit.vn/app/adscheck-pro*`

## Ưu tiên hiển thị dashboard

Khi có dữ liệu AdsCheck V6 mới, dashboard ưu tiên balance/ngưỡng/còn lại/thẻ từ AdsCheck để phản ánh nhanh hơn. Nếu extension chưa có dữ liệu, dashboard fallback về Meta API.

Nguồn bill thanh toán không thay đổi: **Meta API**.
