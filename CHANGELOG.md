# v7.0.2

- Fix `workspace is not defined` trong `metaBridge`.
- Khôi phục request-scope `workspace`, `syncKey`, `deviceName` sau refactor Meta-only.
- Thêm regression test gọi trực tiếp `metaBridge` để lỗi này không tái diễn.
- Không thay đổi database/schema và không khôi phục Outlook/AdsCheck runtime.

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

## v7.0.5
- Thêm `adAccountSetFundingSource` để gắn/bỏ nguồn tiền atomically cho một TKQC.
- Thêm dropdown + nút gắn nguồn tiền trực tiếp trên danh sách TKQC.
- Modal Sửa gửi `bankSnapshot` để xử lý nguồn tiền vừa tạo chưa autosave lên cloud.
- Backend tự upsert `bankSnapshot` hợp lệ trong cùng transaction.
- Giữ `manualBankOverride` để Meta API không ghi đè nguồn tiền sửa thủ công.
