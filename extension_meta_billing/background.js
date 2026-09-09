const WORKSPACE = "tran-duc-tai-main";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const AUTO_ALARM = "tbalance-meta-billing-auto";
const BILLING_BASE = "https://business.facebook.com/billing_hub/payment_activity";
const DEFAULTS = {
  serverBase: "",
  syncKey: "",
  deviceName: "Meta Billing Extension",
  paired: false,
  autoSync: true,
  autoBatchScan: false,
  intervalMinutes: 30,
  batchSize: 10,
  batchCursor: 0,
  closeBatchTabs: true,
  lastSyncAt: 0,
  lastAttemptAt: 0,
  lastError: "",
  lastResult: null,
  lastAccounts: [],
  lastTargets: []
};
const normalizeServerBase = (value) => {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Hãy nhập URL Vercel của T Balance, ví dụ https://ten-du-an.vercel.app");
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("URL server không hợp lệ.");
  return url.origin;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const setSettings = (patch) => chrome.storage.local.set(patch);
const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) });
const randomKey = () => {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 43);
};
async function ensureKey() {
  const cfg = await getSettings();
  if (cfg.syncKey?.length >= 20) return cfg;
  const syncKey = randomKey(); await setSettings({ syncKey });
  return { ...cfg, syncKey };
}
async function fetchJson(url, options = {}, attempts = 3) {
  let last;
  for (let i=0;i<attempts;i++) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 30000);
    try {
      const r = await fetch(url, { ...options, cache:"no-store", signal:c.signal });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok !== false) return j;
      const e = new Error(j.error || `HTTP ${r.status}`); e.code=j.code; e.status=r.status; throw e;
    } catch (e) { last = e?.name === "AbortError" ? new Error("Máy chủ phản hồi quá lâu.") : e; if (Number(last.status||0) < 500 && Number(last.status||0) >= 400) throw last; }
    finally { clearTimeout(t); }
    await wait(600*(i+1));
  }
  throw last || new Error("Không kết nối được T Balance.");
}
async function bridge(action, payload={}) {
  const cfg = await ensureKey();
  const serverBase = normalizeServerBase(cfg.serverBase);
  return fetchJson(`${serverBase}/outlookBridge`, {
    method:"POST", headers:{"Content-Type":"application/json","Cache-Control":"no-cache"},
    body: JSON.stringify({ action, workspace:WORKSPACE, syncKey:cfg.syncKey, deviceName:cfg.deviceName, extensionVersion:EXTENSION_VERSION, clientTimeMs:Date.now(), ...payload })
  });
}
async function updateAlarm() {
  const cfg = await getSettings(); await chrome.alarms.clear(AUTO_ALARM);
  if (cfg.autoSync) await chrome.alarms.create(AUTO_ALARM, { delayInMinutes:1, periodInMinutes:Math.max(5, Number(cfg.intervalMinutes||30)) });
}
function isBillingUrl(url="") {
  return /facebook\.com\/(billing_hub\/|ads\/manager\/billing|adsmanager\/billing)/i.test(url);
}
async function billingTabs() {
  const tabs = await chrome.tabs.query({}); return tabs.filter((t) => isBillingUrl(t.url || ""));
}
async function waitTabComplete(tabId, timeoutMs=50000) {
  try { const t=await chrome.tabs.get(tabId); if (t.status === "complete") return t; } catch { throw new Error("Tab Billing đã đóng."); }
  return new Promise((resolve,reject) => {
    let done=false; const finish=(v)=>{if(done)return;done=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);v instanceof Error?reject(v):resolve(v)};
    const timer=setTimeout(()=>finish(new Error("Meta Billing tải quá lâu.")),timeoutMs);
    const listener=(id,info,tab)=>{if(id===tabId&&info.status==="complete")finish(tab)}; chrome.tabs.onUpdated.addListener(listener);
  });
}
async function sendToTab(tab, msg) {
  try { return await chrome.tabs.sendMessage(tab.id, msg); }
  catch { await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]}); await wait(600); return chrome.tabs.sendMessage(tab.id,msg); }
}
async function scrapeTab(tab, waitReady=true) {
  if (!tab?.id) throw new Error("Không có tab Meta Billing.");
  if (tab.status !== "complete") tab = await waitTabComplete(tab.id);
  const result = await sendToTab(tab, { type: waitReady ? "BILLING_WAIT_READY" : "BILLING_SCRAPE", timeoutMs:26000 });
  if (!result?.ok || !result.account) throw new Error(result?.error || "Không đọc được Payment Threshold trên Meta Billing.");
  return result.account;
}
async function sendAccounts(accounts, reason="manual") {
  const unique = new Map(); for (const a of accounts || []) if (a?.accountId) unique.set(String(a.accountId),a);
  if (!unique.size) throw new Error("Không có dữ liệu Billing để gửi.");
  const payload = [...unique.values()];
  const result = await bridge("billingExtensionSync", { sourceType:"billing_extension", reason, accounts:payload, scannedAtMs:Date.now(), sourceUrl:payload[0]?.sourceUrl || "" });
  await setSettings({ lastSyncAt:Date.now(), lastAttemptAt:Date.now(), lastError:"", lastResult:result, lastAccounts:payload.slice(0,100) });
  return result;
}
async function scanOpenTabs(reason="open_tabs") {
  await setSettings({lastAttemptAt:Date.now()});
  const tabs = await billingTabs(); if (!tabs.length) throw new Error("Chưa mở Meta Billing Hub. Hãy mở trang Billing của Meta trước.");
  const accounts=[]; const errors=[];
  for (const tab of tabs) { try { accounts.push(await scrapeTab(tab,false)); } catch(e) { errors.push(e.message); } }
  if (!accounts.length) throw new Error(errors[0] || "Không đọc được dữ liệu từ các tab Billing đang mở.");
  return sendAccounts(accounts,reason);
}
function targetUrl(target) {
  const u = new URL(BILLING_BASE); u.searchParams.set("asset_id",target.accountId); u.searchParams.set("placement","ads_manager"); u.searchParams.set("payment_account_id",target.accountId);
  if (target.ownerId) { u.searchParams.set("business_id",target.ownerId); u.searchParams.set("global_scope_id",target.ownerId); }
  return u.toString();
}
async function scanTargets({manual=false}={}) {
  const cfg = await getSettings(); await setSettings({lastAttemptAt:Date.now()});
  const targetResult = await bridge("billingExtensionTargets"); const targets = Array.isArray(targetResult.accounts) ? targetResult.accounts : [];
  if (!targets.length) throw new Error("Chưa có TKQC từ Meta API. Hãy đồng bộ Meta API trên T Balance trước.");
  let selected;
  const start = Number(cfg.batchCursor || 0) % targets.length;
  if (manual) {
    const size = Math.min(100, targets.length);
    selected = Array.from({length:size},(_,i)=>targets[(start+i)%targets.length]);
    await setSettings({batchCursor:(start+selected.length)%targets.length});
  } else {
    const size = Math.max(1,Math.min(25,Number(cfg.batchSize||10)));
    selected = Array.from({length:Math.min(size,targets.length)},(_,i)=>targets[(start+i)%targets.length]);
    await setSettings({batchCursor:(start+selected.length)%targets.length});
  }
  await setSettings({lastTargets:targets.slice(0,500)});
  const accounts=[]; const errors=[];
  for (const target of selected) {
    let tab=null;
    try {
      tab = await chrome.tabs.create({url:targetUrl(target),active:false});
      tab = await waitTabComplete(tab.id,55000); await wait(2200);
      const account = await scrapeTab(tab,true); if (!account.name || /^TKQC /.test(account.name)) account.name=target.name || account.name; accounts.push(account);
    } catch(e) { errors.push(`${target.accountId}: ${e.message}`); }
    finally { if (tab?.id && cfg.closeBatchTabs !== false) { try { await chrome.tabs.remove(tab.id); } catch {} } }
    await wait(500);
  }
  if (!accounts.length) throw new Error(errors[0] || "Không quét được tài khoản Billing nào. Kiểm tra đăng nhập Facebook/Business Manager.");
  const result = await sendAccounts(accounts, manual ? "batch_manual" : "batch_auto");
  return { ...result, attempted:selected.length, succeeded:accounts.length, errors:errors.slice(0,20) };
}
async function status() {
  const cfg=await ensureKey(); let device={authorized:false}, server=null;
  try { device=await bridge("deviceStatus"); } catch {}
  if (device.authorized) {
    if (!cfg.paired) await setSettings({paired:true});
    try { server=await bridge("billingExtensionStatus"); } catch {}
  }
  return {local:{...cfg,paired:!!device.authorized||cfg.paired},device,server};
}
chrome.runtime.onInstalled.addListener(() => updateAlarm()); chrome.runtime.onStartup.addListener(()=>updateAlarm());
chrome.alarms.onAlarm.addListener(async (a)=>{ if(a.name!==AUTO_ALARM)return; const cfg=await getSettings(); try { if(cfg.autoBatchScan) await scanTargets({manual:false}); else await scanOpenTabs("alarm_open_tabs"); } catch(e){ await setSettings({lastError:e.message,lastAttemptAt:Date.now()}); } });
chrome.runtime.onMessage.addListener((m,_s,sendResponse)=>{
  (async()=>{
    if(m?.type==="GET_STATE") return status();
    if(m?.type==="PAIR") { const code=String(m.pairingCode||"").replace(/\D/g,""); const serverBase=normalizeServerBase(m.serverBase); await setSettings({serverBase}); const r=await bridge("joinDevice",{pairingCode:code}); await setSettings({paired:true,lastError:""}); return r; }
    if(m?.type==="SAVE") { const v=m.settings||{}; await setSettings({serverBase:normalizeServerBase(v.serverBase),deviceName:String(v.deviceName||"Meta Billing Extension").slice(0,80),autoSync:v.autoSync!==false,autoBatchScan:v.autoBatchScan===true,intervalMinutes:Math.max(5,Number(v.intervalMinutes||30)),batchSize:Math.max(1,Math.min(25,Number(v.batchSize||10))),closeBatchTabs:v.closeBatchTabs!==false}); await updateAlarm(); return getSettings(); }
    if(m?.type==="SCAN_OPEN") return scanOpenTabs("manual_open_tabs");
    if(m?.type==="SCAN_ALL") return scanTargets({manual:true});
    if(m?.type==="OPEN_BILLING") { await chrome.tabs.create({url:BILLING_BASE,active:true}); return {opened:true}; }
    if(m?.type==="OPEN_TBALANCE") { const cfg=await getSettings(); await chrome.tabs.create({url:`${normalizeServerBase(cfg.serverBase)}/adscheck`,active:true}); return {opened:true}; }
    if(m?.type==="BILLING_PAGE_CHANGED") {
      const cfg=await getSettings(); if(!cfg.paired || !cfg.autoSync || !m.result?.account) return {skipped:true};
      try { return await sendAccounts([m.result.account],"page_changed"); } catch(e) { await setSettings({lastError:e.message,lastAttemptAt:Date.now()}); return {error:e.message}; }
    }
    throw new Error("Lệnh không hỗ trợ.");
  })().then((result)=>sendResponse({ok:true,result})).catch(async(e)=>{await setSettings({lastError:e.message,lastAttemptAt:Date.now()});sendResponse({ok:false,error:e.message,code:e.code||""})});
  return true;
});
updateAlarm();
