# T Balance v6.1 — Meta Billing API tự động

## Mục tiêu

Bản v6.1 giữ nguyên toàn bộ chức năng v6.0 và bổ sung luồng lấy bill/thanh toán trực tiếp bằng Meta Marketing API, không cần Firebase và không bắt buộc dùng Meta Billing Extension.

## Luồng hoạt động

1. Người dùng mở **Meta API / Ads** trên web.
2. Nhập Meta Access Token và Graph API version, sau đó bấm **Lưu API**.
3. Backend kiểm tra `/me` và `/me/adaccounts`, mã hóa token bằng AES-256-GCM rồi lưu PostgreSQL. Trình duyệt không nhận lại token đầy đủ.
4. Khi đồng bộ, backend đọc `/act_<AD_ACCOUNT_ID>/activities` và lọc các event billing như:
   - `ad_account_billing_charge`
   - `ad_account_billing_charge_failed`
   - `ad_account_billing_decline`
   - `ad_account_billing_refund`
   - `ad_account_billing_chargeback`
   - `ad_account_billing_chargeback_reversal`
   - `billing_event`
   - `funding_event_successful`
5. Bill được chống trùng bằng fingerprint + transaction/payment ID nếu Meta có trả.
6. Chỉ event charge thành công, có amount đủ tin cậy và khớp đúng Account ID mới được tự trừ. Mặc định chỉ tự trừ VND để tránh sai quy đổi ngoại tệ.
7. Refund/decline/failed vẫn được lưu để theo dõi nhưng không tự thay đổi số dư.

> Lưu ý: API hiện đại không còn dựa vào endpoint `/transactions` cũ. Bản này dùng Ad Account Activities. Meta có thể không trả invoice/PDF hoặc amount ở mọi tài khoản; trường hợp thiếu amount sẽ được giữ ở trạng thái **Chưa đọc được số tiền** thay vì tự trừ sai.

## Cấu hình trên giao diện web

Trong **Meta API / Ads → Tự động lấy bill thanh toán từ Meta API**:

- Meta Access Token
- Graph API version
- Chu kỳ tự quét: 5 / 10 / 15 / 30 / 60 phút
- Dò lại lịch sử: 1–7 ngày
- Bật/tắt Meta Billing API
- Tự động quét bill
- Tự trừ bill charge thành công
- Chỉ tự trừ bill VND

Các nút:

- **Lưu API**: xác thực và lưu token mã hóa.
- **Kiểm tra kết nối**: kiểm tra token, danh sách TKQC và quyền đọc activities.
- **Lấy bill ngay**: chạy đồng bộ ngay lập tức.
- **Xóa Token**: xóa token khỏi PostgreSQL.

## Biến môi trường Vercel

Bắt buộc:

```env
DATABASE_URL=postgresql://...
APP_ENCRYPTION_KEY=<base64 32-byte>
CRON_SECRET=<chuỗi bí mật dài>
WEB_APP_BASE_URL=https://your-project.vercel.app
```

Tạo khóa mã hóa:

```bash
npm run token-key
```

`OUTLOOK_TOKEN_KEY` vẫn được hỗ trợ để tương thích dữ liệu v6.0; nếu đã có khóa này thì chưa bắt buộc đổi sang `APP_ENCRYPTION_KEY`.

Outlook và Web Push vẫn dùng các biến cũ nếu bạn tiếp tục sử dụng chức năng đó.

## Tự động khi trình duyệt đóng

Vercel Hobby không phù hợp cho cron 5 phút. Bản v6.1 có endpoint:

```text
GET/POST /cron/meta-billing
Authorization: Bearer <CRON_SECRET>
```

Có 2 cách miễn phí:

### Cách 1 — GitHub Actions có sẵn trong source

File `.github/workflows/meta-billing-cron.yml` chạy mỗi 5 phút.

Tạo 2 GitHub Actions Secrets:

```text
TBALANCE_BASE_URL=https://your-project.vercel.app
TBALANCE_CRON_SECRET=<giống CRON_SECRET trên Vercel>
```

### Cách 2 — cron-job.org

Tạo job gọi:

```text
https://your-project.vercel.app/cron/meta-billing
```

và thêm header:

```text
Authorization: Bearer <CRON_SECRET>
```

## Giới hạn chống timeout/rate-limit

Mỗi lượt quét tối đa 50 tài khoản quảng cáo và tự xoay vòng qua danh sách. Cursor được lưu theo từng Account ID để tránh bỏ sót bill giữa các lượt. Có overlap 20 phút và lookback 1–7 ngày để chống trễ dữ liệu.

## Kiểm tra sau deploy

1. Mở `/healthz` và xác nhận `ok: true`.
2. Ghép/đăng nhập workspace như bản cũ.
3. Vào **Meta API / Ads**.
4. Nhập token → **Kiểm tra kết nối**.
5. **Lưu API**.
6. Bấm **Lấy bill ngay**.
7. Xem danh sách **Bill gần đây từ Meta API** và trang **Thanh toán**.
8. Nếu muốn chạy 24/7 khi đóng trình duyệt, bật GitHub Actions hoặc cron-job.org.

> **Nâng cấp từ v6.0:** nếu đã có `OUTLOOK_TOKEN_KEY`, hãy giữ nguyên biến này. v6.1 có cơ chế giải mã fallback bằng khóa cũ, còn secret mới ưu tiên `APP_ENCRYPTION_KEY`; vì vậy thêm khóa mới không làm mất khả năng đọc token Outlook cũ.
