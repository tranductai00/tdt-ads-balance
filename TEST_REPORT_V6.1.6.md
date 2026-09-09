# TEST REPORT v6.1.6

## Meta Billing Amount Recovery

- `extra_data.amount` VND/USD: PASS
- `new_value: "650000"` trong `ad_account_billing_charge`: PASS
- Nested JSON: PASS
- URL/HTML encoded JSON: PASS
- Loose `amount: ...; currency: ...`: PASS
- `translated_event_type` có currency: PASS
- Outlook transaction exact-reference recovery: PASS
- Balance delta inference (VND): PASS
- Payment threshold estimate: PASS
- Retry `parse_error / recovered / estimated`: PASS
- Funding/failed event không auto-deduct: PASS

## Regression

- `npm test`: PASS
- `npm run check`: PASS
- Outlook Bridge Vercel explicit route: giữ nguyên từ v6.1.5
- Meta selected-account filtering: giữ nguyên từ v6.1.3
- `/`, `/adscheck`, `/sodu`: cùng một UI source
