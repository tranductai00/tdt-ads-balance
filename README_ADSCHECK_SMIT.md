# T Balance — AdsCheck Pro V6 Sync

Nguồn dữ liệu đã được khôi phục về AdsCheck Pro, với URL mới:

https://adscheckv6.smit.vn/app/adscheck-pro

## Kiến trúc

Extension đọc trực tiếp bảng AdsCheck V6 và gửi dữ liệu về `outlookBridge` bằng action `adsCheckSync`.

Các field đồng bộ:
- Account ID
- Tên tài khoản
- Trạng thái
- Owner ID
- Số dư
- Ngưỡng thanh toán
- Còn lại đến ngưỡng
- Thẻ / 4 số cuối
- Limit
- Currency

T Balance khớp tài khoản theo Account ID, tự import nếu bật, tự cập nhật ngưỡng nếu bật và tự gắn nguồn tiền khi 4 số cuối khớp duy nhất.

## Extension

Cài file `T_Balance_AdsCheckV6_Sync_Extension_v5.8.4.zip`.

Sau khi giải nén:
1. Chrome → `chrome://extensions`.
2. Bật Developer mode.
3. Load unpacked.
4. Trên T Balance → AdsCheck Pro V6 → Tạo mã ghép Extension.
5. Nhập mã 8 số vào popup.
6. Mở AdsCheck V6 và tải danh sách TKQC.
7. Extension tự gửi khi bảng thay đổi hoặc theo chu kỳ dự phòng.

## Meta API

Khi AdsCheck V6 được cấu hình/đồng bộ, backend đặt `adsCheckV6Mode=true` và `metaAutoSync=false`, vì vậy Cloud Scheduler Meta API không tiếp tục gọi quảng cáo cho workspace này.

Muốn quay lại Meta API, cấu hình Meta Access Token mới bằng luồng Meta API.
