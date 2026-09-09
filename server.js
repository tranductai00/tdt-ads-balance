"use strict";

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { getStore } = require("./server/store");
const runtime = require("./server/outlook-runtime");
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
  const owner = `${process.env.VERCEL_REGION || process.env.KOYEB_REGION || process.env.RENDER || "node"}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;
  const acquired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const lockedUntilMs = Number(snap.data()?.lockedUntilMs || 0);
    if (lockedUntilMs > now) return false;
    tx.set(ref, { owner, lockedAtMs: now, lockedUntilMs: now + ttlMs }, { merge: true });
    return true;
  });
  if (!acquired) return { ok: true, skipped: true, reason: "already_running" };
  try {
    const started = Date.now();
    await task();
    return { ok: true, skipped: false, elapsedMs: Date.now() - started };
  } finally {
    try {
      await ref.set({ owner: "", lockedUntilMs: 0, releasedAtMs: Date.now() }, { merge: true });
    } catch (error) {
      console.error("Không giải phóng được runtime lock", name, error?.message || error);
    }
  }
}

function jobRoute(name, ttlMs, task) {
  return async (req, res) => {
    if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized cron request" });
    try {
      const result = await withDistributedLock(name, ttlMs, task);
      return res.status(200).json({ job: name, ...result, at: new Date().toISOString() });
    } catch (error) {
      console.error(`Cron ${name} lỗi:`, error);
      return res.status(500).json({ ok: false, job: name, error: error?.message || String(error) });
    }
  };
}

// Outlook HTTP routes. Keep both the legacy public paths and explicit /api
// aliases so local Node, Vercel Express auto-detection and Vercel API Functions
// all resolve the same handlers without platform-level 404s.
app.all(["/outlookBridge", "/api/outlookBridge"], runtime.outlookBridge);
app.all(["/outlookOAuthCallback", "/api/outlookOAuthCallback"], runtime.outlookOAuthCallback);
app.all(["/outlookWebhook", "/api/outlookWebhook"], runtime.outlookWebhook);

// Protected cron routes. Use cron-job.org / GitHub Actions / a real VPS cron.
app.all("/cron/balance", jobRoute("balanceNotificationPoller", 3 * 60_000, runtime.balanceNotificationPoller));
app.all("/cron/meta", jobRoute("metaAdsAutoSync", 10 * 60_000, runtime.metaAdsAutoSync));
app.all("/cron/meta-billing", jobRoute("metaBillingAutoSync", 10 * 60_000, runtime.metaBillingAutoSync));
app.all("/cron/outlook-scan", jobRoute("outlookAutoScanNewMail", 10 * 60_000, runtime.outlookAutoScanNewMail));
app.all("/cron/outlook-renew", jobRoute("outlookRenewSubscriptions", 30 * 60_000, runtime.outlookRenewSubscriptions));

app.get("/healthz", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  let database = { ok: false, error: "DATABASE_URL chưa cấu hình" };
  try { database = await db.healthCheck(); }
  catch (error) { database = { ok: false, error: error?.message || String(error), code: error?.code || "" }; }
  const ok = database.ok === true;
  res.status(ok ? 200 : 503).json({
    ok,
    service: "T Balance v6.1.4 Outlook Bridge 404 Fix",
    startedAt: STARTED_AT,
    node: process.version,
    storage: "postgresql",
    database,
    config: {
      databaseUrl: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL),
      msClientId: Boolean(process.env.MS_CLIENT_ID),
      msClientSecret: Boolean(process.env.MS_CLIENT_SECRET),
      appEncryptionKey: Boolean(process.env.APP_ENCRYPTION_KEY || process.env.OUTLOOK_TOKEN_KEY),
      outlookTokenKey: Boolean(process.env.OUTLOOK_TOKEN_KEY),
      vapidPublicKey: Boolean(process.env.VAPID_PUBLIC_KEY),
      vapidPrivateKey: Boolean(process.env.VAPID_PRIVATE_KEY),
      cronSecret: Boolean(process.env.CRON_SECRET),
    },
  });
});

// Serve the web UI in every environment, including Vercel.
// Vercel routes requests to this Express app, so `/` must be handled here too.
const staticOptions = {
  etag: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (/\.(?:html|js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  },
};

function sendUiFile(fileName) {
  return (_req, res, next) => {
    res.sendFile(path.join(PUBLIC_DIR, fileName), (error) => {
      if (error) next(error);
    });
  };
}

// Explicit page routes prevent `Cannot GET /` on Vercel.
app.get(["/", "/index.html"], sendUiFile("index.html"));
app.get(["/adscheck", "/adscheck/"], sendUiFile(path.join("adscheck", "index.html")));
app.get(["/sodu", "/sodu/"], sendUiFile(path.join("sodu", "index.html")));

// Static assets (service worker, extension ZIPs, etc.) are also available
// through Express. This is safe on Vercel and makes local/Vercel behavior match.
app.use(express.static(PUBLIC_DIR, staticOptions));

// Friendly 404 for API-like routes; unknown browser routes fall back to the UI.
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/cron/") || req.path.startsWith("/outlook")) return next();
  if (req.accepts("html")) return sendUiFile("index.html")(req, res, next);
  return next();
});

function localTimeParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

const schedulerState = { minute: "", five: "", daily: "" };
async function internalSchedulerTick() {
  const t = localTimeParts();
  const minuteKey = `${t.year}-${t.month}-${t.day}T${t.hour}:${t.minute}`;
  if (schedulerState.minute !== minuteKey) {
    schedulerState.minute = minuteKey;
    withDistributedLock("balanceNotificationPoller", 3 * 60_000, runtime.balanceNotificationPoller).catch((e) => console.error("balance poller", e));
  }
  if (Number(t.minute) % 5 === 0) {
    const fiveKey = `${t.year}-${t.month}-${t.day}T${t.hour}:${Math.floor(Number(t.minute) / 5)}`;
    if (schedulerState.five !== fiveKey) {
      schedulerState.five = fiveKey;
      withDistributedLock("metaAdsAutoSync", 10 * 60_000, runtime.metaAdsAutoSync).catch((e) => console.error("meta sync", e));
      withDistributedLock("metaBillingAutoSync", 10 * 60_000, runtime.metaBillingAutoSync).catch((e) => console.error("meta billing sync", e));
      withDistributedLock("outlookAutoScanNewMail", 10 * 60_000, runtime.outlookAutoScanNewMail).catch((e) => console.error("outlook scan", e));
    }
  }
  if (t.hour === "03" && Number(t.minute) >= 15 && Number(t.minute) < 20) {
    const dailyKey = `${t.year}-${t.month}-${t.day}`;
    if (schedulerState.daily !== dailyKey) {
      schedulerState.daily = dailyKey;
      withDistributedLock("outlookRenewSubscriptions", 30 * 60_000, runtime.outlookRenewSubscriptions).catch((e) => console.error("outlook renew", e));
    }
  }
}

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const internalSchedulerEnabled = String(process.env.ENABLE_INTERNAL_SCHEDULER || "").toLowerCase() === "true" && !isServerless;
if (internalSchedulerEnabled) {
  setTimeout(() => internalSchedulerTick().catch(console.error), 2000);
  setInterval(() => internalSchedulerTick().catch(console.error), 30_000).unref();
  console.log("Internal scheduler: ENABLED");
}

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => console.log(`T Balance listening on :${PORT}`));
}

module.exports = app;
