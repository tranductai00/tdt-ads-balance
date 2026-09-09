"use strict";

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { getStore } = require("./server/store");
const runtime = require("./server/meta-runtime");
const googleSheets = require("./server/google-sheets");
const db = getStore();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const STARTED_AT = new Date().toISOString();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

function safeEqualText(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}
function cronAuthorized(req) {
  const expected = String(process.env.CRON_SECRET || "").trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const header = String(req.headers["x-cron-secret"] || "").trim();
  return safeEqualText(auth, expected) || safeEqualText(header, expected);
}
async function withDistributedLock(name, ttlMs, task) {
  const ref = db.collection("t_balance_runtime_locks").doc(name);
  const now = Date.now();
  const owner = `${process.env.VERCEL_REGION || "node"}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;
  const acquired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (Number(snap.data()?.lockedUntilMs || 0) > now) return false;
    tx.set(ref, { owner, lockedAtMs: now, lockedUntilMs: now + ttlMs }, { merge: true });
    return true;
  });
  if (!acquired) return { ok: true, skipped: true, reason: "already_running" };
  try {
    const started = Date.now();
    await task();
    return { ok: true, skipped: false, elapsedMs: Date.now() - started };
  } finally {
    try { await ref.set({ owner: "", lockedUntilMs: 0, releasedAtMs: Date.now() }, { merge: true }); } catch {}
  }
}
function jobRoute(name, ttlMs, task) {
  return async (req, res) => {
    if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized cron request" });
    try {
      const result = await withDistributedLock(name, ttlMs, task);
      return res.status(200).json({ job: name, ...result, at: new Date().toISOString() });
    } catch (error) {
      return res.status(500).json({ ok: false, job: name, error: error?.message || String(error) });
    }
  };
}


app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const errorText = String(req.query.error_description || req.query.error || "");
    if (errorText) throw new Error(errorText);
    if (!code || !state) throw new Error("Google OAuth callback thiếu code/state.");
    const result = await googleSheets.exchangeCallback(code, state);
    const redirect = new URL(result.returnUrl || "/?section=google", `${req.protocol}://${req.get("host")}`);
    redirect.searchParams.set("google", "connected");
    if (result.email) redirect.searchParams.set("email", result.email);
    return res.redirect(302, redirect.toString());
  } catch (error) {
    const redirect = new URL("/?section=google", `${req.protocol}://${req.get("host")}`);
    redirect.searchParams.set("google", "error");
    redirect.searchParams.set("message", String(error?.message || error).slice(0, 300));
    return res.redirect(302, redirect.toString());
  }
});

// Meta-only API. Outlook and AdsCheck endpoints were intentionally removed.
app.all(["/metaBridge", "/api/metaBridge"], runtime.metaBridge);
app.all(["/outlookBridge", "/outlookOAuthCallback", "/outlookWebhook", "/adscheck"], (_req, res) => {
  res.status(410).json({ ok: false, code: "FEATURE_REMOVED_META_ONLY", error: "Outlook và AdsCheck đã được loại bỏ. Hãy sử dụng Meta API." });
});
app.all(/^\/adscheck\/.*/, (_req, res) => {
  res.status(410).json({ ok: false, code: "FEATURE_REMOVED_META_ONLY", error: "AdsCheck đã được loại bỏ. Hãy sử dụng Meta API." });
});
app.all("/cron/meta-accounts", jobRoute("metaAdsAutoSync", 10 * 60_000, runtime.metaAdsAutoSync));
app.all("/cron/meta-billing", jobRoute("metaBillingAutoSync", 10 * 60_000, runtime.metaBillingAutoSync));

app.get("/healthz", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  let database = { ok: false, error: "DATABASE_URL chưa cấu hình" };
  try { database = await db.healthCheck(); }
  catch (error) { database = { ok: false, error: error?.message || String(error), code: error?.code || "" }; }
  const ok = database.ok === true;
  res.status(ok ? 200 : 503).json({
    ok,
    service: "T Balance v7.1 Meta + Google Sheets",
    startedAt: STARTED_AT,
    node: process.version,
    storage: "postgresql",
    database,
    integrations: { metaGraphApi: true, googleSheets: true, outlook: false, adscheck: false },
    config: {
      databaseUrl: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL),
      appEncryptionKey: Boolean(process.env.APP_ENCRYPTION_KEY || process.env.OUTLOOK_TOKEN_KEY),
      cronSecret: Boolean(process.env.CRON_SECRET),
    },
  });
});

const staticOptions = {
  etag: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (/\.(?:html|js|css)$/i.test(filePath)) res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  },
};
function sendUiFile(fileName) {
  return (_req, res, next) => res.sendFile(path.join(PUBLIC_DIR, fileName), (error) => error && next(error));
}
app.get(["/", "/index.html"], sendUiFile("index.html"));
app.get(["/meta", "/meta/"], sendUiFile("index.html"));
app.get(["/sodu", "/sodu/"], sendUiFile(path.join("sodu", "index.html")));
app.use(express.static(PUBLIC_DIR, staticOptions));
app.use((req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) return next();
  if (req.path.startsWith("/cron/") || req.path.startsWith("/api/") || req.path === "/metaBridge") return next();
  if (req.accepts("html")) return sendUiFile("index.html")(req, res, next);
  return next();
});

if (require.main === module) app.listen(PORT, "0.0.0.0", () => console.log(`T Balance Meta-only listening on :${PORT}`));
module.exports = app;
