"use strict";

// Vercel explicit Function entry point.
// Lazy-load the Outlook runtime inside the request so module/dependency/config
// initialization failures are returned as JSON instead of a generic HTTP 500.
module.exports = async function outlookBridgeEntry(req, res) {
  try {
    const runtime = require("../server/outlook-runtime");
    if (!runtime || typeof runtime.outlookBridge !== "function") {
      const error = new Error("Outlook runtime không export outlookBridge.");
      error.code = "OUTLOOK_RUNTIME_EXPORT_MISSING";
      throw error;
    }
    return await runtime.outlookBridge(req, res);
  } catch (error) {
    console.error("outlookBridge entry init/runtime error", error);
    const status = Number(error?.status || 500);
    res.statusCode = status >= 400 && status <= 599 ? status : 500;
    if (typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
    }
    const missingModule = error?.code === "MODULE_NOT_FOUND";
    const payload = {
      ok: false,
      error: missingModule
        ? `Thiếu dependency backend trên Vercel: ${String(error?.message || "MODULE_NOT_FOUND").split("\n")[0]}. Hãy Redeploy từ thư mục có package.json.`
        : (error?.message || "Không khởi tạo được Outlook Bridge runtime."),
      code: missingModule ? "OUTLOOK_DEPENDENCY_MISSING" : (error?.code || "OUTLOOK_RUNTIME_INIT_ERROR"),
      diagnostic: {
        node: process.version,
        databaseConfigured: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL),
        encryptionKeyConfigured: Boolean(process.env.APP_ENCRYPTION_KEY || process.env.OUTLOOK_TOKEN_KEY),
        msClientIdConfigured: Boolean(process.env.MS_CLIENT_ID),
        msClientSecretConfigured: Boolean(process.env.MS_CLIENT_SECRET),
      },
    };
    if (typeof res.json === "function") return res.json(payload);
    if (typeof res.end === "function") return res.end(JSON.stringify(payload));
  }
};
