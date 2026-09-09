const $ = (id) => document.getElementById(id);
const send = (type, extra = {}) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage({ type, ...extra }, (response) => {
    if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
    if (!response?.ok) return reject(new Error(response?.error || "Không thực hiện được."));
    resolve(response.result);
  });
});
const fmtMoney = (value) => `${Number(value || 0).toLocaleString("vi-VN")} đ`;
const fmtExact = (ms) => ms ? new Date(ms).toLocaleString("vi-VN") : "Chưa đồng bộ";
const fmtRelative = (ms) => {
  if (!ms) return "Chưa đồng bộ";
  const diff = Math.max(0, Date.now() - Number(ms));
  if (diff < 15000) return "Vừa đồng bộ";
  if (diff < 60000) return `${Math.floor(diff / 1000)} giây trước`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
  return `${Math.floor(diff / 3600000)} giờ trước`;
};
const message = (text, state = "") => {
  $("message").textContent = text || "";
  $("message").className = `message ${state}`;
};
const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

let previewAccounts = [];
let selectedIds = new Set();

function renderAccounts() {
  const q = String($("accountSearch").value || "").trim().toLowerCase();
  const accounts = previewAccounts.filter((item) => !q || `${item.name || ""} ${item.accountId || ""}`.toLowerCase().includes(q));
  $("accountCount").textContent = `${selectedIds.size}/${previewAccounts.length} tài khoản được chọn`;
  if (!accounts.length) {
    $("accountList").innerHTML = '<div class="empty">Không có tài khoản phù hợp.</div>';
    return;
  }
  $("accountList").innerHTML = accounts.map((item) => `<label class="account-item">
    <input type="checkbox" data-account-id="${escapeHtml(item.accountId)}" ${selectedIds.has(String(item.accountId)) ? "checked" : ""}>
    <div><div class="account-name">${escapeHtml(item.name || "Tài khoản quảng cáo")}</div><div class="account-id">${escapeHtml(item.accountId || "")}${item.cardLast4 ? ` · •••• ${escapeHtml(item.cardLast4)}` : ""}</div></div>
    <div class="account-balance">${fmtMoney(item.balance)}</div>
  </label>`).join("");
  $("accountList").querySelectorAll("[data-account-id]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) selectedIds.add(input.dataset.accountId);
    else selectedIds.delete(input.dataset.accountId);
    $("accountCount").textContent = `${selectedIds.size}/${previewAccounts.length} tài khoản được chọn`;
  }));
}

function renderSyncTime(local, server) {
  const syncMs = Number(server?.lastSyncAtMs || local?.lastSuccessAt || local?.lastSyncAt || 0);
  $("lastSync").textContent = syncMs ? `${fmtRelative(syncMs)} · ${fmtExact(syncMs)}` : "Chưa đồng bộ";
  const detail = $("syncDetail");
  if (detail) {
    const parts = [];
    if (server?.lastScannedAtMs) parts.push(`AdsCheck quét ${fmtExact(server.lastScannedAtMs)}`);
    if (server?.lastReceivedAtMs) parts.push(`Server nhận ${fmtExact(server.lastReceivedAtMs)}`);
    if (server?.lastReason) parts.push(`Lý do: ${server.lastReason}`);
    if (local?.lastError) parts.push(`Lỗi gần nhất: ${local.lastError}`);
    detail.textContent = parts.join(" · ") || "Dữ liệu sẽ tự gửi khi bảng AdsCheck sẵn sàng.";
    detail.className = `muted ${local?.lastError ? "error-text" : ""}`;
  }
}

async function ensureServerPermission(value) {
  const raw = String(value || "").trim();
  const url = new URL(raw);
  const known = url.hostname.endsWith(".vercel.app") || ["tranductai.xyz", "www.tranductai.xyz"].includes(url.hostname) || ["localhost", "127.0.0.1"].includes(url.hostname);
  if (known) return true;
  const originPattern = `${url.origin}/*`;
  const has = await chrome.permissions.contains({ origins: [originPattern] });
  if (has) return true;
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (!granted) throw new Error("Chrome chưa cấp quyền truy cập custom domain T Balance.");
  return true;
}

async function load() {
  const cfg = await send("GET_SETTINGS");
  $("serverBase").value = cfg.serverBase || "";
  $("deviceName").value = cfg.deviceName || "AdsCheck Extension";
  $("autoSync").checked = cfg.autoSync !== false;
  $("autoOpen").checked = cfg.autoOpen !== false;
  $("autoRefreshBeforeSync").checked = cfg.autoRefreshBeforeSync !== false;
  $("intervalMinutes").value = String(cfg.intervalMinutes || 5);
  $("syncSelectedOnly").checked = cfg.syncSelectedOnly === true;
  previewAccounts = Array.isArray(cfg.lastPreviewAccounts) ? cfg.lastPreviewAccounts : [];
  selectedIds = new Set(Array.isArray(cfg.selectedAccountIds) ? cfg.selectedAccountIds.map(String) : []);
  if (!selectedIds.size && previewAccounts.length) selectedIds = new Set(previewAccounts.map((item) => String(item.accountId)));
  renderAccounts();
  renderSyncTime(cfg, null);

  try {
    const status = await send("CHECK_STATUS");
    const authorized = !!status.device?.authorized;
    const healthy = status.status?.healthy === true;
    $("statusText").textContent = authorized
      ? `${healthy ? "Đồng bộ realtime" : "Đã ghép"} · ${status.status?.selectedCount || status.status?.accountCount || 0} TKQC`
      : "Chưa ghép với T Balance";
    $("statusDot").className = `dot ${authorized ? (healthy ? "ok" : "warn") : "bad"}`;
    $("pairBox").style.display = authorized ? "none" : "block";
    const settings = status.status?.settings || {};
    $("autoImport").checked = settings.autoImport !== false;
    $("autoLinkBank").checked = settings.autoLinkBank !== false;
    $("updateThreshold").checked = settings.updateThreshold !== false;
    $("notifyInsufficient").checked = settings.notifyInsufficient !== false;
    renderSyncTime(status.local || cfg, status.status);
  } catch (error) {
    $("statusText").textContent = "Chưa kết nối";
    $("statusDot").className = "dot bad";
    message(error.message, "bad");
  }
}

async function saveSettings(showMessage = true) {
  await ensureServerPermission($("serverBase").value);
  await send("SAVE_SETTINGS", { settings: {
    serverBase: $("serverBase").value,
    deviceName: $("deviceName").value,
    autoSync: $("autoSync").checked,
    autoOpen: $("autoOpen").checked,
    autoRefreshBeforeSync: $("autoRefreshBeforeSync").checked,
    intervalMinutes: Number($("intervalMinutes").value),
    syncSelectedOnly: $("syncSelectedOnly").checked,
    selectedAccountIds: [...selectedIds],
    serverSettings: {
      autoImport: $("autoImport").checked,
      autoLinkBank: $("autoLinkBank").checked,
      updateThreshold: $("updateThreshold").checked,
      notifyInsufficient: $("notifyInsufficient").checked
    }
  }});
  if (showMessage) message("Đã lưu cài đặt. Extension sẽ tiếp tục tự đồng bộ.", "ok");
}

$("pairingCode").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 8);
});
$("accountSearch").addEventListener("input", renderAccounts);
$("selectAllBtn").onclick = () => {
  selectedIds = new Set(previewAccounts.map((item) => String(item.accountId)));
  renderAccounts();
};
$("selectNoneBtn").onclick = () => {
  selectedIds.clear();
  renderAccounts();
};
$("previewBtn").onclick = async () => {
  try {
    message($("autoRefreshBeforeSync").checked ? "Đang làm mới AdsCheck rồi đọc danh sách…" : "Đang đọc bảng AdsCheck…");
    const result = await send("PREVIEW_ACCOUNTS");
    previewAccounts = result.accounts || [];
    if (!selectedIds.size) selectedIds = new Set(previewAccounts.map((item) => String(item.accountId)));
    renderAccounts();
    message(`Đã đọc ${previewAccounts.length} tài khoản.`, "ok");
  } catch (error) { message(error.message, "bad"); }
};
$("pairBtn").onclick = async () => {
  try {
    message("Đang ghép thiết bị và gửi dữ liệu lần đầu…");
    await ensureServerPermission($("serverBase").value);
    const result = await send("PAIR_DEVICE", { pairingCode: $("pairingCode").value, serverBase: $("serverBase").value });
    if (result.syncResult?.ok === false) message(`Ghép thành công. Chưa gửi được dữ liệu: ${result.syncResult.error}`, "bad");
    else message("Ghép thành công và đã tự đồng bộ dữ liệu.", "ok");
    await load();
  } catch (error) { message(error.message, "bad"); }
};
$("saveBtn").onclick = async () => {
  try { await saveSettings(true); }
  catch (error) { message(error.message, "bad"); }
};
$("syncBtn").onclick = async () => {
  try {
    await saveSettings(false);
    message($("autoRefreshBeforeSync").checked ? "Đang làm mới AdsCheck và gửi dữ liệu…" : "Đang đọc và gửi dữ liệu…");
    const result = await send("RUN_SYNC");
    message(`Phát hiện ${result.discoveredCount || result.scanned || 0} · gửi ${result.selectedCount || result.scanned || 0} · khớp ${result.matched || 0} · thêm ${result.imported || 0} · cảnh báo ${result.alerts?.length || 0}.`, "ok");
    await load();
  } catch (error) { message(error.message, "bad"); }
};
$("openAdsCheck").onclick = () => send("OPEN_ADSCHECK");
$("openTBalance").onclick = () => send("OPEN_TBALANCE");

load().catch((error) => message(error.message, "bad"));
