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

// v6.1.6: Meta đôi khi trả amount trong new_value không có nhãn amount.
const genericNewValue = hooks.normalizeMetaBillingActivity(
  { accountId: "777888999", name: "TKQC new_value", currency: "VND" },
  { event_type: "ad_account_billing_charge", event_time: Math.floor(Date.now()/1000), extra_data: { new_value: "650000" } },
);
assert.equal(genericNewValue.amount, 650000);
assert.equal(genericNewValue.amountConfidence, "medium");
assert.ok(/new_value/.test(genericNewValue.amountSourceKey));

const loosePairs = hooks.normalizeMetaBillingActivity(
  { accountId: "888999000", currency: "VND" },
  { event_type: "ad_account_billing_charge", event_time: Math.floor(Date.now()/1000), extra_data: "amount: 1.250.000 VND; currency: VND; payment_id: PAY-1" },
);
assert.equal(loosePairs.amount, 1250000);
assert.equal(loosePairs.currency, "VND");

const htmlEncoded = hooks.normalizeMetaBillingActivity(
  { accountId: "999000111", currency: "VND" },
  { event_type: "ad_account_billing_charge", event_time: Math.floor(Date.now()/1000), extra_data: "{&quot;payment_amount&quot;:&quot;750000 VND&quot;,&quot;transaction_id&quot;:&quot;HTML-1&quot;}" },
);
assert.equal(htmlEncoded.amount, 750000);
assert.equal(htmlEncoded.txId, "HTML-1");

const recoveryCtx = { candidates: [
  { key: "tx:abc", kind: "outlook_transaction", accountId: "12345", amount: 900000, atMs: 1_000_000, txId: "TX-OUT", transactionId: "internal-1", alreadyApplied: true },
] };
const recovered = hooks.findMetaBillingRelatedAmount({ accountId: "12345", eventTimeMs: 1_120_000, txId: "TX-OUT", reference: "" }, recoveryCtx, new Set());
assert(recovered);
assert.equal(recovered.amount, 900000);
assert.equal(recovered.alreadyApplied, true);
assert.equal(recovered.confidence, "high");

const snapshotEvents = [{ accountId: "22222", eventTimeMs: 2_100_000, isSuccessfulCharge: true, amount: 0, currency: "VND" }];
const nextSnapshots = hooks.applyMetaBillingSnapshotRecovery(snapshotEvents, {
  metaBillingAccountSnapshots: { "22222": { balance: 500000, amountSpent: 1000000, currency: "VND", capturedAtMs: 2_000_000 } },
}, [{ accountId: "22222", balance: 100000, amountSpent: 1200000, currency: "VND" }], 2_200_000);
assert.equal(snapshotEvents[0].amount, 600000); // 500k + 200k spend - 100k current balance
assert.equal(snapshotEvents[0].amountConfidence, "estimated");
assert.equal(snapshotEvents[0].amountSourceKey, "balance_delta");
assert.equal(nextSnapshots["22222"].balance, 100000);

const thresholdEvent = { accountId: "33333", isSuccessfulCharge: true, amount: 0 };
const thresholdApplied = hooks.applyMetaBillingThresholdEstimate(thresholdEvent, { payload: { adAccounts: [{ accountId: "33333", threshold: 800000 }] } });
assert.equal(thresholdApplied, true);
assert.equal(thresholdEvent.amount, 800000);
assert.equal(thresholdEvent.amountConfidence, "estimated");
assert.equal(thresholdEvent.amountSourceKey, "payment_threshold");

console.log("PASS Meta Billing v6.1.6 amount recovery engine");
