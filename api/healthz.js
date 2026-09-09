"use strict";

module.exports = async function healthz(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, route: "api/healthz", runtime: "vercel-node" });
};
