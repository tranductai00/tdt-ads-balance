# T Balance v6.1 — Meta Billing API Direct

Bản deploy Vercel hoàn chỉnh, không Firebase runtime.

## Điểm mới

- Cài Meta Access Token trực tiếp tại **Meta API / Ads**.
- Test kết nối, lưu/xóa token, chọn Graph API version, interval và lookback ngay trên web.
- Tự lấy billing activities từ Meta cho các TKQC và lưu lịch sử billing event.
- Chống trùng event/giao dịch.
- Chỉ `ad_account_billing_charge` có amount đủ tin cậy mới được phép đi vào luồng tự trừ.
- Mặc định chỉ tự trừ VND; failed/refund/decline/chargeback/funding không tự trừ.
- `/cron/meta-billing` + workflow GitHub Actions mẫu cho chế độ 24/7 trên Vercel Hobby.
- Giữ nguyên Outlook, AdsCheck V6, Meta balance sync, multi-device, Web Push và transaction logic v6.0.

## Bắt đầu

Đọc `DEPLOY_VERCEL.md`, sau đó `README_V6.1_META_BILLING_API.md`.
