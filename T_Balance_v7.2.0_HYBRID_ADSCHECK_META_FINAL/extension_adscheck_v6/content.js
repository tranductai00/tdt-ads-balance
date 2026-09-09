(() => {
  "use strict";
  if (globalThis.__TBALANCE_ADSCHECK_CONTENT_V584__) return;
  globalThis.__TBALANCE_ADSCHECK_CONTENT_V584__ = true;

  const CELL_IDS = {
    account: "td-adaccount-account",
    status: "td-adaccount-account_status",
    owner: "td-adaccount-owner",
    balance: "td-adaccount-balance",
    threshold: "td-adaccount-thresh",
    remainingThreshold: "td-adaccount-remain_thresh",
    card: "td-adaccount-card_amount",
    limit: "td-adaccount-limit",
    currency: "td-adaccount-currency"
  };

  const textOf = (node) => String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  const digits = (value) => String(value || "").replace(/\D/g, "");
  const parseAmount = (value) => {
    const raw = String(value || "").trim();
    if (!raw || raw === "-" || raw === "—") return 0;
    const normalized = raw.replace(/[^0-9-]/g, "");
    const number = Number(normalized);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
  };

  function findRow(accountCell) {
    let row = accountCell?.parentElement || null;
    for (let depth = 0; row && depth < 8; depth += 1, row = row.parentElement) {
      const hasBalance = row.querySelector?.(`[id="${CELL_IDS.balance}"]`);
      const hasThreshold = row.querySelector?.(`[id="${CELL_IDS.threshold}"]`);
      if (hasBalance && hasThreshold) return row;
    }
    return accountCell?.closest?.("tr,[role='row'],.ant-table-row") || accountCell?.parentElement || null;
  }

  const cell = (row, id) => row?.querySelector?.(`[id="${id}"]`) || null;

  function parseAccountCell(accountCell) {
    const spans = [...accountCell.querySelectorAll("span")].map(textOf).filter(Boolean);
    const allText = textOf(accountCell);
    const numericCandidates = spans.concat([allText]).flatMap((value) => value.match(/\d{8,30}/g) || []);
    const accountId = numericCandidates.sort((a, b) => b.length - a.length)[0] || "";
    let name = spans.find((value) => value !== accountId && !/^\d+$/.test(value)) || allText;
    if (accountId) name = name.replace(accountId, "").replace(/[()]/g, "").replace(/\s{2,}/g, " ").trim();
    return { name: name || accountId || "Tài khoản quảng cáo", accountId };
  }

  function parseCardLast4(value) {
    const raw = String(value || "");
    const candidates = raw.match(/(?:^|\D)(\d{4})(?!\d)/g) || [];
    const value4 = candidates.length ? candidates[candidates.length - 1].replace(/\D/g, "") : digits(raw).slice(-4);
    return value4.length === 4 ? value4 : "";
  }


  function parseCardBrand(value) {
    const raw = String(value || "");
    const m = raw.match(/\b(Visa|Mastercard|Master Card|Amex|American Express|JCB|Discover|UnionPay)\b/i);
    return m ? m[1].replace(/Master Card/i, "Mastercard") : "";
  }

  function parseNextBillingDate(row) {
    const raw = textOf(row);
    const patterns = [
      /(?:ngày thu tiếp|ngày thanh toán tiếp|next billing date|next payment date)[^0-9]{0,40}(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})/i,
      /(?:ngày thu tiếp|ngày thanh toán tiếp|next billing date|next payment date)[^0-9]{0,40}(\d{4}-\d{2}-\d{2})/i
    ];
    for (const re of patterns) {
      const m = raw.match(re);
      if (m) return m[1];
    }
    return "";
  }

  function extractAccounts() {
    const accountCells = [...document.querySelectorAll(`[id="${CELL_IDS.account}"]`)];
    const accounts = [];
    const seen = new Set();
    for (const accountCell of accountCells) {
      const row = findRow(accountCell);
      if (!row) continue;
      const base = parseAccountCell(accountCell);
      if (!base.accountId || seen.has(base.accountId)) continue;
      seen.add(base.accountId);
      const cardText = textOf(cell(row, CELL_IDS.card));
      accounts.push({
        ...base,
        status: textOf(cell(row, CELL_IDS.status)),
        ownerId: digits(textOf(cell(row, CELL_IDS.owner))),
        balance: parseAmount(textOf(cell(row, CELL_IDS.balance))),
        threshold: parseAmount(textOf(cell(row, CELL_IDS.threshold))),
        remainingThreshold: parseAmount(textOf(cell(row, CELL_IDS.remainingThreshold))),
        cardLast4: parseCardLast4(cardText),
        cardBrand: parseCardBrand(cardText),
        paymentMethodText: cardText.slice(0, 160),
        nextBillingDate: parseNextBillingDate(row),
        nextBillingDateText: parseNextBillingDate(row),
        thresholdSource: "adscheck_v6",
        thresholdConfidence: "high",
        limit: parseAmount(textOf(cell(row, CELL_IDS.limit))),
        currency: textOf(cell(row, CELL_IDS.currency)).slice(0, 20),
        sourceUrl: location.href,
        scannedAt: new Date().toISOString()
      });
    }
    return accounts;
  }

  function scrapeAccounts() {
    const accounts = extractAccounts();
    const scannedAt = new Date().toISOString();
    return {
      ok: true,
      accounts,
      accountCount: accounts.length,
      url: location.href,
      title: document.title,
      scannedAt,
      scannedAtMs: Date.parse(scannedAt)
    };
  }

  function waitForAccounts(timeoutMs = 18000) {
    const current = extractAccounts();
    if (current.length) return Promise.resolve({ ok: true, count: current.length });
    return new Promise((resolve) => {
      const target = document.getElementById("single-spa-application:@smit/insight-table") || document.body || document.documentElement;
      let finished = false;
      const done = (payload) => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(payload);
      };
      const observer = new MutationObserver(() => {
        const accounts = extractAccounts();
        if (accounts.length) done({ ok: true, count: accounts.length });
      });
      observer.observe(target, { childList: true, subtree: true, characterData: true });
      const timer = setTimeout(() => {
        const accounts = extractAccounts();
        done({ ok: !!accounts.length, count: accounts.length, timeout: true });
      }, timeoutMs);
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "ADSCHECK_SCRAPE") {
      try { sendResponse(scrapeAccounts()); }
      catch (error) { sendResponse({ ok: false, error: error?.message || "Không đọc được bảng AdsCheck V6." }); }
      return true;
    }
    if (message?.type === "ADSCHECK_WAIT_READY") {
      waitForAccounts(Number(message.timeoutMs || 18000))
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error?.message || "AdsCheck V6 chưa sẵn sàng." }));
      return true;
    }
    return false;
  });

  let debounceTimer = null;
  let lastSuccessfulFingerprint = "";
  let lastSuccessfulSentAt = 0;
  let sendInFlight = false;

  const fingerprintOf = (result) => JSON.stringify(result.accounts.map((account) => [
    account.accountId,
    account.balance,
    account.threshold,
    account.remainingThreshold,
    account.cardLast4,
    account.status
  ]));

  async function sendToBackground(type, result) {
    if (sendInFlight || !result.accounts.length) return false;
    sendInFlight = true;
    try {
      const response = await chrome.runtime.sendMessage({ type, result });
      if (!response?.ok || response?.result?.ok === false) return false;
      lastSuccessfulFingerprint = fingerprintOf(result);
      lastSuccessfulSentAt = Date.now();
      return true;
    } catch {
      return false;
    } finally {
      sendInFlight = false;
    }
  }

  function scheduleChangedSync() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const run = async () => {
        const result = scrapeAccounts();
        if (!result.accounts.length) return;
        const fingerprint = fingerprintOf(result);
        const changed = fingerprint !== lastSuccessfulFingerprint;
        const stale = Date.now() - lastSuccessfulSentAt > 60000;
        if (!changed && !stale) return;
        await sendToBackground(changed ? "ADSCHECK_TABLE_CHANGED" : "ADSCHECK_HEARTBEAT", result);
      };
      if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 1800 });
      else setTimeout(run, 0);
    }, 1500);
  }

  function sendHeartbeat() {
    const result = scrapeAccounts();
    if (!result.accounts.length) return;
    sendToBackground("ADSCHECK_HEARTBEAT", result).catch(() => {});
  }

  function startObserver() {
    const target = document.getElementById("single-spa-application:@smit/insight-table") || document.body || document.documentElement;
    const observer = new MutationObserver(scheduleChangedSync);
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    waitForAccounts(25000).then(() => scheduleChangedSync()).catch(() => {});
    setInterval(() => {
      if (document.visibilityState === "visible") sendHeartbeat();
    }, 60000);
    window.addEventListener("focus", scheduleChangedSync);
    window.addEventListener("pageshow", scheduleChangedSync);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleChangedSync();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else startObserver();
})();
