# Multi-device — T Balance v7.0 Meta-only

Multi-device là cơ chế xác thực cloud riêng của T Balance, không liên quan Outlook hay AdsCheck.

- Mỗi trình duyệt có một `syncKey` riêng.
- Web cùng origin có thể tự khôi phục quyền nếu `DEVICE_PAIRING_REQUIRED` không bật.
- Có thể tạo mã ghép 8 số trong **Cài đặt → Quản lý thiết bị**.
- Có thể thu hồi từng thiết bị hoặc tất cả thiết bị khác.
- Dữ liệu dùng chung nằm trong PostgreSQL/Neon theo workspace.

Phiên bản Meta-only chỉ dùng Meta Graph API để tự đồng bộ tài khoản quảng cáo và billing.
