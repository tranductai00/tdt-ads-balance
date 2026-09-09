# TEST REPORT — v7.1.1

- `npm run check`: PASS
- `npm test`: PASS
- Meta bill `116651` + fee `3%` => fee `3500`, total `120151`: PASS
- `deductionMode=exact` vẫn không cộng fee: PASS
- Số dư ngân hàng ưu tiên `bankIdSnapshot` của transaction lịch sử: PASS
- Đổi nguồn tiền TKQC không làm bill cũ chuyển sang ngân hàng mới: PASS
- Meta Billing parser / payment_amount action 67: PASS
- Manual ad edit / funding source attach: PASS
- Google Sheets mapping/baseline helpers: PASS
