# T Balance 7.3.0 — Nhiều Meta API và báo cáo USD/VND

Bản sửa dựa trên tranductai00/tdt-ads-balance, commit bfdbc06fc0464f6b1ac712424c355ecc109d9131.

## Sử dụng

1. Trong Meta Billing, nhập tối đa 20 Access Token, mỗi dòng một token. Bấm kiểm tra rồi lưu. Danh sách nhập mới thay thế toàn bộ danh sách cũ; để trống để giữ nguyên. Xóa token sẽ xóa toàn bộ danh sách đã lưu. Token tiếp tục được mã hóa bằng khóa máy chủ hiện có.
2. Trong Google Sheets, cấu hình riêng hai khung VND và USD: link file, tên tab, dòng ngày, cột Account ID và phạm vi cột ngày. Hai tiền tệ phải dùng tab khác nhau (có thể trong cùng một file).
3. Lưu và kiểm tra từng cấu hình. Account ID trong Sheet phải là Plain text; không được trùng dòng. Nên dùng ngày dd/mm/yyyy để tránh nhầm năm.
4. Để tự động ghi cả hai tiền tệ, bỏ chọn “Tự động chỉ điền VND” và bấm bắt đầu tự động. Điền lại báo cáo áp dụng cho cả hai cấu hình đã lưu, trong khoảng ngày đã chọn.
5. USD được ghi dưới dạng số, giữ hai chữ số thập phân; VND ghi nguyên đồng. Không tự quy đổi tỷ giá.

## Nguồn dữ liệu báo cáo

Báo cáo cộng các billing charge hợp lệ đã ghi nhận từ Meta. Đây là tiền hóa đơn thanh toán theo ngày sự kiện, KHÔNG phải daily ad spend từ Insights. Không lấy amount_spent tích lũy làm chi tiêu trong ngày. Múi giờ báo cáo giữ Asia/Ho_Chi_Minh. Dữ liệu ước tính, lỗi, không rõ tiền tệ hoặc số tiền không hợp lệ không được đưa vào báo cáo.

## Thay đổi

- Khám phá tài khoản từ từng token, hợp nhất theo Account ID, giữ tài khoản ở các trạng thái khác nhau. Token gặp lỗi không loại bỏ kết quả từ token khác; lỗi một phần được đưa vào kết quả đồng bộ.
- Gọi API tài khoản bằng token có quyền truy cập; thử token còn lại khi lỗi quyền/token/tạm thời. Không bỏ giới hạn request của Meta; vẫn giữ retry/backoff hiện có.
- Loại token khỏi URL phân trang; chỉ gửi Bearer token đến graph.facebook.com.
- Giữ cents USD khi đọc balance, amount_spent, spend_cap và chuẩn hóa tài khoản. Các tổng số dư/ngưỡng trên dashboard tách theo tiền tệ.
- Cấu hình USD riêng, giữ cấu hình VND cũ. Chặn dùng chung tab giữa USD và VND.
- Cộng USD bằng đơn vị cent và gửi số RAW vào Google Sheets.
- Lưu baseline trước khi ghi Sheet, khóa theo ô bằng transaction, tách trạng thái theo tiền tệ/đích ghi/mốc tự động. Khôi phục baseline VND cũ khi đích ghi không đổi.
- Chặn Account ID trùng dòng, ngày trùng cột, hoặc nhiều ngày cùng ánh xạ vào một ô khi điền lại báo cáo.

## Kiểm chứng

- npm run check: PASS.
- npm test: PASS, bao gồm kiểm thử cũ và test_multi_currency_reports.js.
- JavaScript nhúng trong public/index.html, public/sodu/index.html, sodu.html: kiểm tra cú pháp PASS.
- Kiểm thử mới mô phỏng Meta, Google Sheets và kho dữ liệu: nhiều token, tài khoản trùng/không hoạt động, một token hết hạn, USD cents, ghi riêng USD/VND, loại số tiền lỗi/ước tính, chạy lại báo cáo, lỗi sau khi Google đã nhận ghi, đổi tab và nâng cấp baseline VND.
- Chưa kiểm thử end-to-end với Meta, Google Sheets hoặc PostgreSQL thật. Các kiểm thử dùng mock không chứng minh hành vi trên tài khoản thật.
- Chưa kiểm tra hình ảnh trên trình duyệt: môi trường thiếu Chromium.

## Triển khai

Giữ nguyên DATABASE_URL, APP_ENCRYPTION_KEY và cấu hình OAuth hiện tại. Không đổi khóa mã hóa. Cập nhật source lên repo rồi triển khai theo DEPLOY_VERCEL.md/README hiện có. Chạy npm install, npm run check và npm test trước khi đưa lên server.

Gói này chưa được đẩy lên GitHub hoặc triển khai website. GitHub connector hiện báo pull=true, push=false.

Các chức năng ngân hàng/phí thẻ hiện có chưa được chuyển thành hệ thống ví đa tiền tệ; không dùng tùy chọn tự trừ bill ngoài VND vào số dư ngân hàng VND nếu chưa có xử lý quy đổi riêng.
