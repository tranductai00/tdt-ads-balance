"use strict";

module.exports = async function outlookWebhookEntry(req, res) {
  try {
    const runtime = require("../server/outlook-runtime");
    if (!runtime || typeof runtime.outlookWebhook !== "function") throw Object.assign(new Error("Outlook runtime không export outlookWebhook."), { code: "OUTLOOK_RUNTIME_EXPORT_MISSING" });
    return await runtime.outlookWebhook(req, res);
  } catch (error) {
    console.error("outlookWebhook entry init/runtime error", error);
    res.statusCode = 500;
    if (typeof res.setHeader === "function") res.setHeader("Content-Type", "application/json; charset=utf-8");
    const payload = { ok: false, error: error?.message || "Không khởi tạo được Outlook Webhook.", code: error?.code || "OUTLOOK_RUNTIME_INIT_ERROR" };
    if (typeof res.json === "function") return res.json(payload);
    if (typeof res.end === "function") return res.end(JSON.stringify(payload));
  }
};
