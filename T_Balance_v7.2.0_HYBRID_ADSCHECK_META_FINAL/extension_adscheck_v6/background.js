const WORKSPACE = "tran-duc-tai-main";
const ADSCHECK_URL = "https://adscheckv6.smit.vn/app/adscheck-pro";
const ADSCHECK_ALT_URL = "https://adscheck.smit.vn/app/adscheck-pro/adaccounts";
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const AUTO_ALARM = "adscheck-auto-sync";
const DEFAULTS = {
  serverBase: "",
  syncKey: "",
  deviceName: "AdsCheck V6 Extension",
  paired: false,
  autoSync: true,
  autoOpen: true,
  autoRefreshBeforeSync: true,
  intervalMinutes: 5,
  syncSelectedOnly: false,
  selectedAccountIds: [],
  lastPreviewAccounts: [],
  lastPreviewAt: 0,
  lastSyncAt: 0,
  lastSuccessAt: 0,
  lastAttemptAt: 0,
  lastScannedAt: 0,
  lastServerReceivedAt: 0,
  lastReason: "",
  syncSequence: 0,
  lastResult: null,
  lastError: "",
  lastRefreshAt: 0,
  syncInProgress: false
};

const normalizeServerBase = (value) => {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Hãy nhập URL Vercel của T Balance, ví dụ https://ten-du-an.vercel.app");
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("URL server không hợp lệ.");
  return url.origin;
};
const normalizeIds = (values) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => String(value || "").replace(/\D/g, ""))
  .filter(Boolean))].slice(0, 500);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const setSettings = (patch) => chrome.storage.local.set(patch);
const getSettings = async () => {
  const raw = await chrome.storage.local.get(DEFAULTS);
  return {
    ...DEFAULTS,
    ...raw,
    selectedAccountIds: normalizeIds(raw.selectedAccountIds),
    lastPreviewAccounts: Array.isArray(raw.lastPreviewAccounts) ? raw.lastPreviewAccounts.slice(0, 500) : []
  };
};
const randomKey = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 43);
};

async function ensureKey() {
  const cfg = await getSettings();
  if (cfg.syncKey?.length >= 20) return cfg;
  const syncKey = randomKey();
  await setSettings({ syncKey });
  return { ...cfg, syncKey };
}

async function fetchJsonWithRetry(url, options, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { ...options, cache: "no-store", signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok !== false) return result;
      const error = new Error(result.error || `HTTP ${response.status}`);
      error.code = result.code || "BRIDGE_ERROR";
      error.status = response.status;
      if (response.status < 500 || attempt === maxAttempts - 1) throw error;
      lastError = error;
    } catch (error) {
      lastError = error?.name === "AbortError" ? new Error("Máy chủ phản hồi quá lâu.") : error;
      const status = Number(lastError?.status || 0);
      if ((status >= 400 && status < 500) || attempt === maxAttempts - 1) throw lastError;
    } finally {
      clearTimeout(timer);
    }
    await wait(500 * (attempt + 1));
  }
  throw lastError || new Error("Không kết nối được máy chủ T Balance.");
}

async function bridge(action, payload = {}) {
  const cfg = await ensureKey();
  const serverBase = normalizeServerBase(cfg.serverBase);
  const requestId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return fetchJsonWithRetry(`${serverBase}/api/metaBridge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: JSON.stringify({
      action,
      workspace: WORKSPACE,
      syncKey: cfg.syncKey,
      deviceName: cfg.deviceName || DEFAULTS.deviceName,
      clientTimeMs: Date.now(),
      extensionVersion: EXTENSION_VERSION,
      requestId,
      ...payload
    })
  });
}

async function updateAlarm() {
  const cfg = await getSettings();
  await chrome.alarms.clear(AUTO_ALARM);
  if (cfg.autoSync) {
    await chrome.alarms.create(AUTO_ALARM, {
      delayInMinutes: 0.5,
      periodInMinutes: Math.max(1, Number(cfg.intervalMinutes || 5))
    });
  }
}

async function getAdsCheckTab({ autoOpen = false } = {}) {
  const tabs = await chrome.tabs.query({ url: ["https://adscheckv6.smit.vn/app/adscheck-pro*", "https://adscheck.smit.vn/app/adscheck-pro*"] });
  if (tabs.length) return tabs.find((tab) => tab.active) || tabs[0];
  if (!autoOpen) return null;
  return chrome.tabs.create({ url: ADSCHECK_URL, active: false });
}

async function waitTabComplete(tabId, timeoutMs = 45000) {
  try {
    const current = await chrome.tabs.get(tabId);
    if (current.status === "complete") return current;
  } catch {
    throw new Error("Tab AdsCheck không còn tồn tại.");
  }
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      value instanceof Error ? reject(value) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("AdsCheck tải quá lâu, hãy thử lại.")), timeoutMs);
    const onUpdated = async (updatedTabId, info, tab) => {
      if (updatedTabId !== tabId || info.status !== "complete") return;
      try { finish(tab || await chrome.tabs.get(tabId)); } catch (error) { finish(error); }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function sendTabMessage(tab, message, retry = true) {
  if (!tab?.id) throw new Error("Không tìm thấy tab AdsCheck.");
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!retry) throw error;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await wait(700);
    return sendTabMessage(tab, message, false);
  }
}

const requestWaitReady = (tab, timeoutMs = 18000) => sendTabMessage(tab, { type: "ADSCHECK_WAIT_READY", timeoutMs });
const requestScrape = (tab) => sendTabMessage(tab, { type: "ADSCHECK_SCRAPE" });

async function refreshAdsCheckTab(tab) {
  if (!tab?.id) throw new Error("Không tìm thấy tab AdsCheck để làm mới.");
  await chrome.tabs.reload(tab.id, { bypassCache: true });
  const updated = await waitTabComplete(tab.id, 50000);
  await wait(1800);
  await requestWaitReady(updated, 22000).catch(() => null);
  await setSettings({ lastRefreshAt: Date.now() });
  return chrome.tabs.get(tab.id);
}

async function scrapeCurrentTable({ autoOpen = false, forceRefresh = false } = {}) {
  let tab = await getAdsCheckTab({ autoOpen });
  if (!tab) throw new Error("Chưa mở trang AdsCheck. Hãy mở AdsCheck hoặc bật Tự mở AdsCheck.");
  if (tab.status !== "complete") tab = await waitTabComplete(tab.id, 45000);
  if (forceRefresh) tab = await refreshAdsCheckTab(tab);
  else await requestWaitReady(tab, 15000).catch(() => null);

  let scraped = await requestScrape(tab).catch(() => null);
  if (!scraped?.ok || !Array.isArray(scraped.accounts) || !scraped.accounts.length) {
    await wait(1800);
    scraped = await requestScrape(tab).catch(() => null);
  }
  if ((!scraped?.accounts?.length) && !forceRefresh) {
    tab = await refreshAdsCheckTab(tab);
    scraped = await requestScrape(tab).catch(() => null);
  }
  if (!scraped?.ok || !Array.isArray(scraped.accounts) || !scraped.accounts.length) {
    throw new Error(scraped?.error || "AdsCheck chưa hiển thị dữ liệu tài khoản.");
  }
  const scannedAtMs = Date.parse(scraped.scannedAt || "") || Date.now();
  await setSettings({
    lastPreviewAccounts: scraped.accounts.slice(0, 500),
    lastPreviewAt: Date.now(),
    lastScannedAt: scannedAtMs
  });
  return { ...scraped, scannedAtMs };
}

function applyAccountSelection(scraped, cfg) {
  const discovered = Array.isArray(scraped.accounts) ? scraped.accounts : [];
  const selectedIds = normalizeIds(cfg.selectedAccountIds);
  if (!cfg.syncSelectedOnly) {
    return {
      ...scraped,
      accounts: discovered,
      discoveredCount: discovered.length,
      selectedAccountIds: discovered.map((item) => item.accountId),
      selectionMode: "all"
    };
  }
  if (!selectedIds.length) throw new Error("Bạn chưa chọn tài khoản nào để đồng bộ.");
  const selectedSet = new Set(selectedIds);
  const accounts = discovered.filter((item) => selectedSet.has(String(item.accountId)));
  if (!accounts.length) throw new Error("Các tài khoản đã chọn không còn xuất hiện trong bảng AdsCheck hiện tại.");
  return {
    ...scraped,
    accounts,
    discoveredCount: discovered.length,
    selectedAccountIds: accounts.map((item) => item.accountId),
    selectionMode: "selected"
  };
}

async function showAlertNotifications(alerts = []) {
  for (const alert of alerts.slice(0, 5)) {
    await chrome.notifications.create(`adscheck-${alert.accountId}-${Date.now()}`.slice(0, 120), {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Thẻ không đủ thanh toán Meta",
      message: `${alert.name || alert.accountId} · Thẻ •••• ${alert.cardLast4 || "----"}\nCòn ${Number(alert.bankBalance || 0).toLocaleString("vi-VN")} đ · Cần ${Number(alert.required || 0).toLocaleString("vi-VN")} đ`,
      priority: 2
    });
  }
}

async function syncScrapedResult(scraped, reason = "manual") {
  const cfg = await getSettings();
  if (!cfg.paired) throw new Error("Extension chưa ghép với T Balance.");
  const selected = applyAccountSelection(scraped, cfg);
  const clientSentAtMs = Date.now();
  const scannedAtMs = Number(scraped.scannedAtMs || Date.parse(scraped.scannedAt || "") || clientSentAtMs);
  const syncSequence = Number(cfg.syncSequence || 0) + 1;
  const result = await bridge("adsCheckV6Sync", {
    accounts: selected.accounts,
    discoveredCount: selected.discoveredCount,
    selectionMode: selected.selectionMode,
    selectedAccountIds: selected.selectedAccountIds,
    sourceUrl: selected.url || ADSCHECK_URL,
    reason,
    clientSentAtMs,
    scannedAtMs,
    scannedAt: selected.scannedAt || new Date(scannedAtMs).toISOString(),
    syncSequence
  });
  const successAt = Date.now();
  await setSettings({
    lastSyncAt: successAt,
    lastSuccessAt: successAt,
    lastServerReceivedAt: Number(result.serverReceivedAtMs || successAt),
    lastResult: result,
    lastError: "",
    lastReason: reason,
    paired: true,
    syncSequence,
    syncInProgress: false,
    lastPreviewAccounts: scraped.accounts.slice(0, 500),
    lastPreviewAt: Date.now(),
    lastScannedAt: scannedAtMs
  });
  if (Array.isArray(result.alerts) && result.alerts.length) await showAlertNotifications(result.alerts);
  return result;
}

let syncTask = null;
async function runSync(reason = "manual", providedScrape = null) {
  if (syncTask) return syncTask;
  syncTask = (async () => {
    const cfg = await getSettings();
    if (!cfg.autoSync && reason !== "manual" && reason !== "paired") return { ok: true, skipped: "auto_disabled" };
    const attemptAt = Date.now();
    await setSettings({ lastAttemptAt: attemptAt, lastReason: reason, syncInProgress: true });
    try {
      const shouldRefresh = !providedScrape && !["table_changed", "heartbeat", "page_ready"].includes(reason) && cfg.autoRefreshBeforeSync !== false;
      const scraped = providedScrape || await scrapeCurrentTable({ autoOpen: cfg.autoOpen, forceRefresh: shouldRefresh });
      return await syncScrapedResult(scraped, reason);
    } catch (error) {
      await setSettings({
        lastError: error?.message || "Đồng bộ thất bại.",
        lastReason: reason,
        syncInProgress: false
      });
      if (["manual", "paired"].includes(reason)) throw error;
      return { ok: false, error: error?.message || "Đồng bộ thất bại." };
    } finally {
      syncTask = null;
    }
  })();
  return syncTask;
}

async function initializeBackground(reason) {
  await ensureKey();
  await updateAlarm();
  const cfg = await getSettings();
  if (cfg.paired && cfg.autoSync) {
    setTimeout(() => runSync(reason).catch(() => {}), 1800);
  }
}

chrome.runtime.onInstalled.addListener(() => initializeBackground("installed").catch(() => {}));
chrome.runtime.onStartup.addListener(() => initializeBackground("startup").catch(() => {}));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_ALARM) runSync("alarm").catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !(tab?.url?.startsWith(ADSCHECK_URL) || tab?.url?.startsWith("https://adscheck.smit.vn/app/adscheck-pro"))) return;
  getSettings().then((cfg) => {
    if (cfg.paired && cfg.autoSync) setTimeout(() => runSync("page_ready").catch(() => {}), 1600);
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "ADSCHECK_TABLE_CHANGED") return runSync("table_changed", message.result);
    if (message?.type === "ADSCHECK_HEARTBEAT") return runSync("heartbeat", message.result);
    if (message?.type === "RUN_SYNC") return runSync("manual");
    if (message?.type === "PREVIEW_ACCOUNTS") {
      const cfg = await getSettings();
      const scraped = await scrapeCurrentTable({ autoOpen: cfg.autoOpen, forceRefresh: cfg.autoRefreshBeforeSync !== false });
      return { accounts: scraped.accounts, accountCount: scraped.accounts.length, scannedAt: scraped.scannedAt, scannedAtMs: scraped.scannedAtMs };
    }
    if (message?.type === "PAIR_DEVICE") {
      const code = String(message.pairingCode || "").replace(/\D/g, "");
      const serverBase = normalizeServerBase(message.serverBase);
      await setSettings({ serverBase });
      const pairedResult = await bridge("joinDevice", { pairingCode: code });
      await setSettings({ paired: true, lastError: "" });
      let syncResult = null;
      try { syncResult = await runSync("paired"); } catch (error) { syncResult = { ok: false, error: error.message }; }
      return { ...pairedResult, syncResult };
    }
    if (message?.type === "CHECK_STATUS") {
      const local = await getSettings();
      const device = await bridge("deviceStatus");
      const status = device.authorized ? await bridge("adsCheckV6Status") : null;
      await setSettings({ paired: !!device.authorized });
      return { device, status, local };
    }
    if (message?.type === "SAVE_SETTINGS") {
      const clean = {
        serverBase: normalizeServerBase(message.settings?.serverBase),
        deviceName: String(message.settings?.deviceName || DEFAULTS.deviceName).slice(0, 80),
        autoSync: message.settings?.autoSync !== false,
        autoOpen: message.settings?.autoOpen !== false,
        autoRefreshBeforeSync: message.settings?.autoRefreshBeforeSync !== false,
        intervalMinutes: Math.max(1, Number(message.settings?.intervalMinutes || 5)),
        syncSelectedOnly: message.settings?.syncSelectedOnly === true,
        selectedAccountIds: normalizeIds(message.settings?.selectedAccountIds)
      };
      if (clean.syncSelectedOnly && !clean.selectedAccountIds.length) {
        throw new Error("Hãy chọn ít nhất một tài khoản hoặc tắt chế độ chỉ đồng bộ tài khoản đã chọn.");
      }
      await setSettings(clean);
      await updateAlarm();
      const cfg = await getSettings();
      if (cfg.paired) await bridge("adsCheckV6Configure", { settings: message.settings?.serverSettings || {} });
      if (cfg.paired && clean.autoSync) setTimeout(() => runSync("settings_saved").catch(() => {}), 500);
      return { ok: true, ...clean };
    }
    if (message?.type === "GET_SETTINGS") return getSettings();
    if (message?.type === "OPEN_ADSCHECK") return chrome.tabs.create({ url: ADSCHECK_URL });
    if (message?.type === "OPEN_TBALANCE") {
      const cfg = await getSettings();
      return chrome.tabs.create({ url: `${normalizeServerBase(cfg.serverBase)}/` });
    }
    return { ok: false, error: "Lệnh không hỗ trợ." };
  })()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || "Có lỗi xảy ra.", code: error?.code || "" }));
  return true;
});

ensureKey().then(updateAlarm).catch(() => {});
