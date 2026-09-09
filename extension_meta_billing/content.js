(() => {
  if (globalThis.__TBALANCE_META_BILLING_V58__) return;
  globalThis.__TBALANCE_META_BILLING_V58__ = true;

  const ZERO_DECIMAL = new Set(["BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF"]);
  const MONTHS = {
    jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
    jul:7,july:7,aug:8,august:8,sep:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12
  };

  const clean = (v) => String(v || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  const normalizedBodyText = () => clean(document.body?.innerText || "").replace(/\r/g, "");

  function urlAccountId() {
    try {
      const u = new URL(location.href);
      for (const key of ["asset_id", "act", "ad_account_id", "account_id", "selected_ad_account_id"]) {
        const id = String(u.searchParams.get(key) || "").replace(/\D/g, "");
        if (id) return id;
      }
      // payment_account_id thường trùng asset_id trên Billing Hub; chỉ dùng làm fallback.
      const fallback = String(u.searchParams.get("payment_account_id") || "").replace(/\D/g, "");
      return fallback;
    } catch { return ""; }
  }

  function detectCurrency(text, moneyText = "") {
    const source = `${moneyText} ${text}`;
    if (/\bVND\b|₫|(?:^|\s)đ(?:\s|$)/i.test(source)) return "VND";
    if (/\bUSD\b|US\$|\$/i.test(source)) return "USD";
    if (/\bTHB\b|฿/i.test(source)) return "THB";
    if (/\bLAK\b|₭/i.test(source)) return "LAK";
    if (/\bKHR\b|៛/i.test(source)) return "KHR";
    if (/\bEUR\b|€/i.test(source)) return "EUR";
    return "";
  }

  function parseMoney(raw, currency = "") {
    let value = clean(raw).replace(/[^\d.,-]/g, "");
    if (!value) return 0;
    const c = String(currency || "").toUpperCase();
    if (ZERO_DECIMAL.has(c)) return Math.max(0, Math.round(Number(value.replace(/[.,]/g, "")) || 0));
    const dots = (value.match(/\./g) || []).length;
    const commas = (value.match(/,/g) || []).length;
    if (dots && commas) {
      const lastDot = value.lastIndexOf(".");
      const lastComma = value.lastIndexOf(",");
      const decimal = lastDot > lastComma ? "." : ",";
      const thousands = decimal === "." ? "," : ".";
      value = value.replaceAll(thousands, "").replace(decimal, ".");
    } else if (commas) {
      const tail = value.split(",").pop();
      value = tail?.length === 2 ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
    } else if (dots) {
      const tail = value.split(".").pop();
      if (dots > 1 || tail?.length === 3) value = value.replace(/\./g, "");
    }
    return Math.max(0, Math.round(Number(value) || 0));
  }

  function findMoneyAfter(text, labels) {
    for (const label of labels) {
      const re = new RegExp(`${label}[\\s\\S]{0,180}?([0-9][0-9., \u00a0]*)(?:\\s*)(₫|đ|VND|USD|US\\$|\\$|THB|฿|LAK|₭|KHR|៛|EUR|€)?`, "i");
      const m = text.match(re);
      if (m) {
        const raw = clean(m[1]);
        const currency = detectCurrency(m[0] || `${m[2] || ""}`, raw);
        return { raw, currency, value: parseMoney(raw, currency), match: clean(m[0]) };
      }
    }
    return { raw: "", currency: "", value: 0, match: "" };
  }

  function findLineAfter(text, labels, maxLen = 120) {
    for (const label of labels) {
      const re = new RegExp(`${label}\\s*\\n?\\s*([^\\n]{1,${maxLen}})`, "i");
      const m = text.match(re);
      if (m) return clean(m[1]);
    }
    return "";
  }

  function parseDate(raw) {
    const v = clean(raw).replace(/[.]/g, " ");
    let m = v.match(/(\d{1,2})\s*(?:Tháng|thang)\s*(\d{1,2})\s*,?\s*(\d{4})/i);
    if (m) return `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
    m = v.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
    m = v.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
    m = v.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
    return "";
  }

  function paymentMethod(text) {
    const section = findLineAfter(text, ["Bạn sẽ thanh toán bằng", "You(?:'|’)ll pay with", "You will pay with", "Payment method"], 180);
    const source = `${section}\n${text}`;
    const brandMatch = source.match(/\b(Visa|Mastercard|MasterCard|American Express|Amex|JCB)\b/i);
    const last4Match = source.match(/(?:•{2,}|·{2,}|\*{2,}|x{2,})\s*(\d{4})/i) || source.match(/\b(?:Visa|Mastercard|MasterCard|American Express|Amex|JCB)[^\n]{0,70}?(\d{4})\b/i);
    let brand = brandMatch ? brandMatch[1] : "";
    if (/master/i.test(brand)) brand = "Mastercard";
    if (/amex|american/i.test(brand)) brand = "American Express";
    return { brand, last4: last4Match ? last4Match[1] : "", text: section };
  }

  function accountName(text) {
    const candidates = [
      /(?:Tài khoản quảng cáo|Ad account)\s*[:\-]?\s*([^\n]{2,100})/i,
      /(?:Account name)\s*[:\-]?\s*([^\n]{2,100})/i
    ];
    for (const re of candidates) {
      const m = text.match(re);
      if (m) return clean(m[1]).slice(0,160);
    }
    return "";
  }

  function scrape() {
    const text = normalizedBodyText();
    const accountId = urlAccountId();
    const current = findMoneyAfter(text, ["Số dư hiện tại", "Current balance"]);
    const threshold = findMoneyAfter(text, ["Số dư của bạn đạt", "Your balance reaches", "Balance reaches"]);
    const dateText = findLineAfter(text, ["Và vào ngày này", "And on this date", "Or on this date", "on this date"], 100);
    const payment = paymentMethod(text);
    const currency = current.currency || threshold.currency || detectCurrency(text);
    const nextBillingDate = parseDate(dateText);
    const hasBillingSignals = !!(current.value || threshold.value || dateText || payment.last4);
    return {
      ok: !!accountId && hasBillingSignals,
      account: accountId ? {
        accountId,
        name: accountName(text) || `TKQC ${accountId}`,
        balance: current.value,
        threshold: threshold.value,
        remainingThreshold: threshold.value ? Math.max(0, threshold.value - current.value) : 0,
        nextBillingDate,
        nextBillingDateText: dateText,
        cardBrand: payment.brand,
        cardLast4: payment.last4,
        paymentMethodText: payment.text,
        currency,
        sourceUrl: location.href,
        scannedAt: new Date().toISOString()
      } : null,
      debug: {
        hasAccountId: !!accountId,
        hasCurrentBalance: !!current.value,
        hasThreshold: !!threshold.value,
        hasNextDate: !!dateText,
        hasCard: !!payment.last4
      },
      error: !accountId ? "Không xác định được Account ID từ URL Billing Hub." : (!hasBillingSignals ? "Trang Billing chưa hiển thị dữ liệu thanh toán." : "")
    };
  }

  async function waitReady(timeoutMs = 25000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = scrape();
      if (result.ok && result.account?.threshold > 0) return result;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    return scrape();
  }

  let timer = null;
  let lastFingerprint = "";
  let lastSentAt = 0;
  function fingerprint(result) {
    const a = result?.account || {};
    return [a.accountId, a.balance, a.threshold, a.nextBillingDate, a.cardBrand, a.cardLast4].join("|");
  }
  function notifyChanged() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const result = scrape();
      if (!result.ok) return;
      const fp = fingerprint(result);
      if (fp === lastFingerprint && Date.now() - lastSentAt < 60000) return;
      lastFingerprint = fp;
      lastSentAt = Date.now();
      try { chrome.runtime.sendMessage({ type: "BILLING_PAGE_CHANGED", result }); } catch {}
    }, 1800);
  }

  const observer = new MutationObserver(notifyChanged);
  observer.observe(document.body || document.documentElement, { subtree: true, childList: true });
  window.addEventListener("pageshow", notifyChanged);
  window.addEventListener("focus", notifyChanged);
  setInterval(() => { if (document.visibilityState !== "hidden") notifyChanged(); }, 60000);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BILLING_SCRAPE") {
      sendResponse(scrape());
      return;
    }
    if (message?.type === "BILLING_WAIT_READY") {
      waitReady(Number(message.timeoutMs || 25000)).then(sendResponse).catch((error) => sendResponse({ ok:false, error:error.message }));
      return true;
    }
  });
})();
