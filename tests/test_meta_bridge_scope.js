"use strict";
const assert = require("assert");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "web-push") return { setVapidDetails() {}, async sendNotification() {} };
  if (request === "pg") return { Pool: class Pool { async connect(){ throw new Error("DB should not be touched in scope regression test"); } } };
  return originalLoad.call(this, request, parent, isMain);
};
process.env.NODE_ENV = "test";
const runtime = require("../server/meta-runtime");

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k,v){ this.headers[String(k).toLowerCase()] = String(v); },
    end(v=""){ this.body = String(v ?? ""); this.ended = true; return this; },
    json(obj){ this.setHeader("content-type","application/json"); this.body = JSON.stringify(obj); this.ended = true; return this; },
    status(code){ this.statusCode = code; return this; },
  };
}

(async () => {
  const req = {
    method: "POST",
    query: {},
    headers: {},
    body: { action: "deviceStatus" },
  };
  const res = makeRes();
  await runtime.metaBridge(req, res);
  const payload = JSON.parse(res.body || "{}");
  assert.notEqual(payload.error, "workspace is not defined", "workspace must be request-scoped before any action uses it");
  assert.ok(/Workspace không hợp lệ/i.test(payload.error || ""), `expected workspace validation, got: ${res.body}`);

  const req2 = {
    method: "POST",
    query: {},
    headers: { "x-device-name": "Test Device" },
    body: { action: "deviceStatus", workspace: "tai_balance", syncKey: "" },
  };
  const res2 = makeRes();
  await runtime.metaBridge(req2, res2);
  const payload2 = JSON.parse(res2.body || "{}");
  assert.notEqual(payload2.error, "syncKey is not defined");
  assert.notEqual(payload2.error, "deviceName is not defined");
  console.log("PASS v7.0.2 metaBridge request scope: workspace/syncKey/deviceName declared");
})().catch((error) => { console.error(error); process.exit(1); });
