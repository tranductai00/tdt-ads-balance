# T Balance v5.8.6 — AdsCheck V6 Auto Match + Delete Accounts

## Mục tiêu

Giữ nguyên luồng AdsCheck V6:

`https://adscheckv6.smit.vn/app/adscheck-pro`

và sửa hai vấn đề:

1. Email biên lai Meta có Account ID nhưng T Balance báo `Không khớp được tài khoản quảng cáo`, buộc ghi nhận thủ công.
2. Tài khoản quảng cáo không còn sử dụng không có nút xóa và nếu xóa thủ công có thể bị AdsCheck V6 nhập lại.

## Auto-match biên lai mới

Parser hỗ trợ trực tiếp mẫu Meta mới:

`Biên lai quảng cáo Meta của bạn (ID tài khoản: 1503335338036239)`

Thứ tự khớp:

1. Account ID chính xác.
2. Account ID suffix duy nhất để tương thích dữ liệu cũ bị cắt tiền tố.
3. 4 số cuối thẻ đang lưu trực tiếp trên TKQC từ AdsCheck/Billing.
4. 4 số cuối của nguồn tiền/ngân hàng liên kết.

Hệ thống không tự trừ nếu kết quả còn mơ hồ.

Sau mỗi lần AdsCheck V6 đồng bộ, backend tự quét lại tối đa 60 biên lai `pending_match`. Khi người dùng bấm Đồng bộ Outlook, backend quét lại tối đa 100 biên lai. Các biên lai cũ có Account ID nằm trong tiêu đề cũng được tự khôi phục mà không cần đọc lại email.

## Fix trạng thái xanh nhưng vẫn hiện lỗi đỏ

Trước đây Firestore dùng merge nên `error = Không khớp...` có thể còn sót sau khi biên lai đã chuyển sang `Đã ghi nhận`.

v5.8.6:
- xóa lỗi cũ khi biên lai được xử lý lại;
- không hiển thị lỗi cũ cho `auto_deducted`, `manually_applied`, `duplicate`.

## Xóa tài khoản quảng cáo không dùng nữa

Danh sách TKQC có thêm nút **Xóa** và modal Sửa có **Xóa tài khoản này**.

Khi xóa:
- tài khoản biến mất khỏi danh sách active;
- Account ID được thêm vào `settings.deletedAdAccountIds`;
- AdsCheck V6/Billing/Meta sync không tự import lại Account ID đó;
- tài khoản bị xóa không được dùng để auto-match biên lai mới;
- giao dịch cũ được giữ;
- `bankIdSnapshot`, `adAccountNameSnapshot`, `metaAdAccountId` được chụp vào giao dịch trước khi xóa để số dư nguồn tiền không thay đổi.

Muốn dùng lại tài khoản đã xóa: thêm thủ công lại đúng Account ID. T Balance tự gỡ Account ID đó khỏi danh sách chặn.

## Deploy

Bản này thay đổi Functions và Hosting:

```bash
firebase deploy --only functions,hosting
```

Extension AdsCheck V6 v5.8.4 vẫn dùng được, không bắt buộc cài lại.
