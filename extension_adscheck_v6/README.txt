T Balance AdsCheck V6 Realtime Data v7.2.1

Vai trò:
- AdsCheck V6: realtime balance, threshold, remaining threshold, payment card, next billing date/status.
- Meta Graph API: billing payment events, transaction id, bill amount, auto deduction, Google Sheets.

Cài đặt:
1. Chrome > Extensions > Developer mode > Load unpacked.
2. Chọn thư mục extension_adscheck_v6.
3. Nhập URL Vercel T Balance.
4. Ghép thiết bị bằng mã ghép từ web.
5. Mở AdsCheck V6 và bấm Đồng bộ.

Extension không tạo giao dịch bill và không tự trừ ngân hàng.


Thay đổi v7.2.1:
- Tách rõ thời gian AdsCheck quét / Extension gửi / Server nhận để tránh hiểu nhầm timestamp.
- Sửa version hiển thị popup bị kẹt ở v6.0.0.
- Lưu lastClientSentAt để chẩn đoán realtime sync.

Lưu ý quan trọng:
- Extension này KHÔNG đọc billing event từ Meta Graph API.
- Lỗi thiếu bill phải sửa ở backend T Balance (server/meta-runtime.js), không thể sửa chỉ bằng extension.
