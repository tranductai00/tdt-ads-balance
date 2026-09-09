# T Balance v7.0.5 — Fix gắn nguồn tiền TKQC

## Lỗi đã sửa

Ở các bản trước, muốn gắn nguồn tiền phải mở modal **Sửa tài khoản quảng cáo** và lưu toàn bộ record. Trong một số trường hợp dữ liệu Meta đang sync hoặc nguồn tiền vừa được tạo nhưng chưa autosave lên cloud, thao tác có thể không lưu được `bankId`.

v7.0.5 thêm luồng riêng:

1. Mỗi TKQC có dropdown nguồn tiền ngay trong danh sách.
2. Chọn nguồn tiền rồi bấm **Gắn nguồn tiền** / **Cập nhật nguồn**.
3. Frontend gọi action `adAccountSetFundingSource`.
4. Backend tìm TKQC theo `id`, `metaAccountId`, hoặc `accountId`.
5. Backend patch atomically đúng `bankId`, bật `manualBankOverride=true`, và ghi về PostgreSQL.
6. Meta API tiếp tục cập nhật balance/thẻ/billing nhưng không ghi đè nguồn tiền đã gắn thủ công.

## Trường hợp nguồn tiền mới tạo chưa có trên cloud

Frontend gửi thêm `bankSnapshot`. Nếu `bankId` chưa tồn tại ở workspace cloud nhưng snapshot hợp lệ, backend sẽ upsert nguồn tiền đó và gắn cho TKQC trong cùng transaction. Vì vậy không cần chờ autosave trước khi gắn nguồn tiền.

## Modal Sửa vẫn hoạt động

Modal Sửa vẫn hỗ trợ tên, Account ID, nguồn tiền và ngưỡng. Payload hiện gửi thêm `bankSnapshot` nên thao tác lưu từ modal cũng không còn phụ thuộc việc nguồn tiền đã được autosave trước đó.

## Deploy

Không cần migration database. Deploy lại source lên Vercel, sau đó hard refresh trình duyệt (`Ctrl+Shift+R` hoặc `Cmd+Shift+R`).
