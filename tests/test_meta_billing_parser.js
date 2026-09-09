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
const runtime = require("../server/meta-runtime");
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
assert.equal(hooks.shouldRetryMetaBillingEvent({ processed: true, status: "parse_error", transactionId: "META-OLD-1" }, { isSuccessfulCharge: true }), true, "parse_error with existing txId must still retry");

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

const typedPaymentAmount = hooks.normalizeMetaBillingActivity(
  { accountId: "1728828071611455", name: "Acc LA", currency: "VND" },
  { event_type: "ad_account_billing_charge", event_time: Math.floor(Date.now()/1000), extra_data: { type: "payment_amount", action: 67, currency: "VND", new_value: "116651", transaction_id: "28526254503727057-28472574245761751" } },
);
assert.equal(typedPaymentAmount.amount, 116651);
assert.equal(typedPaymentAmount.amountConfidence, "high");
assert.ok(/(?:^type:payment_amount\.|^facebook_billing_tool:payment_amount)/.test(typedPaymentAmount.amountSourceKey));
assert.equal(typedPaymentAmount.txId, "28526254503727057-28472574245761751");

console.log("PASS Meta Billing v6.1.7 payment_amount + retry fix");

// v6.1.8: Facebook Billing Tool-compatible mapping + manual backfill.
const fbtExact = hooks.normalizeMetaBillingActivity(
  { accountId: "1728828071611455", name: "Acc LA", currency: "VND" },
  {
    event_type: "ad_account_billing_charge",
    event_time: Math.floor(Date.now()/1000),
    extra_data: {
      type: "payment_amount",
      action: 67,
      currency: "VND",
      new_value: "116651",
      transaction_id: "28526254503727057-28472574245761751"
    }
  }
);
assert.equal(fbtExact.amount, 116651);
assert.equal(fbtExact.amountConfidence, "high");
assert.equal(fbtExact.amountSourceKey, "facebook_billing_tool:payment_amount/action_67/new_value");
assert.equal(fbtExact.billingType, "payment_amount");
assert.equal(fbtExact.billingAction, 67);
assert.ok(fbtExact.downloadInvoiceLink.includes("txid=28526254503727057-28472574245761751"));

const lookback = 1_000_000;
const cursor = 9_000_000;
assert.equal(hooks.resolveMetaBillingSinceMs({ reason: "manual", lookbackFloor: lookback, cursorMs: cursor, parserRevision: 8 }), lookback);
assert.equal(hooks.resolveMetaBillingSinceMs({ reason: "auto", lookbackFloor: lookback, cursorMs: cursor, parserRevision: 7 }), lookback);
assert.equal(hooks.resolveMetaBillingSinceMs({ reason: "auto", lookbackFloor: lookback, cursorMs: cursor, parserRevision: 8 }), cursor - 20*60*1000);

console.log("PASS Meta Billing v6.1.8 FBT-compatible parser + backfill");

// v6.1.9: manual ad-account edits must survive a newer AdsCheck/Billing scan.
const mergedManualAd = hooks.mergeConcurrentWorkspacePayload(
  {
    payload: {
      banks: [{ id: "bank-old", name: "Old bank" }],
      adAccounts: [{
        id: "smit_abc",
        name: "Tên từ scan",
        accountId: "1455001556459898",
        bankId: "bank-old",
        threshold: 52611,
        lastAdsCheckSyncAt: "2026-09-09T06:00:00.000Z",
        adsCheckBalance: 12904,
      }],
      transactions: [], settings: {},
    },
  },
  {
    banks: [{ id: "bank-new", name: "VPBANK - LA" }],
    adAccounts: [{
      id: "smit_abc",
      name: "TAI-BOOM ĐÃ SỬA",
      accountId: "1455001556459898",
      bankId: "bank-new",
      threshold: 60000,
      lastAdsCheckSyncAt: "2026-09-09T05:00:00.000Z",
      manualEditedAt: "2026-09-09T06:10:00.000Z",
      manualNameOverride: true,
      manualBankOverride: true,
      manualThresholdOverride: true,
    }],
    transactions: [], settings: {},
  },
);
assert.equal(mergedManualAd.adAccounts[0].name, "TAI-BOOM ĐÃ SỬA");
assert.equal(mergedManualAd.adAccounts[0].bankId, "bank-new");
assert.equal(mergedManualAd.adAccounts[0].threshold, 60000);
assert.equal(mergedManualAd.adAccounts[0].adsCheckBalance, 12904, "scan fields should still refresh");

const mergedAutoThreshold = hooks.mergeConcurrentWorkspacePayload(
  { payload: { banks: [], adAccounts: [{ id: "smit_xyz", accountId: "1067089695688330", threshold: 52611, lastAdsCheckSyncAt: "2026-09-09T06:00:00.000Z" }], transactions: [], settings: {} } },
  { banks: [], adAccounts: [{ id: "smit_xyz", accountId: "1067089695688330", threshold: 40000, lastAdsCheckSyncAt: "2026-09-09T05:00:00.000Z", manualThresholdOverride: false }], transactions: [], settings: {} },
);
assert.equal(mergedAutoThreshold.adAccounts[0].threshold, 52611, "automatic threshold should still follow newer scan when no manual override");

console.log("PASS v6.1.9 ad-account manual edit merge protection");

const payloadForImport = {
  banks: [{ id: "bank-1", name: "VPB" }],
  adAccounts: [{
    id: "existing-1",
    name: "Tên sửa tay",
    accountId: "999999",
    metaAccountId: "123456789",
    bankId: "bank-1",
    threshold: 777777,
    manualNameOverride: true,
    manualBankOverride: true,
    manualThresholdOverride: true,
  }],
  transactions: [],
  settings: {},
};
const importResult = hooks.mergeMetaAccountsIntoPayload(payloadForImport, [
  { accountId: "123456789", name: "Tên từ Meta", balance: 100000, currency: "VND", status: "Đang hoạt động" },
  { accountId: "222333444", name: "TKQC mới", balance: 250000, currency: "VND", status: "Đang hoạt động" },
], "2026-09-09T07:00:00.000Z");
assert.equal(importResult.scanned, 2);
assert.equal(importResult.matched, 1);
assert.equal(importResult.imported, 1);
assert.equal(importResult.payload.adAccounts.length, 2);
const existingMeta = importResult.payload.adAccounts.find((x) => x.metaAccountId === "123456789");
assert(existingMeta);
assert.equal(existingMeta.name, "Tên sửa tay", "manual name must survive Meta sync");
assert.equal(existingMeta.bankId, "bank-1", "manual bank must survive Meta sync");
assert.equal(existingMeta.threshold, 777777, "manual threshold must survive Meta sync");
assert.equal(existingMeta.metaApiBalance, 100000);
const importedMeta = importResult.payload.adAccounts.find((x) => x.metaAccountId === "222333444");
assert(importedMeta);
assert.equal(importedMeta.createdFrom, "meta_api");
assert.equal(importedMeta.metaAutoImported, true);
console.log("PASS Meta-only auto import ad accounts");
