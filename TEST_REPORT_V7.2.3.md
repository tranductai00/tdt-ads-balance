# Test Report v7.2.3

Ngày kiểm tra: 2026-09-15

## Kết quả

- `npm run check`: PASS.
- `npm test`: PASS (exit code 0).
- `node --check extension_adscheck_v6/background.js`: PASS.
- `node --check extension_adscheck_v6/content.js`: PASS.
- `node --check extension_adscheck_v6/popup.js`: PASS.

## Regression coverage liên quan fix

- Meta Billing parser / encryption fallback: PASS.
- Amount recovery / payment_amount / FBT mapping: PASS.
- Backfill revision v9 + cursor overlap 60 phút: PASS.
- Lookback normalize 7–30 ngày: PASS.
- Meta activity timestamp seconds/milliseconds/ISO: PASS.
- Manual ad edit / funding source / card fee: PASS.
- Meta bridge scope / full billing info / Google Sheets: PASS.

Lưu ý: `tests/test_meta_bridge_scope.js` chủ động kích hoạt các nhánh lỗi `Workspace không hợp lệ` và `DATABASE_URL_REQUIRED` để kiểm tra error handling; test vẫn kết thúc exit code 0 theo thiết kế.
