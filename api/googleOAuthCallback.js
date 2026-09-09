"use strict";
const googleSheets = require("../server/google-sheets");
module.exports = async function googleOAuthCallback(req, res) {
  try {
    const code = String(req.query?.code || "");
    const state = String(req.query?.state || "");
    const oauthError = String(req.query?.error_description || req.query?.error || "");
    if (oauthError) throw new Error(oauthError);
    if (!code || !state) throw new Error("Google OAuth callback thiếu code/state.");
    const result = await googleSheets.exchangeCallback(code, state);
    const base = String(process.env.WEB_APP_BASE_URL || `https://${req.headers.host || "localhost"}`).replace(/\/+$/, "");
    const redirect = new URL(result.returnUrl || "/?section=google", base);
    redirect.searchParams.set("google", "connected");
    if (result.email) redirect.searchParams.set("email", result.email);
    res.statusCode = 302;
    res.setHeader("Location", redirect.toString());
    return res.end();
  } catch (error) {
    const base = String(process.env.WEB_APP_BASE_URL || `https://${req.headers.host || "localhost"}`).replace(/\/+$/, "");
    const redirect = new URL("/?section=google", base);
    redirect.searchParams.set("google", "error");
    redirect.searchParams.set("message", String(error?.message || error).slice(0, 300));
    res.statusCode = 302;
    res.setHeader("Location", redirect.toString());
    return res.end();
  }
};
