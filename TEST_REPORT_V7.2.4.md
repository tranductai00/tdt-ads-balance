# TEST REPORT v7.2.4 — Bridge timeout / Meta Billing duplicate-sync protection

Ngày kiểm tra: 15/09/2026

## Kết quả

- `npm run check`: **PASS**
- `node --check server/outlook-runtime.js`: **PASS**
- `npm test`: **PASS**
- Regression test `tests/test_bridge_timeout_fix.js`: **PASS**
- Inline JavaScript syntax:
  - `public/index.html`: **PASS**
  - `public/sodu/index.html`: **PASS**
  - `public/adscheck/index.html`: **PASS**
  - `sodu.html`: **PASS**

## Các case được khóa regression

- Không còn browser abort cố định ở `22.000 ms` cho Meta Bridge.
- `metaBillingSync` dùng timeout client 250 giây và chỉ 1 attempt.
- Backend `metaBridge` cho phép runtime 240 giây.
- Vercel `/api/metaBridge` và `/api/outlookBridge` có `maxDuration: 300`.
- Có server-side Meta Billing sync lease và mã lỗi `META_BILLING_SYNC_IN_PROGRESS` để chặn job trùng.

## Ghi chú test

`tests/test_meta_bridge_scope.js` cố ý gọi các case lỗi workspace/database để kiểm tra scope/error path, vì vậy console có thể in dòng `metaBridge Error` trong khi test vẫn PASS. Đây là output expected của regression test, không phải lỗi build.
