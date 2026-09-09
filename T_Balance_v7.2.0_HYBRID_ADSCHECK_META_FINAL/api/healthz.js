"use strict";
function canResolve(name) { try { require.resolve(name); return true; } catch { return false; } }
module.exports = async function healthz(_req, res) {
  const payload = {
    ok: true,
    service: "T Balance v7.1 Meta + Google Sheets",
    route: "api/healthz",
    runtime: "vercel-node",
    node: process.version,
    dependencies: { pg: canResolve("pg") },
    config: {
      databaseUrl: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL),
      appEncryptionKey: Boolean(process.env.APP_ENCRYPTION_KEY || process.env.OUTLOOK_TOKEN_KEY),
      webAppBaseUrl: Boolean(process.env.WEB_APP_BASE_URL),
      cronSecret: Boolean(process.env.CRON_SECRET),
    },
    integrations: { metaGraphApi: true, googleSheets: true, outlook: false, adscheck: false },
  };
  res.statusCode = 200;
  res.setHeader?.("Content-Type", "application/json; charset=utf-8");
  res.setHeader?.("Cache-Control", "no-store");
  if (typeof res.json === "function") return res.json(payload);
  return res.end?.(JSON.stringify(payload));
};
