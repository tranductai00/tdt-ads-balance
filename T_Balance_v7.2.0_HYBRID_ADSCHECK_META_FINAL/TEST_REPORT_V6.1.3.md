# TEST REPORT — T Balance v6.1.3

Các kiểm tra bắt buộc:

- Node syntax backend/server: PASS
- Meta Billing amount `charge_amount: "1.234.567 VND"`: PASS
- Meta Billing amount `amount: 500000` dạng số: PASS, confidence=high
- Meta Billing JSON lồng `new_value -> payment -> amount`: PASS
- Meta Billing amount từ `translated_event_type`: PASS
- Billing failed/funding event không tự trừ: PASS
- Meta Billing selection config normalize + dedupe Account ID: PASS
- Inline JavaScript của UI: PASS
- UI có selection mode/search/select all/select none: PASS
- Existing tests Billing Extension EN/VI: PASS
- Firebase runtime dependency: không thêm lại

Lưu ý: API live phụ thuộc Access Token/quyền thực tế của tài khoản Meta nên không được gọi trong test offline.
