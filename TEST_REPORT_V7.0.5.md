# Test Report — T Balance v7.0.5

- `npm test`: PASS
- `npm run check`: PASS
- Meta Billing parser: PASS
- Meta auto-import TKQC: PASS
- Manual edit TKQC: PASS
- Direct funding-source attach: PASS
- Direct funding-source detach: PASS
- Resolve TKQC by stable `metaAccountId`: PASS
- Upsert `bankSnapshot` when source is not yet on cloud: PASS
- `manualBankOverride=true` after attach/detach: PASS
- Inline JS syntax `sodu.html`: PASS
- Inline JS syntax `public/index.html`: PASS
- Inline JS syntax `public/sodu/index.html`: PASS
- UI mirrors byte-identical: PASS

The test suite intentionally invokes some error-path diagnostics without a real DATABASE_URL; those diagnostics are expected and do not indicate a failed test.
