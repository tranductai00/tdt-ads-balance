# v7.2.4

- Fix lỗi `Máy chủ phản hồi quá lâu. Hệ thống sẽ tự thử lại.` do frontend abort request sau 22 giây.
- Thêm request policy theo action: Meta Billing 250 giây / 1 attempt; tác vụ nặng khác 90–180 giây.
- Không tự retry `metaBillingSync`, tránh chạy trùng khi request đầu vẫn tiếp tục ở server.
- Thêm distributed lease 6 phút cho Meta Billing theo workspace; request trùng nhận `META_BILLING_SYNC_IN_PROGRESS` (409).
- Meta Billing status hiển thị trạng thái đang quét và tự khóa nút sync trong lúc job đang chạy.
- Nâng runtime bridge lên 240 giây và Vercel maxDuration cho `/api/metaBridge`, `/api/outlookBridge` lên 300 giây.
- Giữ nguyên toàn bộ cơ chế phục hồi bill thiếu của v7.2.3.

# v7.2.3

- Fix UI trạng thái Meta API dùng nhầm timestamp legacy/AdsCheck.
- Tách `metaLastReceivedAtMs` / `metaLastScannedAtMs` / `metaLastReason`.
- Sửa Meta Billing pagination: bỏ giới hạn cứng 4 trang/400 activity; mặc định tối đa 50 trang.
- Không advance cursor khi pagination chưa hoàn tất, tránh bỏ sót bill.
- Per-account parser revision v9 để mọi TKQC đều được one-time backfill dù scan theo batch.
- Lookback tối thiểu 7 ngày, hỗ trợ 14/30 ngày; overlap cursor tăng lên 60 phút.
- Tích hợp AdsCheck V6 extension v7.2.1 đã sửa timestamp chẩn đoán realtime.

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

## v7.1.1
- Fix Meta Billing auto-deduct: trừ cả phí thẻ theo `settings.cardFeePercent`.
- Tự repair transaction Meta cũ đã trừ bill nhưng thiếu phí mà không tạo giao dịch trùng.
- Ưu tiên `bankIdSnapshot` khi tính số dư để bill lịch sử luôn thuộc đúng nguồn tiền lúc thanh toán.
- UI Meta Billing đổi mô tả thành “Tự trừ billing charge + phí thẻ ngân hàng”.
