# TEST REPORT v6.1.4

- `npm run check`: PASS
- `server.js`: syntax PASS
- `server/outlook-runtime.js`: syntax PASS
- `api/outlookBridge.js`: syntax PASS
- `api/outlookOAuthCallback.js`: syntax PASS
- `api/outlookWebhook.js`: syntax PASS
- `api/healthz.js`: syntax PASS
- Vercel rewrite `/outlookBridge -> /api/outlookBridge`: PASS
- Vercel rewrite `/outlookOAuthCallback -> /api/outlookOAuthCallback`: PASS
- Vercel rewrite `/outlookWebhook -> /api/outlookWebhook`: PASS
- Frontend bridge endpoint `/api/outlookBridge`: PASS
- UI mirrors `/`, `/adscheck`, `/sodu`: identical PASS
- `sodu.html` mirror: identical PASS
- No `cloudfunctions.net` runtime endpoint in UI: PASS

Note: full production invocation requires the user's Vercel environment variables and PostgreSQL/Neon database, which are not available in the build environment.
