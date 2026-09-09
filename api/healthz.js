"use strict";

function canResolve(name) {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

module.exports = async function healthz(_req, res) {
  const payload = {
    ok: true,
    route: "api/healthz",
    runtime: "vercel-node",
    node: process.version,
    dependencies: {
      pg: canResolve("pg"),
      webPush: canResolve("web-push"),
    },
    config: {
      databaseUrl: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL),
      appEncryptionKey: Boolean(process.env.APP_ENCRYPTION_KEY || process.env.OUTLOOK_TOKEN_KEY),
      msClientId: Boolean(process.env.MS_CLIENT_ID),
      msClientSecret: Boolean(process.env.MS_CLIENT_SECRET),
      webAppBaseUrl: Boolean(process.env.WEB_APP_BASE_URL),
      outlookPublicBaseUrl: Boolean(process.env.OUTLOOK_PUBLIC_BASE_URL),
    },
  };
  res.statusCode = 200;
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
  }
  if (typeof res.json === "function") return res.json(payload);
  if (typeof res.end === "function") return res.end(JSON.stringify(payload));
};
