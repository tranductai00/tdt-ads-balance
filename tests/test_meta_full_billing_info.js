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

const now = Date.now();
const profile = hooks.deriveMetaBillingProfile(
  { accountId: "1728828071611455", balance: 12904, currency: "VND" },
  [
    { isSuccessfulCharge: true, amount: 116651, eventTimeMs: now - 1000, eventTime: new Date(now - 1000).toISOString(), extraData: { type: "payment_amount", new_value: "116651", currency: "VND", next_billing_date: "2026-10-09" } },
    { isSuccessfulCharge: true, amount: 116626, eventTimeMs: now - 86400000, eventTime: new Date(now - 86400000).toISOString(), extraData: { type: "payment_amount", new_value: "116626", currency: "VND" } },
  ],
);
assert(profile.threshold >= 116626 && profile.threshold <= 116651, "threshold should be derived from recent Meta billing charges");
assert.equal(profile.thresholdConfidence, "high");
assert.equal(profile.thresholdSource, "meta_billing_activity");
assert(profile.remainingThreshold > 100000);
assert.equal(profile.nextBillingDate, "2026-10-09");

const payload = { banks: [], transactions: [], settings: {}, adAccounts: [{ id: "ad1", name: "Acc LA", accountId: "1728828071611455", metaAccountId: "1728828071611455", bankId: "", threshold: 0 }] };
const merged = hooks.mergeMetaAccountsIntoPayload(payload, [{
  accountId: "1728828071611455",
  name: "Acc LA",
  balance: 12904,
  threshold: 116651,
  remainingThreshold: 103747,
  thresholdSource: "meta_billing_activity",
  thresholdConfidence: "high",
  cardLast4: "6952",
  cardBrand: "Visa",
  paymentMethodText: "Visa •••• 6952",
  nextBillingDate: "2026-10-09",
  nextBillingDateText: "",
  billingMode: "threshold_or_monthly",
  currency: "VND",
  amountSpent: 500000,
  fundingSourceId: "funding1",
  businessName: "BM",
  status: "Đang hoạt động",
  sourceUrl: "https://graph.facebook.com",
  scannedAt: new Date().toISOString(),
}]);
const ad = merged.payload.adAccounts[0];
assert.equal(ad.threshold, 116651);
assert.equal(ad.remainingThreshold, 103747);
assert.equal(ad.paymentCardLast4, "6952");
assert.equal(ad.paymentCardBrand, "Visa");
assert.equal(ad.billingNextDate, "2026-10-09");
assert.equal(ad.metaThresholdSource, "meta_billing_activity");
assert.equal(ad.metaApi.threshold, 116651);
assert.equal(ad.metaApi.cardLast4, "6952");

console.log("PASS Meta full billing info: threshold/remaining/card/next billing/source");
