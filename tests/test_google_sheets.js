"use strict";
const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "pg") return { Pool: class Pool {} };
  return originalLoad.call(this, request, parent, isMain);
};
process.env.NODE_ENV = "test";
const gs = require("../server/google-sheets");
assert.equal(gs.extractSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz123456789/edit#gid=0"), "1AbCdEfGhIjKlMnOpQrStUvWxYz123456789");
assert.equal(gs.billingDateToHeader("2026-09-09"), "09/09");
assert.equal(gs.eventBillingDate("2026-09-09T05:00:00.000Z", "Asia/Ho_Chi_Minh"), "2026-09-09");
assert.equal(gs.eventBillingDate("2026-09-08T18:30:00.000Z", "Asia/Ho_Chi_Minh"), "2026-09-09");

assert.deepEqual(gs.computeSheetTotals({ current: 100000, eventTotal: 20000, alreadySyncedTotal: 0, baselineInitialized: false }), { baseline: 100000, total: 120000 });
assert.deepEqual(gs.computeSheetTotals({ current: 120000, eventTotal: 20000, alreadySyncedTotal: 20000, baselineInitialized: false }), { baseline: 100000, total: 120000 });
assert.deepEqual(gs.computeSheetTotals({ eventTotal: 150000, autoEventTotal: 50000, rewriteExact: true }), { baseline: 100000, total: 150000 });
console.log("PASS v7.1.0 Google Sheets mapping + baseline helpers");
