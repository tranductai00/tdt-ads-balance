# T Balance v5.8 — Hybrid Meta API + Billing Extension

## Kiến trúc v5.8

T Balance dùng hai nguồn dữ liệu, mỗi nguồn có độ ưu tiên riêng:

- **Meta Marketing API (nguồn chính):** `balance`, `amount_spent`, `account_status`, `currency`, `spend_cap`, funding source khi token cho phép.
- **Meta Billing Extension (nguồn bổ sung):** Payment Threshold, Next Billing Date, Visa/Mastercard + 4 số cuối và balance trên Billing Hub để đối chiếu.

Không còn lấy dữ liệu từ AdsCheck.

### Quy tắc ưu tiên

- Số dư TKQC: `Meta API > Billing Extension > dữ liệu cũ`.
- Ngưỡng thanh toán: `Billing Extension > ngưỡng cũ/nhập thủ công`.
- Ngày thanh toán kế tiếp: `Billing Extension`.
- 4 số cuối thẻ: `Billing Extension > Meta API > dữ liệu cũ`.

## Cài website / Functions

```bash
cd T_Balance_v5.8_Hybrid_Meta_API_Billing_Extension
firebase deploy --only functions,hosting
```

Giữ nguyên các Firebase secrets/params của bản cũ. v5.8 không thêm secret mới.

## Cài Meta Billing Extension

1. Tải `T_Balance_Meta_Billing_Extension_v5.8.0.zip` từ website hoặc thư mục source.
2. Giải nén.
3. Chrome → `chrome://extensions` → bật Developer mode → Load unpacked.
4. Trên T Balance mở mục **Meta API + Billing Extension**.
5. Bấm **Tạo mã ghép Extension**.
6. Mở popup extension → nhập mã 8 số → **Ghép**.
7. Đồng bộ Meta API trước để T Balance có danh sách Account ID/BM ID.
8. Bấm **Quét hàng loạt** trong extension.

Extension mở Billing Hub nền theo từng Account ID, chờ giao diện render, đọc dữ liệu hiển thị rồi tự đóng tab. Facebook phải đang đăng nhập trên cùng Chrome profile.

## Dữ liệu Billing lưu trên mỗi TKQC

```json
{
  "threshold": 3167945,
  "billingPageBalance": 342095,
  "billingNextDate": "2026-09-15",
  "paymentCardBrand": "Visa",
  "paymentCardLast4": "7818",
  "billingLastSyncAt": "2026-08-25T...Z",
  "billingExtension": {
    "threshold": 3167945,
    "balance": 342095,
    "nextBillingDate": "2026-09-15",
    "cardBrand": "Visa",
    "cardLast4": "7818",
    "sourceUrl": "https://business.facebook.com/billing_hub/..."
  }
}
```

## Ghi chú

Payment Threshold/Next Billing Date không phải field public ổn định của Marketing API. Extension đọc đúng dữ liệu đang hiển thị trên Billing Hub nên nếu Meta thay đổi ngôn ngữ/cấu trúc giao diện lớn, parser có thể cần cập nhật. Parser v5.8 hỗ trợ giao diện Việt/Anh và không dùng selector CSS cứng cho số tiền, nhằm giảm lỗi khi Meta thay đổi class React.
