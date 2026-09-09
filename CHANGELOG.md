# Changelog

## v7.0.0 — Meta API Only

- Loại bỏ Outlook UI/routes/webhook/OAuth khỏi deployment.
- Loại bỏ AdsCheck UI/routes/extensions và Billing Extension.
- API duy nhất cho dữ liệu quảng cáo: Meta Graph API.
- Thêm `/api/metaBridge` thay `/api/outlookBridge`.
- Thêm auto-import TKQC từ Meta API nếu chưa có trong `data.adAccounts`.
- Merge chống trùng theo `metaAccountId/accountId`.
- Giữ manual override cho tên/ngân hàng/ngưỡng khi Meta sync.
- Meta Billing tự auto-import TKQC trước khi quét event.
- Lưu/test/tải danh sách Meta API đều tự import tài khoản mới.
- Cron Meta account sync riêng: `/cron/meta-accounts`.
- Giữ parser Facebook Billing Tool `payment_amount/action=67/new_value`.
