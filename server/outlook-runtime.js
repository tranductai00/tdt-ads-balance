"use strict";

const crypto = require("crypto");
const webpush = require("web-push");
const { getStore, FieldValue } = require("./store");
// Portable Vercel runtime: same HTTP/job API as the previous build,
// but persistence is PostgreSQL and browser notifications use standard Web Push.
const onRequest = (_options, handler) => handler;
const onSchedule = (_options, handler) => handler;
const defineSecret = (name) => ({ value: () => String(process.env[name] || "") });
const defineString = (name, options = {}) => ({
  value: () => String(process.env[name] || options.default || ""),
});

function inferPublicBaseUrl() {
  const explicit = String(process.env.OUTLOOK_PUBLIC_BASE_URL || process.env.WEB_APP_BASE_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const domain = String(
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    ""
  ).trim();
  if (domain) return `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

const db = getStore();

const REGION = "asia-southeast1";
const MS_CLIENT_ID = defineSecret("MS_CLIENT_ID");
const MS_CLIENT_SECRET = defineSecret("MS_CLIENT_SECRET");
const OUTLOOK_TOKEN_KEY = defineSecret("OUTLOOK_TOKEN_KEY");
const APP_ENCRYPTION_KEY = defineSecret("APP_ENCRYPTION_KEY");
const OUTLOOK_PUBLIC_BASE_URL = defineString("OUTLOOK_PUBLIC_BASE_URL", { default: inferPublicBaseUrl() });
const MS_TENANT = defineString("MS_TENANT", { default: "common" });
const WEB_APP_BASE_URL = defineString("WEB_APP_BASE_URL", { default: inferPublicBaseUrl() });
const VAPID_PUBLIC_KEY = defineSecret("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = defineString("VAPID_SUBJECT", { default: "mailto:admin@example.com" });

const CONNECTIONS = "t_balance_outlook";
const STATES = "t_balance_outlook_states";
const RECEIPTS = "t_balance_outlook_receipts";
const WORKSPACES = "t_balance_workspaces";
const LEGACY_WORKSPACES = "t_balance";
const BALANCE_NOTIFICATION_STATES = "t_balance_notification_states";
const DEVICE_PAIRINGS = "t_balance_device_pairings";
const ADSCHECK_STATES = "t_balance_adscheck"; // Giữ tên collection cũ để tương thích dữ liệu v5.6
const META_BILLING_EVENTS = "t_balance_meta_billing_events";
const META_GRAPH_DEFAULT_VERSION = "v26.0";
const META_GRAPH_BASE = "https://graph.facebook.com";
const DEFAULT_SENDER = "noreply@business-updates.facebook.com";
const GRAPH_SCOPE = "openid profile offline_access User.Read Mail.Read";

function baseUrl() {
  return String(OUTLOOK_PUBLIC_BASE_URL.value() || "").replace(/\/+$/, "");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function safeEqualHex(a, b) {
  const aa = Buffer.from(String(a || ""), "hex");
  const bb = Buffer.from(String(b || ""), "hex");
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function tokenKeyBuffers() {
  const candidates = [
    ["APP_ENCRYPTION_KEY", String(APP_ENCRYPTION_KEY.value() || "").trim()],
    ["OUTLOOK_TOKEN_KEY", String(OUTLOOK_TOKEN_KEY.value() || "").trim()],
  ].filter(([, value]) => value);
  if (!candidates.length) {
    throw new Error("Thiếu APP_ENCRYPTION_KEY (hoặc OUTLOOK_TOKEN_KEY tương thích cũ). Tạo khóa base64 32 byte bằng: openssl rand -base64 32");
  }
  const seen = new Set();
  return candidates.map(([label, configured]) => {
    const raw = Buffer.from(configured, "base64");
    if (raw.length !== 32) throw new Error(`${label} phải là khóa base64 32 byte.`);
    return { label, raw };
  }).filter(({ raw }) => {
    const id = raw.toString("hex");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  // Dữ liệu mới ưu tiên APP_ENCRYPTION_KEY. Nếu nâng cấp từ bản cũ chỉ có
  // OUTLOOK_TOKEN_KEY thì vẫn tiếp tục dùng khóa cũ mà không làm gián đoạn.
  const key = tokenKeyBuffers()[0].raw;
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString("base64url")).join(".");
}

function decryptSecret(value) {
  const [ivText, tagText, encryptedText] = String(value || "").split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Secret mã hóa không hợp lệ.");
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const encrypted = Buffer.from(encryptedText, "base64url");
  let lastError = null;
  // Thử APP_ENCRYPTION_KEY trước, sau đó OUTLOOK_TOKEN_KEY để đọc được token
  // đã mã hóa từ v6.0 khi người dùng thêm khóa APP mới ở v6.1.
  for (const { raw } of tokenKeyBuffers()) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", raw, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error("Không giải mã được secret. Kiểm tra APP_ENCRYPTION_KEY/OUTLOOK_TOKEN_KEY.");
  error.cause = lastError;
  throw error;
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function normalizeWorkspace(value) {
  const workspace = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(workspace)) {
    throw new Error("Workspace không hợp lệ.");
  }
  return workspace;
}

function configuredWebUrl() {
  try { return new URL(String(WEB_APP_BASE_URL.value() || inferPublicBaseUrl())); }
  catch { return new URL("http://localhost:3000"); }
}

function allowedWebOrigins() {
  const configured = configuredWebUrl();
  return new Set([
    configured.origin,
    "https://tranductai.xyz",
    "https://www.tranductai.xyz",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
  ]);
}

function normalizeReturnUrl(value) {
  const raw = String(value || configuredWebUrl().toString()).trim();
  const url = new URL(raw);
  if (!allowedWebOrigins().has(url.origin)) throw new Error("returnUrl không được phép.");
  return url.toString();
}

function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (allowedWebOrigins().has(origin) || origin.startsWith("chrome-extension://")) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Device-Name, Cache-Control");
  res.set("Cache-Control", "no-store");
}

// v6.1.2: Web UI cùng origin được tự khôi phục/cấp quyền thiết bị.
// Pairing vẫn giữ cho Extension hoặc khi bật DEVICE_PAIRING_REQUIRED=true.
function devicePairingRequired() {
  return /^(1|true|yes|on)$/i.test(String(process.env.DEVICE_PAIRING_REQUIRED || "").trim());
}

function requestOrigin(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const proto = String(req.headers["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https")).split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

function isTrustedWebClient(req, body = {}) {
  if (String(body?.clientType || "").toLowerCase() !== "web") return false;
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  const currentOrigin = requestOrigin(req).replace(/\/+$/, "");
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (origin && (origin === currentOrigin || allowedWebOrigins().has(origin))) return true;
  // Một số browser/proxy không gửi Origin cho request same-origin.
  if (!origin && fetchSite === "same-origin" && currentOrigin) return true;
  return false;
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(String(req.body || "{}"));
  } catch {
    return {};
  }
}

function deviceIdFromHash(keyHash) {
  return String(keyHash || "").slice(0, 16);
}

function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return Number(value.toMillis() || 0);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function deviceListFromConnection(connection, currentKeyHash = "") {
  const devices = connection?.devices && typeof connection.devices === "object" ? connection.devices : {};
  return authorizedKeyHashes(connection).map((keyHash) => {
    const deviceId = deviceIdFromHash(keyHash);
    const meta = devices[deviceId] || {};
    return {
      deviceId,
      name: String(meta.name || "Thiết bị T Balance").trim().slice(0, 80),
      firstSeenAtMs: timestampToMs(meta.firstSeenAt),
      lastSeenAtMs: timestampToMs(meta.lastSeenAt),
      isCurrent: !!currentKeyHash && safeEqualHex(keyHash, currentKeyHash),
    };
  }).sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return Number(b.lastSeenAtMs || 0) - Number(a.lastSeenAtMs || 0);
  });
}

function authorizedKeyHashes(connection) {
  const values = [];
  if (connection?.keyHash) values.push(String(connection.keyHash));
  if (Array.isArray(connection?.authorizedKeyHashes)) {
    connection.authorizedKeyHashes.forEach((value) => values.push(String(value || "")));
  }
  return [...new Set(values.filter((value) => /^[a-f0-9]{64}$/i.test(value)))];
}

function revokedKeyHashes(connection) {
  const values = Array.isArray(connection?.revokedKeyHashes) ? connection.revokedKeyHashes : [];
  return [...new Set(values.map((value) => String(value || "")).filter((value) => /^[a-f0-9]{64}$/i.test(value)))];
}

function isRevokedKey(connection, syncKey) {
  if (String(syncKey || "").length < 20) return false;
  const candidate = sha256(syncKey);
  return revokedKeyHashes(connection).some((stored) => safeEqualHex(stored, candidate));
}

function isAuthorizedKey(connection, syncKey) {
  if (String(syncKey || "").length < 20) return false;
  const candidate = sha256(syncKey);
  return authorizedKeyHashes(connection).some((stored) => safeEqualHex(stored, candidate));
}

function deviceAuthError() {
  const error = new Error("Thiết bị này chưa được cấp quyền. Hãy dùng mã ghép từ thiết bị đã đăng nhập.");
  error.status = 403;
  error.code = "DEVICE_NOT_AUTHORIZED";
  return error;
}

async function markDevice(ref, connection, keyHash, deviceName = "") {
  const id = deviceIdFromHash(keyHash);
  const existing = connection?.devices?.[id] || {};
  const cleanName = String(deviceName || existing.name || "Thiết bị T Balance").trim().slice(0, 80);
  await ref.set({
    authorizedKeyHashes: FieldValue.arrayUnion(keyHash),
    devices: {
      ...(connection?.devices || {}),
      [id]: {
        name: cleanName,
        firstSeenAt: existing.firstSeenAt || FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      },
    },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return id;
}

async function autoAuthorizeTrustedWebDevice(workspace, syncKey, deviceName, req, body = {}, existingConnection = null) {
  if (devicePairingRequired() || !isTrustedWebClient(req, body) || String(syncKey || "").length < 20) return false;
  const ref = db.collection(CONNECTIONS).doc(workspace);
  let connection = existingConnection;
  if (!connection) {
    const snap = await ref.get();
    connection = snap.exists ? (snap.data() || {}) : null;
  }
  if (!connection) return false;
  if (isAuthorizedKey(connection, syncKey)) return true;
  if (isRevokedKey(connection, syncKey)) return false;
  const keyHash = sha256(syncKey);
  await markDevice(ref, connection, keyHash, deviceName || "Web T Balance");
  return true;
}

async function verifyConnectionKey(workspace, syncKey, deviceName = "") {
  const ref = db.collection(CONNECTIONS).doc(workspace);
  const snap = await ref.get();
  if (!snap.exists) return { ref, snap, connection: null };
  const connection = snap.data() || {};
  if (!isAuthorizedKey(connection, syncKey)) throw deviceAuthError();
  const keyHash = sha256(syncKey);
  // Tự di chuyển dữ liệu v4.7.2 từ một keyHash sang danh sách nhiều thiết bị.
  if (!Array.isArray(connection.authorizedKeyHashes) || !connection.authorizedKeyHashes.includes(keyHash)) {
    await markDevice(ref, connection, keyHash, deviceName);
  }
  return { ref, snap, connection: { ...connection, authorizedKeyHashes: authorizedKeyHashes(connection) } };
}

async function ensureWorkspaceKey(workspace, syncKey, deviceName = "", requestContext = null) {
  if (String(syncKey || "").length < 20) {
    const error = new Error("Khóa thiết bị phải có ít nhất 20 ký tự.");
    error.status = 400;
    error.code = "DEVICE_KEY_REQUIRED";
    throw error;
  }
  const ref = db.collection(CONNECTIONS).doc(workspace);
  const snap = await ref.get();
  const keyHash = sha256(syncKey);
  if (snap.exists) {
    let connection = snap.data() || {};
    if (!isAuthorizedKey(connection, syncKey)) {
      const autoAuthorized = requestContext?.req
        ? await autoAuthorizeTrustedWebDevice(workspace, syncKey, deviceName, requestContext.req, requestContext.body || {}, connection)
        : false;
      if (!autoAuthorized) throw deviceAuthError();
      const refreshed = await ref.get();
      connection = refreshed.exists ? (refreshed.data() || {}) : connection;
    }
    const id = deviceIdFromHash(keyHash);
    const needsMigration = !Array.isArray(connection.authorizedKeyHashes)
      || !connection.authorizedKeyHashes.includes(keyHash)
      || !connection.devices?.[id];
    if (needsMigration) await markDevice(ref, connection, keyHash, deviceName);
    return { ref, connection: { ...connection, authorizedKeyHashes: authorizedKeyHashes(connection) } };
  }
  const settings = {
    sender: DEFAULT_SENDER,
    autoDeduct: true,
    deductionMode: "exact",
    autoScan: true,
    pushEnabled: true,
    onlyAfterStart: true,
    processFrom: new Date().toISOString(),
  };
  const id = deviceIdFromHash(keyHash);
  const connection = {
    keyHash,
    authorizedKeyHashes: [keyHash],
    revokedKeyHashes: [],
    devices: {
      [id]: {
        name: String(deviceName || "Thiết bị đầu tiên").trim().slice(0, 80),
        firstSeenAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      },
    },
    status: "not_connected",
    settings,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(connection, { merge: true });
  return { ref, connection };
}

async function readWorkspacePayload(workspace) {
  const primaryRef = db.collection(WORKSPACES).doc(workspace);
  const primarySnap = await primaryRef.get();
  if (primarySnap.exists) {
    const raw = primarySnap.data() || {};
    return {
      payload: getPayload(raw),
      updatedAtMs: timestampToMs(raw.updatedAt),
      source: WORKSPACES,
    };
  }
  const legacyRef = db.collection(LEGACY_WORKSPACES).doc(workspace);
  const legacySnap = await legacyRef.get();
  if (legacySnap.exists) {
    const raw = legacySnap.data() || {};
    return {
      payload: getPayload(raw),
      updatedAtMs: timestampToMs(raw.updatedAt),
      source: LEGACY_WORKSPACES,
    };
  }
  return {
    payload: { banks: [], adAccounts: [], transactions: [], settings: {} },
    updatedAtMs: 0,
    source: null,
  };
}

function sanitizeWorkspacePayload(value) {
  const payload = getPayload(value || {});
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > 850000) {
    const error = new Error("Dữ liệu workspace vượt quá giới hạn an toàn 850 KB.");
    error.status = 413;
    throw error;
  }
  return payload;
}


const ADSCHECK_SERVER_FIELDS = Object.freeze([
  "adsCheckBalance", "adsCheckSelected", "remainingThreshold", "paymentCardLast4",
  "paymentCardBrand", "billingNextDate", "billingNextDateText", "billingPageBalance",
  "billingLastSyncAt", "billingSourceUrl", "billingExtension",
  "adsCheckStatus", "adsCheckOwnerId", "adsCheckLimit", "adsCheckCurrency",
  "lastAdsCheckSyncAt", "adsCheck",
  // v5.7+ Meta API fields - giữ lại khi web cũ push workspace đồng thời.
  "metaApiBalance", "metaAmountSpent", "metaFundingSourceId", "metaBusinessName",
  "metaLastSyncAt", "metaCurrency"
]);

function adsCheckTimestamp(ad) {
  const candidates = [ad?.metaLastSyncAt, ad?.billingLastSyncAt, ad?.lastAdsCheckSyncAt, ad?.adsCheck?.scannedAt, ad?.adsCheck?.lastSyncAt];
  for (const value of candidates) {
    const ms = Date.parse(String(value || ""));
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return 0;
}

function adRecordKey(ad) {
  const id = String(ad?.id || "").trim();
  if (id) return `id:${id}`;
  const accountId = normalizeAccountId(ad?.accountId);
  return accountId ? `account:${accountId}` : "";
}

function txRecordKey(tx) {
  const id = String(tx?.id || "").trim();
  if (id) return `id:${id}`;
  const outlook = String(tx?.outlookMessageId || "").trim();
  if (outlook) return `outlook:${outlook}`;
  const txId = String(tx?.txId || "").trim().toLowerCase();
  if (txId) return `tx:${txId}:${String(tx?.type || "")}`;
  return `fallback:${String(tx?.createdAt || "")}:${Number(tx?.amount || 0)}:${String(tx?.adAccountId || tx?.bankId || "")}`;
}

function mergeConcurrentWorkspacePayload(serverValue, clientValue) {
  const server = getPayload(serverValue || {});
  const client = getPayload(clientValue || {});
  const serverByKey = new Map();
  const serverByAccount = new Map();
  for (const ad of server.adAccounts) {
    const key = adRecordKey(ad);
    if (key) serverByKey.set(key, ad);
    const accountId = normalizeAccountId(ad?.accountId);
    if (accountId) serverByAccount.set(accountId, ad);
  }

  const deletedIdSource = Array.isArray(client.settings?.deletedAdAccountIds)
    ? client.settings.deletedAdAccountIds
    : (Array.isArray(server.settings?.deletedAdAccountIds) ? server.settings.deletedAdAccountIds : []);
  const deletedAdIds = new Set(deletedIdSource.map(normalizeAccountId).filter(Boolean));

  const mergedAds = client.adAccounts
    .filter((clientAd) => !deletedAdIds.has(normalizeAccountId(clientAd?.accountId)))
    .map((clientAd) => {
    const key = adRecordKey(clientAd);
    const accountId = normalizeAccountId(clientAd?.accountId);
    const serverAd = (key && serverByKey.get(key)) || (accountId && serverByAccount.get(accountId));
    if (!serverAd) return clientAd;
    const serverStamp = adsCheckTimestamp(serverAd);
    const clientStamp = adsCheckTimestamp(clientAd);
    if (!serverStamp || serverStamp <= clientStamp) return clientAd;
    const merged = { ...serverAd, ...clientAd };
    for (const field of ADSCHECK_SERVER_FIELDS) {
      if (serverAd[field] !== undefined) merged[field] = serverAd[field];
    }
    if (serverAd.threshold !== undefined) merged.threshold = serverAd.threshold;
    if (!clientAd.bankId && serverAd.bankId) merged.bankId = serverAd.bankId;
    if ((!clientAd.name || ["adscheck_smit", "meta_api"].includes(clientAd.createdFrom)) && serverAd.name) merged.name = serverAd.name;
    return merged;
  });

  const clientAdKeys = new Set(mergedAds.flatMap((ad) => {
    const values = [];
    const key = adRecordKey(ad);
    const accountId = normalizeAccountId(ad?.accountId);
    if (key) values.push(key);
    if (accountId) values.push(`account:${accountId}`);
    return values;
  }));
  for (const serverAd of server.adAccounts) {
    const key = adRecordKey(serverAd);
    const accountKey = normalizeAccountId(serverAd?.accountId) ? `account:${normalizeAccountId(serverAd.accountId)}` : "";
    if ((key && clientAdKeys.has(key)) || (accountKey && clientAdKeys.has(accountKey))) continue;
    if (deletedAdIds.has(normalizeAccountId(serverAd?.accountId))) continue;
    if (serverAd.lastAdsCheckSyncAt || serverAd.adsCheck || ["adscheck_smit", "meta_api"].includes(serverAd.createdFrom)) mergedAds.push(serverAd);
  }

  const mergedTransactions = [...client.transactions];
  const clientTxKeys = new Set(client.transactions.map(txRecordKey));
  for (const serverTx of server.transactions) {
    const key = txRecordKey(serverTx);
    if (!clientTxKeys.has(key)) {
      mergedTransactions.push(serverTx);
      clientTxKeys.add(key);
    }
  }

  const serverAdsSettings = server.settings?.adsCheck && typeof server.settings.adsCheck === "object"
    ? server.settings.adsCheck : {};
  const clientAdsSettings = client.settings?.adsCheck && typeof client.settings.adsCheck === "object"
    ? client.settings.adsCheck : {};
  const serverSettingsStamp = Number(serverAdsSettings.lastSyncAtMs || Date.parse(serverAdsSettings.lastSyncAt || "") || 0);
  const clientSettingsStamp = Number(clientAdsSettings.lastSyncAtMs || Date.parse(clientAdsSettings.lastSyncAt || "") || 0);
  const mergedSettings = {
    ...server.settings,
    ...client.settings,
    adsCheck: serverSettingsStamp > clientSettingsStamp
      ? { ...clientAdsSettings, ...serverAdsSettings }
      : { ...serverAdsSettings, ...clientAdsSettings },
  };

  return sanitizeWorkspacePayload({
    banks: client.banks,
    adAccounts: mergedAds,
    transactions: mergedTransactions,
    settings: mergedSettings,
  });
}

async function tokenRequest(params) {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(MS_TENANT.value())}/oauth2/v2.0/token`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) {
    const error = new Error(payload.error_description || payload.error || `Microsoft token HTTP ${response.status}`);
    error.status = response.status;
    error.oauthCode = String(payload.error || "");
    error.transient = response.status === 429 || response.status >= 500 || ["temporarily_unavailable", "server_error"].includes(error.oauthCode);
    error.reconnectRequired = error.oauthCode === "invalid_grant" || /revoked|expired|AADSTS70008|AADSTS700082/i.test(String(error.message || ""));
    throw error;
  }
  return payload;
}

async function graphRequest(path, accessToken, options = {}) {
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path.startsWith("/") ? path : `/${path}`}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    ...(options.headers || {}),
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error_description || payload?.raw || `Microsoft Graph HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function getAccessToken(workspace, connection, ref) {
  const expiresAt = Number(connection.accessTokenExpiresAt || 0);
  if (connection.accessTokenEnc && expiresAt > Date.now() + 5 * 60 * 1000) {
    return { token: decryptSecret(connection.accessTokenEnc), connection };
  }

  if (!connection.refreshTokenEnc) {
    const error = new Error("Outlook cần kết nối lại vì không còn refresh token.");
    error.reconnectRequired = true;
    throw error;
  }

  let refreshed = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      refreshed = await tokenRequest({
        client_id: MS_CLIENT_ID.value(),
        client_secret: MS_CLIENT_SECRET.value(),
        grant_type: "refresh_token",
        refresh_token: decryptSecret(connection.refreshTokenEnc),
        scope: GRAPH_SCOPE,
      });
      break;
    } catch (error) {
      lastError = error;
      if (!error.transient || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }

  if (!refreshed) {
    if (lastError?.reconnectRequired) {
      await ref.set({
        status: "reconnect_required",
        lastAuthError: lastError.message,
        lastAuthErrorAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      // Lỗi mạng/Microsoft tạm thời không được biến thành đăng xuất.
      await ref.set({
        connectionHealth: "temporary_error",
        lastTransientError: lastError?.message || "Không làm mới được token",
        lastTransientErrorAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    throw lastError || new Error("Không làm mới được phiên Outlook.");
  }

  const patch = {
    accessTokenEnc: encryptSecret(refreshed.access_token),
    accessTokenExpiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    updatedAt: FieldValue.serverTimestamp(),
    status: "connected",
    connectionHealth: "ok",
    lastTransientError: FieldValue.delete(),
    lastAuthError: FieldValue.delete(),
  };
  if (refreshed.refresh_token) patch.refreshTokenEnc = encryptSecret(refreshed.refresh_token);
  await ref.set(patch, { merge: true });
  const next = { ...connection, ...patch };
  return { token: refreshed.access_token, connection: next };
}

function subscriptionExpiration() {
  return new Date(Date.now() + (6 * 24 + 20) * 60 * 60 * 1000).toISOString();
}

async function createSubscription(accessToken, clientState) {
  return graphRequest("/subscriptions", accessToken, {
    method: "POST",
    body: {
      changeType: "created",
      notificationUrl: `${baseUrl()}/outlookWebhook`,
      lifecycleNotificationUrl: `${baseUrl()}/outlookWebhook`,
      resource: "me/mailFolders('inbox')/messages",
      expirationDateTime: subscriptionExpiration(),
      clientState,
      latestSupportedTlsVersion: "v1_2",
    },
  });
}

async function renewSubscription(workspace, ref, connection) {
  const auth = await getAccessToken(workspace, connection, ref);
  const accessToken = auth.token;
  let subscription = null;
  if (connection.subscriptionId) {
    try {
      subscription = await graphRequest(`/subscriptions/${encodeURIComponent(connection.subscriptionId)}`, accessToken, {
        method: "PATCH",
        body: { expirationDateTime: subscriptionExpiration() },
      });
    } catch (error) {
      console.warn("Không gia hạn được subscription cũ, tạo mới:", error.message);
    }
  }
  if (!subscription) {
    subscription = await createSubscription(accessToken, connection.clientState || randomToken(24));
  }
  await ref.set({
    subscriptionId: subscription.id,
    subscriptionExpiresAt: subscription.expirationDateTime,
    clientState: connection.clientState || subscription.clientState || randomToken(24),
    status: "connected",
    connectionHealth: "ok",
    lastError: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return subscription;
}

function htmlToText(input) {
  return String(input || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseVndNumber(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  const amount = Number(digits);
  return Number.isSafeInteger(amount) ? amount : 0;
}

function extractAmount(text) {
  const patterns = [
    /(?:số tiền đã lập hóa đơn|so tien da lap hoa don|amount billed|invoice amount|tổng số tiền|tong so tien|total amount)[^\d]{0,60}(\d{1,3}(?:[.,\s]\d{3})+|\d{4,12})\s*(?:đ|vnd|vnđ)?/i,
    /(\d{1,3}(?:[.,\s]\d{3})+|\d{4,12})\s*(?:đ|vnd|vnđ)\b/i,
  ];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    const amount = parseVndNumber(match?.[1]);
    if (amount > 0) return amount;
  }
  return 0;
}

function extractNearLabel(text, labels, pattern) {
  const raw = String(text || "");
  for (const label of labels) {
    const index = normalizeText(raw).indexOf(normalizeText(label));
    if (index < 0) continue;
    const windowText = raw.slice(Math.max(0, index), index + 400);
    const match = windowText.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }
  return "";
}

function extractTransactionId(text) {
  const direct = extractNearLabel(
    text,
    ["ID giao dịch", "Transaction ID"],
    /(?:id giao dịch|id giao dich|transaction id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._-]{7,120})/i,
  );
  if (direct) return direct.replace(/[^A-Z0-9._-]+$/i, "");
  const dashed = String(text || "").match(/\b\d{10,40}-\d{6,40}\b/);
  return dashed?.[0] || "";
}

function extractAdAccountId(text) {
  const raw = String(text || "");
  const patterns = [
    // Mẫu email Meta mới: "Biên lai quảng cáo Meta của bạn (ID tài khoản: 1503335338036239)"
    /(?:id\s*(?:tài khoản|tai khoan)|account\s*id)\s*[:#-]?\s*(?:act[_\s-]*)?(\d[\d .-]{8,32}\d)/i,
    /\((?:id\s*)?(?:tài khoản|tai khoan|account)\s*[:#-]?\s*(?:act[_\s-]*)?(\d[\d .-]{8,32}\d)\)/i,
    /(?:biên lai(?: quảng cáo)?(?: meta)?(?: của bạn)?|bien lai(?: quang cao)?(?: meta)?(?: cua ban)?|receipt for)[\s\S]{0,220}?\((?:[^\d]{0,50})?(\d[\d .-]{8,32}\d)\)/i,
    /(?:tài khoản quảng cáo|tai khoan quang cao|ad account)[^\d]{0,100}(\d[\d .-]{8,32}\d)/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const digits = onlyDigits(match?.[1] || "");
    if (digits.length >= 8 && digits.length <= 30) return digits;
  }
  return "";
}

function extractCardLast4(text) {
  const match = String(text || "").match(/(?:visa|mastercard|master card|amex|american express|jcb|phương thức thanh toán|payment method)[\s\S]{0,100}?(\d{4})\b/i);
  return match?.[1] || "";
}

function extractReference(text) {
  return extractNearLabel(
    text,
    ["Số tham chiếu", "Reference number", "Reference"],
    /(?:số tham chiếu|so tham chieu|reference(?: number)?)\s*[:#-]?\s*([A-Z0-9-]{5,50})/i,
  );
}

function parseMetaReceipt(message) {
  const body = htmlToText(message?.body?.content || message?.bodyPreview || "");
  const subject = String(message?.subject || "");
  const combined = `${subject}\n${body}`;
  const normalized = normalizeText(combined);
  const isMeta = normalized.includes("meta") && (
    normalized.includes("so tien da lap hoa don") ||
    normalized.includes("amount billed") ||
    normalized.includes("id giao dich") ||
    normalized.includes("transaction id")
  );
  return {
    isMeta,
    subject,
    body,
    amount: extractAmount(combined),
    txId: extractTransactionId(combined),
    adAccountId: extractAdAccountId(combined),
    cardLast4: extractCardLast4(combined),
    reference: extractReference(combined),
  };
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function matchAdAccount(payload, parsed) {
  const deletedIds = deletedAdAccountIdSet(payload?.settings || {});
  const ads = (Array.isArray(payload.adAccounts) ? payload.adAccounts : [])
    .filter((ad) => !deletedIds.has(normalizeAccountId(ad.accountId)));
  const banks = Array.isArray(payload.banks) ? payload.banks : [];
  const parsedId = onlyDigits(parsed.adAccountId);

  if (parsedId) {
    const exact = ads.find((ad) => onlyDigits(ad.accountId) === parsedId);
    if (exact) return { ad: exact, reason: "account_id" };

    // Một số dữ liệu cũ bị cắt tiền tố act_ hoặc chứa ký tự phân cách.
    // Chỉ fallback suffix khi duy nhất một tài khoản khớp để tránh trừ nhầm.
    const suffixMatches = ads.filter((ad) => {
      const id = onlyDigits(ad.accountId);
      return id && parsedId.length >= 10 && id.length >= 10 && (id.endsWith(parsedId) || parsedId.endsWith(id));
    });
    if (suffixMatches.length === 1) return { ad: suffixMatches[0], reason: "account_id_suffix" };
  }

  const cardLast4 = normalizeLast4(parsed.cardLast4);
  if (cardLast4) {
    // Ưu tiên 4 số cuối thẻ được AdsCheck/Billing đồng bộ trực tiếp trên TKQC.
    const directCardMatches = ads.filter((ad) => {
      const values = [
        ad.paymentCardLast4,
        ad.adsCheck?.cardLast4,
        ad.billingExtension?.cardLast4,
      ].map(normalizeLast4).filter(Boolean);
      return values.includes(cardLast4);
    });
    if (directCardMatches.length === 1) return { ad: directCardMatches[0], reason: "ad_card_last4" };

    // Tương thích dữ liệu cũ: thẻ được lưu ở nguồn tiền/ngân hàng liên kết.
    const matchingBankIds = banks
      .filter((bank) => onlyDigits(bank.number).endsWith(cardLast4))
      .map((bank) => bank.id);
    const bankCandidates = ads.filter((ad) => matchingBankIds.includes(ad.bankId));
    if (bankCandidates.length === 1) return { ad: bankCandidates[0], reason: "bank_card_last4" };
  }
  return { ad: null, reason: parsedId ? "account_not_found" : (cardLast4 ? "card_ambiguous_or_not_found" : "not_found") };
}

function calculateDeduction(payload, amount, mode) {
  if (mode !== "with_fee") {
    return { rawAmount: amount, fee: 0, total: amount, feePercent: 0 };
  }
  const rawPercent = String(payload?.settings?.cardFeePercent || "0").replace(",", ".");
  const feePercent = Number(rawPercent) || 0;
  const fee = Math.round(amount * feePercent / 100);
  return { rawAmount: amount, fee, total: amount + fee, feePercent };
}

function receiptDocId(messageId) {
  return sha256(messageId).slice(0, 40);
}

async function getWorkspaceSnapshot(transaction, workspace) {
  const primaryRef = db.collection(WORKSPACES).doc(workspace);
  const primarySnap = await transaction.get(primaryRef);
  if (primarySnap.exists) return { ref: primaryRef, snap: primarySnap, data: primarySnap.data() || {} };
  const legacyRef = db.collection(LEGACY_WORKSPACES).doc(workspace);
  const legacySnap = await transaction.get(legacyRef);
  if (legacySnap.exists) return { ref: primaryRef, snap: legacySnap, data: legacySnap.data() || {} };
  return { ref: primaryRef, snap: null, data: { payload: { banks: [], adAccounts: [], transactions: [], settings: {} } } };
}

function getPayload(raw) {
  const payload = raw?.payload ? raw.payload : raw;
  return {
    banks: Array.isArray(payload?.banks) ? payload.banks : [],
    adAccounts: Array.isArray(payload?.adAccounts) ? payload.adAccounts : [],
    transactions: Array.isArray(payload?.transactions) ? payload.transactions : [],
    settings: payload?.settings && typeof payload.settings === "object" ? payload.settings : {},
  };
}

function getProcessFrom(connection) {
  const value = connection?.settings?.processFrom;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isAfterProcessStart(connection, receivedDateTime) {
  const receivedAt = Date.parse(receivedDateTime || "");
  if (!Number.isFinite(receivedAt)) return false;
  return receivedAt >= getProcessFrom(connection);
}

function calculateBankBalances(payload) {
  const adsById = new Map((payload.adAccounts || []).map((ad) => [ad.id, ad]));
  const balances = new Map();
  for (const bank of payload.banks || []) balances.set(bank.id, Number(bank.initialBalance || 0));
  for (const tx of payload.transactions || []) {
    if (tx.type === "bank_deposit" && balances.has(tx.bankId)) {
      balances.set(tx.bankId, Number(balances.get(tx.bankId) || 0) + Number(tx.amount || 0));
      continue;
    }
    if (tx.type === "ad_payment") {
      const ad = adsById.get(tx.adAccountId);
      const bankId = ad?.bankId || tx.bankIdSnapshot || "";
      if (bankId && balances.has(bankId)) {
        balances.set(bankId, Number(balances.get(bankId) || 0) - Number(tx.amount || 0));
      }
    }
  }
  return balances;
}

function formatVnd(value) {
  return `${Math.abs(Number(value || 0)).toLocaleString("vi-VN")} đ`;
}

async function pushTokenCount(workspace) {
  const snap = await db.collection(CONNECTIONS).doc(workspace).collection("pushTokens").limit(500).get();
  return snap.size;
}

let webPushConfiguredSignature = "";

function ensureWebPushConfigured() {
  const publicKey = String(VAPID_PUBLIC_KEY.value() || "").trim();
  const privateKey = String(VAPID_PRIVATE_KEY.value() || "").trim();
  const subject = String(VAPID_SUBJECT.value() || "mailto:admin@localhost").trim();
  if (!publicKey || !privateKey) return false;
  const signature = `${subject}|${publicKey}|${privateKey.slice(0, 12)}`;
  if (signature !== webPushConfiguredSignature) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    webPushConfiguredSignature = signature;
  }
  return true;
}

async function sendWebPushBatch(tokenDocs, notification) {
  if (!ensureWebPushConfigured()) return { sent: 0, failed: 0, disabled: true };
  let sent = 0;
  let failed = 0;
  const removals = [];
  const payload = JSON.stringify(notification);
  const tasks = tokenDocs.map(async (doc) => {
    const subscription = doc.data()?.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return;
    try {
      await webpush.sendNotification(subscription, payload, { TTL: 60, urgency: "high" });
      sent += 1;
    } catch (error) {
      failed += 1;
      const status = Number(error?.statusCode || error?.status || 0);
      if ([404, 410].includes(status)) removals.push(doc.ref.delete());
      else console.warn("Web Push lỗi:", status || "", error?.message || error);
    }
  });
  await Promise.allSettled(tasks);
  await Promise.allSettled(removals);
  return { sent, failed };
}

async function sendBalancePush(workspace, changes) {
  if (!changes.length) return { sent: 0 };
  const connectionSnap = await db.collection(CONNECTIONS).doc(workspace).get();
  if (!connectionSnap.exists) return { sent: 0 };
  const connection = connectionSnap.data() || {};
  if (connection.settings?.pushEnabled === false) return { sent: 0 };

  const tokenSnap = await connectionSnap.ref.collection("pushTokens").limit(500).get();
  const tokenDocs = tokenSnap.docs.filter((doc) => doc.data()?.subscription?.endpoint);
  if (!tokenDocs.length) return { sent: 0 };

  let title = "Biến động số dư T Balance";
  let body = "Số dư tài khoản ngân hàng vừa thay đổi.";
  if (changes.length === 1) {
    const change = changes[0];
    const sign = change.delta > 0 ? "+" : "−";
    body = `${change.bankName}: ${sign}${formatVnd(change.delta)} · Còn ${Number(change.after || 0).toLocaleString("vi-VN")} đ`;
  } else {
    body = `${changes.length} tài khoản vừa có biến động số dư.`;
  }

  return sendWebPushBatch(tokenDocs, {
    title,
    body,
    tag: "tbalance-balance-change",
    url: configuredWebUrl().toString(),
    data: {
      workspace,
      type: "balance_change",
      changedBanks: String(changes.length),
      createdAt: new Date().toISOString(),
    },
  });
}


const DEFAULT_ADSCHECK_SETTINGS = Object.freeze({
  enabled: true,
  autoImport: true,
  autoLinkBank: true,
  updateThreshold: true,
  notifyInsufficient: true,
});

function cleanPositiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function cleanTimestampMs(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  const now = Date.now();
  return Math.max(0, Math.min(Math.round(number), now + 5 * 60 * 1000));
}

function normalizeAccountId(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 30);
}

function deletedAdAccountIdSet(settings) {
  const values = Array.isArray(settings?.deletedAdAccountIds) ? settings.deletedAdAccountIds : [];
  return new Set(values.map(normalizeAccountId).filter(Boolean).slice(0, 1000));
}

function normalizeLast4(value) {
  const result = String(value || "").replace(/\D/g, "").slice(-4);
  return result.length === 4 ? result : "";
}

function normalizeBillingDate(value) {
  const raw = String(value || "").trim().slice(0, 80);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return "";
}

function normalizeCardBrand(value) {
  const raw = String(value || "").trim().slice(0, 40);
  if (!raw) return "";
  if (/master/i.test(raw)) return "Mastercard";
  if (/amex|american express/i.test(raw)) return "American Express";
  if (/visa/i.test(raw)) return "Visa";
  if (/jcb/i.test(raw)) return "JCB";
  return raw.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 40);
}

function normalizeAdsCheckAccount(value) {
  const accountId = normalizeAccountId(value?.accountId);
  if (!accountId) return null;
  return {
    accountId,
    name: String(value?.name || accountId).trim().slice(0, 160),
    status: String(value?.status || "").trim().slice(0, 60),
    ownerId: normalizeAccountId(value?.ownerId),
    balance: cleanPositiveNumber(value?.balance),
    threshold: cleanPositiveNumber(value?.threshold),
    remainingThreshold: cleanPositiveNumber(value?.remainingThreshold),
    cardLast4: normalizeLast4(value?.cardLast4),
    cardBrand: normalizeCardBrand(value?.cardBrand || value?.paymentMethodBrand),
    paymentMethodText: String(value?.paymentMethodText || "").trim().slice(0, 160),
    nextBillingDate: normalizeBillingDate(value?.nextBillingDate),
    nextBillingDateText: String(value?.nextBillingDateText || value?.nextBillingDate || "").trim().slice(0, 100),
    limit: cleanPositiveNumber(value?.limit),
    currency: String(value?.currency || "").trim().slice(0, 20),
    amountSpent: cleanPositiveNumber(value?.amountSpent),
    fundingSourceId: String(value?.fundingSourceId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
    businessName: String(value?.businessName || "").trim().slice(0, 160),
    sourceUrl: String(value?.sourceUrl || "").trim().slice(0, 500),
    scannedAt: String(value?.scannedAt || new Date().toISOString()).slice(0, 40),
  };
}

function adsCheckSettings(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: value.enabled !== false,
    autoImport: value.autoImport !== false,
    autoLinkBank: value.autoLinkBank !== false,
    updateThreshold: value.updateThreshold !== false,
    notifyInsufficient: value.notifyInsufficient !== false,
  };
}

function normalizeMetaGraphVersion(value) {
  const raw = String(value || META_GRAPH_DEFAULT_VERSION).trim().toLowerCase();
  return /^v\d{1,2}\.\d$/.test(raw) ? raw : META_GRAPH_DEFAULT_VERSION;
}

function metaAccountStatusLabel(value) {
  const code = Number(value || 0);
  const labels = {
    1: "Đang hoạt động",
    2: "Đã vô hiệu hóa",
    3: "Chưa thanh toán",
    7: "Chờ đánh giá rủi ro",
    8: "Chờ quyết toán",
    9: "Thời gian ân hạn",
    100: "Chờ đóng",
    101: "Đã đóng",
    201: "Đang hoạt động",
    202: "Đã đóng",
  };
  return labels[code] || (code ? `Trạng thái ${code}` : "Không rõ");
}

const META_ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

function metaMoneyToMajor(value, currency) {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const divisor = META_ZERO_DECIMAL_CURRENCIES.has(String(currency || "").toUpperCase()) ? 1 : 100;
  return Math.round(raw / divisor);
}

function metaFundingDetails(value) {
  const details = value && typeof value === "object" ? value : {};
  const display = String(details.display_string || details.displayString || details.name || "").trim().slice(0, 160);
  return {
    display,
    last4: normalizeLast4(details.last4 || details.last_four_digits || display),
    id: String(details.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
  };
}

async function metaGraphFetch(url, accessToken, options = {}) {
  let lastError = null;
  const maxAttempts = Math.max(1, Math.min(4, Number(options.maxAttempts || 3)));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      let response;
      try {
        response = await fetch(url, {
          method: options.method || "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            ...(options.headers || {}),
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const text = await response.text();
      let payload = {};
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
      if (response.ok && !payload?.error) return payload;

      const metaError = payload?.error || {};
      const error = new Error(metaError.message || `Meta Graph API HTTP ${response.status}`);
      error.status = response.status || 400;
      error.code = String(metaError.code || "META_GRAPH_ERROR");
      error.metaSubcode = String(metaError.error_subcode || "");
      error.reconnectRequired = [190, 102].includes(Number(metaError.code || 0));
      const code = Number(metaError.code || 0);
      error.transient = response.status === 429 || response.status >= 500 || [1, 2, 4, 17, 32, 613].includes(code);
      lastError = error;
      if (!error.transient || attempt === maxAttempts - 1) throw error;
    } catch (error) {
      const normalized = error?.name === "AbortError" ? new Error("Meta Graph API phản hồi quá lâu.") : error;
      if (normalized?.name === "AbortError") normalized.transient = true;
      lastError = normalized;
      if (attempt === maxAttempts - 1 || normalized?.reconnectRequired || (normalized?.status >= 400 && normalized?.status < 500 && normalized?.status !== 429 && !normalized?.transient)) throw normalized;
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  throw lastError || new Error("Không kết nối được Meta Graph API.");
}

async function metaGraphRequest(path, accessToken, graphVersion, query = {}) {
  const version = normalizeMetaGraphVersion(graphVersion);
  const normalizedPath = String(path || "").startsWith("/") ? String(path) : `/${path}`;
  const url = new URL(`${META_GRAPH_BASE}/${version}${normalizedPath}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, String(value));
  }
  return metaGraphFetch(url.toString(), accessToken);
}

async function validateMetaAccessToken(accessToken, graphVersion) {
  const profile = await metaGraphRequest("/me", accessToken, graphVersion, { fields: "id,name" });
  // Kiểm tra luôn edge quảng cáo để phát hiện sớm token hợp lệ nhưng thiếu quyền ads_read/ads_management.
  await metaGraphRequest("/me/adaccounts", accessToken, graphVersion, { fields: "id,account_id,name", limit: "1" });
  return { id: String(profile.id || ""), name: String(profile.name || "").slice(0, 160) };
}

async function fetchMetaAdAccounts(accessToken, graphVersion) {
  const version = normalizeMetaGraphVersion(graphVersion);
  const richFields = "id,account_id,name,account_status,currency,balance,amount_spent,spend_cap,funding_source,funding_source_details,business{id,name}";
  const mediumFields = "id,account_id,name,account_status,currency,balance,amount_spent,spend_cap,business{id,name}";
  const safeFields = "id,account_id,name,account_status,currency,balance,amount_spent,spend_cap";

  async function readPages(fields) {
    const first = new URL(`${META_GRAPH_BASE}/${version}/me/adaccounts`);
    first.searchParams.set("fields", fields);
    first.searchParams.set("limit", "100");
    const items = [];
    let next = first.toString();
    let pageCount = 0;
    while (next && items.length < 500 && pageCount < 10) {
      const payload = await metaGraphFetch(next, accessToken);
      if (Array.isArray(payload.data)) items.push(...payload.data);
      next = payload?.paging?.next || "";
      pageCount += 1;
    }
    return items.slice(0, 500);
  }

  let rawAccounts;
  let fundingDetailsAvailable = true;
  try {
    rawAccounts = await readPages(richFields);
  } catch (error) {
    // Ưu tiên giữ business{id,name} để Billing Extension có thể tạo URL theo từng BM.
    fundingDetailsAvailable = false;
    try { rawAccounts = await readPages(mediumFields); }
    catch { rawAccounts = await readPages(safeFields); }
  }

  const now = new Date().toISOString();
  const accounts = rawAccounts.map((item) => {
    const currency = String(item.currency || "").toUpperCase();
    const funding = metaFundingDetails(item.funding_source_details);
    return {
      accountId: normalizeAccountId(item.account_id || item.id),
      name: String(item.name || item.account_id || item.id || "Tài khoản quảng cáo").slice(0, 160),
      status: metaAccountStatusLabel(item.account_status),
      ownerId: normalizeAccountId(item.business?.id),
      balance: metaMoneyToMajor(item.balance, currency),
      threshold: 0, // Meta Marketing API public không trả payment threshold.
      remainingThreshold: 0,
      cardLast4: funding.last4,
      paymentMethodText: funding.display,
      limit: metaMoneyToMajor(item.spend_cap, currency),
      currency,
      amountSpent: metaMoneyToMajor(item.amount_spent, currency),
      fundingSourceId: String(item.funding_source || funding.id || ""),
      businessName: String(item.business?.name || "").slice(0, 160),
      sourceUrl: `${META_GRAPH_BASE}/${version}/me/adaccounts`,
      scannedAt: now,
    };
  }).filter((item) => item.accountId);

  return { accounts, fundingDetailsAvailable, graphVersion: version };
}

async function runMetaApiSync(workspace, state, reason = "manual", deviceName = "Meta API") {
  if (!state?.metaAccessTokenEnc) {
    const error = new Error("Chưa cấu hình Meta Access Token.");
    error.status = 400;
    error.code = "META_TOKEN_REQUIRED";
    throw error;
  }
  const accessToken = decryptSecret(state.metaAccessTokenEnc);
  const graphVersion = normalizeMetaGraphVersion(state.metaGraphVersion);
  const startedAt = Date.now();
  try {
    const fetched = await fetchMetaAdAccounts(accessToken, graphVersion);
    if (!fetched.accounts.length) {
      const error = new Error("Meta API không trả về tài khoản quảng cáo nào. Kiểm tra quyền ads_read/ads_management của token.");
      error.status = 400;
      error.code = "META_AD_ACCOUNTS_EMPTY";
      throw error;
    }
    const result = await syncAdsCheckData(workspace, null, {
      accounts: fetched.accounts,
      discoveredCount: fetched.accounts.length,
      selectionMode: "all",
      selectedAccountIds: fetched.accounts.map((item) => item.accountId),
      sourceUrl: `${META_GRAPH_BASE}/${fetched.graphVersion}/me/adaccounts`,
      sourceType: "meta_api",
      reason,
      clientSentAtMs: startedAt,
      scannedAtMs: Date.now(),
      scannedAt: new Date().toISOString(),
      extensionVersion: "meta-api",
      requestId: `meta-${startedAt}`,
    }, deviceName);
    await db.collection(ADSCHECK_STATES).doc(workspace).set({
      metaLastApiAt: FieldValue.serverTimestamp(),
      metaLastApiAtMs: Date.now(),
      metaLastSyncAt: FieldValue.serverTimestamp(),
      metaLastSyncAtMs: Date.now(),
      metaLastSuccessAtMs: Date.now(),
      metaLastError: "",
      metaFundingDetailsAvailable: fetched.fundingDetailsAvailable,
      metaGraphVersion: fetched.graphVersion,
      metaSource: "marketing_api",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ...result, fundingDetailsAvailable: fetched.fundingDetailsAvailable, graphVersion: fetched.graphVersion };
  } catch (error) {
    await db.collection(ADSCHECK_STATES).doc(workspace).set({
      metaLastAttemptAt: FieldValue.serverTimestamp(),
      metaLastAttemptAtMs: Date.now(),
      metaLastError: String(error?.message || "Meta API sync failed").slice(0, 500),
      metaReconnectRequired: !!error?.reconnectRequired,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}


const META_BILLING_EVENT_TYPES = new Set([
  "ad_account_billing_charge",
  "ad_account_billing_charge_failed",
  "ad_account_billing_decline",
  "ad_account_billing_refund",
  "ad_account_billing_chargeback",
  "ad_account_billing_chargeback_reversal",
  "billing_event",
  "funding_event_successful",
]);

// Chỉ billing charge thực sự được phép đi vào luồng tự trừ.
// funding_event_successful có thể liên quan đến funding/prepaid và không được
// coi là bill charge để tránh thay đổi số dư sai.
const META_BILLING_SUCCESS_TYPES = new Set([
  "ad_account_billing_charge",
]);

function normalizeMetaBillingConfig(state = {}) {
  const selectedAccountIds = [...new Set((Array.isArray(state.metaBillingSelectedAccountIds)
    ? state.metaBillingSelectedAccountIds : []).map(normalizeAccountId).filter(Boolean))].slice(0, 500);
  return {
    enabled: state.metaBillingEnabled !== false,
    autoSync: state.metaBillingAutoSync !== false,
    autoDeduct: state.metaBillingAutoDeduct !== false,
    onlyVndAutoDeduct: state.metaBillingOnlyVndAutoDeduct !== false,
    lookbackDays: Math.max(1, Math.min(7, Number(state.metaBillingLookbackDays || 3))),
    syncIntervalMinutes: Math.max(5, Math.min(1440, Number(state.metaBillingSyncIntervalMinutes || 10))),
    maxAccountsPerRun: Math.max(5, Math.min(100, Number(state.metaBillingMaxAccountsPerRun || 50))),
    selectionMode: state.metaBillingSelectionMode === "selected" ? "selected" : "all",
    selectedAccountIds,
  };
}

function tryParseEmbeddedMetaValue(value) {
  if (value && typeof value === "object") return value;
  let raw = String(value ?? "").trim();
  if (!raw) return null;
  const variants = [raw];
  if (/%(?:7B|7D|22|5B|5D)/i.test(raw)) {
    try { variants.push(decodeURIComponent(raw)); } catch {}
  }
  for (const candidate of variants) {
    let current = candidate;
    for (let depth = 0; depth < 3; depth += 1) {
      const trimmed = String(current ?? "").trim();
      if (!trimmed || !/^(?:\{|\[|\")/.test(trimmed)) break;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") return parsed;
        if (typeof parsed === "string" && parsed !== trimmed) { current = parsed; continue; }
        break;
      } catch { break; }
    }
  }
  if (/^[^\s=&]+=[^&]+(?:&[^\s=&]+=[^&]+)+$/.test(raw)) {
    try {
      const params = new URLSearchParams(raw);
      const object = {};
      for (const [key, val] of params.entries()) object[key] = val;
      if (Object.keys(object).length) return object;
    } catch {}
  }
  return null;
}

function safeJsonParse(value) {
  if (value && typeof value === "object") return value;
  const raw = String(value || "").trim();
  if (!raw) return {};
  const parsed = tryParseEmbeddedMetaValue(raw);
  return parsed && typeof parsed === "object" ? parsed : { raw };
}

function flattenMetaBillingValues(value, prefix = "", out = [], depth = 0) {
  if (out.length > 600 || depth > 10) return out;
  if (Array.isArray(value)) {
    value.slice(0, 80).forEach((item, index) => flattenMetaBillingValues(item, `${prefix}[${index}]`, out, depth + 1));
    return out;
  }
  if (value && typeof value === "object") {
    Object.entries(value).slice(0, 160).forEach(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      flattenMetaBillingValues(child, path, out, depth + 1);
    });
    return out;
  }
  const scalar = { key: prefix.toLowerCase(), value };
  out.push(scalar);
  if (typeof value === "string") {
    const embedded = tryParseEmbeddedMetaValue(value);
    if (embedded && typeof embedded === "object") {
      flattenMetaBillingValues(embedded, prefix ? `${prefix}.__decoded` : "__decoded", out, depth + 1);
    }
  }
  return out;
}

function parseLocaleMoneyString(value, currency = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const upperCurrency = String(currency || "").toUpperCase();
  const hasVnd = upperCurrency === "VND" || /(?:\bVND\b|VNĐ|₫|đ\b)/i.test(raw);
  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  if (hasVnd) {
    const digits = cleaned.replace(/\D/g, "");
    const amount = Number(digits || 0);
    return Number.isFinite(amount) ? Math.round(Math.abs(amount)) : 0;
  }
  let normalized = cleaned;
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) normalized = normalized.replace(/\./g, "").replace(",", ".");
    else normalized = normalized.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = normalized.length - lastComma - 1;
    normalized = decimals > 0 && decimals <= 2 ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  } else if ((normalized.match(/\./g) || []).length > 1) {
    normalized = normalized.replace(/\./g, "");
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

function extractMetaBillingCurrency(extraData, fallback = "") {
  const flat = flattenMetaBillingValues(extraData);
  for (const item of flat) {
    if (/currency|currency_code|iso_currency/.test(item.key)) {
      const code = String(item.value || "").trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(code)) return code;
    }
  }
  const raw = JSON.stringify(extraData || {});
  const match = raw.match(/\b(VND|USD|EUR|THB|SGD|MYR|IDR|PHP|JPY|KRW|GBP|AUD|CAD)\b/i);
  return String(match?.[1] || fallback || "").toUpperCase();
}

function extractMetaBillingTextField(extraData, patterns = []) {
  const flat = flattenMetaBillingValues(extraData);
  for (const item of flat) {
    if (!patterns.some((pattern) => pattern.test(item.key))) continue;
    const value = String(item.value ?? "").trim();
    if (value && value.length <= 200) return value;
  }
  return "";
}

function currencyFromMarker(marker, fallback = "") {
  const raw = String(marker || "").trim().toUpperCase();
  if (/^(?:₫|Đ|VNĐ|VND)$/.test(raw)) return "VND";
  if (raw === "$" || raw === "US$") return String(fallback || "USD").toUpperCase() || "USD";
  if (raw === "€") return "EUR";
  if (raw === "£") return "GBP";
  if (raw === "฿") return "THB";
  return /^[A-Z]{3}$/.test(raw) ? raw : String(fallback || "").toUpperCase();
}

function extractMoneyCandidatesFromText(text, currencyHint = "", sourceKey = "text") {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const results = [];
  const marker = String.raw`(?:VND|VNĐ|USD|EUR|THB|SGD|MYR|IDR|PHP|JPY|KRW|GBP|AUD|CAD|US\$|\$|€|£|฿|₫|đ)`;
  const number = String.raw`(?:\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
  const patterns = [
    new RegExp(`(${marker})\\s*[:=~-]?\\s*(${number})`, "ig"),
    new RegExp(`(${number})\\s*(${marker})`, "ig"),
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    let match;
    while ((match = patterns[i].exec(raw)) && results.length < 10) {
      const moneyMarker = i === 0 ? match[1] : match[2];
      const moneyText = i === 0 ? match[2] : match[1];
      const currency = currencyFromMarker(moneyMarker, currencyHint);
      const amount = parseLocaleMoneyString(moneyText, currency);
      if (amount > 0) results.push({ amount, currency, score: 10, key: sourceKey, explicitCurrency: true });
    }
  }
  if (!results.length && currencyHint && /(?:amount|total|charge|charged|billing|billed|payment|paid|thanh\s*to[aá]n|t[ií]nh\s*ph[ií]|ghi\s*n[oợ])/i.test(raw)) {
    const contextual = raw.match(/(?:amount|total|charge(?:d)?|billing|billed|payment|paid|thanh\s*to[aá]n|t[ií]nh\s*ph[ií])[^0-9]{0,32}(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d{4,15}(?:[.,]\d{1,2})?)/i);
    const reverse = raw.match(/(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d{4,15}(?:[.,]\d{1,2})?)[^a-zA-ZÀ-ỹ]{0,12}(?:amount|total|charge(?:d)?|billing|billed|payment|paid)/i);
    const value = contextual?.[1] || reverse?.[1] || "";
    const amount = parseLocaleMoneyString(value, currencyHint);
    if (amount > 0) results.push({ amount, currency: String(currencyHint).toUpperCase(), score: 6, key: sourceKey, explicitCurrency: false });
  }
  return results;
}

function extractMetaBillingAmount(extraData, currency, activity = {}) {
  const flat = flattenMetaBillingValues(extraData);
  const candidates = [];
  const exactAmountKey = /(?:^|\.)(?:amount|charge_amount|charged_amount|payment_amount|billing_amount|invoice_amount|total_amount|amount_charged|charged_total|payment_total|transaction_amount|bill_amount|value_amount|amount_paid)$/i;
  const amountishKey = /(?:charge|charged|payment|billing|bill|invoice|transaction|total|amount|paid)/i;
  const excludeKey = /(?:id|time|date|count|limit|balance|spent|threshold|cap)/i;

  for (const item of flat) {
    const key = item.key || "";
    const isExactAmount = exactAmountKey.test(key);
    const isAmountish = amountishKey.test(key);
    if (!isAmountish && typeof item.value !== "string") continue;
    if (!isExactAmount && excludeKey.test(key) && !/(?:amount|charge|payment|billing|invoice|total|paid)/i.test(key)) continue;

    if (isExactAmount || isAmountish) {
      const amount = parseLocaleMoneyString(item.value, currency);
      if (amount > 0) {
        let score = 1;
        if (isExactAmount) score += 8;
        else if (/(?:amount|total|paid)/i.test(key)) score += 4;
        if (/(?:charge_amount|charged_amount|payment_amount|billing_amount|invoice_amount|total_amount|amount_charged|transaction_amount|bill_amount|amount_paid)/i.test(key)) score += 3;
        if (typeof item.value === "number" && isExactAmount) score += 2;
        if (typeof item.value === "string" && /(?:VND|VNĐ|₫|USD|EUR|THB|SGD|MYR|IDR|PHP|JPY|KRW|GBP|AUD|CAD|\$|€|£|฿)/i.test(item.value)) score += 4;
        candidates.push({ amount, score, key, currency: String(currency || "").toUpperCase() });
      }
    }

    if (typeof item.value === "string") {
      const textCandidates = extractMoneyCandidatesFromText(item.value, currency, key || "extra_data.text");
      for (const candidate of textCandidates) {
        candidate.score += isAmountish ? 2 : 0;
        candidates.push(candidate);
      }
    }
  }

  const translated = String(activity?.translated_event_type || "").trim();
  const objectName = String(activity?.object_name || "").trim();
  for (const candidate of extractMoneyCandidatesFromText(translated, currency, "translated_event_type")) {
    candidate.score += 3;
    candidates.push(candidate);
  }
  for (const candidate of extractMoneyCandidatesFromText(objectName, currency, "object_name")) {
    candidate.score += 1;
    candidates.push(candidate);
  }

  if (!candidates.length) {
    const raw = typeof extraData === "string" ? extraData : JSON.stringify(extraData || {});
    const vnd = raw.match(/(?:VND|VNĐ|₫|đ)\s*[:=-]?\s*(\d{1,3}(?:[.,\s]\d{3})+|\d{4,15})|(\d{1,3}(?:[.,\s]\d{3})+|\d{4,15})\s*(?:VND|VNĐ|₫|đ)/i);
    const value = vnd?.[1] || vnd?.[2] || "";
    const amount = parseLocaleMoneyString(value, "VND");
    if (amount > 0) return { amount, confidence: "high", sourceKey: "formatted_vnd", currency: "VND" };
  }

  candidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  const best = candidates[0];
  if (!best) return { amount: 0, confidence: "none", sourceKey: "", currency: String(currency || "").toUpperCase() };
  return {
    amount: best.amount,
    confidence: best.score >= 8 ? "high" : best.score >= 5 ? "medium" : "low",
    sourceKey: best.key,
    currency: String(best.currency || currency || "").toUpperCase(),
  };
}

function normalizeMetaBillingActivity(account, activity) {
  const extraData = safeJsonParse(activity?.extra_data);
  const accountId = normalizeAccountId(account?.accountId || account?.account_id || account?.id);
  const eventType = String(activity?.event_type || "").trim();
  const eventTimeRaw = activity?.event_time || activity?.date_time_in_timezone || "";
  const eventTimeMs = /^\d+$/.test(String(eventTimeRaw || ""))
    ? Number(eventTimeRaw) * (String(eventTimeRaw).length <= 10 ? 1000 : 1)
    : (Date.parse(String(eventTimeRaw || "")) || Date.now());
  const currency = extractMetaBillingCurrency(extraData, account?.currency || "");
  const amountInfo = extractMetaBillingAmount(extraData, currency, activity);
  const txId = extractMetaBillingTextField(extraData, [/(?:transaction|payment|charge|invoice|receipt).*(?:id|number|ref)/i, /(?:fatura|invoice_id|transaction_id|payment_id|charge_id)/i]);
  const reference = extractMetaBillingTextField(extraData, [/(?:reference|ref_number|receipt|invoice_number)/i]);
  const cardLast4 = normalizeLast4(extractMetaBillingTextField(extraData, [/(?:last.?4|last_four|card.*digits|payment_method)/i]));
  const fingerprintSource = JSON.stringify({ accountId, eventType, eventTimeMs, objectId: activity?.object_id || "", txId, extraData });
  const eventId = sha256(fingerprintSource).slice(0, 40);
  return {
    eventId,
    accountId,
    accountName: String(account?.name || accountId || "Tài khoản quảng cáo").slice(0, 160),
    eventType,
    translatedEventType: String(activity?.translated_event_type || "").slice(0, 240),
    eventTimeMs,
    eventTime: new Date(eventTimeMs).toISOString(),
    amount: amountInfo.amount,
    amountConfidence: amountInfo.confidence,
    amountSourceKey: amountInfo.sourceKey,
    currency: amountInfo.currency || currency,
    txId: String(txId || "").slice(0, 160),
    reference: String(reference || "").slice(0, 160),
    cardLast4,
    actorName: String(activity?.actor_name || "Meta").slice(0, 160),
    objectId: String(activity?.object_id || "").slice(0, 160),
    objectName: String(activity?.object_name || "").slice(0, 200),
    objectType: String(activity?.object_type || "").slice(0, 80),
    extraData,
    isBillingEvent: META_BILLING_EVENT_TYPES.has(eventType),
    isSuccessfulCharge: META_BILLING_SUCCESS_TYPES.has(eventType),
  };
}

async function fetchMetaBillingActivitiesForAccount(account, accessToken, graphVersion, sinceMs) {
  const version = normalizeMetaGraphVersion(graphVersion);
  const accountId = normalizeAccountId(account?.accountId || account?.account_id || account?.id);
  if (!accountId) return [];
  const makeUrl = (withSince = true) => {
    const url = new URL(`${META_GRAPH_BASE}/${version}/act_${accountId}/activities`);
    url.searchParams.set("fields", "actor_name,date_time_in_timezone,event_time,event_type,extra_data,object_id,object_name,object_type,translated_event_type");
    url.searchParams.set("limit", "100");
    if (withSince && sinceMs > 0) url.searchParams.set("since", String(Math.floor(sinceMs / 1000)));
    return url;
  };

  async function read(startUrl) {
    const output = [];
    let next = startUrl.toString();
    let pages = 0;
    while (next && pages < 4 && output.length < 400) {
      const payload = await metaGraphFetch(next, accessToken, { maxAttempts: 2 });
      for (const activity of Array.isArray(payload?.data) ? payload.data : []) {
        const normalized = normalizeMetaBillingActivity(account, activity);
        if (!normalized.isBillingEvent) continue;
        if (sinceMs && normalized.eventTimeMs < sinceMs) continue;
        output.push(normalized);
      }
      next = payload?.paging?.next || "";
      pages += 1;
    }
    return output;
  }

  try {
    return await read(makeUrl(true));
  } catch (error) {
    if (String(error?.code || "") !== "100" && Number(error?.status || 0) !== 400) throw error;
    // Một số Graph version/tài khoản không nhận tham số since trên activities.
    // Retry không since rồi lọc timestamp phía server để không mất bill.
    return read(makeUrl(false));
  }
}

async function recentMetaBillingEvents(workspace, limit = 30) {
  const snap = await db.collection(META_BILLING_EVENTS).doc(workspace).collection("items")
    .orderBy("eventTime", "desc")
    .limit(Math.max(1, Math.min(100, Number(limit || 30))))
    .get();
  return snap.docs.map((doc) => {
    const raw = doc.data() || {};
    const safeExtra = raw.extraData && typeof raw.extraData === "object" ? raw.extraData : {};
    return {
      id: doc.id,
      eventId: raw.eventId || doc.id,
      accountId: raw.accountId || "",
      accountName: raw.accountName || "",
      eventType: raw.eventType || "",
      translatedEventType: raw.translatedEventType || "",
      eventTime: raw.eventTime || "",
      eventTimeMs: Number(raw.eventTimeMs || 0),
      amount: Number(raw.amount || 0),
      amountConfidence: raw.amountConfidence || "none",
      amountSourceKey: raw.amountSourceKey || "",
      currency: raw.currency || "",
      txId: raw.txId || "",
      reference: raw.reference || "",
      cardLast4: raw.cardLast4 || "",
      status: raw.status || "recognized",
      error: raw.error || "",
      transactionId: raw.transactionId || "",
      extraSummary: JSON.stringify(safeExtra).slice(0, 500),
    };
  });
}

function shouldRetryMetaBillingEvent(existingData = {}, event = {}) {
  return existingData.processed === true
    && existingData.status === "parse_error"
    && event.isSuccessfulCharge === true
    && !existingData.transactionId;
}

async function runMetaBillingSync(workspace, state, reason = "manual", deviceName = "Meta Billing API") {
  if (!state?.metaAccessTokenEnc) {
    const error = new Error("Chưa cấu hình Meta Access Token trên giao diện web.");
    error.status = 400;
    error.code = "META_TOKEN_REQUIRED";
    throw error;
  }
  const config = normalizeMetaBillingConfig(state);
  if (!config.enabled && reason !== "manual") return { skipped: true, reason: "disabled" };
  const accessToken = decryptSecret(state.metaAccessTokenEnc);
  const graphVersion = normalizeMetaGraphVersion(state.metaGraphVersion);
  const now = Date.now();
  const lookbackFloor = now - config.lookbackDays * 24 * 60 * 60 * 1000;
  const previousEventMs = Number(state.metaBillingLastEventTimeMs || 0);
  const accountCursors = state.metaBillingAccountCursors && typeof state.metaBillingAccountCursors === "object"
    ? { ...state.metaBillingAccountCursors } : {};

  try {
    const accountResult = await fetchMetaAdAccounts(accessToken, graphVersion);
    const discoveredAccounts = accountResult.accounts || [];
    const availableAccounts = discoveredAccounts.map((item) => ({
      accountId: normalizeAccountId(item.accountId),
      name: String(item.name || item.accountId || "Tài khoản quảng cáo").slice(0, 160),
      currency: String(item.currency || "").toUpperCase(),
      status: String(item.status || "").slice(0, 60),
      businessName: String(item.businessName || "").slice(0, 160),
    })).filter((item) => item.accountId).slice(0, 500);
    let allAccounts = discoveredAccounts;
    const selectedIds = new Set(config.selectedAccountIds.map(normalizeAccountId).filter(Boolean));
    if (config.selectionMode === "selected") {
      if (!selectedIds.size) {
        const error = new Error("Đã bật chế độ chỉ quét tài khoản được chọn nhưng chưa chọn TKQC nào.");
        error.status = 400;
        error.code = "META_BILLING_SELECTION_EMPTY";
        error.availableAccounts = availableAccounts;
        throw error;
      }
      allAccounts = allAccounts.filter((item) => selectedIds.has(normalizeAccountId(item.accountId)));
      if (!allAccounts.length) {
        const error = new Error("Không có TKQC đã chọn nào còn truy cập được bằng Meta Access Token hiện tại.");
        error.status = 400;
        error.code = "META_BILLING_SELECTED_ACCOUNTS_UNAVAILABLE";
        error.availableAccounts = availableAccounts;
        throw error;
      }
    }
    const totalAccounts = allAccounts.length;
    const startCursor = totalAccounts ? Math.max(0, Number(state.metaBillingScanCursor || 0)) % totalAccounts : 0;
    const rotated = totalAccounts ? [...allAccounts.slice(startCursor), ...allAccounts.slice(0, startCursor)] : [];
    const accounts = rotated.slice(0, config.maxAccountsPerRun);
    const nextScanCursor = totalAccounts ? (startCursor + accounts.length) % totalAccounts : 0;

    const allEvents = [];
    const errors = [];
    const concurrency = 4;
    for (let i = 0; i < accounts.length; i += concurrency) {
      const chunk = accounts.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(async (account) => {
        const accountId = normalizeAccountId(account.accountId);
        const cursorMs = Number(accountCursors[accountId] || 0);
        const sinceMs = Math.max(lookbackFloor, cursorMs ? cursorMs - 20 * 60 * 1000 : 0);
        try {
          const events = await fetchMetaBillingActivitiesForAccount(account, accessToken, graphVersion, sinceMs);
          accountCursors[accountId] = now;
          return events;
        } catch (error) {
          errors.push({ accountId: account.accountId, error: String(error?.message || error).slice(0, 240) });
          return [];
        }
      }));
      results.forEach((items) => allEvents.push(...items));
    }

    allEvents.sort((a, b) => a.eventTimeMs - b.eventTimeMs);
    let newBills = 0;
    let autoDeducted = 0;
    let pending = 0;
    let parseErrors = 0;
    let duplicates = 0;
    let recognized = 0;
    let lastEventTimeMs = previousEventMs;

    for (const event of allEvents) {
      lastEventTimeMs = Math.max(lastEventTimeMs, Number(event.eventTimeMs || 0));
      const eventRef = db.collection(META_BILLING_EVENTS).doc(workspace).collection("items").doc(event.eventId);
      const existing = await eventRef.get();
      const existingData = existing.exists ? (existing.data() || {}) : {};
      const retryPreviousParseError = shouldRetryMetaBillingEvent(existingData, event);
      if (existingData.processed === true && !retryPreviousParseError) {
        duplicates += 1;
        continue;
      }
      if (!existing.exists) newBills += 1;
      let status = "recognized";
      let errorText = "";
      let transactionId = "";

      if (event.isSuccessfulCharge) {
        const currencyAllowed = !config.onlyVndAutoDeduct || !event.currency || event.currency === "VND";
        const confidenceAllowed = event.amountConfidence === "high" || event.amountConfidence === "medium";
        if (!event.amount || !confidenceAllowed) {
          status = "parse_error";
          errorText = event.amount > 0
            ? `Đã thấy amount ${event.amount} nhưng nguồn ${event.amountSourceKey || "không xác định"} chưa đủ tin cậy để tự trừ.`
            : "Chưa tìm thấy amount trong extra_data/translated_event_type. Hệ thống sẽ tự thử đọc lại event ở lần quét sau.";
          parseErrors += 1;
        } else if (!currencyAllowed) {
          status = "recognized";
          errorText = `Bill ${event.currency || "khác VND"} được ghi nhận nhưng không tự trừ để tránh sai quy đổi.`;
          recognized += 1;
        } else {
          const pseudoMessage = {
            id: `meta-billing:${event.eventId}`,
            internetMessageId: "",
            subject: event.translatedEventType || event.eventType,
            from: { emailAddress: { address: "meta-graph-api" } },
            receivedDateTime: event.eventTime,
          };
          const syntheticConnection = {
            settings: {
              autoDeduct: config.autoDeduct,
              deductionMode: "exact",
            },
          };
          const parsed = {
            isMeta: true,
            subject: pseudoMessage.subject,
            body: JSON.stringify(event.extraData || {}),
            amount: Math.round(Number(event.amount || 0)),
            txId: event.txId || `META-${event.eventId.slice(0, 20)}`,
            adAccountId: event.accountId,
            cardLast4: event.cardLast4,
            reference: event.reference,
          };
          const applied = await applyParsedReceipt({
            workspace,
            connection: syntheticConnection,
            message: pseudoMessage,
            parsed,
            source: "meta_billing_api",
            sourceLabel: "Meta Billing API",
          });
          status = applied.status;
          transactionId = applied.transaction?.id || "";
          if (status === "auto_deducted") autoDeducted += 1;
          else if (status === "duplicate") duplicates += 1;
          else if (status === "pending_match") pending += 1;
          else if (status === "parse_error") parseErrors += 1;
          else recognized += 1;
        }
      } else {
        status = event.eventType.includes("failed") || event.eventType.includes("decline") ? "failed" : event.eventType.includes("refund") ? "refund" : "recognized";
        recognized += 1;
      }

      await eventRef.set({
        ...event,
        status,
        error: errorText,
        transactionId,
        processed: true,
        source: "meta_billing_api",
        syncedAt: FieldValue.serverTimestamp(),
        syncedAtMs: Date.now(),
      }, { merge: true });
    }

    const patch = {
      metaBillingEnabled: config.enabled,
      metaBillingAutoSync: config.autoSync,
      metaBillingAutoDeduct: config.autoDeduct,
      metaBillingOnlyVndAutoDeduct: config.onlyVndAutoDeduct,
      metaBillingLookbackDays: config.lookbackDays,
      metaBillingSyncIntervalMinutes: config.syncIntervalMinutes,
      metaBillingLastAttemptAtMs: now,
      metaBillingLastSyncAt: FieldValue.serverTimestamp(),
      metaBillingLastSyncAtMs: Date.now(),
      metaBillingLastSuccessAtMs: Date.now(),
      metaBillingLastEventTimeMs: lastEventTimeMs,
      metaBillingScannedAccounts: accounts.length,
      metaBillingTotalAccounts: totalAccounts,
      metaBillingDiscoveredAccounts: discoveredAccounts.length,
      metaBillingAvailableAccounts: availableAccounts,
      metaBillingSelectionMode: config.selectionMode,
      metaBillingSelectedAccountIds: config.selectedAccountIds,
      metaBillingSelectedAccountCount: config.selectionMode === "selected" ? allAccounts.length : discoveredAccounts.length,
      metaBillingScanCursor: nextScanCursor,
      metaBillingAccountCursors: accountCursors,
      metaBillingEventsFound: allEvents.length,
      metaBillingNewBills: newBills,
      metaBillingAutoDeducted: autoDeducted,
      metaBillingPending: pending,
      metaBillingParseErrors: parseErrors,
      metaBillingDuplicates: duplicates,
      metaBillingRecognized: recognized,
      metaBillingLastError: "",
      metaBillingAccountErrors: errors.slice(0, 20),
      metaBillingReason: String(reason || "manual").slice(0, 60),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await db.collection(ADSCHECK_STATES).doc(workspace).set(patch, { merge: true });
    return { scannedAccounts: accounts.length, totalAccounts, discoveredAccounts: discoveredAccounts.length, selectionMode: config.selectionMode, selectedAccountIds: config.selectedAccountIds, availableAccounts, nextScanCursor, eventsFound: allEvents.length, newBills, autoDeducted, pending, parseErrors, duplicates, recognized, accountErrors: errors.slice(0, 20), lastEventTimeMs };
  } catch (error) {
    const patch = {
      metaBillingLastAttemptAtMs: Date.now(),
      metaBillingLastError: String(error?.message || "Meta Billing API sync failed").slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (Array.isArray(error?.availableAccounts)) {
      patch.metaBillingAvailableAccounts = error.availableAccounts.slice(0, 500);
      patch.metaBillingDiscoveredAccounts = error.availableAccounts.length;
    }
    await db.collection(ADSCHECK_STATES).doc(workspace).set(patch, { merge: true });
    throw error;
  }
}

function preferredAdBalance(ad, billingBalance = 0) {
  // Meta API là nguồn chính cho số dư. Billing page chỉ dự phòng khi API chưa từng đồng bộ.
  if (ad?.metaLastSyncAt || ad?.metaApiBalance !== undefined) return Number(ad.metaApiBalance || 0);
  return Number(billingBalance || ad?.billingPageBalance || ad?.adsCheckBalance || 0);
}

async function syncBillingExtensionData(workspace, body, deviceName) {
  const serverReceivedAtMs = Date.now();
  const rawAccounts = Array.isArray(body.accounts) ? body.accounts.slice(0, 500) : [];
  const scannedAccounts = rawAccounts.map(normalizeAdsCheckAccount).filter((item) => item && item.accountId);
  if (!scannedAccounts.length) {
    const error = new Error("Billing Extension chưa trả về dữ liệu tài khoản hợp lệ.");
    error.status = 400;
    error.code = "BILLING_EXTENSION_EMPTY";
    throw error;
  }
  const stateRef = db.collection(ADSCHECK_STATES).doc(workspace);
  const nowIso = new Date().toISOString();
  const extensionVersion = String(body.extensionVersion || "billing-extension").trim().slice(0, 30);
  const syncReason = String(body.reason || "billing_extension").trim().slice(0, 60);
  const requestId = String(body.requestId || "").trim().slice(0, 120);
  let result = null;

  await db.runTransaction(async (transaction) => {
    const workspaceRecord = await getWorkspaceSnapshot(transaction, workspace);
    const stateSnap = await transaction.get(stateRef);
    const previousState = stateSnap.exists ? (stateSnap.data() || {}) : {};
    const settings = adsCheckSettings(previousState.settings || DEFAULT_ADSCHECK_SETTINGS);
    if (!settings.enabled) {
      transaction.set(stateRef, {
        billingLastAttemptAtMs: serverReceivedAtMs,
        billingLastReason: syncReason,
        billingExtensionVersion: extensionVersion,
        billingLastDeviceName: String(deviceName || "Meta Billing Extension").slice(0, 80),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      result = { scanned: scannedAccounts.length, updated: 0, matched: 0, imported: 0, linked: 0, alerts: [], settings, skipped: "disabled" };
      return;
    }

    const payload = getPayload(workspaceRecord.data || {});
    const deletedIds = deletedAdAccountIdSet(payload.settings || {});
    if (deletedIds.size) {
      payload.adAccounts = payload.adAccounts.filter((ad) => !deletedIds.has(normalizeAccountId(ad.accountId)));
    }
    const existingByAccountId = new Map();
    for (const ad of payload.adAccounts) {
      const id = normalizeAccountId(ad.accountId);
      if (id) existingByAccountId.set(id, ad);
    }
    const suffixes = bankSuffixMap(payload);
    let matched = 0;
    let imported = 0;
    let linked = 0;
    let updated = 0;

    let ignoredDeleted = 0;
    for (const scanned of scannedAccounts) {
      if (deletedIds.has(scanned.accountId)) {
        ignoredDeleted += 1;
        continue;
      }
      let ad = existingByAccountId.get(scanned.accountId);
      if (!ad && settings.autoImport) {
        ad = {
          id: createAdsCheckAdId(scanned.accountId),
          name: scanned.name || `TKQC ${scanned.accountId}`,
          accountId: scanned.accountId,
          bankId: "",
          threshold: scanned.threshold || 0,
          createdFrom: "billing_extension",
        };
        payload.adAccounts.unshift(ad);
        existingByAccountId.set(scanned.accountId, ad);
        imported += 1;
      } else if (ad) {
        matched += 1;
      }
      if (!ad) continue;

      if (settings.autoLinkBank && !ad.bankId && scanned.cardLast4) {
        const candidates = suffixes.get(scanned.cardLast4) || [];
        if (candidates.length === 1) {
          ad.bankId = candidates[0].id;
          linked += 1;
        }
      }

      // Billing Hub là nguồn ưu tiên cho payment threshold/ngày thu/thẻ.
      if (scanned.threshold > 0) ad.threshold = scanned.threshold;
      if (scanned.cardLast4) ad.paymentCardLast4 = scanned.cardLast4;
      if (scanned.cardBrand) ad.paymentCardBrand = scanned.cardBrand;
      if (scanned.nextBillingDate) ad.billingNextDate = scanned.nextBillingDate;
      if (scanned.nextBillingDateText) ad.billingNextDateText = scanned.nextBillingDateText;
      if (scanned.name && (!ad.name || ad.createdFrom === "billing_extension")) ad.name = scanned.name;
      ad.billingPageBalance = scanned.balance;
      ad.billingSourceUrl = scanned.sourceUrl || String(body.sourceUrl || "").slice(0, 500);
      ad.billingLastSyncAt = nowIso;
      const effectiveBalance = preferredAdBalance(ad, scanned.balance);
      ad.remainingThreshold = Math.max(0, cleanPositiveNumber(ad.threshold) - Math.max(0, Number(effectiveBalance || 0)));
      // Legacy fields vẫn giữ để toàn bộ UI/công thức cũ tiếp tục hoạt động.
      if (!ad.metaLastSyncAt && ad.metaApiBalance === undefined) ad.adsCheckBalance = scanned.balance;
      ad.lastAdsCheckSyncAt = ad.metaLastSyncAt || nowIso;
      ad.billingExtension = {
        balance: scanned.balance,
        threshold: scanned.threshold || cleanPositiveNumber(ad.threshold),
        nextBillingDate: scanned.nextBillingDate || "",
        nextBillingDateText: scanned.nextBillingDateText || "",
        cardLast4: scanned.cardLast4 || ad.paymentCardLast4 || "",
        cardBrand: scanned.cardBrand || ad.paymentCardBrand || "",
        paymentMethodText: scanned.paymentMethodText || "",
        currency: scanned.currency || ad.metaCurrency || ad.adsCheckCurrency || "",
        sourceUrl: scanned.sourceUrl || String(body.sourceUrl || "").slice(0, 500),
        scannedAt: scanned.scannedAt || nowIso,
        extensionVersion,
      };
      ad.adsCheck = {
        ...(ad.adsCheck || {}),
        balance: effectiveBalance,
        threshold: cleanPositiveNumber(ad.threshold),
        remainingThreshold: ad.remainingThreshold,
        cardLast4: ad.paymentCardLast4 || ad.adsCheck?.cardLast4 || "",
        paymentMethodText: scanned.paymentMethodText || ad.adsCheck?.paymentMethodText || "",
        currency: scanned.currency || ad.metaCurrency || ad.adsCheck?.currency || "",
        status: ad.adsCheckStatus || ad.adsCheck?.status || "",
        sourceType: "hybrid",
        billingScannedAt: scanned.scannedAt || nowIso,
      };
      updated += 1;
    }

    const balances = calculateBankBalances(payload);
    const feePercent = parseCardFeePercent(payload);
    const banksById = new Map(payload.banks.map((bank) => [bank.id, bank]));
    const previousFingerprints = previousState.insufficientFingerprints && typeof previousState.insufficientFingerprints === "object"
      ? previousState.insufficientFingerprints : {};
    const nextFingerprints = { ...previousFingerprints };
    const alerts = [];
    let insufficientCount = 0;
    for (const ad of payload.adAccounts) {
      if (!ad.bankId) continue;
      const statusText = String(ad.adsCheckStatus || ad.adsCheck?.status || "").toLowerCase();
      if (/vô hiệu|vo hieu|disabled|closed|đã đóng|da dong/.test(statusText)) continue;
      const threshold = cleanPositiveNumber(ad.threshold || ad.adsCheck?.threshold);
      if (!threshold) continue;
      const bank = banksById.get(ad.bankId);
      if (!bank) continue;
      const bankBalance = Number(balances.get(bank.id) || 0);
      const required = Math.round(threshold + threshold * feePercent / 100);
      if (bankBalance >= required) continue;
      insufficientCount += 1;
      const alert = buildInsufficientAlert(ad, bank, bankBalance, required);
      const fingerprint = sha256(JSON.stringify([alert.accountId, alert.bankBalance, alert.required, alert.cardLast4])).slice(0, 24);
      const key = alert.accountId || ad.id;
      nextFingerprints[key] = fingerprint;
      if (settings.notifyInsufficient && previousFingerprints[key] !== fingerprint) alerts.push(alert);
    }

    payload.settings = {
      ...(payload.settings || {}),
      billingExtension: {
        ...(payload.settings?.billingExtension || {}),
        enabled: true,
        lastSyncAt: nowIso,
        lastSyncAtMs: serverReceivedAtMs,
        accountCount: scannedAccounts.length,
        sourceType: "billing_extension",
        extensionVersion,
      },
    };

    transaction.set(workspaceRecord.ref, { payload, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(stateRef, {
      billingConnected: true,
      billingLastAttemptAt: FieldValue.serverTimestamp(),
      billingLastAttemptAtMs: serverReceivedAtMs,
      billingLastSyncAt: FieldValue.serverTimestamp(),
      billingLastSyncAtMs: serverReceivedAtMs,
      billingLastSuccessAtMs: serverReceivedAtMs,
      billingLastReceivedAtMs: serverReceivedAtMs,
      billingLastReason: syncReason,
      billingLastError: "",
      billingExtensionVersion: extensionVersion,
      billingRequestId: requestId,
      billingLastDeviceName: String(deviceName || "Meta Billing Extension").slice(0, 80),
      billingAccountCount: scannedAccounts.length,
      billingMatched: matched,
      billingImported: imported,
      billingLinked: linked,
      billingUpdated: updated,
      insufficientCount,
      insufficientFingerprints: nextFingerprints,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    result = { scanned: scannedAccounts.length, matched, imported, linked, updated, insufficientCount, alerts, settings, serverReceivedAtMs };
  });

  const pushResult = result.settings.notifyInsufficient ? await sendAdsCheckPush(workspace, result.alerts) : { sent: 0, failed: 0 };
  await stateRef.set({
    billingLastPushSent: Number(pushResult.sent || 0),
    billingLastPushFailed: Number(pushResult.failed || 0),
    billingLastPushAt: result.alerts.length ? FieldValue.serverTimestamp() : null,
  }, { merge: true });
  return { ...result, push: pushResult };
}

function parseCardFeePercent(payload) {
  const raw = String(payload?.settings?.cardFeePercent || "0").replace(",", ".");
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function bankSuffixMap(payload) {
  const map = new Map();
  for (const bank of payload.banks || []) {
    const suffix = normalizeLast4(bank.number);
    if (!suffix) continue;
    const values = map.get(suffix) || [];
    values.push(bank);
    map.set(suffix, values);
  }
  return map;
}

function createAdsCheckAdId(accountId) {
  return `smit_${sha256(accountId).slice(0, 14)}`;
}

function buildInsufficientAlert(ad, bank, bankBalance, required) {
  return {
    accountId: normalizeAccountId(ad.accountId),
    adId: String(ad.id || ""),
    name: String(ad.name || ad.accountId || "Tài khoản quảng cáo").slice(0, 160),
    cardLast4: normalizeLast4(ad.paymentCardLast4 || ad.adsCheck?.cardLast4 || bank?.number),
    bankId: String(bank?.id || ""),
    bankName: String(bank?.name || "Tài khoản ngân hàng").slice(0, 120),
    bankBalance: Math.round(Number(bankBalance || 0)),
    required: Math.round(Number(required || 0)),
    shortage: Math.max(0, Math.round(Number(required || 0) - Number(bankBalance || 0))),
    threshold: Math.round(Number(ad.threshold || ad.adsCheck?.threshold || 0)),
    currentAdBalance: Math.round(Number(ad.adsCheckBalance || ad.adsCheck?.balance || 0)),
    remainingThreshold: Math.round(Number(ad.remainingThreshold || ad.adsCheck?.remainingThreshold || 0)),
  };
}

async function sendAdsCheckPush(workspace, alerts) {
  if (!alerts.length) return { sent: 0, failed: 0 };
  const connectionSnap = await db.collection(CONNECTIONS).doc(workspace).get();
  if (!connectionSnap.exists) return { sent: 0, failed: 0 };
  const connection = connectionSnap.data() || {};
  if (connection.settings?.pushEnabled === false) return { sent: 0, failed: 0 };
  const tokenSnap = await connectionSnap.ref.collection("pushTokens").limit(500).get();
  const tokenDocs = tokenSnap.docs.filter((doc) => doc.data()?.subscription?.endpoint);
  if (!tokenDocs.length) return { sent: 0, failed: 0 };

  const first = alerts[0];
  const title = alerts.length === 1 ? "Thẻ không đủ thanh toán Meta" : `${alerts.length} thẻ không đủ thanh toán Meta`;
  const body = alerts.length === 1
    ? `${first.name} · Thẻ •••• ${first.cardLast4 || "----"}: còn ${Number(first.bankBalance || 0).toLocaleString("vi-VN")} đ, cần ${Number(first.required || 0).toLocaleString("vi-VN")} đ.`
    : `${alerts.length} tài khoản quảng cáo có thẻ liên kết không đủ số dư.`;

  return sendWebPushBatch(tokenDocs, {
    title,
    body,
    tag: "tbalance-adscheck-insufficient",
    url: `${configuredWebUrl().toString().replace(/\/$/, "")}/adscheck`,
    data: {
      workspace,
      type: "adscheck_insufficient",
      alertCount: String(alerts.length),
      createdAt: new Date().toISOString(),
    },
  });
}


async function syncAdsCheckData(workspace, connection, body, deviceName) {
  const serverReceivedAtMs = Date.now();
  const rawAccounts = Array.isArray(body.accounts) ? body.accounts.slice(0, 500) : [];
  const clientSentAtMs = cleanTimestampMs(body.clientSentAtMs || body.clientTimeMs);
  const scannedAtMs = cleanTimestampMs(body.scannedAtMs || Date.parse(body.scannedAt || rawAccounts?.[0]?.scannedAt || ""));
  const syncReason = String(body.reason || "unknown").trim().slice(0, 60);
  const sourceType = body.sourceType === "meta_api" ? "meta_api" : "adscheck";
  const isMetaApi = sourceType === "meta_api";
  const extensionVersion = String(body.extensionVersion || (isMetaApi ? "meta-api" : "")).trim().slice(0, 30);
  const requestId = String(body.requestId || "").trim().slice(0, 120);
  const scannedAccounts = rawAccounts.map(normalizeAdsCheckAccount).filter(Boolean);
  const selectionMode = body.selectionMode === "selected" ? "selected" : "all";
  const selectedAccountIds = [...new Set((Array.isArray(body.selectedAccountIds) ? body.selectedAccountIds : scannedAccounts.map((item) => item.accountId)).map(normalizeAccountId).filter(Boolean))].slice(0, 500);
  const selectedAccountIdSet = new Set(selectedAccountIds);
  const discoveredCount = Math.max(scannedAccounts.length, Math.min(500, cleanPositiveNumber(body.discoveredCount) || scannedAccounts.length));
  if (!scannedAccounts.length) {
    const error = new Error(isMetaApi ? "Meta API chưa trả về tài khoản hợp lệ." : "AdsCheck chưa trả về tài khoản hợp lệ.");
    error.status = 400;
    error.code = isMetaApi ? "META_API_EMPTY" : "ADSCHECK_EMPTY";
    throw error;
  }

  const stateRef = db.collection(ADSCHECK_STATES).doc(workspace);
  const nowIso = new Date().toISOString();
  let result = null;

  await db.runTransaction(async (transaction) => {
    const workspaceRecord = await getWorkspaceSnapshot(transaction, workspace);
    const stateSnap = await transaction.get(stateRef);
    const previousState = stateSnap.exists ? (stateSnap.data() || {}) : {};
    const settings = adsCheckSettings(previousState.settings || DEFAULT_ADSCHECK_SETTINGS);
    if (!settings.enabled) {
      transaction.set(stateRef, {
        settings,
        lastAttemptAt: FieldValue.serverTimestamp(),
        lastAttemptAtMs: serverReceivedAtMs,
        lastReceivedAtMs: serverReceivedAtMs,
        lastClientSentAtMs: clientSentAtMs,
        lastScannedAtMs: scannedAtMs,
        lastReason: syncReason,
        extensionVersion,
        requestId,
        lastDeviceName: String(deviceName || (isMetaApi ? "Meta API" : "AdsCheck Extension")).slice(0, 80),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      result = { scanned: scannedAccounts.length, matched: 0, imported: 0, linked: 0, updated: 0, insufficientCount: 0, alerts: [], settings, skipped: "disabled" };
      return;
    }
    const payload = getPayload(workspaceRecord.data || {});
    const deletedIds = deletedAdAccountIdSet(payload.settings || {});
    if (deletedIds.size) {
      payload.adAccounts = payload.adAccounts.filter((ad) => !deletedIds.has(normalizeAccountId(ad.accountId)));
    }
    const existingByAccountId = new Map();
    for (const ad of payload.adAccounts) {
      const id = normalizeAccountId(ad.accountId);
      if (id) existingByAccountId.set(id, ad);
    }
    const suffixes = bankSuffixMap(payload);
    if (selectionMode === "selected") {
      for (const existingAd of payload.adAccounts) {
        if (!existingAd.lastAdsCheckSyncAt && !existingAd.adsCheck) continue;
        existingAd.adsCheckSelected = selectedAccountIdSet.has(normalizeAccountId(existingAd.accountId));
      }
    }
    let matched = 0;
    let imported = 0;
    let linked = 0;
    let updated = 0;
    let ignoredDeleted = 0;

    for (const scanned of scannedAccounts) {
      if (deletedIds.has(scanned.accountId)) {
        ignoredDeleted += 1;
        continue;
      }
      let ad = existingByAccountId.get(scanned.accountId);
      if (!ad && settings.autoImport) {
        ad = {
          id: createAdsCheckAdId(scanned.accountId),
          name: scanned.name,
          accountId: scanned.accountId,
          bankId: "",
          threshold: scanned.threshold || 0,
          createdFrom: isMetaApi ? "meta_api" : "adscheck_smit",
        };
        payload.adAccounts.unshift(ad);
        existingByAccountId.set(scanned.accountId, ad);
        imported += 1;
      } else if (ad) {
        matched += 1;
      }
      if (!ad) continue;

      if (settings.autoLinkBank && !ad.bankId && scanned.cardLast4) {
        const candidates = suffixes.get(scanned.cardLast4) || [];
        if (candidates.length === 1) {
          ad.bankId = candidates[0].id;
          linked += 1;
        }
      }
      if (settings.updateThreshold && scanned.threshold > 0) ad.threshold = scanned.threshold;
      if (scanned.name && (!ad.name || ["adscheck_smit", "meta_api"].includes(ad.createdFrom))) ad.name = scanned.name;
      ad.adsCheckBalance = scanned.balance; // field legacy để dashboard v5.6 tiếp tục hoạt động
      ad.adsCheckSelected = true;
      ad.remainingThreshold = isMetaApi
        ? Math.max(0, cleanPositiveNumber(ad.threshold) - scanned.balance)
        : scanned.remainingThreshold;
      if (scanned.cardLast4 || !isMetaApi) ad.paymentCardLast4 = scanned.cardLast4;
      ad.adsCheckStatus = scanned.status;
      ad.adsCheckOwnerId = scanned.ownerId;
      ad.adsCheckLimit = scanned.limit;
      ad.adsCheckCurrency = scanned.currency;
      ad.lastAdsCheckSyncAt = nowIso;
      if (isMetaApi) {
        ad.metaApiBalance = scanned.balance;
        ad.metaAmountSpent = scanned.amountSpent;
        ad.metaFundingSourceId = scanned.fundingSourceId;
        ad.metaBusinessName = scanned.businessName;
        ad.metaLastSyncAt = nowIso;
        ad.metaCurrency = scanned.currency;
      }
      ad.adsCheck = {
        balance: scanned.balance,
        threshold: isMetaApi ? cleanPositiveNumber(ad.threshold) : scanned.threshold,
        remainingThreshold: ad.remainingThreshold,
        cardLast4: scanned.cardLast4 || ad.paymentCardLast4 || "",
        paymentMethodText: scanned.paymentMethodText,
        ownerId: scanned.ownerId,
        limit: scanned.limit,
        currency: scanned.currency,
        status: scanned.status,
        amountSpent: scanned.amountSpent,
        fundingSourceId: scanned.fundingSourceId,
        businessName: scanned.businessName,
        sourceType,
        sourceUrl: scanned.sourceUrl,
        scannedAt: scanned.scannedAt,
      };
      updated += 1;
    }

    const balances = calculateBankBalances(payload);
    const feePercent = parseCardFeePercent(payload);
    const banksById = new Map(payload.banks.map((bank) => [bank.id, bank]));
    const previousFingerprints = previousState.insufficientFingerprints && typeof previousState.insufficientFingerprints === "object"
      ? previousState.insufficientFingerprints : {};
    const nextFingerprints = {};
    const alerts = [];
    let insufficientCount = 0;

    for (const ad of payload.adAccounts) {
      if (selectionMode === "selected" && ad.adsCheckSelected === false) continue;
      if (!ad.lastAdsCheckSyncAt || !ad.bankId) continue;
      const statusText = String(ad.adsCheckStatus || ad.adsCheck?.status || "").toLowerCase();
      if (/vô hiệu|vo hieu|disabled|closed|đã đóng|da dong/.test(statusText)) continue;
      const threshold = cleanPositiveNumber(ad.threshold || ad.adsCheck?.threshold);
      if (!threshold) continue;
      const bank = banksById.get(ad.bankId);
      if (!bank) continue;
      const bankBalance = Number(balances.get(bank.id) || 0);
      const required = Math.round(threshold + threshold * feePercent / 100);
      if (bankBalance >= required) continue;
      insufficientCount += 1;
      const alert = buildInsufficientAlert(ad, bank, bankBalance, required);
      const fingerprint = sha256(JSON.stringify([
        alert.accountId, alert.bankBalance, alert.required, alert.cardLast4,
      ])).slice(0, 24);
      nextFingerprints[alert.accountId || ad.id] = fingerprint;
      if (settings.notifyInsufficient && previousFingerprints[alert.accountId || ad.id] !== fingerprint) alerts.push(alert);
    }

    const syncSettingsSnapshot = {
      ...settings,
      lastSyncAt: nowIso,
      lastSyncAtMs: serverReceivedAtMs,
      lastReceivedAtMs: serverReceivedAtMs,
      lastScannedAtMs: scannedAtMs,
      lastReason: syncReason,
      extensionVersion,
      accountCount: scannedAccounts.length,
      discoveredCount,
      selectedCount: scannedAccounts.length,
      selectionMode,
      insufficientCount,
      sourceType,
    };
    payload.settings = {
      ...(payload.settings || {}),
      // adsCheck giữ lại cho tương thích dữ liệu cũ; metaApi là nguồn chính từ v5.7.
      adsCheck: { ...(payload.settings?.adsCheck || {}), ...syncSettingsSnapshot },
      metaApi: isMetaApi
        ? { ...(payload.settings?.metaApi || {}), ...syncSettingsSnapshot }
        : (payload.settings?.metaApi || {}),
    };

    transaction.set(workspaceRecord.ref, { payload, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(stateRef, {
      settings,
      lastAttemptAt: FieldValue.serverTimestamp(),
      lastAttemptAtMs: serverReceivedAtMs,
      lastSyncAt: FieldValue.serverTimestamp(),
      lastSyncAtMs: serverReceivedAtMs,
      lastSuccessAtMs: serverReceivedAtMs,
      lastReceivedAtMs: serverReceivedAtMs,
      lastClientSentAtMs: clientSentAtMs,
      lastScannedAtMs: scannedAtMs,
      lastReason: syncReason,
      extensionVersion,
      requestId,
      syncSequence: Number(previousState.syncSequence || 0) + 1,
      lastDeviceName: String(deviceName || (isMetaApi ? "Meta API" : "AdsCheck Extension")).slice(0, 80),
      sourceType,
      adsCheckV6Mode: isMetaApi ? false : true,
      metaAutoSync: isMetaApi ? previousState.metaAutoSync : false,
      metaSource: isMetaApi ? (previousState.metaSource || "marketing_api") : "adscheck_v6",
      sourceUrl: String(body.sourceUrl || scannedAccounts[0]?.sourceUrl || (isMetaApi ? `${META_GRAPH_BASE}/${META_GRAPH_DEFAULT_VERSION}/me/adaccounts` : "https://adscheckv6.smit.vn/app/adscheck-pro")).slice(0, 500),
      accountCount: scannedAccounts.length,
      discoveredCount,
      selectedCount: scannedAccounts.length,
      selectionMode,
      selectedAccountIds,
      matched,
      imported,
      linked,
      updated,
      insufficientCount,
      insufficientFingerprints: nextFingerprints,
      lastAlerts: alerts.slice(0, 20),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    result = { scanned: scannedAccounts.length, discoveredCount, selectedCount: scannedAccounts.length, selectionMode, selectedAccountIds, matched, imported, linked, updated, ignoredDeleted, insufficientCount, alerts, settings, serverReceivedAtMs, clientSentAtMs, scannedAtMs, syncReason, extensionVersion };
  });

  const pushResult = result.settings.notifyInsufficient ? await sendAdsCheckPush(workspace, result.alerts) : { sent: 0, failed: 0 };
  await stateRef.set({
    lastPushSent: Number(pushResult.sent || 0),
    lastPushFailed: Number(pushResult.failed || 0),
    lastPushAt: result.alerts.length ? FieldValue.serverTimestamp() : null,
  }, { merge: true });
  return { ...result, push: pushResult };
}

async function applyParsedReceipt({ workspace, connection, message, parsed, forcedAdId = "", source = "outlook_meta", sourceLabel = "Outlook Meta" }) {
  const receiptId = receiptDocId(message.id);
  const receiptRef = db.collection(RECEIPTS).doc(workspace).collection("items").doc(receiptId);
  let result = null;

  await db.runTransaction(async (transaction) => {
    const receiptSnap = await transaction.get(receiptRef);
    const existingReceipt = receiptSnap.exists ? receiptSnap.data() || {} : null;
    if (existingReceipt && ["auto_deducted", "manually_applied", "duplicate"].includes(existingReceipt.status)) {
      result = { status: existingReceipt.status, receiptId, duplicate: true };
      return;
    }

    const workspaceRecord = await getWorkspaceSnapshot(transaction, workspace);
    const payload = getPayload(workspaceRecord.data);
    const selected = forcedAdId
      ? { ad: payload.adAccounts.find((ad) => ad.id === forcedAdId) || null, reason: "manual" }
      : matchAdAccount(payload, parsed);

    const baseReceipt = {
      messageId: message.id,
      internetMessageId: message.internetMessageId || "",
      subject: parsed.subject || message.subject || "",
      sender: message.from?.emailAddress?.address || "",
      receivedAt: message.receivedDateTime || new Date().toISOString(),
      amount: parsed.amount || 0,
      txId: parsed.txId || "",
      adAccountId: parsed.adAccountId || "",
      cardLast4: parsed.cardLast4 || "",
      reference: parsed.reference || "",
      matchedAdId: selected.ad?.id || "",
      matchReason: selected.reason,
      // Luôn xóa lỗi cũ khi biên lai được xử lý lại/thành công.
      // Trước đây merge:true làm trạng thái "Đã ghi nhận" vẫn còn dòng đỏ "Không khớp...".
      error: "",
      source,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!parsed.amount) {
      transaction.set(receiptRef, { ...baseReceipt, status: "parse_error", error: "Không đọc được số tiền." }, { merge: true });
      result = { status: "parse_error", receiptId };
      return;
    }

    if (!selected.ad) {
      transaction.set(receiptRef, { ...baseReceipt, status: "pending_match", error: "Không khớp được tài khoản quảng cáo." }, { merge: true });
      result = { status: "pending_match", receiptId };
      return;
    }

    if (!connection.settings?.autoDeduct && !forcedAdId) {
      transaction.set(receiptRef, { ...baseReceipt, status: "recognized", error: "Đang tắt tự động trừ tiền." }, { merge: true });
      result = { status: "recognized", receiptId };
      return;
    }

    const duplicate = payload.transactions.find((tx) =>
      (parsed.txId && String(tx.txId || "").toLowerCase() === parsed.txId.toLowerCase()) ||
      String(tx.sourceEventId || tx.outlookMessageId || "") === String(message.id),
    );
    if (duplicate) {
      transaction.set(receiptRef, { ...baseReceipt, status: "duplicate", transactionId: duplicate.id || "" }, { merge: true });
      result = { status: "duplicate", receiptId };
      return;
    }

    const deduction = calculateDeduction(payload, parsed.amount, connection.settings?.deductionMode || "exact");
    const txRecord = {
      id: randomToken(8),
      type: "ad_payment",
      adAccountId: selected.ad.id,
      adAccountNameSnapshot: selected.ad.name || "",
      metaAdAccountId: parsed.adAccountId || selected.ad.accountId || "",
      bankIdSnapshot: selected.ad.bankId || "",
      txId: parsed.txId || `${source === "meta_billing_api" ? "META" : "OUTLOOK"}-${receiptId.slice(0, 16)}`,
      amount: deduction.total,
      rawAmount: deduction.rawAmount,
      fee: deduction.fee,
      feePercent: deduction.feePercent,
      note: `Tự nhận diện ${sourceLabel}${parsed.cardLast4 ? ` · thẻ ${parsed.cardLast4}` : ""}${parsed.reference ? ` · Ref ${parsed.reference}` : ""}`,
      createdAt: message.receivedDateTime || new Date().toISOString(),
      source,
      sourceEventId: message.id,
      outlookMessageId: source === "outlook_meta" ? message.id : "",
      cardLast4: parsed.cardLast4 || "",
      reference: parsed.reference || "",
    };
    payload.transactions.unshift(txRecord);

    transaction.set(workspaceRecord.ref, {
      payload,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(receiptRef, {
      ...baseReceipt,
      status: forcedAdId ? "manually_applied" : "auto_deducted",
      transactionId: txRecord.id,
      deductedAmount: deduction.total,
      fee: deduction.fee,
    }, { merge: true });
    result = { status: forcedAdId ? "manually_applied" : "auto_deducted", receiptId, transaction: txRecord };
  });

  return result;
}

async function rematchPendingReceipts(workspace, connection, { limit = 60 } = {}) {
  if (!connection?.settings?.autoDeduct) {
    return { checked: 0, matched: 0, stillPending: 0, skipped: "auto_deduct_off" };
  }
  const snap = await db.collection(RECEIPTS).doc(workspace).collection("items")
    .orderBy("receivedAt", "desc")
    .limit(Math.max(1, Math.min(100, Number(limit || 60))))
    .get();
  const pending = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((receipt) => receipt.status === "pending_match" && Number(receipt.amount || 0) > 0);

  let matched = 0;
  let stillPending = 0;
  let duplicate = 0;
  let errors = 0;

  for (const receipt of pending) {
    try {
      const parsedAdAccountId = normalizeAccountId(receipt.adAccountId)
        || extractAdAccountId(receipt.subject || "");
      const message = {
        id: receipt.messageId,
        internetMessageId: receipt.internetMessageId || "",
        subject: receipt.subject || "",
        from: { emailAddress: { address: receipt.sender || "" } },
        receivedDateTime: receipt.receivedAt || new Date().toISOString(),
      };
      const parsed = {
        isMeta: true,
        subject: receipt.subject || "",
        body: "",
        amount: Number(receipt.amount || 0),
        txId: receipt.txId || "",
        adAccountId: parsedAdAccountId,
        cardLast4: receipt.cardLast4 || "",
        reference: receipt.reference || "",
      };
      const result = await applyParsedReceipt({ workspace, connection, message, parsed });
      if (result.status === "auto_deducted") matched += 1;
      else if (result.status === "duplicate") duplicate += 1;
      else if (result.status === "pending_match") stillPending += 1;
    } catch (error) {
      console.warn("Không tự khớp lại được biên lai", receipt.id, error?.message || error);
      errors += 1;
    }
  }
  return { checked: pending.length, matched, stillPending, duplicate, errors };
}

async function processMessage(workspace, ref, connection, messageId) {
  const auth = await getAccessToken(workspace, connection, ref);
  const message = await graphRequest(
    `/me/messages/${encodeURIComponent(messageId)}?$select=id,internetMessageId,subject,from,receivedDateTime,body,bodyPreview`,
    auth.token,
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  );
  if (!isAfterProcessStart(auth.connection, message.receivedDateTime)) return { status: "ignored_before_start" };
  const expectedSender = String(auth.connection.settings?.sender || DEFAULT_SENDER).toLowerCase();
  const sender = String(message.from?.emailAddress?.address || "").toLowerCase();
  if (expectedSender && sender !== expectedSender) return { status: "ignored_sender" };
  const parsed = parseMetaReceipt(message);
  if (!parsed.isMeta) return { status: "ignored_content" };
  return applyParsedReceipt({ workspace, connection: auth.connection, message, parsed });
}

async function listAndProcessRecent(workspace, ref, connection, mode = "manual") {
  const auth = await getAccessToken(workspace, connection, ref);
  const list = await graphRequest(
    "/me/mailFolders/inbox/messages?$top=100&$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc",
    auth.token,
  );
  const expectedSender = String(auth.connection.settings?.sender || DEFAULT_SENDER).toLowerCase();
  const processFromMs = getProcessFrom(auth.connection);
  const overlapMs = 15 * 60 * 1000;
  const lastAutoScanMs = Number(auth.connection.lastAutoScanAtMs || 0);
  const scanFromMs = mode === "auto" && lastAutoScanMs
    ? Math.max(processFromMs, lastAutoScanMs - overlapMs)
    : processFromMs;

  const candidates = (list?.value || []).filter((message) => {
    const sender = String(message.from?.emailAddress?.address || "").toLowerCase();
    const receivedAt = Date.parse(message.receivedDateTime || "") || 0;
    return receivedAt >= scanFromMs && (!expectedSender || sender === expectedSender);
  }).slice(0, 50);

  const summary = { checked: candidates.length, autoDeducted: 0, pending: 0, duplicate: 0, ignored: 0, beforeStart: 0, errors: 0 };
  for (const message of candidates) {
    try {
      const result = await processMessage(workspace, ref, auth.connection, message.id);
      if (["auto_deducted", "manually_applied"].includes(result.status)) summary.autoDeducted += 1;
      else if (["pending_match", "recognized", "parse_error"].includes(result.status)) summary.pending += 1;
      else if (result.status === "duplicate") summary.duplicate += 1;
      else if (result.status === "ignored_before_start") summary.beforeStart += 1;
      else summary.ignored += 1;
    } catch (error) {
      console.error("Lỗi xử lý mail", message.id, error);
      summary.errors += 1;
    }
  }
  const patch = mode === "auto"
    ? { lastAutoScanAt: FieldValue.serverTimestamp(), lastAutoScanAtMs: Date.now(), lastAutoScanError: FieldValue.delete() }
    : { lastManualSyncAt: FieldValue.serverTimestamp() };
  await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (summary.autoDeducted > 0) {
    try {
      const workspaceSnap = await db.collection(WORKSPACES).doc(workspace).get();
      if (workspaceSnap.exists) await checkWorkspaceBalanceChanges(workspace, workspaceSnap.data() || {});
    } catch (error) {
      console.warn("Không kiểm tra được thông báo số dư sau Outlook sync:", error?.message || error);
    }
  }
  return summary;
}

async function recentReceipts(workspace, connection = null) {
  const snap = await db.collection(RECEIPTS).doc(workspace).collection("items")
    .orderBy("receivedAt", "desc")
    .limit(100)
    .get();
  const startMs = connection ? getProcessFrom(connection) : Date.now();
  return snap.docs
    .map((doc) => {
      const receipt = { id: doc.id, ...doc.data() };
      if (["auto_deducted", "manually_applied", "duplicate"].includes(receipt.status)) receipt.error = "";
      return receipt;
    })
    .filter((receipt) => (Date.parse(receipt.receivedAt || "") || 0) >= startMs)
    .slice(0, 20);
}

exports.outlookBridge = onRequest({
  region: REGION,
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: [MS_CLIENT_ID, MS_CLIENT_SECRET, OUTLOOK_TOKEN_KEY],
}, async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  try {
    const body = await parseJsonBody(req);
    const action = String(req.query.action || body.action || "status");

    if (action === "authStart") {
      const workspace = normalizeWorkspace(req.query.workspace);
      const syncKey = String(req.query.key || "");
      if (syncKey.length < 20) throw new Error("Khóa đồng bộ Outlook phải có ít nhất 20 ký tự.");
      const returnUrl = normalizeReturnUrl(req.query.returnUrl);
      const existing = await db.collection(CONNECTIONS).doc(workspace).get();
      if (existing.exists && !isAuthorizedKey(existing.data() || {}, syncKey)) {
        const returnOrigin = new URL(returnUrl).origin;
        const allowWebRecovery = !devicePairingRequired()
          && String(req.query.clientType || "").toLowerCase() === "web"
          && allowedWebOrigins().has(returnOrigin);
        if (allowWebRecovery) {
          const connection = existing.data() || {};
          await markDevice(db.collection(CONNECTIONS).doc(workspace), connection, sha256(syncKey), String(req.query.deviceName || "Web T Balance"));
        } else {
          throw deviceAuthError();
        }
      }
      const state = randomToken(32);
      await db.collection(STATES).doc(state).set({
        workspace,
        keyHash: sha256(syncKey),
        returnUrl,
        sender: String(req.query.sender || DEFAULT_SENDER).trim().toLowerCase(),
        autoDeduct: String(req.query.autoDeduct || "true") !== "false",
        deductionMode: req.query.deductionMode === "with_fee" ? "with_fee" : "exact",
        autoScan: String(req.query.autoScan || "true") !== "false",
        pushEnabled: String(req.query.pushEnabled || "true") !== "false",
        expiresAt: Date.now() + 10 * 60 * 1000,
        createdAt: FieldValue.serverTimestamp(),
      });
      const redirectUri = `${baseUrl()}/outlookOAuthCallback`;
      const authUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(MS_TENANT.value())}/oauth2/v2.0/authorize`);
      authUrl.searchParams.set("client_id", MS_CLIENT_ID.value());
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_mode", "query");
      authUrl.searchParams.set("scope", GRAPH_SCOPE);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("prompt", "select_account");
      return res.redirect(authUrl.toString());
    }

    const workspace = normalizeWorkspace(body.workspace || req.query.workspace);
    const syncKey = String(body.syncKey || req.query.key || "");
    const deviceName = String(body.deviceName || req.headers["x-device-name"] || "").trim().slice(0, 80);

    if (action === "deviceStatus") {
      const connectionRef = db.collection(CONNECTIONS).doc(workspace);
      let snap = await connectionRef.get();
      let connection = snap.exists ? (snap.data() || {}) : null;
      let authorized = !!connection && isAuthorizedKey(connection, syncKey);
      if (connection && !authorized) {
        authorized = await autoAuthorizeTrustedWebDevice(workspace, syncKey, deviceName, req, body, connection);
        if (authorized) {
          snap = await connectionRef.get();
          connection = snap.exists ? (snap.data() || {}) : connection;
        }
      }
      return sendJson(res, 200, {
        ok: true,
        workspaceExists: !!connection,
        authorized,
        connected: connection?.status === "connected",
        deviceId: authorized ? deviceIdFromHash(sha256(syncKey)) : null,
        deviceCount: connection ? authorizedKeyHashes(connection).length : 0,
      });
    }

    if (action === "listDevices") {
      const verified = await verifyConnectionKey(workspace, syncKey, deviceName);
      const freshSnap = await verified.ref.get();
      const connection = freshSnap.exists ? (freshSnap.data() || {}) : verified.connection;
      const currentKeyHash = sha256(syncKey);
      const devices = deviceListFromConnection(connection, currentKeyHash);
      return sendJson(res, 200, {
        ok: true,
        devices,
        deviceCount: devices.length,
        currentDeviceId: deviceIdFromHash(currentKeyHash),
        maxDevices: 10,
      });
    }

    if (action === "removeDevice") {
      const targetDeviceId = String(body.deviceId || "").trim().toLowerCase();
      if (!/^[a-f0-9]{16}$/.test(targetDeviceId)) {
        const error = new Error("Mã thiết bị không hợp lệ.");
        error.status = 400;
        error.code = "DEVICE_ID_INVALID";
        throw error;
      }
      const connectionRef = db.collection(CONNECTIONS).doc(workspace);
      const currentKeyHash = sha256(syncKey);
      let result = null;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(connectionRef);
        if (!snap.exists) throw deviceAuthError();
        const connection = snap.data() || {};
        if (!isAuthorizedKey(connection, syncKey)) throw deviceAuthError();
        const hashes = authorizedKeyHashes(connection);
        const targetHash = hashes.find((value) => deviceIdFromHash(value) === targetDeviceId);
        if (!targetHash) {
          const error = new Error("Thiết bị này không còn trong danh sách ghép nối.");
          error.status = 404;
          error.code = "DEVICE_NOT_FOUND";
          throw error;
        }
        if (safeEqualHex(targetHash, currentKeyHash)) {
          const error = new Error("Không thể xóa thiết bị đang dùng tại đây. Hãy xóa từ một thiết bị khác để tránh tự khóa quyền truy cập.");
          error.status = 409;
          error.code = "CANNOT_REMOVE_CURRENT_DEVICE";
          throw error;
        }
        const remaining = hashes.filter((value) => !safeEqualHex(value, targetHash));
        const devices = { ...(connection.devices || {}) };
        const removedDevice = devices[targetDeviceId] || {};
        delete devices[targetDeviceId];
        let nextLegacyKeyHash = String(connection.keyHash || "");
        if (!remaining.some((value) => safeEqualHex(value, nextLegacyKeyHash))) {
          nextLegacyKeyHash = remaining[0] || currentKeyHash;
        }
        tx.update(connectionRef, {
          keyHash: nextLegacyKeyHash,
          authorizedKeyHashes: remaining,
          revokedKeyHashes: [...new Set([...revokedKeyHashes(connection), targetHash])],
          devices,
          updatedAt: FieldValue.serverTimestamp(),
        });
        result = {
          removedDeviceId: targetDeviceId,
          removedDeviceName: String(removedDevice.name || "Thiết bị").slice(0, 80),
          deviceCount: remaining.length,
        };
      });
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (action === "removeOtherDevices") {
      const connectionRef = db.collection(CONNECTIONS).doc(workspace);
      const currentKeyHash = sha256(syncKey);
      let removedCount = 0;
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(connectionRef);
        if (!snap.exists) throw deviceAuthError();
        const connection = snap.data() || {};
        if (!isAuthorizedKey(connection, syncKey)) throw deviceAuthError();
        const hashes = authorizedKeyHashes(connection);
        removedCount = Math.max(0, hashes.length - 1);
        const currentDeviceId = deviceIdFromHash(currentKeyHash);
        const currentMeta = connection.devices?.[currentDeviceId] || {};
        const removedHashes = hashes.filter((value) => !safeEqualHex(value, currentKeyHash));
        tx.update(connectionRef, {
          keyHash: currentKeyHash,
          authorizedKeyHashes: [currentKeyHash],
          revokedKeyHashes: [...new Set([...revokedKeyHashes(connection), ...removedHashes])],
          devices: {
            [currentDeviceId]: {
              name: String(currentMeta.name || deviceName || "Thiết bị hiện tại").trim().slice(0, 80),
              firstSeenAt: currentMeta.firstSeenAt || FieldValue.serverTimestamp(),
              lastSeenAt: FieldValue.serverTimestamp(),
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return sendJson(res, 200, {
        ok: true,
        removedCount,
        deviceCount: 1,
        currentDeviceId: deviceIdFromHash(currentKeyHash),
      });
    }

    if (action === "createPairingCode") {
      const verified = await verifyConnectionKey(workspace, syncKey, deviceName);
      const code = String(crypto.randomInt(10000000, 100000000));
      const pairingId = sha256(`${workspace}:${code}`);
      await db.collection(DEVICE_PAIRINGS).doc(pairingId).set({
        workspace,
        codeHash: sha256(code),
        createdByDeviceId: deviceIdFromHash(sha256(syncKey)),
        expiresAtMs: Date.now() + 10 * 60 * 1000,
        createdAt: FieldValue.serverTimestamp(),
      });
      return sendJson(res, 200, {
        ok: true,
        pairingCode: code,
        expiresAtMs: Date.now() + 10 * 60 * 1000,
        deviceCount: authorizedKeyHashes(verified.connection).length,
      });
    }

    if (action === "joinDevice") {
      if (syncKey.length < 20) {
        const error = new Error("Khóa thiết bị mới không hợp lệ.");
        error.status = 400;
        error.code = "DEVICE_KEY_REQUIRED";
        throw error;
      }
      const pairingCode = String(body.pairingCode || "").replace(/\D/g, "");
      if (!/^\d{8}$/.test(pairingCode)) {
        const error = new Error("Mã ghép thiết bị phải gồm 8 chữ số.");
        error.status = 400;
        error.code = "PAIRING_CODE_INVALID";
        throw error;
      }
      const pairingRef = db.collection(DEVICE_PAIRINGS).doc(sha256(`${workspace}:${pairingCode}`));
      const connectionRef = db.collection(CONNECTIONS).doc(workspace);
      const newHash = sha256(syncKey);
      await db.runTransaction(async (tx) => {
        const [pairingSnap, connectionSnap] = await Promise.all([tx.get(pairingRef), tx.get(connectionRef)]);
        if (!pairingSnap.exists || !connectionSnap.exists) {
          const error = new Error("Mã ghép thiết bị không đúng hoặc đã được sử dụng.");
          error.status = 403;
          error.code = "PAIRING_CODE_INVALID";
          throw error;
        }
        const pairing = pairingSnap.data() || {};
        if (pairing.workspace !== workspace || Number(pairing.expiresAtMs || 0) < Date.now() || !safeEqualHex(pairing.codeHash, sha256(pairingCode))) {
          const error = new Error("Mã ghép thiết bị đã hết hạn. Hãy tạo mã mới trên thiết bị đang đăng nhập.");
          error.status = 403;
          error.code = "PAIRING_CODE_EXPIRED";
          throw error;
        }
        const connection = connectionSnap.data() || {};
        const current = authorizedKeyHashes(connection);
        const creatorStillAuthorized = !pairing.createdByDeviceId
          || current.some((hash) => deviceIdFromHash(hash) === String(pairing.createdByDeviceId));
        if (!creatorStillAuthorized) {
          const error = new Error("Mã ghép đã bị thu hồi vì thiết bị tạo mã không còn được cấp quyền.");
          error.status = 403;
          error.code = "PAIRING_CODE_REVOKED";
          throw error;
        }
        if (!current.includes(newHash) && current.length >= 10) {
          const error = new Error("Workspace đã đạt tối đa 10 thiết bị.");
          error.status = 409;
          error.code = "DEVICE_LIMIT_REACHED";
          throw error;
        }
        const id = deviceIdFromHash(newHash);
        tx.set(connectionRef, {
          authorizedKeyHashes: FieldValue.arrayUnion(newHash),
          revokedKeyHashes: revokedKeyHashes(connection).filter((value) => !safeEqualHex(value, newHash)),
          devices: {
            ...(connection.devices || {}),
            [id]: {
              name: deviceName || "Thiết bị mới",
              firstSeenAt: FieldValue.serverTimestamp(),
              lastSeenAt: FieldValue.serverTimestamp(),
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.delete(pairingRef);
      });
      return sendJson(res, 200, {
        ok: true,
        authorized: true,
        deviceId: deviceIdFromHash(newHash),
        message: "Thiết bị đã được cấp quyền thành công.",
      });
    }

    if (action === "workspaceGet" || action === "workspaceSet") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      if (action === "workspaceGet") {
        const snapshot = await readWorkspacePayload(workspace);
        return sendJson(res, 200, { ok: true, ...snapshot });
      }
      const incomingPayload = sanitizeWorkspacePayload(body.payload);
      const clientBaseVersion = cleanTimestampMs(body.baseUpdatedAtMs);
      const ref = db.collection(WORKSPACES).doc(workspace);
      let conflictMerged = false;
      let savedPayload = incomingPayload;
      await db.runTransaction(async (transaction) => {
        const currentSnap = await transaction.get(ref);
        const currentRaw = currentSnap.exists ? (currentSnap.data() || {}) : {};
        const currentVersion = timestampToMs(currentRaw.updatedAt) || 0;
        if (clientBaseVersion && currentVersion && currentVersion > clientBaseVersion) {
          savedPayload = mergeConcurrentWorkspacePayload(currentRaw, incomingPayload);
          conflictMerged = true;
        }
        transaction.set(ref, { payload: savedPayload, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      const next = await ref.get();
      let balanceNotification = null;
      try {
        balanceNotification = await checkWorkspaceBalanceChanges(workspace, next.data() || {});
      } catch (error) {
        console.warn("Không kiểm tra được thông báo số dư sau workspaceSet:", error?.message || error);
      }
      return sendJson(res, 200, {
        ok: true,
        saved: true,
        conflictMerged,
        updatedAtMs: timestampToMs(next.data()?.updatedAt) || Date.now(),
        balanceNotification,
      });
    }

    if (action === "metaApiStatus") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateSnap = await db.collection(ADSCHECK_STATES).doc(workspace).get();
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const lastSyncAtMs = Number(state.metaLastSyncAtMs || state.metaLastApiAtMs || state.lastSyncAtMs || 0);
      const ageMs = lastSyncAtMs ? Math.max(0, Date.now() - lastSyncAtMs) : 0;
      const tokenConfigured = !!state.metaAccessTokenEnc;
      return sendJson(res, 200, {
        ok: true,
        connected: tokenConfigured,
        tokenConfigured,
        healthy: tokenConfigured && !!lastSyncAtMs && ageMs < 10 * 60 * 1000,
        ageMs,
        settings: { ...adsCheckSettings(state.settings || DEFAULT_ADSCHECK_SETTINGS), updateThreshold: false },
        graphVersion: normalizeMetaGraphVersion(state.metaGraphVersion),
        autoSync: state.metaAutoSync !== false,
        tokenHint: state.metaTokenHint || "",
        metaUserId: state.metaUserId || "",
        metaUserName: state.metaUserName || "",
        fundingDetailsAvailable: state.metaFundingDetailsAvailable !== false,
        accountCount: Number(state.accountCount || 0),
        discoveredCount: Number(state.discoveredCount || state.accountCount || 0),
        selectedCount: Number(state.selectedCount || state.accountCount || 0),
        selectionMode: state.selectionMode === "selected" ? "selected" : "all",
        selectedAccountIds: Array.isArray(state.selectedAccountIds) ? state.selectedAccountIds.slice(0, 500) : [],
        matched: Number(state.matched || 0),
        imported: Number(state.imported || 0),
        linked: Number(state.linked || 0),
        updated: Number(state.updated || 0),
        insufficientCount: Number(state.insufficientCount || 0),
        lastSyncAtMs,
        lastSuccessAtMs: Number(state.metaLastSuccessAtMs || state.metaLastSyncAtMs || state.lastSuccessAtMs || state.lastSyncAtMs || 0),
        lastAttemptAtMs: Number(state.metaLastAttemptAtMs || state.lastAttemptAtMs || 0),
        lastReceivedAtMs: Number(state.metaLastSyncAtMs || state.lastReceivedAtMs || state.lastSyncAtMs || 0),
        lastScannedAtMs: Number(state.lastScannedAtMs || 0),
        lastReason: state.lastReason || "",
        lastError: state.metaLastError || "",
        reconnectRequired: !!state.metaReconnectRequired,
        sourceUrl: state.sourceUrl || "",
        sourceType: state.sourceType || "meta_api",
        lastAlerts: Array.isArray(state.lastAlerts) ? state.lastAlerts : [],
      });
    }

    if (action === "metaApiConfigure") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateRef = db.collection(ADSCHECK_STATES).doc(workspace);
      const stateSnap = await stateRef.get();
      const previous = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const graphVersion = normalizeMetaGraphVersion(body.graphVersion || previous.metaGraphVersion);
      const settings = { ...adsCheckSettings({ ...(previous.settings || {}), ...(body.settings || {}) }), updateThreshold: false };
      const update = {
        settings,
        metaGraphVersion: graphVersion,
        metaAutoSync: body.autoSync !== false,
        metaSource: "marketing_api",
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (body.clearToken === true) {
        update.metaAccessTokenEnc = FieldValue.delete();
        update.metaTokenHint = FieldValue.delete();
        update.metaUserId = FieldValue.delete();
        update.metaUserName = FieldValue.delete();
        update.metaReconnectRequired = false;
      } else if (String(body.accessToken || "").trim()) {
        const token = String(body.accessToken || "").trim();
        if (token.length < 20) {
          const error = new Error("Meta Access Token không hợp lệ.");
          error.status = 400;
          error.code = "META_TOKEN_INVALID";
          throw error;
        }
        const profile = await validateMetaAccessToken(token, graphVersion);
        update.metaAccessTokenEnc = encryptSecret(token);
        update.adsCheckV6Mode = false;
        update.metaSource = "marketing_api";
        update.metaTokenHint = `••••${token.slice(-6)}`;
        update.metaUserId = profile.id;
        update.metaUserName = profile.name;
        update.metaReconnectRequired = false;
        update.metaLastError = "";
      } else if (!previous.metaAccessTokenEnc) {
        const error = new Error("Hãy nhập Meta Access Token ở lần kết nối đầu tiên.");
        error.status = 400;
        error.code = "META_TOKEN_REQUIRED";
        throw error;
      }
      await stateRef.set(update, { merge: true });
      const saved = (await stateRef.get()).data() || {};
      return sendJson(res, 200, {
        ok: true,
        settings,
        tokenConfigured: !!saved.metaAccessTokenEnc,
        tokenHint: saved.metaTokenHint || "",
        graphVersion: normalizeMetaGraphVersion(saved.metaGraphVersion),
        autoSync: saved.metaAutoSync !== false,
        metaUserId: saved.metaUserId || "",
        metaUserName: saved.metaUserName || "",
      });
    }

    if (action === "metaApiSync") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateRef = db.collection(ADSCHECK_STATES).doc(workspace);
      const stateSnap = await stateRef.get();
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const result = await runMetaApiSync(workspace, state, String(body.reason || "manual"), deviceName || "T Balance Web");
      return sendJson(res, 200, { ok: true, ...result });
    }


    if (action === "metaBillingStatus") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateSnap = await db.collection(ADSCHECK_STATES).doc(workspace).get();
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const config = normalizeMetaBillingConfig(state);
      const lastSyncAtMs = Number(state.metaBillingLastSyncAtMs || 0);
      const intervalMs = config.syncIntervalMinutes * 60 * 1000;
      const due = config.enabled && config.autoSync && !!state.metaAccessTokenEnc && (!lastSyncAtMs || Date.now() - lastSyncAtMs >= intervalMs);
      return sendJson(res, 200, {
        ok: true,
        connected: !!state.metaAccessTokenEnc,
        tokenConfigured: !!state.metaAccessTokenEnc,
        tokenHint: state.metaTokenHint || "",
        metaUserId: state.metaUserId || "",
        metaUserName: state.metaUserName || "",
        graphVersion: normalizeMetaGraphVersion(state.metaGraphVersion),
        ...config,
        due,
        lastSyncAtMs,
        lastSuccessAtMs: Number(state.metaBillingLastSuccessAtMs || 0),
        lastAttemptAtMs: Number(state.metaBillingLastAttemptAtMs || 0),
        lastEventTimeMs: Number(state.metaBillingLastEventTimeMs || 0),
        scannedAccounts: Number(state.metaBillingScannedAccounts || 0),
        totalAccounts: Number(state.metaBillingTotalAccounts || state.metaBillingScannedAccounts || 0),
        discoveredAccounts: Number(state.metaBillingDiscoveredAccounts || state.metaBillingTotalAccounts || state.metaBillingScannedAccounts || 0),
        selectionMode: config.selectionMode,
        selectedAccountIds: config.selectedAccountIds,
        selectedAccountCount: Number(state.metaBillingSelectedAccountCount || (config.selectionMode === "selected" ? config.selectedAccountIds.length : state.metaBillingDiscoveredAccounts || state.metaBillingTotalAccounts || 0)),
        availableAccounts: Array.isArray(state.metaBillingAvailableAccounts) ? state.metaBillingAvailableAccounts.slice(0, 500) : [],
        eventsFound: Number(state.metaBillingEventsFound || 0),
        newBills: Number(state.metaBillingNewBills || 0),
        autoDeducted: Number(state.metaBillingAutoDeducted || 0),
        pending: Number(state.metaBillingPending || 0),
        parseErrors: Number(state.metaBillingParseErrors || 0),
        duplicates: Number(state.metaBillingDuplicates || 0),
        recognized: Number(state.metaBillingRecognized || 0),
        lastError: state.metaBillingLastError || "",
        accountErrors: Array.isArray(state.metaBillingAccountErrors) ? state.metaBillingAccountErrors : [],
        recentBills: await recentMetaBillingEvents(workspace, 30),
      });
    }

    if (action === "metaBillingConfigure") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateRef = db.collection(ADSCHECK_STATES).doc(workspace);
      const stateSnap = await stateRef.get();
      const previous = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const graphVersion = normalizeMetaGraphVersion(body.graphVersion || previous.metaGraphVersion);
      const update = {
        metaGraphVersion: graphVersion,
        metaBillingEnabled: body.enabled !== false,
        metaBillingAutoSync: body.autoSync !== false,
        metaBillingAutoDeduct: body.autoDeduct !== false,
        metaBillingOnlyVndAutoDeduct: body.onlyVndAutoDeduct !== false,
        metaBillingLookbackDays: Math.max(1, Math.min(7, Number(body.lookbackDays || previous.metaBillingLookbackDays || 3))),
        metaBillingSyncIntervalMinutes: Math.max(5, Math.min(1440, Number(body.syncIntervalMinutes || previous.metaBillingSyncIntervalMinutes || 10))),
        metaBillingMaxAccountsPerRun: Math.max(5, Math.min(100, Number(body.maxAccountsPerRun || previous.metaBillingMaxAccountsPerRun || 50))),
        metaBillingSelectionMode: body.selectionMode === "selected" ? "selected" : "all",
        metaBillingSelectedAccountIds: [...new Set((Array.isArray(body.selectedAccountIds) ? body.selectedAccountIds : (previous.metaBillingSelectedAccountIds || [])).map(normalizeAccountId).filter(Boolean))].slice(0, 500),
        metaSource: previous.metaSource || "marketing_api",
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (body.clearToken === true) {
        update.metaAccessTokenEnc = FieldValue.delete();
        update.metaTokenHint = FieldValue.delete();
        update.metaUserId = FieldValue.delete();
        update.metaUserName = FieldValue.delete();
        update.metaReconnectRequired = false;
      } else if (String(body.accessToken || "").trim()) {
        const token = String(body.accessToken || "").trim();
        if (token.length < 20) {
          const error = new Error("Meta Access Token không hợp lệ.");
          error.status = 400;
          error.code = "META_TOKEN_INVALID";
          throw error;
        }
        const profile = await validateMetaAccessToken(token, graphVersion);
        const accountResult = await fetchMetaAdAccounts(token, graphVersion);
        update.metaBillingAvailableAccounts = (accountResult.accounts || []).map((item) => ({
          accountId: normalizeAccountId(item.accountId),
          name: String(item.name || item.accountId || "Tài khoản quảng cáo").slice(0, 160),
          currency: String(item.currency || "").toUpperCase(),
          status: String(item.status || "").slice(0, 60),
          businessName: String(item.businessName || "").slice(0, 160),
        })).filter((item) => item.accountId).slice(0, 500);
        update.metaBillingDiscoveredAccounts = update.metaBillingAvailableAccounts.length;
        update.metaAccessTokenEnc = encryptSecret(token);
        update.metaTokenHint = `••••${token.slice(-6)}`;
        update.metaUserId = profile.id;
        update.metaUserName = profile.name;
        update.metaReconnectRequired = false;
        update.metaBillingLastError = "";
      } else if (!previous.metaAccessTokenEnc) {
        const error = new Error("Hãy nhập Meta Access Token ở lần cấu hình đầu tiên.");
        error.status = 400;
        error.code = "META_TOKEN_REQUIRED";
        throw error;
      }
      await stateRef.set(update, { merge: true });
      const saved = (await stateRef.get()).data() || {};
      return sendJson(res, 200, {
        ok: true,
        tokenConfigured: !!saved.metaAccessTokenEnc,
        tokenHint: saved.metaTokenHint || "",
        metaUserId: saved.metaUserId || "",
        metaUserName: saved.metaUserName || "",
        graphVersion: normalizeMetaGraphVersion(saved.metaGraphVersion),
        ...normalizeMetaBillingConfig(saved),
      });
    }

    if (action === "metaBillingAccounts") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateRef = db.collection(ADSCHECK_STATES).doc(workspace);
      const stateSnap = await stateRef.get();
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const provided = String(body.accessToken || "").trim();
      const token = provided || (state.metaAccessTokenEnc ? decryptSecret(state.metaAccessTokenEnc) : "");
      if (!token) {
        const error = new Error("Chưa có Meta Access Token để tải danh sách TKQC.");
        error.status = 400;
        throw error;
      }
      const graphVersion = normalizeMetaGraphVersion(body.graphVersion || state.metaGraphVersion);
      const result = await fetchMetaAdAccounts(token, graphVersion);
      const accounts = (result.accounts || []).map((item) => ({
        accountId: normalizeAccountId(item.accountId),
        name: String(item.name || item.accountId || "Tài khoản quảng cáo").slice(0, 160),
        currency: String(item.currency || "").toUpperCase(),
        status: String(item.status || "").slice(0, 60),
        businessName: String(item.businessName || "").slice(0, 160),
      })).filter((item) => item.accountId).slice(0, 500);
      await stateRef.set({
        metaBillingAvailableAccounts: accounts,
        metaBillingDiscoveredAccounts: accounts.length,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      const config = normalizeMetaBillingConfig(state);
      return sendJson(res, 200, { ok: true, accounts, count: accounts.length, selectionMode: config.selectionMode, selectedAccountIds: config.selectedAccountIds, graphVersion });
    }

    if (action === "metaBillingTest") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateSnap = await db.collection(ADSCHECK_STATES).doc(workspace).get();
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const provided = String(body.accessToken || "").trim();
      const token = provided || (state.metaAccessTokenEnc ? decryptSecret(state.metaAccessTokenEnc) : "");
      if (!token) {
        const error = new Error("Chưa có Meta Access Token để kiểm tra.");
        error.status = 400;
        throw error;
      }
      const graphVersion = normalizeMetaGraphVersion(body.graphVersion || state.metaGraphVersion);
      const profile = await validateMetaAccessToken(token, graphVersion);
      const accountsResult = await fetchMetaAdAccounts(token, graphVersion);
      const first = accountsResult.accounts?.[0] || null;
      const availableAccounts = (accountsResult.accounts || []).map((item) => ({
        accountId: normalizeAccountId(item.accountId),
        name: String(item.name || item.accountId || "Tài khoản quảng cáo").slice(0, 160),
        currency: String(item.currency || "").toUpperCase(),
        status: String(item.status || "").slice(0, 60),
        businessName: String(item.businessName || "").slice(0, 160),
      })).filter((item) => item.accountId).slice(0, 500);
      await db.collection(ADSCHECK_STATES).doc(workspace).set({ metaBillingAvailableAccounts: availableAccounts, metaBillingDiscoveredAccounts: availableAccounts.length, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      let billingActivityCount = 0;
      if (first) {
        const activities = await fetchMetaBillingActivitiesForAccount(first, token, graphVersion, Date.now() - 24 * 60 * 60 * 1000);
        billingActivityCount = activities.length;
      }
      return sendJson(res, 200, {
        ok: true,
        profile,
        graphVersion,
        accountCount: Number(accountsResult.accounts?.length || 0),
        accounts: availableAccounts,
        firstAccount: first ? { accountId: first.accountId, name: first.name, currency: first.currency } : null,
        billingActivityCount,
        activitiesEdgeAccessible: !!first,
      });
    }

    if (action === "metaBillingSync") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateRef = db.collection(ADSCHECK_STATES).doc(workspace);
      const stateSnap = await stateRef.get();
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const result = await runMetaBillingSync(workspace, state, String(body.reason || "manual"), deviceName || "T Balance Web");
      return sendJson(res, 200, { ok: true, ...result, recentBills: await recentMetaBillingEvents(workspace, 30) });
    }

    if (action === "billingExtensionStatus") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateSnap = await db.collection(ADSCHECK_STATES).doc(workspace).get();
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const lastSyncAtMs = Number(state.billingLastSyncAtMs || 0);
      const ageMs = lastSyncAtMs ? Math.max(0, Date.now() - lastSyncAtMs) : 0;
      return sendJson(res, 200, {
        ok: true,
        connected: !!lastSyncAtMs,
        healthy: !!lastSyncAtMs && ageMs < 45 * 60 * 1000,
        ageMs,
        accountCount: Number(state.billingAccountCount || 0),
        matched: Number(state.billingMatched || 0),
        imported: Number(state.billingImported || 0),
        linked: Number(state.billingLinked || 0),
        updated: Number(state.billingUpdated || 0),
        lastSyncAtMs,
        lastSuccessAtMs: Number(state.billingLastSuccessAtMs || lastSyncAtMs || 0),
        lastAttemptAtMs: Number(state.billingLastAttemptAtMs || 0),
        lastReceivedAtMs: Number(state.billingLastReceivedAtMs || lastSyncAtMs || 0),
        lastReason: state.billingLastReason || "",
        lastError: state.billingLastError || "",
        extensionVersion: state.billingExtensionVersion || "",
        lastDeviceName: state.billingLastDeviceName || "",
      });
    }

    if (action === "billingExtensionTargets") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const snapshot = await readWorkspacePayload(workspace);
      const accounts = (snapshot.payload?.adAccounts || []).map((ad) => ({
        accountId: normalizeAccountId(ad.accountId),
        name: String(ad.name || "Tài khoản quảng cáo").slice(0, 160),
        ownerId: normalizeAccountId(ad.adsCheckOwnerId || ad.adsCheck?.ownerId),
        last4: normalizeLast4(ad.paymentCardLast4 || ad.adsCheck?.cardLast4),
        threshold: cleanPositiveNumber(ad.threshold || ad.adsCheck?.threshold),
        billingLastSyncAt: String(ad.billingLastSyncAt || "").slice(0, 40),
      })).filter((item) => item.accountId).slice(0, 500);
      return sendJson(res, 200, { ok: true, accounts, count: accounts.length });
    }

    if (action === "billingExtensionSync") {
      await verifyConnectionKey(workspace, syncKey, deviceName);
      try {
        const result = await syncBillingExtensionData(workspace, body, deviceName || "Meta Billing Extension");
        return sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        await db.collection(ADSCHECK_STATES).doc(workspace).set({
          billingLastAttemptAt: FieldValue.serverTimestamp(),
          billingLastAttemptAtMs: Date.now(),
          billingLastError: String(error?.message || "Billing Extension sync failed").slice(0, 500),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        throw error;
      }
    }

    if (action === "adsCheckStatus") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateSnap = await db.collection(ADSCHECK_STATES).doc(workspace).get();
      const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
      const lastSyncAtMs = Number(state.lastSyncAtMs || 0);
      const ageMs = lastSyncAtMs ? Math.max(0, Date.now() - lastSyncAtMs) : 0;
      return sendJson(res, 200, {
        ok: true,
        connected: stateSnap.exists && !!lastSyncAtMs,
        healthy: !!lastSyncAtMs && ageMs < 10 * 60 * 1000,
        ageMs,
        settings: adsCheckSettings(state.settings || DEFAULT_ADSCHECK_SETTINGS),
        accountCount: Number(state.accountCount || 0),
        discoveredCount: Number(state.discoveredCount || state.accountCount || 0),
        selectedCount: Number(state.selectedCount || state.accountCount || 0),
        selectionMode: state.selectionMode === "selected" ? "selected" : "all",
        selectedAccountIds: Array.isArray(state.selectedAccountIds) ? state.selectedAccountIds.slice(0, 500) : [],
        matched: Number(state.matched || 0),
        imported: Number(state.imported || 0),
        linked: Number(state.linked || 0),
        updated: Number(state.updated || 0),
        insufficientCount: Number(state.insufficientCount || 0),
        lastSyncAtMs,
        lastSuccessAtMs: Number(state.lastSuccessAtMs || state.lastSyncAtMs || 0),
        lastAttemptAtMs: Number(state.lastAttemptAtMs || 0),
        lastReceivedAtMs: Number(state.lastReceivedAtMs || state.lastSyncAtMs || 0),
        lastClientSentAtMs: Number(state.lastClientSentAtMs || 0),
        lastScannedAtMs: Number(state.lastScannedAtMs || 0),
        lastReason: state.lastReason || "",
        extensionVersion: state.extensionVersion || "",
        syncSequence: Number(state.syncSequence || 0),
        requestId: state.requestId || "",
        lastDeviceName: state.lastDeviceName || "",
        sourceUrl: state.sourceUrl || "",
        lastAlerts: Array.isArray(state.lastAlerts) ? state.lastAlerts : [],
      });
    }

    if (action === "adsCheckConfigure") {
      await ensureWorkspaceKey(workspace, syncKey, deviceName, { req, body });
      const stateRef = db.collection(ADSCHECK_STATES).doc(workspace);
      const stateSnap = await stateRef.get();
      const previous = stateSnap.exists ? (stateSnap.data()?.settings || {}) : {};
      const settings = adsCheckSettings({ ...previous, ...(body.settings || {}) });
      await stateRef.set({
        settings,
        adsCheckV6Mode: true,
        metaAutoSync: false,
        metaSource: "adscheck_v6",
        sourceType: "adscheck",
        sourceUrl: "https://adscheckv6.smit.vn/app/adscheck-pro",
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return sendJson(res, 200, { ok: true, settings, adsCheckV6Mode: true });
    }

    if (action === "adsCheckSync") {
      const verifiedAdsCheck = await verifyConnectionKey(workspace, syncKey, deviceName);
      const result = await syncAdsCheckData(workspace, verifiedAdsCheck.connection, body, deviceName);
      let receiptRematch = { checked: 0, matched: 0, stillPending: 0 };
      try {
        receiptRematch = await rematchPendingReceipts(workspace, verifiedAdsCheck.connection, { limit: 60 });
      } catch (error) {
        console.warn("AdsCheck sync: lỗi tự khớp lại biên lai", error?.message || error);
      }
      return sendJson(res, 200, { ok: true, ...result, receiptRematch });
    }

    const verified = await verifyConnectionKey(workspace, syncKey, deviceName);

    if (action === "status") {
      const reconnectRequired = verified.connection?.status === "reconnect_required";
      if (!verified.connection || !verified.connection.refreshTokenEnc || reconnectRequired) {
        return sendJson(res, 200, {
          ok: true,
          connected: false,
          status: verified.connection?.status || "not_connected",
          settings: verified.connection?.settings || {},
          lastError: verified.connection?.lastAuthError || "",
          receipts: [],
        });
      }
      let connection = verified.connection;
      if (!connection.settings?.processFrom) {
        const settings = {
          ...(connection.settings || {}),
          sender: connection.settings?.sender || DEFAULT_SENDER,
          autoDeduct: connection.settings?.autoDeduct !== false,
          deductionMode: connection.settings?.deductionMode === "with_fee" ? "with_fee" : "exact",
          autoScan: connection.settings?.autoScan !== false,
          pushEnabled: connection.settings?.pushEnabled !== false,
          onlyAfterStart: true,
          processFrom: new Date().toISOString(),
        };
        await verified.ref.set({ settings, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        connection = { ...connection, settings };
      }
      return sendJson(res, 200, {
        ok: true,
        connected: true,
        mailbox: connection.mailbox || "",
        displayName: connection.displayName || "",
        status: connection.status === "renew_error" ? "connected_warning" : (connection.status || "connected"),
        connectionHealth: connection.connectionHealth || "ok",
        lastError: connection.lastTransientError || connection.lastError || "",
        subscriptionExpiresAt: connection.subscriptionExpiresAt || "",
        lastManualSyncAt: connection.lastManualSyncAt || null,
        lastAutoScanAt: connection.lastAutoScanAt || null,
        settings: connection.settings || {},
        pushTokenCount: await pushTokenCount(workspace),
        receipts: await recentReceipts(workspace, connection),
      });
    }

    if (!verified.connection) {
      const error = new Error("Outlook chưa được kết nối cho workspace này.");
      error.status = 404;
      throw error;
    }

    if (action === "pushConfig") {
      return sendJson(res, 200, {
        ok: true,
        enabled: Boolean(String(VAPID_PUBLIC_KEY.value() || "").trim() && String(VAPID_PRIVATE_KEY.value() || "").trim()),
        vapidPublicKey: String(VAPID_PUBLIC_KEY.value() || "").trim(),
      });
    }

    if (action === "configure") {
      const sender = String(body.sender || DEFAULT_SENDER).trim().toLowerCase();
      const deductionMode = body.deductionMode === "with_fee" ? "with_fee" : "exact";
      const previous = verified.connection.settings || {};
      const settings = {
        ...previous,
        sender,
        autoDeduct: body.autoDeduct !== false,
        deductionMode,
        autoScan: body.autoScan !== false,
        pushEnabled: body.pushEnabled !== false,
        onlyAfterStart: true,
        processFrom: body.resetProcessFrom === true
          ? new Date().toISOString()
          : (previous.processFrom || new Date().toISOString()),
      };
      await verified.ref.set({ settings, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return sendJson(res, 200, { ok: true, settings });
    }

    if (action === "registerPush") {
      const subscription = body.subscription && typeof body.subscription === "object" ? body.subscription : null;
      const endpoint = String(subscription?.endpoint || "").trim();
      const p256dh = String(subscription?.keys?.p256dh || "").trim();
      const auth = String(subscription?.keys?.auth || "").trim();
      if (!endpoint.startsWith("https://") || !p256dh || !auth) throw new Error("Web Push subscription không hợp lệ.");
      if (!ensureWebPushConfigured()) throw new Error("Máy chủ chưa cấu hình VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY.");
      const tokenId = sha256(endpoint).slice(0, 48);
      await verified.ref.collection("pushTokens").doc(tokenId).set({
        subscription: { endpoint, expirationTime: subscription.expirationTime || null, keys: { p256dh, auth } },
        userAgent: String(body.userAgent || "").slice(0, 500),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return sendJson(res, 200, { ok: true, registered: true, pushTokenCount: await pushTokenCount(workspace) });
    }

    if (action === "unregisterPush") {
      const endpoint = String(body.endpoint || body.subscription?.endpoint || "").trim();
      if (endpoint) await verified.ref.collection("pushTokens").doc(sha256(endpoint).slice(0, 48)).delete();
      return sendJson(res, 200, { ok: true, registered: false, pushTokenCount: await pushTokenCount(workspace) });
    }

    if (action === "sync") {
      const summary = await listAndProcessRecent(workspace, verified.ref, verified.connection, "manual");
      const nextSnap = await verified.ref.get();
      const nextConnection = nextSnap.data() || verified.connection;
      const rematch = await rematchPendingReceipts(workspace, nextConnection, { limit: 100 });
      return sendJson(res, 200, { ok: true, summary, rematch, receipts: await recentReceipts(workspace, nextConnection) });
    }

    if (action === "apply") {
      const receiptId = String(body.receiptId || "");
      const adAccountId = String(body.adAccountId || "");
      if (!receiptId || !adAccountId) throw new Error("Thiếu receiptId hoặc tài khoản quảng cáo.");
      const receiptRef = db.collection(RECEIPTS).doc(workspace).collection("items").doc(receiptId);
      const receiptSnap = await receiptRef.get();
      if (!receiptSnap.exists) {
        const error = new Error("Không tìm thấy email đã nhận diện.");
        error.status = 404;
        throw error;
      }
      const receipt = receiptSnap.data() || {};
      if ((Date.parse(receipt.receivedAt || "") || 0) < getProcessFrom(verified.connection)) {
        throw new Error("Email này cũ hơn mốc bắt đầu nên không được ghi nhận.");
      }
      const message = {
        id: receipt.messageId,
        internetMessageId: receipt.internetMessageId || "",
        subject: receipt.subject || "",
        from: { emailAddress: { address: receipt.sender || "" } },
        receivedDateTime: receipt.receivedAt || new Date().toISOString(),
      };
      const parsed = {
        isMeta: true,
        subject: receipt.subject || "",
        body: "",
        amount: Number(receipt.amount || 0),
        txId: receipt.txId || "",
        adAccountId: receipt.adAccountId || "",
        cardLast4: receipt.cardLast4 || "",
        reference: receipt.reference || "",
      };
      const result = await applyParsedReceipt({
        workspace,
        connection: verified.connection,
        message,
        parsed,
        forcedAdId: adAccountId,
      });
      return sendJson(res, 200, { ok: true, result, receipts: await recentReceipts(workspace, verified.connection) });
    }

    if (action === "disconnect") {
      try {
        if (verified.connection.subscriptionId) {
          const auth = await getAccessToken(workspace, verified.connection, verified.ref);
          await graphRequest(`/subscriptions/${encodeURIComponent(verified.connection.subscriptionId)}`, auth.token, { method: "DELETE" });
        }
      } catch (error) {
        console.warn("Không xóa được Microsoft subscription:", error.message);
      }
      const tokenSnap = await verified.ref.collection("pushTokens").get();
      await Promise.allSettled(tokenSnap.docs.map((doc) => doc.ref.delete()));
      await verified.ref.delete();
      return sendJson(res, 200, { ok: true, connected: false });
    }

    throw new Error("Action không được hỗ trợ.");
  } catch (error) {
    console.error("outlookBridge", error);
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || "Lỗi Outlook Bridge.",
      code: error.code || "OUTLOOK_BRIDGE_ERROR",
    });
  }
});

exports.outlookOAuthCallback = onRequest({
  region: REGION,
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: [MS_CLIENT_ID, MS_CLIENT_SECRET, OUTLOOK_TOKEN_KEY],
}, async (req, res) => {
  try {
    const state = String(req.query.state || "");
    const code = String(req.query.code || "");
    const errorText = String(req.query.error_description || req.query.error || "");
    const stateRef = db.collection(STATES).doc(state);
    const stateSnap = await stateRef.get();
    if (!state || !stateSnap.exists) throw new Error("Phiên kết nối Outlook không hợp lệ hoặc đã hết hạn.");
    const stateData = stateSnap.data() || {};
    await stateRef.delete();
    if (Number(stateData.expiresAt || 0) < Date.now()) throw new Error("Phiên kết nối Outlook đã hết hạn.");
    const returnUrl = normalizeReturnUrl(stateData.returnUrl);
    if (errorText) {
      const target = new URL(returnUrl);
      target.searchParams.set("outlook", "error");
      target.searchParams.set("message", errorText.slice(0, 300));
      return res.redirect(target.toString());
    }
    if (!code) throw new Error("Microsoft không trả về authorization code.");

    const redirectUri = `${baseUrl()}/outlookOAuthCallback`;
    const token = await tokenRequest({
      client_id: MS_CLIENT_ID.value(),
      client_secret: MS_CLIENT_SECRET.value(),
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope: GRAPH_SCOPE,
    });
    if (!token.refresh_token) throw new Error("Microsoft không cấp refresh token. Hãy kiểm tra scope offline_access và kết nối lại.");
    const profile = await graphRequest("/me?$select=id,displayName,mail,userPrincipalName", token.access_token);
    const workspace = normalizeWorkspace(stateData.workspace);
    const ref = db.collection(CONNECTIONS).doc(workspace);
    const existingConnectionSnap = await ref.get();
    const existingConnection = existingConnectionSnap.exists ? (existingConnectionSnap.data() || {}) : {};
    const clientState = randomToken(24);
    const oauthKeyHash = String(stateData.keyHash || "");
    const deviceId = deviceIdFromHash(oauthKeyHash);
    const connection = {
      keyHash: existingConnection.keyHash || oauthKeyHash,
      authorizedKeyHashes: [...new Set([...authorizedKeyHashes(existingConnection), oauthKeyHash].filter(Boolean))],
      devices: {
        ...(existingConnection.devices || {}),
        [deviceId]: {
          ...(existingConnection.devices?.[deviceId] || {}),
          name: existingConnection.devices?.[deviceId]?.name || "Thiết bị kết nối Outlook",
          firstSeenAt: existingConnection.devices?.[deviceId]?.firstSeenAt || FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
        },
      },
      mailbox: profile.mail || profile.userPrincipalName || "",
      displayName: profile.displayName || "",
      microsoftUserId: profile.id || "",
      accessTokenEnc: encryptSecret(token.access_token),
      refreshTokenEnc: encryptSecret(token.refresh_token),
      accessTokenExpiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      clientState,
      settings: {
        sender: String(stateData.sender || DEFAULT_SENDER).toLowerCase(),
        autoDeduct: stateData.autoDeduct !== false,
        deductionMode: stateData.deductionMode === "with_fee" ? "with_fee" : "exact",
        autoScan: stateData.autoScan !== false,
        pushEnabled: stateData.pushEnabled !== false,
        onlyAfterStart: true,
        processFrom: new Date().toISOString(),
      },
      status: "connecting",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(connection, { merge: true });
    const subscription = await createSubscription(token.access_token, clientState);
    await ref.set({
      subscriptionId: subscription.id,
      subscriptionExpiresAt: subscription.expirationDateTime,
      status: "connected",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const target = new URL(returnUrl);
    target.searchParams.set("outlook", "connected");
    return res.redirect(target.toString());
  } catch (error) {
    console.error("outlookOAuthCallback", error);
    const fallback = configuredWebUrl();
    fallback.searchParams.set("outlook", "error");
    fallback.searchParams.set("message", String(error.message || "Lỗi kết nối Outlook").slice(0, 300));
    return res.redirect(fallback.toString());
  }
});

exports.outlookWebhook = onRequest({
  region: REGION,
  timeoutSeconds: 120,
  memory: "256MiB",
  secrets: [MS_CLIENT_ID, MS_CLIENT_SECRET, OUTLOOK_TOKEN_KEY],
}, async (req, res) => {
  const validationToken = req.query.validationToken;
  if (validationToken) {
    res.set("Content-Type", "text/plain");
    return res.status(200).send(String(validationToken));
  }
  try {
    const notifications = Array.isArray(req.body?.value) ? req.body.value : [];
    for (const notification of notifications.slice(0, 20)) {
      try {
        const subscriptionId = String(notification.subscriptionId || "");
        const query = await db.collection(CONNECTIONS).where("subscriptionId", "==", subscriptionId).limit(1).get();
        if (query.empty) continue;
        const doc = query.docs[0];
        const connection = doc.data() || {};
        if (!connection.clientState || notification.clientState !== connection.clientState) continue;
        if (notification.lifecycleEvent) {
          await doc.ref.set({
            lifecycleEvent: String(notification.lifecycleEvent),
            lifecycleEventAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          continue;
        }
        const messageId = notification.resourceData?.id;
        if (!messageId || notification.changeType !== "created") continue;
        await processMessage(doc.id, doc.ref, connection, messageId);
      } catch (itemError) {
        console.error("Lỗi notification Outlook:", itemError);
      }
    }
    return res.status(202).send("");
  } catch (error) {
    console.error("outlookWebhook", error);
    return res.status(202).send("");
  }
});

exports.metaAdsAutoSync = onSchedule({
  region: REGION,
  schedule: "every 5 minutes",
  timeZone: "Asia/Ho_Chi_Minh",
  timeoutSeconds: 540,
  memory: "256MiB",
  maxInstances: 1,
  secrets: [OUTLOOK_TOKEN_KEY],
}, async () => {
  const states = await db.collection(ADSCHECK_STATES).get();
  for (const doc of states.docs) {
    const state = doc.data() || {};
    if (state.adsCheckV6Mode === true || state.metaSource === "adscheck_v6") continue;
    if (!state.metaAccessTokenEnc || state.metaAutoSync === false || state.settings?.enabled === false) continue;
    try {
      const result = await runMetaApiSync(doc.id, state, "scheduler", "Meta API Scheduler");
      console.log("Meta Ads API auto sync:", doc.id, { updated: result.updated, accountCount: result.scanned });
    } catch (error) {
      console.error("Meta Ads API auto sync lỗi:", doc.id, error?.message || error);
    }
  }
});


exports.metaBillingAutoSync = onSchedule({
  region: REGION,
  schedule: "every 5 minutes",
  timeZone: "Asia/Ho_Chi_Minh",
  timeoutSeconds: 540,
  memory: "256MiB",
  maxInstances: 1,
  secrets: [OUTLOOK_TOKEN_KEY, APP_ENCRYPTION_KEY],
}, async () => {
  const states = await db.collection(ADSCHECK_STATES).get();
  for (const doc of states.docs) {
    const state = doc.data() || {};
    const config = normalizeMetaBillingConfig(state);
    if (!state.metaAccessTokenEnc || !config.enabled || !config.autoSync) continue;
    const lastSyncAtMs = Number(state.metaBillingLastSyncAtMs || 0);
    if (lastSyncAtMs && Date.now() - lastSyncAtMs < config.syncIntervalMinutes * 60 * 1000) continue;
    try {
      const result = await runMetaBillingSync(doc.id, state, "scheduler", "Meta Billing Scheduler");
      console.log("Meta Billing API auto sync:", doc.id, {
        scannedAccounts: result.scannedAccounts,
        eventsFound: result.eventsFound,
        autoDeducted: result.autoDeducted,
      });
    } catch (error) {
      console.error("Meta Billing API auto sync lỗi:", doc.id, error?.message || error);
    }
  }
});

exports.outlookAutoScanNewMail = onSchedule({
  region: REGION,
  schedule: "every 5 minutes",
  timeZone: "Asia/Ho_Chi_Minh",
  timeoutSeconds: 540,
  memory: "256MiB",
  secrets: [MS_CLIENT_ID, MS_CLIENT_SECRET, OUTLOOK_TOKEN_KEY],
}, async () => {
  const snap = await db.collection(CONNECTIONS).get();
  for (const doc of snap.docs) {
    const connection = doc.data() || {};
    if (!connection.refreshTokenEnc || connection.status === "reconnect_required" || connection.settings?.autoScan === false) continue;
    try {
      const summary = await listAndProcessRecent(doc.id, doc.ref, connection, "auto");
      console.log("Tự quét Outlook:", doc.id, summary);
    } catch (error) {
      console.error("Tự quét Outlook lỗi:", doc.id, error);
      await doc.ref.set({
        lastAutoScanAt: FieldValue.serverTimestamp(),
        lastAutoScanAtMs: Date.now(),
        lastAutoScanError: error.message,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
});

function serializeBalanceMap(balanceMap) {
  const result = {};
  for (const [bankId, value] of balanceMap.entries()) {
    result[String(bankId)] = Number(value || 0);
  }
  return result;
}

async function checkWorkspaceBalanceChanges(workspace, workspaceData) {
  const payload = getPayload(workspaceData || {});
  const currentBalances = calculateBankBalances(payload);
  const currentSerialized = serializeBalanceMap(currentBalances);
  const stateRef = db.collection(BALANCE_NOTIFICATION_STATES).doc(workspace);
  const stateSnap = await stateRef.get();

  // Lần chạy đầu chỉ lưu mốc số dư, không gửi thông báo cho dữ liệu cũ.
  if (!stateSnap.exists) {
    await stateRef.set({
      balances: currentSerialized,
      initializedAt: FieldValue.serverTimestamp(),
      checkedAt: FieldValue.serverTimestamp(),
      checkedAtMs: Date.now(),
    }, { merge: true });
    return { baselineCreated: true, changes: 0, sent: 0 };
  }

  const previousBalances = stateSnap.data()?.balances || {};
  const banksById = new Map((payload.banks || []).map((bank) => [String(bank.id), bank]));
  const changes = [];

  for (const [bankId, afterRaw] of Object.entries(currentSerialized)) {
    if (!Object.prototype.hasOwnProperty.call(previousBalances, bankId)) continue;
    const before = Number(previousBalances[bankId] || 0);
    const after = Number(afterRaw || 0);
    const delta = after - before;
    if (!delta) continue;

    const bank = banksById.get(bankId) || {};
    const suffix = onlyDigits(bank.number).slice(-4);
    changes.push({
      bankId,
      bankName: `${bank.name || "Tài khoản ngân hàng"}${suffix ? ` •••• ${suffix}` : ""}`,
      before,
      after,
      delta,
    });
  }

  if (!changes.length) {
    await stateRef.set({
      balances: currentSerialized,
      checkedAt: FieldValue.serverTimestamp(),
      checkedAtMs: Date.now(),
    }, { merge: true });
    return { baselineCreated: false, changes: 0, sent: 0 };
  }

  // Gửi trước, chỉ cập nhật mốc sau khi tác vụ gửi hoàn tất.
  // Nếu Web Push tạm lỗi, lần quét kế tiếp sẽ thử lại thay vì bỏ mất thông báo.
  const result = await sendBalancePush(workspace, changes.slice(0, 10));

  await stateRef.set({
    balances: currentSerialized,
    lastChanges: changes.slice(0, 10),
    lastNotificationAt: FieldValue.serverTimestamp(),
    lastNotificationAtMs: Date.now(),
    checkedAt: FieldValue.serverTimestamp(),
    checkedAtMs: Date.now(),
  }, { merge: true });

  return {
    baselineCreated: false,
    changes: changes.length,
    sent: Number(result?.sent || 0),
    failed: Number(result?.failed || 0),
  };
}

// Lịch quét dự phòng cho thay đổi số dư không đi qua workspaceSet/Outlook.
// Vercel Hobby không chạy cron mỗi phút, vì vậy endpoint /cron/balance có thể
// được gọi bởi HTTP scheduler miễn phí; các luồng chính đã kiểm tra tức thời.
exports.balanceNotificationPoller = onSchedule({
  region: REGION,
  schedule: "* * * * *",
  timeZone: "Asia/Ho_Chi_Minh",
  timeoutSeconds: 240,
  memory: "256MiB",
  maxInstances: 1,
}, async () => {
  const workspaceSnap = await db.collection(WORKSPACES).get();

  for (const workspaceDoc of workspaceSnap.docs) {
    try {
      const result = await checkWorkspaceBalanceChanges(workspaceDoc.id, workspaceDoc.data() || {});
      if (result.changes || result.baselineCreated) {
        console.log("Kiểm tra thông báo số dư:", workspaceDoc.id, result);
      }
    } catch (error) {
      console.error("Kiểm tra thông báo số dư lỗi:", workspaceDoc.id, error);
    }
  }
});

exports.outlookRenewSubscriptions = onSchedule({
  region: REGION,
  schedule: "15 3 * * *",
  timeZone: "Asia/Ho_Chi_Minh",
  timeoutSeconds: 540,
  memory: "256MiB",
  secrets: [MS_CLIENT_ID, MS_CLIENT_SECRET, OUTLOOK_TOKEN_KEY],
}, async () => {
  const snap = await db.collection(CONNECTIONS).get();
  for (const doc of snap.docs) {
    const connection = doc.data() || {};
    const expiry = Date.parse(connection.subscriptionExpiresAt || "") || 0;
    if (expiry > Date.now() + 48 * 60 * 60 * 1000 && connection.status !== "reconnect_required") continue;
    try {
      await renewSubscription(doc.id, doc.ref, connection);
      console.log("Đã gia hạn Outlook subscription:", doc.id);
    } catch (error) {
      console.error("Không gia hạn được Outlook subscription:", doc.id, error);
      await doc.ref.set({
        connectionHealth: error.reconnectRequired ? "reconnect_required" : "subscription_warning",
        status: error.reconnectRequired ? "reconnect_required" : (connection.status || "connected"),
        lastError: error.message,
        lastRenewErrorAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
});

if (process.env.NODE_ENV === "test") {
  exports.__metaBillingTestHooks = {
    normalizeMetaBillingActivity,
    extractMetaBillingAmount,
    extractMetaBillingCurrency,
    normalizeMetaBillingConfig,
    shouldRetryMetaBillingEvent,
    encryptSecret,
    decryptSecret,
  };
}
