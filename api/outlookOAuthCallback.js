"use strict";

module.exports = async function outlookOAuthCallbackEntry(req, res) {
  try {
    const runtime = require("../server/outlook-runtime");
    if (!runtime || typeof runtime.outlookOAuthCallback !== "function") throw Object.assign(new Error("Outlook runtime không export outlookOAuthCallback."), { code: "OUTLOOK_RUNTIME_EXPORT_MISSING" });
    return await runtime.outlookOAuthCallback(req, res);
  } catch (error) {
    console.error("outlookOAuthCallback entry init/runtime error", error);
    res.statusCode = 500;
    if (typeof res.setHeader === "function") res.setHeader("Content-Type", "application/json; charset=utf-8");
    const payload = { ok: false, error: error?.message || "Không khởi tạo được Outlook OAuth callback.", code: error?.code || "OUTLOOK_RUNTIME_INIT_ERROR" };
    if (typeof res.json === "function") return res.json(payload);
    if (typeof res.end === "function") return res.end(JSON.stringify(payload));
  }
};
