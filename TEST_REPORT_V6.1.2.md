# TEST REPORT v6.1.2

- `npm run check`: PASS
- `npm test`: PASS
- Meta Billing parser: PASS
- Bill parser EN/VI: PASS
- 3 UI mirrors (`/`, `/adscheck`, `/sodu`): identical PASS
- Frontend sends `clientType=web`: PASS
- Backend same-origin web recovery path present in `deviceStatus` and `ensureWorkspaceKey`: PASS
- Strict pairing override `DEVICE_PAIRING_REQUIRED=true`: present PASS
- Revoked device safeguard (`revokedKeyHashes`): present PASS
