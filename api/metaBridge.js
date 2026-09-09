"use strict";

module.exports = async function metaBridgeEntry(req, res) {
  try {
    const runtime = require("../server/meta-runtime");
    if (!runtime || typeof runtime.metaBridge !== "function") {
      const error = new Error("Meta runtime không export metaBridge.");
      error.code = "META_RUNTIME_EXPORT_MISSING";
      throw error;
    }
    return await runtime.metaBridge(req, res);
  } catch (error) {
    console.error("metaBridge entry init/runtime error", error);
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
        : (error?.message || "Không khởi tạo được Meta API runtime."),
      code: missingModule ? "META_DEPENDENCY_MISSING" : (error?.code || "META_RUNTIME_INIT_ERROR"),
      diagnostic: {
        node: process.version,
        databaseConfigured: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL),
        encryptionKeyConfigured: Boolean(process.env.APP_ENCRYPTION_KEY || process.env.OUTLOOK_TOKEN_KEY),
        webAppBaseUrlConfigured: Boolean(process.env.WEB_APP_BASE_URL),
      },
    };
    if (typeof res.json === "function") return res.json(payload);
    if (typeof res.end === "function") return res.end(JSON.stringify(payload));
  }
};
