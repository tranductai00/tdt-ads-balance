# TEST REPORT v7.0.3

- `npm test`: PASS
- `npm run check`: PASS
- Inline JS `sodu.html`: PASS
- Inline JS `public/index.html`: PASS
- Inline JS `public/sodu/index.html`: PASS
- Manual edit by internal `id`: PASS
- Manual edit fallback by stable `metaAccountId`: PASS
- Manual name/bank/threshold override: PASS
- Funding source validation (empty bank): PASS
- Funding source validation (missing bank ID): PASS
- Funding source validation (existing bank): PASS
- `pending_source` retry rule: PASS
- Meta Billing parser / FBT-compatible amount: PASS
- Meta-only auto import accounts: PASS
- metaBridge workspace/syncKey/deviceName scope regression: PASS

Note: scope regression test intentionally exercises invalid workspace / missing DATABASE_URL branches; those diagnostic errors are expected and the test exits PASS.
