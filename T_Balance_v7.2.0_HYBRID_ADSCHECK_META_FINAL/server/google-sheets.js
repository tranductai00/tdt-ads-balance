"use strict";

const crypto = require("crypto");
const { getStore, FieldValue } = require("./store");

const db = getStore();
const GOOGLE_STATES = "t_balance_google_sheets";
const GOOGLE_OAUTH_STATES = "t_balance_google_oauth_states";
const META_BILLING_EVENTS = "t_balance_meta_billing_events";
const SHEET_DAILY = "t_balance_google_sheet_daily";
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

function inferBaseUrl() {
  const explicit = String(process.env.WEB_APP_BASE_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "").trim();
  if (host) return `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}
function redirectUri() { return `${inferBaseUrl()}/auth/google/callback`; }
function tokenKeyBuffers() {
  const candidates = [process.env.APP_ENCRYPTION_KEY, process.env.OUTLOOK_TOKEN_KEY].map(v => String(v || "").trim()).filter(Boolean);
  if (!candidates.length) throw new Error("Thiếu APP_ENCRYPTION_KEY. Tạo khóa base64 32 byte bằng: openssl rand -base64 32");
  const unique = [];
  for (const value of candidates) {
    const raw = Buffer.from(value, "base64");
    if (raw.length !== 32) throw new Error("APP_ENCRYPTION_KEY phải là khóa base64 32 byte.");
    if (!unique.some(x => x.equals(raw))) unique.push(raw);
  }
  return unique;
}
function encryptSecret(value) {
  const key = tokenKeyBuffers()[0];
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(b => b.toString("base64url")).join(".");
}
function decryptSecret(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) throw new Error("Secret Google mã hóa không hợp lệ.");
  const iv = Buffer.from(parts[0], "base64url");
  const tag = Buffer.from(parts[1], "base64url");
  const encrypted = Buffer.from(parts[2], "base64url");
  let last;
  for (const key of tokenKeyBuffers()) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (error) { last = error; }
  }
  const error = new Error("Không giải mã được Google secret. Kiểm tra APP_ENCRYPTION_KEY.");
  error.cause = last;
  throw error;
}
function mask(value, left = 8, right = 5) {
  const v = String(value || "");
  if (!v) return "";
  if (v.length <= left + right) return `${v.slice(0, Math.min(4, v.length))}…`;
  return `${v.slice(0, left)}…${v.slice(-right)}`;
}
function stateRef(workspace) { return db.collection(GOOGLE_STATES).doc(workspace); }
function normalizeAccountId(v) { return String(v || "").replace(/\D/g, ""); }
function extractSpreadsheetId(input) {
  const v = String(input || "").trim();
  const match = v.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || (/^[a-zA-Z0-9-_]{20,}$/.test(v) ? v : "");
}
function colToNum(col) { let n = 0; for (const c of String(col || "").toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64; return n; }
function numToCol(n) { let s = ""; while (n > 0) { n -= 1; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
function pad2(n) { return String(n).padStart(2, "0"); }
function datePartsInTz(value, timeZone = "Asia/Ho_Chi_Minh") {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { year: obj.year, month: obj.month, day: obj.day };
}
function eventBillingDate(value, timeZone = "Asia/Ho_Chi_Minh") {
  const p = datePartsInTz(value, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}
function billingDateToHeader(date) {
  const [,m,d] = String(date || "").slice(0,10).split("-");
  return `${pad2(d)}/${pad2(m)}`;
}
function parseMoney(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return 0;
  let normalized = cleaned;
  const comma = normalized.lastIndexOf(","), dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) normalized = comma > dot ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  else if (comma >= 0) normalized = normalized.length - comma - 1 <= 2 ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  else if ((normalized.match(/\./g) || []).length > 1) normalized = normalized.replace(/\./g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
function dailyId(workspace, accountId, date) { return crypto.createHash("sha256").update(`${workspace}|${normalizeAccountId(accountId)}|${date}`).digest("hex"); }

function computeSheetTotals({ current = 0, eventTotal = 0, alreadySyncedTotal = 0, storedBaseline = 0, baselineInitialized = false, rewriteExact = false, autoEventTotal = 0 } = {}) {
  if (rewriteExact) {
    const baseline = Number(eventTotal || 0) - Number(autoEventTotal || 0);
    return { baseline, total: Number(eventTotal || 0) };
  }
  const baseline = baselineInitialized ? Number(storedBaseline || 0) : Number(current || 0) - Number(alreadySyncedTotal || 0);
  return { baseline, total: baseline + Number(eventTotal || 0) };
}

async function getState(workspace) {
  const snap = await stateRef(workspace).get();
  return snap.exists ? (snap.data() || {}) : {};
}
async function saveCredentials(workspace, input = {}) {
  const previous = await getState(workspace);
  const clientId = String(input.clientId || previous.googleClientId || "").trim();
  const clientSecret = String(input.clientSecret || "").trim();
  if (!clientId) throw new Error("Hãy nhập Google OAuth Client ID.");
  const patch = { googleClientId: clientId, updatedAt: FieldValue.serverTimestamp() };
  if (clientSecret) patch.googleClientSecretEnc = encryptSecret(clientSecret);
  else if (!previous.googleClientSecretEnc) throw new Error("Hãy nhập Google OAuth Client Secret ở lần cấu hình đầu tiên.");
  await stateRef(workspace).set(patch, { merge: true });
  return { clientIdHint: mask(clientId), secretConfigured: Boolean(clientSecret || previous.googleClientSecretEnc), redirectUri: redirectUri() };
}
async function clientConfig(workspace) {
  const state = await getState(workspace);
  const clientId = String(state.googleClientId || "").trim();
  const clientSecret = state.googleClientSecretEnc ? decryptSecret(state.googleClientSecretEnc) : "";
  if (!clientId || !clientSecret) throw new Error("Chưa cấu hình Google OAuth Client ID/Secret.");
  return { state, clientId, clientSecret };
}
async function createAuthUrl(workspace, returnUrl = "/?section=google") {
  const { clientId } = await clientConfig(workspace);
  const state = crypto.randomBytes(24).toString("hex");
  await db.collection(GOOGLE_OAUTH_STATES).doc(state).set({ workspace, returnUrl: String(returnUrl || "/?section=google").slice(0, 500), expiresAtMs: Date.now() + 10 * 60_000, createdAt: FieldValue.serverTimestamp() });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  return { authUrl: url.toString(), redirectUri: redirectUri() };
}
async function tokenRequest(body) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error_description || json.error || `Google OAuth HTTP ${response.status}`);
  return json;
}
async function exchangeCallback(code, stateValue) {
  const oauthRef = db.collection(GOOGLE_OAUTH_STATES).doc(String(stateValue || ""));
  const oauthSnap = await oauthRef.get();
  if (!oauthSnap.exists) throw new Error("Phiên kết nối Google không hợp lệ hoặc đã được sử dụng.");
  const oauthState = oauthSnap.data() || {};
  if (Number(oauthState.expiresAtMs || 0) < Date.now()) { await oauthRef.delete(); throw new Error("Phiên kết nối Google đã hết hạn."); }
  const workspace = String(oauthState.workspace || "");
  const { clientId, clientSecret, state } = await clientConfig(workspace);
  const tokens = await tokenRequest({ code: String(code || ""), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" });
  if (!tokens.refresh_token && !state.googleRefreshTokenEnc) throw new Error("Google không trả refresh token. Hãy thu hồi quyền ứng dụng trong Google Account rồi kết nối lại với prompt=consent.");
  let email = state.googleEmail || "";
  if (tokens.access_token) {
    const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } }).then(r => r.ok ? r.json() : ({})).catch(() => ({}));
    email = String(info.email || email || "");
  }
  await stateRef(workspace).set({
    googleAccessTokenEnc: tokens.access_token ? encryptSecret(tokens.access_token) : state.googleAccessTokenEnc,
    googleRefreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : state.googleRefreshTokenEnc,
    googleAccessTokenExpiresAtMs: Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000,
    googleEmail: email,
    googleConnectedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await oauthRef.delete();
  return { workspace, email, returnUrl: String(oauthState.returnUrl || "/?section=google") };
}
async function accessToken(workspace) {
  const { state, clientId, clientSecret } = await clientConfig(workspace);
  const expiresAt = Number(state.googleAccessTokenExpiresAtMs || 0);
  if (state.googleAccessTokenEnc && expiresAt > Date.now() + 60_000) return decryptSecret(state.googleAccessTokenEnc);
  if (!state.googleRefreshTokenEnc) throw new Error("Google chưa được kết nối hoặc refresh token không còn hợp lệ.");
  const refreshToken = decryptSecret(state.googleRefreshTokenEnc);
  const tokens = await tokenRequest({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  if (!tokens.access_token) throw new Error("Google không trả access token mới.");
  await stateRef(workspace).set({ googleAccessTokenEnc: encryptSecret(tokens.access_token), googleAccessTokenExpiresAtMs: Date.now() + Math.max(60, Number(tokens.expires_in || 3600)) * 1000, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return tokens.access_token;
}
async function googleFetch(workspace, url, options = {}) {
  const token = await accessToken(workspace);
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  let payload;
  const type = response.headers.get("content-type") || "";
  payload = type.includes("application/json") ? await response.json().catch(() => ({})) : await response.text().catch(() => "");
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error_description || payload?.error || (typeof payload === "string" ? payload : "") || `Google API HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}
function sheetCfg(state) {
  return {
    spreadsheetId: String(state.spreadsheetId || ""),
    spreadsheetTitle: String(state.spreadsheetTitle || ""),
    sheetName: String(state.sheetName || "Chi tiết dòng tiền"),
    headerRow: Math.max(1, Number(state.headerRow || 2)),
    accountIdColumn: String(state.accountIdColumn || "C").toUpperCase(),
    dateStartColumn: String(state.dateStartColumn || "G").toUpperCase(),
    dateEndColumn: String(state.dateEndColumn || "AK").toUpperCase(),
    scanMaxRow: Math.max(10, Math.min(50000, Number(state.scanMaxRow || 5000))),
    autoEnabled: state.googleSheetAutoEnabled === true,
    startFromMs: Number(state.googleSheetStartFromMs || 0),
    onlyVnd: state.googleSheetOnlyVnd !== false,
    timeZone: String(state.googleSheetTimeZone || "Asia/Ho_Chi_Minh"),
  };
}
async function spreadsheetMeta(workspace, spreadsheetId) {
  return googleFetch(workspace, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`);
}
async function saveSheetSettings(workspace, input = {}) {
  const id = extractSpreadsheetId(input.spreadsheetUrl || input.spreadsheetId);
  if (!id) throw new Error("Link hoặc Spreadsheet ID không hợp lệ.");
  const meta = await spreadsheetMeta(workspace, id);
  const names = (meta.sheets || []).map(s => s.properties?.title).filter(Boolean);
  const sheetName = String(input.sheetName || "Chi tiết dòng tiền").trim();
  if (!names.includes(sheetName)) throw new Error(`Không tìm thấy sheet \"${sheetName}\".`);
  const patch = {
    spreadsheetId: id,
    spreadsheetTitle: meta.properties?.title || "",
    sheetName,
    headerRow: Math.max(1, Number(input.headerRow || 2)),
    accountIdColumn: String(input.accountIdColumn || "C").toUpperCase(),
    dateStartColumn: String(input.dateStartColumn || "G").toUpperCase(),
    dateEndColumn: String(input.dateEndColumn || "AK").toUpperCase(),
    scanMaxRow: Math.max(10, Math.min(50000, Number(input.scanMaxRow || 5000))),
    googleSheetOnlyVnd: input.onlyVnd !== false,
    googleSheetTimeZone: String(input.timeZone || "Asia/Ho_Chi_Minh"),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await stateRef(workspace).set(patch, { merge: true });
  return { ...patch, sheets: names };
}
async function valuesGet(workspace, spreadsheetId, range, params = {}) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  return googleFetch(workspace, url.toString());
}
async function valuesUpdate(workspace, spreadsheetId, range, values) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  url.searchParams.set("valueInputOption", "RAW");
  return googleFetch(workspace, url.toString(), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
}
async function valuesBatchUpdate(workspace, spreadsheetId, data) {
  return googleFetch(workspace, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valueInputOption: "RAW", data }) });
}
async function loadSheetIndex(workspace) {
  const state = await getState(workspace), cfg = sheetCfg(state);
  if (!cfg.spreadsheetId) throw new Error("Chưa chọn Google Sheet.");
  const sheet = cfg.sheetName.replace(/'/g, "''");
  const accountRange = `'${sheet}'!${cfg.accountIdColumn}1:${cfg.accountIdColumn}${cfg.scanMaxRow}`;
  const headerRange = `'${sheet}'!${cfg.dateStartColumn}${cfg.headerRow}:${cfg.dateEndColumn}${cfg.headerRow}`;
  const [accounts, headers] = await Promise.all([
    valuesGet(workspace, cfg.spreadsheetId, accountRange, { valueRenderOption: "FORMATTED_VALUE" }),
    valuesGet(workspace, cfg.spreadsheetId, headerRange, { valueRenderOption: "FORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }),
  ]);
  const accountRows = new Map();
  (accounts.values || []).forEach((r, i) => { const id = normalizeAccountId(r?.[0]); if (id && !accountRows.has(id)) accountRows.set(id, i + 1); });
  const dateColumns = new Map();
  (headers.values?.[0] || []).map(v => String(v || "").trim()).forEach((v, i) => {
    const col = numToCol(colToNum(cfg.dateStartColumn) + i);
    dateColumns.set(v, col);
    const m = v.match(/^(\d{1,2})[\/-](\d{1,2})/);
    if (m) dateColumns.set(`${pad2(m[1])}/${pad2(m[2])}`, col);
  });
  return { cfg, sheet, accountRows, dateColumns };
}
function locateFromIndex(index, accountId, billingDate) {
  const normalized = normalizeAccountId(accountId);
  const row = index.accountRows.get(normalized);
  if (!row) { const e = new Error(`Không tìm thấy Account ID ${normalized} trong cột ${index.cfg.accountIdColumn}.`); e.code = "ACCOUNT_NOT_FOUND"; throw e; }
  const wanted = billingDateToHeader(billingDate);
  const column = index.dateColumns.get(wanted);
  if (!column) { const e = new Error(`Không tìm thấy cột ngày ${wanted} trong dòng ${index.cfg.headerRow}.`); e.code = "DATE_NOT_FOUND"; throw e; }
  return { cell: `${column}${row}`, row, column, header: wanted, cfg: index.cfg };
}
async function eligibleEvents(workspace, accountId = "", billingDate = "", options = {}) {
  const state = await getState(workspace), cfg = sheetCfg(state);
  const snap = await db.collection(META_BILLING_EVENTS).doc(workspace).collection("items").get();
  const startFromMs = Number(options.ignoreStart ? 0 : cfg.startFromMs || 0);
  const out = [];
  for (const doc of snap.docs) {
    const r = doc.data() || {};
    const date = eventBillingDate(r.eventTime || Number(r.eventTimeMs || 0), cfg.timeZone);
    const normalizedId = normalizeAccountId(r.accountId);
    const currency = String(r.currency || "").toUpperCase();
    const amount = Number(r.amount || 0);
    if (String(r.eventType || "") !== "ad_account_billing_charge") continue;
    if (!normalizedId || !amount || amount <= 0) continue;
    if (["parse_error", "failed", "estimated"].includes(String(r.status || ""))) continue;
    if (cfg.onlyVnd && currency && currency !== "VND") continue;
    if (startFromMs && Number(r.eventTimeMs || Date.parse(r.eventTime || "") || 0) < startFromMs) continue;
    if (accountId && normalizedId !== normalizeAccountId(accountId)) continue;
    if (billingDate && date !== billingDate) continue;
    out.push({ ref: doc.ref, id: doc.id, ...r, billingDate: date, amount });
  }
  return out;
}
async function syncAccountDateToSheet(workspace, accountId, billingDate, options = {}) {
  const state = await getState(workspace), cfg = sheetCfg(state);
  if (!cfg.spreadsheetId) throw new Error("Chưa chọn Google Sheet.");
  if (!options.force && (!cfg.autoEnabled || !cfg.startFromMs)) return { skipped: true, reason: "auto_disabled" };
  const index = options.index || await loadSheetIndex(workspace);
  const location = locateFromIndex(index, accountId, billingDate);
  const dailyRef = db.collection(SHEET_DAILY).doc(workspace).collection("items").doc(dailyId(workspace, accountId, billingDate));
  const events = await eligibleEvents(workspace, accountId, billingDate, { ignoreStart: options.ignoreStart === true });
  const eventTotal = events.reduce((s, r) => s + Number(r.amount || 0), 0);
  const alreadySyncedTotal = events.filter(r => Number(r.googleSheetSyncedAtMs || 0) > 0).reduce((s, r) => s + Number(r.amount || 0), 0);
  const dailySnap = await dailyRef.get();
  let daily = dailySnap.exists ? (dailySnap.data() || {}) : {};
  let baseline = Number(daily.baselineAmount || 0);
  let total = 0;
  if (options.rewriteExact) {
    // Manual reconciliation giống website mẫu: ghi chính xác toàn bộ bill đã quét.
    // Baseline giữ phần lịch sử nằm ngoài mốc auto, để bill mới tiếp tục cộng đúng.
    const autoEvents = await eligibleEvents(workspace, accountId, billingDate, { ignoreStart: false });
    const autoEventTotal = autoEvents.reduce((s, r) => s + Number(r.amount || 0), 0);
    ({ baseline, total } = computeSheetTotals({ eventTotal, autoEventTotal, rewriteExact: true }));
  } else {
    let current = 0;
    if (!daily.baselineInitialized) {
      const cellData = await valuesGet(workspace, cfg.spreadsheetId, `'${index.sheet}'!${location.cell}`, { valueRenderOption: "UNFORMATTED_VALUE" });
      current = parseMoney(cellData.values?.[0]?.[0]);
    }
    ({ baseline, total } = computeSheetTotals({ current, eventTotal, alreadySyncedTotal, storedBaseline: daily.baselineAmount, baselineInitialized: !!daily.baselineInitialized }));
  }
  await valuesUpdate(workspace, cfg.spreadsheetId, `'${index.sheet}'!${location.cell}`, [[total]]);
  const syncedAtMs = Date.now();
  for (const event of events) {
    await event.ref.set({ googleSheetSyncedAtMs: syncedAtMs, googleSheetCell: location.cell, googleSheetBillingDate: billingDate, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await dailyRef.set({
    accountId: normalizeAccountId(accountId), billingDate, sheetCell: location.cell,
    baselineAmount: baseline, baselineInitialized: true, lastEventTotal: eventTotal,
    lastWrittenTotal: total, lastEventCount: events.length, lastSyncedEventCount: events.length,
    lastSheetSyncedAtMs: syncedAtMs, updatedAt: FieldValue.serverTimestamp(),
    manualReconciledAtMs: options.rewriteExact ? syncedAtMs : Number(daily.manualReconciledAtMs || 0),
  }, { merge: true });
  return { skipped: false, cell: location.cell, baseline, eventTotal, alreadySyncedTotal, total, eventCount: events.length };
}
async function autoSyncEventGroups(workspace, events = []) {
  try {
    const state = await getState(workspace), cfg = sheetCfg(state);
    if (!cfg.autoEnabled || !cfg.spreadsheetId || !cfg.startFromMs) return { enabled: false, written: 0, errors: [] };
    const groups = new Map();
    for (const e of events || []) {
      if (String(e.eventType || "") !== "ad_account_billing_charge" || Number(e.amount || 0) <= 0) continue;
      const atMs = Number(e.eventTimeMs || Date.parse(e.eventTime || "") || 0);
      if (atMs < cfg.startFromMs) continue;
      if (cfg.onlyVnd && String(e.currency || "").toUpperCase() !== "VND") continue;
      const date = eventBillingDate(e.eventTime || atMs, cfg.timeZone);
      const id = normalizeAccountId(e.accountId);
      if (!id) continue;
      groups.set(`${id}|${date}`, { accountId: id, billingDate: date });
    }
    if (!groups.size) return { enabled: true, written: 0, errors: [] };
    const index = await loadSheetIndex(workspace);
    const results = [], errors = [];
    for (const group of groups.values()) {
      try { results.push(await syncAccountDateToSheet(workspace, group.accountId, group.billingDate, { index })); }
      catch (error) { errors.push({ ...group, error: error.message, code: error.code || "" }); }
    }
    await stateRef(workspace).set({ googleSheetLastAutoSyncAtMs: Date.now(), googleSheetLastAutoWritten: results.length, googleSheetLastErrors: errors.slice(0,50), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { enabled: true, written: results.length, results, errors };
  } catch (error) {
    await stateRef(workspace).set({ googleSheetLastError: error.message || String(error), googleSheetLastAutoSyncAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    return { enabled: true, written: 0, errors: [{ error: error.message || String(error) }] };
  }
}
async function fillAll(workspace, input = {}) {
  const state = await getState(workspace), cfg = sheetCfg(state);
  if (!cfg.spreadsheetId) throw new Error("Chưa chọn Google Sheet.");
  const events = await eligibleEvents(workspace, String(input.accountId || ""), "", { ignoreStart: true });
  const from = String(input.from || "").slice(0,10), to = String(input.to || "").slice(0,10);
  const groups = new Map();
  for (const e of events) {
    if (from && e.billingDate < from) continue;
    if (to && e.billingDate > to) continue;
    groups.set(`${normalizeAccountId(e.accountId)}|${e.billingDate}`, { accountId: normalizeAccountId(e.accountId), billingDate: e.billingDate });
  }
  const index = await loadSheetIndex(workspace), results = [], errors = [];
  for (const group of groups.values()) {
    try { results.push(await syncAccountDateToSheet(workspace, group.accountId, group.billingDate, { index, force: true, ignoreStart: true, rewriteExact: true })); }
    catch (error) { errors.push({ ...group, error: error.message, code: error.code || "" }); }
  }
  await stateRef(workspace).set({ googleSheetLastManualFillAtMs: Date.now(), googleSheetLastManualWritten: results.length, googleSheetLastErrors: errors.slice(0,50), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { written: results.length, results, errors };
}
async function startNow(workspace, enabled = true, options = {}) {
  const patch = { googleSheetAutoEnabled: enabled !== false, googleSheetStartFromMs: enabled === false ? 0 : Date.now(), googleSheetOnlyVnd: options.onlyVnd !== false, updatedAt: FieldValue.serverTimestamp() };
  await stateRef(workspace).set(patch, { merge: true });
  return { autoEnabled: patch.googleSheetAutoEnabled, startFromMs: patch.googleSheetStartFromMs };
}
async function disconnect(workspace) {
  await stateRef(workspace).set({ googleAccessTokenEnc: FieldValue.delete(), googleRefreshTokenEnc: FieldValue.delete(), googleAccessTokenExpiresAtMs: 0, googleEmail: "", googleConnectedAtMs: 0, googleSheetAutoEnabled: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { disconnected: true };
}
async function testSheet(workspace) {
  const state = await getState(workspace), cfg = sheetCfg(state);
  if (!cfg.spreadsheetId) throw new Error("Chưa chọn Google Sheet.");
  const meta = await spreadsheetMeta(workspace, cfg.spreadsheetId);
  return { spreadsheetId: cfg.spreadsheetId, title: meta.properties?.title || cfg.spreadsheetTitle, sheetName: cfg.sheetName, sheets: (meta.sheets || []).map(s => s.properties?.title).filter(Boolean) };
}
async function status(workspace) {
  const state = await getState(workspace), cfg = sheetCfg(state);
  const connected = Boolean(state.googleRefreshTokenEnc || state.googleAccessTokenEnc);
  return {
    connected,
    email: state.googleEmail || "",
    clientConfigured: Boolean(state.googleClientId && state.googleClientSecretEnc),
    clientIdHint: mask(state.googleClientId || ""),
    redirectUri: redirectUri(),
    spreadsheetConfigured: Boolean(cfg.spreadsheetId),
    spreadsheetIdHint: mask(cfg.spreadsheetId),
    spreadsheetTitle: cfg.spreadsheetTitle,
    ...cfg,
    lastAutoSyncAtMs: Number(state.googleSheetLastAutoSyncAtMs || 0),
    lastManualFillAtMs: Number(state.googleSheetLastManualFillAtMs || 0),
    lastAutoWritten: Number(state.googleSheetLastAutoWritten || 0),
    lastManualWritten: Number(state.googleSheetLastManualWritten || 0),
    lastError: state.googleSheetLastError || "",
    lastErrors: Array.isArray(state.googleSheetLastErrors) ? state.googleSheetLastErrors : [],
  };
}

module.exports = {
  status, saveCredentials, createAuthUrl, exchangeCallback, disconnect,
  saveSheetSettings, testSheet, startNow, fillAll, autoSyncEventGroups,
  eventBillingDate, billingDateToHeader, extractSpreadsheetId, computeSheetTotals,
};
