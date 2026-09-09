# T Balance v4.7 — cập nhật bắt buộc

Bản v4.7 bổ sung mốc chỉ xử lý mail mới, lịch quét dự phòng mỗi 5 phút và Firebase Cloud Messaging thông báo biến động số dư. Xem hướng dẫn mới tại `README_V4.7_CAI_DAT.md` trước khi deploy.

# T Balance v4.6 — Firebase cố định + taidt.web.app + Outlook Meta

## Firebase đã được gắn cố định

- Project ID: `tran-duc-tai-0`
- Firebase Hosting chính: `https://taidt.web.app`
- Đường dẫn tương thích: `https://taidt.web.app/sodu`
- Hosting site ID/target: `taidt`
- Workspace Firestore: `tran-duc-tai-main`
- Cloud Functions: `https://asia-southeast1-tran-duc-tai-0.cloudfunctions.net`

Website không còn cho nhập hoặc thay đổi Firebase Config trên giao diện.

## Tên miền đã cấu hình

Tên miền đã được cố định thành:

```text
https://taidt.web.app
```

Bộ source đã có deploy target `taidt`, đặt ứng dụng ở cả `/` và `/sodu`, đồng thời cập nhật CORS/đường dẫn trả về Outlook. Callback Microsoft Entra vẫn dùng Cloud Functions:

```text
https://asia-southeast1-tran-duc-tai-0.cloudfunctions.net/outlookOAuthCallback
```

Nếu Hosting site `taidt` chưa tồn tại trong Firebase project `tran-duc-tai-0`, tạo một lần:

```bash
firebase hosting:sites:create taidt --project tran-duc-tai-0
firebase target:apply hosting taidt taidt --project tran-duc-tai-0
```

Deploy:

```bash
firebase deploy --only hosting:taidt,functions --project tran-duc-tai-0
```


Bản này giữ nguyên toàn bộ chức năng T Balance và và bổ sung nhận diện biên lai Meta từ Outlook để tự động trừ số dư.

## 1. Chức năng đã bổ sung

- Kết nối Outlook bằng Microsoft OAuth 2.0.
- Nhận mail mới bằng Microsoft Graph Webhook, không cần mở trang `/sodu` liên tục.
- Chỉ xử lý mail từ địa chỉ mặc định:
  `noreply@business-updates.facebook.com`
- Tự đọc:
  - Số tiền đã lập hóa đơn.
  - ID giao dịch.
  - ID tài khoản quảng cáo trong phần “Biên lai của”.
  - 4 số cuối thẻ.
  - Số tham chiếu.
- Tự khớp theo thứ tự:
  1. ID tài khoản quảng cáo khớp chính xác.
  2. Nếu email không có ID tài khoản: khớp 4 số cuối thẻ và chỉ tự chọn khi thẻ đó liên kết đúng một tài khoản QC.
- Chống trùng bằng Outlook Message ID và ID giao dịch.
- Mail không khớp sẽ nằm ở trạng thái “Chờ khớp tài khoản” và không bị trừ tiền.
- Có nút “Quét mail ngay” để kiểm tra lại tối đa 20 mail Meta gần nhất trong 50 mail Inbox mới nhất.
- Có thể chọn tài khoản QC thủ công cho mail chưa khớp.
- Tự gia hạn Microsoft Graph subscription mỗi ngày.

### Ví dụ email trong ảnh mẫu

Hệ thống sẽ đọc được:

- Số tiền: `466.970 đ`
- ID giao dịch: `27855032750851036-27986196334401347`
- Tài khoản QC: `684477777092435`
- Thẻ: `7818`
- Số tham chiếu: `SW5UKX52K2`

Mặc định hệ thống trừ đúng `466.970 đ`. Có thể chọn “Cộng thêm phí thẻ đang cài đặt”.

---

## 2. Cấu trúc file

```text
T_Balance_v4.6_Taidt_Fixed_Firebase/
├── sodu.html                         # File HTML hoàn chỉnh để thay bản cũ
├── public/
│   └── sodu/
│       └── index.html                # Dùng khi deploy Firebase Hosting
├── functions/
│   ├── index.js                      # Entry độc lập
│   ├── outlook.js                    # Toàn bộ Outlook Bridge
│   └── package.json
├── firebase.json
└── .firebaserc
```

---

## 3. Tạo ứng dụng Microsoft

Truy cập Microsoft Entra Admin Center:

1. Chọn **App registrations** → **New registration**.
2. Đặt tên: `T Balance Outlook`.
3. Chọn loại tài khoản:
   - **Accounts in any organizational directory and personal Microsoft accounts**.
4. Trong **Redirect URI**, chọn loại **Web** và nhập chính xác:

```text
https://asia-southeast1-tran-duc-tai-0.cloudfunctions.net/outlookOAuthCallback
```

5. Sau khi tạo, sao chép **Application (client) ID**.
6. Vào **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**.
7. Thêm:

```text
User.Read
Mail.Read
```

8. Vào **Certificates & secrets** → **New client secret**.
9. Sao chép ngay **Value** của client secret. Không dùng “Secret ID”.

> `offline_access` được yêu cầu tự động trong luồng đăng nhập nên không cần thêm thủ công ở màn hình API permissions.

---

## 4. Chuẩn bị Firestore

Trong Firebase Console của project `tran-duc-tai-0`:

1. Mở **Firestore Database** và tạo database nếu chưa có.
2. Chọn khu vực phù hợp, nên dùng khu vực gần Việt Nam.
3. Giữ lại quy tắc Firestore hiện tại nếu website cũ của bạn đã hoạt động. Nếu xuất hiện lỗi `Missing or insufficient permissions`, cần cấu hình Firebase Authentication/rules trước khi dùng dữ liệu thật. Không nên mở quyền đọc/ghi công khai lâu dài vì website lưu số dư và giao dịch.

---

## 5. Cài Firebase Functions

Yêu cầu Node.js 20.

```bash
cd T_Balance_v4.6_Taidt_Fixed_Firebase/functions
npm install
cd ..
```

Đăng nhập và chọn dự án:

```bash
npx --yes firebase-tools@latest login
npx --yes firebase-tools@latest use tran-duc-tai-0
```

Cài ba secret. Mỗi lệnh sẽ yêu cầu dán giá trị rồi Enter:

```bash
npx --yes firebase-tools@latest functions:secrets:set MS_CLIENT_ID
npx --yes firebase-tools@latest functions:secrets:set MS_CLIENT_SECRET
npx --yes firebase-tools@latest functions:secrets:set OUTLOOK_TOKEN_KEY
```

Giá trị `OUTLOOK_TOKEN_KEY` phải là base64 32 byte. Tạo trên Mac/Linux:

```bash
openssl rand -base64 32
```

Deploy Functions:

```bash
npx --yes firebase-tools@latest deploy --only functions --project tran-duc-tai-0
```

Sau khi deploy phải có 4 function:

```text
outlookBridge
outlookOAuthCallback
outlookWebhook
outlookRenewSubscriptions
```

---

## 5. Dự án đã có Cloud Functions khác

Không ghi đè `functions/index.js` hiện tại.

1. Sao chép file `functions/outlook.js` vào thư mục functions hiện tại.
2. Thêm hai dòng sau vào cuối `functions/index.js` hiện tại:

```js
const outlook = require("./outlook");
Object.assign(exports, outlook);
```

3. Đảm bảo `package.json` dùng Node 20 và có dependencies:

```json
{
  "engines": { "node": "20" },
  "dependencies": {
    "firebase-admin": "^13.4.0",
    "firebase-functions": "^6.4.0"
  }
}
```

4. Chạy lại:

```bash
npm install
npx --yes firebase-tools@latest deploy --only functions --project tran-duc-tai-0
```

---

## 7. Deploy website

### Cách 1 — thay trực tiếp file hiện tại

Dùng file:

```text
sodu.html
```

thay cho file `/sodu` cũ trên hosting hiện tại.

### Cách 2 — Firebase Hosting

```bash
npx --yes firebase-tools@latest deploy --only hosting --project tran-duc-tai-0
```

Sau đó mở:

```text
https://taidt.web.app
```

Khi đã gắn tên miền mới, mở đường dẫn `/sodu` trên tên miền đó.

---

## 8. Kết nối Outlook trên website

1. Mở mục **Outlook Meta**.
2. Giữ địa chỉ Cloud Functions mặc định:

```text
https://asia-southeast1-tran-duc-tai-0.cloudfunctions.net
```

3. Bấm **Tạo khóa**.
4. Bật **Tự động trừ tiền khi nhận mail mới**.
5. Chọn cách tính tiền:
   - **Trừ đúng số tiền ghi trên bill Meta**: khuyến nghị.
   - **Cộng thêm phí thẻ đang cài đặt**: dùng khi ngân hàng thực tế thu thêm phí.
6. Bấm **Kết nối Outlook**.
7. Chọn tài khoản Outlook đang nhận mail Meta và chấp nhận quyền đọc mail.
8. Website quay lại `/sodu` và hiển thị “Đã kết nối”.
9. Bấm **Quét mail ngay** để nhập các bill gần đây.

---

## 8. Điều kiện để tự trừ chính xác

Trong mục **Tài khoản QC**, trường **Mã tài khoản** phải chứa đúng ID Meta trong email.

Ví dụ email có:

```text
TAI-684477777092435 (684477777092435)
```

thì trường **Mã tài khoản** phải là:

```text
684477777092435
```

Trong mục **Tài khoản ngân hàng**, trường **Số tài khoản / 4 số cuối** nên chứa `7818` để kiểm tra thẻ liên kết.

---

## 9. Bảo mật

- Client secret Microsoft và token Outlook chỉ nằm trong Firebase Secret Manager/Firestore phía máy chủ.
- Access token và refresh token được mã hóa AES-256-GCM trước khi lưu.
- Website chỉ lưu khóa đồng bộ riêng trong trình duyệt.
- Không đặt `MS_CLIENT_SECRET` hoặc token Outlook vào file HTML.
- Chỉ cấp quyền `Mail.Read`; hệ thống không cần quyền gửi, sửa hoặc xóa email.

---

## 10. Kiểm tra lỗi

### Redirect URI không khớp

Đảm bảo URI trong Microsoft App trùng hoàn toàn:

```text
https://asia-southeast1-tran-duc-tai-0.cloudfunctions.net/outlookOAuthCallback
```

### Website báo HTTP 404

Kiểm tra function `outlookBridge` đã deploy đúng region `asia-southeast1`.

### Mail tới nhưng chưa trừ tiền

Kiểm tra theo thứ tự:

1. Email gửi từ đúng `noreply@business-updates.facebook.com`.
2. ID tài khoản QC trong website khớp ID trong email.
3. Tự động trừ tiền đang bật.
4. Email chưa từng được ghi nhận trước đó.
5. Mục **Email Meta đã nhận diện** có trạng thái “Chờ khớp tài khoản” hay không.

### Subscription hết hạn

Function `outlookRenewSubscriptions` chạy mỗi ngày lúc 03:15 theo giờ Việt Nam và gia hạn trước khi subscription hết hạn.
