"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const web = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const runtime = fs.readFileSync(path.join(root, "server", "meta-runtime.js"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

assert(!web.includes("setTimeout(() => controller.abort(), 22000)"), "22s browser abort must be removed");
assert(web.includes('if (name === "metaBillingSync") return { timeoutMs: 250000, maxAttempts: 1 };'), "Meta Billing must use long single-attempt request policy");
assert(runtime.includes("timeoutSeconds: 240"), "Meta bridge runtime timeout must allow long billing scans");
assert(runtime.includes("META_BILLING_SYNC_LEASE_MS"), "Meta Billing must use a server-side sync lease");
assert(runtime.includes('error.code = "META_BILLING_SYNC_IN_PROGRESS"'), "Concurrent billing requests must be rejected explicitly");
assert.strictEqual(vercel.functions?.["api/metaBridge.js"]?.maxDuration, 300, "Vercel metaBridge maxDuration must be 300s");
assert.strictEqual(vercel.functions?.["api/outlookBridge.js"]?.maxDuration, 300, "Vercel legacy bridge maxDuration must be 300s");

console.log("PASS v7.2.4 bridge timeout + duplicate-sync protection");
