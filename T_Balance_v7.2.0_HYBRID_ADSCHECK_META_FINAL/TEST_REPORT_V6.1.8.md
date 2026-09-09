# TEST REPORT v6.1.8

- Syntax backend/API/extensions: PASS (`npm run check`)
- Existing Meta billing parser tests: PASS
- Facebook Billing Tool mapping `ad_account_billing_charge + type=payment_amount + action=67 + new_value`: PASS
- Sample payload `new_value=116651 VND`: PASS, confidence=high
- `transaction_id` extraction: PASS
- Billing PDF link generation: PASS
- Manual full-lookback backfill: PASS
- One-time parser revision backfill after upgrade: PASS
- Auto cursor mode after parser revision 8: PASS
- Old `parse_error` with existing transaction ID retry: PASS
- Outlook billing parser EN/VI: PASS
- UI mirrors `/`, `/adscheck`, `/sodu`: checked identical after patch
