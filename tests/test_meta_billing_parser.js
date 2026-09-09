"use strict";
const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "web-push") return { setVapidDetails() {}, async sendNotification() {} };
  if (request === "pg") return { Pool: class Pool {} };
  return originalLoad.call(this, request, parent, isMain);
};
process.env.NODE_ENV = "test";
const runtime = require("../server/outlook-runtime");
const hooks = runtime.__metaBillingTestHooks;
assert(hooks, "missing test hooks");

const vnd = hooks.normalizeMetaBillingActivity(
  { accountId: "123456789", name: "TKQC Test", currency: "VND" },
  {
    event_type: "ad_account_billing_charge",
    event_time: Math.floor(Date.now() / 1000),
    extra_data: JSON.stringify({ transaction_id: "TX-001", charge_amount: "1.234.567 VND", payment_method: "Visa •••• 6087" }),
  },
);
assert.equal(vnd.amount, 1234567);
assert.equal(vnd.currency, "VND");
assert.equal(vnd.txId, "TX-001");
assert.equal(vnd.cardLast4, "6087");
assert.equal(vnd.isSuccessfulCharge, true);
assert.ok(["high", "medium"].includes(vnd.amountConfidence));

const failed = hooks.normalizeMetaBillingActivity(
  { accountId: "987654321", name: "TKQC Failed", currency: "VND" },
  { event_type: "ad_account_billing_charge_failed", event_time: Math.floor(Date.now()/1000), extra_data: { amount: "500000 VND" } },
);
assert.equal(failed.isSuccessfulCharge, false);
assert.equal(failed.isBillingEvent, true);

const funding = hooks.normalizeMetaBillingActivity(
  { accountId: "555666777", name: "TKQC Funding", currency: "VND" },
  { event_type: "funding_event_successful", event_time: Math.floor(Date.now()/1000), extra_data: { amount: "900000 VND" } },
);
assert.equal(funding.isBillingEvent, true);
assert.equal(funding.isSuccessfulCharge, false, "funding event must never auto-deduct as a billing charge");

const usd = hooks.normalizeMetaBillingActivity(
  { accountId: "111222333", currency: "USD" },
  { event_type: "ad_account_billing_charge", event_time: Math.floor(Date.now()/1000), extra_data: { currency: "USD", payment_amount: "$12.34" } },
);
assert.equal(usd.currency, "USD");
assert.equal(usd.amount, 12.34);


const directAmount = hooks.normalizeMetaBillingActivity(
  { accountId: "222333444", name: "TKQC Direct Amount", currency: "VND" },
  { event_type: "ad_account_billing_charge", event_time: Math.floor(Date.now()/1000), extra_data: { amount: 500000, transaction_id: "TX-DIRECT" } },
);
assert.equal(directAmount.amount, 500000);
assert.equal(directAmount.amountConfidence, "high", "plain extra_data.amount must be trusted for a billing charge");

const nestedAmount = hooks.normalizeMetaBillingActivity(
  { accountId: "333444555", name: "TKQC Nested", currency: "VND" },
  { event_type: "ad_account_billing_charge", event_time: Math.floor(Date.now()/1000), extra_data: { new_value: JSON.stringify({ payment: { amount: "1.250.000 VND" } }) } },
);
assert.equal(nestedAmount.amount, 1250000);
assert.ok(["high", "medium"].includes(nestedAmount.amountConfidence));

const translatedAmount = hooks.normalizeMetaBillingActivity(
  { accountId: "444555666", name: "TKQC Translated", currency: "VND" },
  { event_type: "ad_account_billing_charge", event_time: Math.floor(Date.now()/1000), translated_event_type: "Tài khoản quảng cáo đã được tính phí 750.000 VND", extra_data: {} },
);
assert.equal(translatedAmount.amount, 750000);
assert.equal(translatedAmount.amountSourceKey, "translated_event_type");
assert.equal(translatedAmount.amountConfidence, "high");

const selectedCfg = hooks.normalizeMetaBillingConfig({ metaBillingSelectionMode: "selected", metaBillingSelectedAccountIds: ["act_123", "123", "456"] });
assert.equal(selectedCfg.selectionMode, "selected");
assert.deepEqual(selectedCfg.selectedAccountIds, ["123", "456"]);

assert.equal(hooks.shouldRetryMetaBillingEvent({ processed: true, status: "parse_error", transactionId: "" }, { isSuccessfulCharge: true }), true);
assert.equal(hooks.shouldRetryMetaBillingEvent({ processed: true, status: "auto_deducted", transactionId: "tx1" }, { isSuccessfulCharge: true }), false);

const cfg = hooks.normalizeMetaBillingConfig({ metaBillingSyncIntervalMinutes: 1, metaBillingLookbackDays: 99, metaBillingMaxAccountsPerRun: 500 });
assert.equal(cfg.syncIntervalMinutes, 5);
assert.equal(cfg.lookbackDays, 7);
assert.equal(cfg.maxAccountsPerRun, 100);


// Key rotation/backward-compatibility: dữ liệu mã hóa bằng OUTLOOK_TOKEN_KEY cũ
// vẫn giải mã được sau khi thêm APP_ENCRYPTION_KEY mới.
const oldKey = Buffer.alloc(32, 1).toString("base64");
const newKey = Buffer.alloc(32, 2).toString("base64");
process.env.APP_ENCRYPTION_KEY = "";
process.env.OUTLOOK_TOKEN_KEY = oldKey;
const legacyCipher = hooks.encryptSecret("legacy-outlook-token");
process.env.APP_ENCRYPTION_KEY = newKey;
assert.equal(hooks.decryptSecret(legacyCipher), "legacy-outlook-token");
const newCipher = hooks.encryptSecret("new-meta-token");
assert.equal(hooks.decryptSecret(newCipher), "new-meta-token");

console.log("PASS Meta Billing parser + encryption fallback");
