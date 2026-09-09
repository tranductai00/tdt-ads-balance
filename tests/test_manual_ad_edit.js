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
assert(hooks?.applyManualAdAccountEdit, "missing applyManualAdAccountEdit hook");

const source = {
  banks: [{ id: "bank1", name: "VPBANK" }],
  adAccounts: [{
    id: "ad1",
    name: "AUTO NAME",
    accountId: "act_123456",
    bankId: "bank1",
    threshold: 50000,
    adsCheckBalance: 12000,
    paymentCardLast4: "6952",
    lastAdsCheckSyncAt: "2026-09-09T01:00:00.000Z",
    createdFrom: "adscheck_smit",
  }],
  transactions: [],
  settings: { deletedAdAccountIds: [] },
};

const edited = hooks.applyManualAdAccountEdit(source, {
  id: "ad1",
  currentAccountId: "123456",
  name: "Tên sửa tay",
  accountId: "act_999888",
  bankId: "",
  threshold: 777777,
});
const ad = edited.ad;
assert.equal(ad.name, "Tên sửa tay");
assert.equal(ad.accountId, "999888");
assert.equal(ad.bankId, "");
assert.equal(ad.threshold, 777777);
assert.equal(ad.manualNameOverride, true);
assert.equal(ad.manualBankOverride, true, "clearing bank must remain a manual choice");
assert.equal(ad.manualThresholdOverride, true);
assert.equal(ad.manualAccountIdOverride, true);
assert.equal(ad.adsCheckBalance, 12000, "scan fields must be preserved");
assert.equal(ad.paymentCardLast4, "6952");
assert(edited.payload.settings.deletedAdAccountIds.includes("123456"), "old account id must be tombstoned");
assert(!edited.payload.settings.deletedAdAccountIds.includes("999888"), "new account id must be active");

const autoThreshold = hooks.applyManualAdAccountEdit(edited.payload, {
  id: "ad1", name: "Tên sửa tay", accountId: "999888", bankId: "", threshold: 0,
}).ad;
assert.equal(autoThreshold.manualThresholdOverride, false, "threshold 0 should restore automatic threshold updates");
assert.equal(autoThreshold.manualBankOverride, true, "empty bank stays manually detached");

assert.throws(() => hooks.applyManualAdAccountEdit({
  banks: [],
  adAccounts: [{id:"a",name:"A",accountId:"1"},{id:"b",name:"B",accountId:"2"}],
  transactions: [], settings: {}
}, {id:"a", name:"A2", accountId:"2", bankId:"", threshold:0}), /đã tồn tại/i);

console.log("PASS atomic manual ad-account edit");
