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

// v7.0.3: auto-imported Meta account must still be editable even if local id/accountId diverged; metaAccountId is stable identity.
const metaStable = hooks.applyManualAdAccountEdit({
  banks: [{ id: "bank-x", name: "BANK X" }],
  adAccounts: [{ id: "server-id", name: "Meta Auto", accountId: "111222", metaAccountId: "999000", bankId: "", threshold: 0 }],
  transactions: [], settings: {}
}, {
  id: "stale-local-id",
  metaAccountId: "999000",
  currentAccountId: "333444",
  name: "Tên sửa Meta",
  accountId: "555666",
  bankId: "bank-x",
  threshold: 123456,
});
assert.equal(metaStable.ad.id, "server-id");
assert.equal(metaStable.ad.name, "Tên sửa Meta");
assert.equal(metaStable.ad.accountId, "555666");
assert.equal(metaStable.ad.bankId, "bank-x");
assert.equal(metaStable.ad.threshold, 123456);

assert.equal(hooks.getValidFundingSource({ banks: [{ id: "b1" }] }, { bankId: "" }), null);
assert.equal(hooks.getValidFundingSource({ banks: [{ id: "b1" }] }, { bankId: "missing" }), null);
assert.equal(hooks.getValidFundingSource({ banks: [{ id: "b1" }] }, { bankId: "b1" }).id, "b1");

console.log("PASS v7.0.3 stable Meta manual edit + funding source validation");


// v7.0.5: gắn nguồn tiền atomically bằng endpoint riêng, không phụ thuộc toàn bộ modal edit.
assert(hooks.applyAdFundingSourceEdit, "missing applyAdFundingSourceEdit hook");
const fundingAttached = hooks.applyAdFundingSourceEdit({
  banks: [{ id: "bank-main", name: "VPBANK - LA", number: "6952" }],
  adAccounts: [{ id: "ad-meta-1", name: "LA - TDT ADS", accountId: "1701141704298014", metaAccountId: "1701141704298014", bankId: "", threshold: 34365 }],
  transactions: [], settings: {}
}, {
  id: "stale-ui-id",
  metaAccountId: "1701141704298014",
  currentAccountId: "1701141704298014",
  bankId: "bank-main",
});
assert.equal(fundingAttached.ad.bankId, "bank-main");
assert.equal(fundingAttached.ad.manualBankOverride, true);
assert.equal(fundingAttached.ad.name, "LA - TDT ADS");
assert.equal(fundingAttached.ad.threshold, 34365);

const sourceUpsert = hooks.applyAdFundingSourceEdit({
  banks: [],
  adAccounts: [{ id: "ad-meta-2", name: "TAI-BOOM", accountId: "1455001556459898", metaAccountId: "1455001556459898", bankId: "" }],
  transactions: [], settings: {}
}, {
  metaAccountId: "1455001556459898",
  bankId: "new-source",
  bankSnapshot: { id: "new-source", name: "Nguồn tiền mới", number: "0805", initialBalance: 1000000 },
});
assert.equal(sourceUpsert.ad.bankId, "new-source");
assert.equal(sourceUpsert.payload.banks.length, 1, "selected source snapshot should be upserted atomically when cloud autosave is behind");
assert.equal(sourceUpsert.payload.banks[0].name, "Nguồn tiền mới");

const sourceDetached = hooks.applyAdFundingSourceEdit(fundingAttached.payload, {
  metaAccountId: "1701141704298014",
  bankId: "",
});
assert.equal(sourceDetached.ad.bankId, "");
assert.equal(sourceDetached.ad.manualBankOverride, true);

console.log("PASS v7.0.5 direct funding-source attach/detach + bank snapshot upsert");
