#!/usr/bin/env python3
'''
Apply the Meta API timestamp + missing billing-event fix to tdt-ads-balance.

Run from the repository root:
    python3 apply_meta_billing_fix.py
Then:
    npm run check
    npm test

The script is intentionally strict: every replacement must match the current
source exactly once, otherwise it aborts without writing files.
'''
from pathlib import Path

ROOT = Path.cwd()
SERVER = ROOT / "server" / "meta-runtime.js"
PUBLIC = ROOT / "public" / "index.html"
TESTS = ROOT / "tests" / "test_meta_billing_parser.js"

for p in (SERVER, PUBLIC, TESTS):
    if not p.exists():
        raise SystemExit(f"Missing {p}. Run this script from the repository root.")

sources = {
    SERVER: SERVER.read_text(encoding="utf-8"),
    PUBLIC: PUBLIC.read_text(encoding="utf-8"),
    TESTS: TESTS.read_text(encoding="utf-8"),
}

def replace_once(path: Path, old: str, new: str, label: str):
    text = sources[path]
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"[ABORT] {label}: expected exactly 1 match in {path}, found {count}. "
            "No files were written."
        )
    sources[path] = text.replace(old, new, 1)

# 1) Direct Meta API status must never reuse stale legacy/AdsCheck timestamps.
replace_once(
    SERVER,
'''    const result = await syncMetaAccountsToWorkspace(workspace, fetched.accounts, reason, deviceName);
    await db.collection(META_STATES).doc(workspace).set({
      metaLastApiAt: FieldValue.serverTimestamp(),
      metaLastApiAtMs: Date.now(),
      metaLastSyncAt: FieldValue.serverTimestamp(),
      metaLastSyncAtMs: Date.now(),
      metaLastSuccessAtMs: Date.now(),
      metaLastError: "",''',
'''    const result = await syncMetaAccountsToWorkspace(workspace, fetched.accounts, reason, deviceName);
    const syncedAtMs = Date.now();
    await db.collection(META_STATES).doc(workspace).set({
      metaLastApiAt: FieldValue.serverTimestamp(),
      metaLastApiAtMs: syncedAtMs,
      metaLastSyncAt: FieldValue.serverTimestamp(),
      metaLastSyncAtMs: syncedAtMs,
      metaLastSuccessAtMs: syncedAtMs,
      metaLastReceivedAtMs: syncedAtMs,
      metaLastScannedAtMs: syncedAtMs,
      metaLastReason: String(reason || "manual").slice(0, 60),
      metaLastError: "",''',
    "Meta API sync timestamps",
)

# Keep account-enrichment behavior bounded; the larger page budget below is for
# the dedicated billing sync, not the 90-day profile enrichment on every account sync.
replace_once(
    SERVER,
'''        const activities = await fetchMetaBillingActivitiesForAccount(account, accessToken, graphVersion, Date.now() - 90 * 24 * 60 * 60 * 1000);''',
'''        const activities = await fetchMetaBillingActivitiesForAccount(account, accessToken, graphVersion, Date.now() - 90 * 24 * 60 * 60 * 1000, { maxPages: 4 });''',
    "bounded account billing enrichment",
)

# 2) Recovery horizon: never less than 7 days, manual repair can reach 30 days.
replace_once(
    SERVER,
'''    lookbackDays: Math.max(1, Math.min(7, Number(state.metaBillingLookbackDays || 3))),''',
'''    lookbackDays: Math.max(7, Math.min(30, Number(state.metaBillingLookbackDays || 7))),''',
    "billing lookback config",
)

# 3) Parse activity timestamps once and reuse the same logic for pagination coverage.
replace_once(
    SERVER,
'''function normalizeMetaBillingActivity(account, activity) {
  const extraData = safeJsonParse(activity?.extra_data);
  const accountId = normalizeAccountId(account?.accountId || account?.account_id || account?.id);
  const eventType = String(activity?.event_type || "").trim();
  const eventTimeRaw = activity?.event_time || activity?.date_time_in_timezone || "";
  const eventTimeMs = /^\\d+$/.test(String(eventTimeRaw || ""))
    ? Number(eventTimeRaw) * (String(eventTimeRaw).length <= 10 ? 1000 : 1)
    : (Date.parse(String(eventTimeRaw || "")) || Date.now());''',
'''function metaActivityEventTimeMs(activity) {
  const eventTimeRaw = activity?.event_time || activity?.date_time_in_timezone || "";
  if (/^\\d+$/.test(String(eventTimeRaw || ""))) {
    const value = Number(eventTimeRaw);
    return Number.isFinite(value) ? value * (String(eventTimeRaw).length <= 10 ? 1000 : 1) : 0;
  }
  const parsed = Date.parse(String(eventTimeRaw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizeMetaBillingActivity(account, activity) {
  const extraData = safeJsonParse(activity?.extra_data);
  const accountId = normalizeAccountId(account?.accountId || account?.account_id || account?.id);
  const eventType = String(activity?.event_type || "").trim();
  const eventTimeMs = metaActivityEventTimeMs(activity) || Date.now();''',
    "shared Meta activity timestamp parser",
)

# 4) Billing pagination: 4 pages/400 output rows could silently stop before an
# older payment activity. Scan deeper, stop by time boundary, and expose whether
# the scan was complete so callers do not advance the cursor on truncation.
replace_once(
    SERVER,
'''async function fetchMetaBillingActivitiesForAccount(account, accessToken, graphVersion, sinceMs) {
  const version = normalizeMetaGraphVersion(graphVersion);
  const accountId = normalizeAccountId(account?.accountId || account?.account_id || account?.id);
  if (!accountId) return [];
  const makeUrl = (withSince = true) => {''',
'''async function fetchMetaBillingActivitiesForAccount(account, accessToken, graphVersion, sinceMs, options = {}) {
  const version = normalizeMetaGraphVersion(graphVersion);
  const accountId = normalizeAccountId(account?.accountId || account?.account_id || account?.id);
  if (!accountId) return [];
  const requestedMaxPages = Number(options.maxPages || process.env.META_BILLING_MAX_ACTIVITY_PAGES || 50);
  const maxPages = Math.max(4, Math.min(100, Number.isFinite(requestedMaxPages) ? requestedMaxPages : 50));
  const makeUrl = (withSince = true) => {''',
    "billing fetch signature/page budget",
)

replace_once(
    SERVER,
'''  async function read(startUrl) {
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
  }''',
'''  async function read(startUrl) {
    const output = [];
    let next = startUrl.toString();
    let pages = 0;
    let rawActivitiesScanned = 0;
    let oldestSeenMs = 0;
    let reachedSinceBoundary = false;
    while (next && pages < maxPages) {
      const payload = await metaGraphFetch(next, accessToken, { maxAttempts: 2 });
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      let pageNewestMs = 0;
      for (const activity of rows) {
        rawActivitiesScanned += 1;
        const rawEventTimeMs = metaActivityEventTimeMs(activity);
        if (rawEventTimeMs) {
          if (!oldestSeenMs || rawEventTimeMs < oldestSeenMs) oldestSeenMs = rawEventTimeMs;
          if (rawEventTimeMs > pageNewestMs) pageNewestMs = rawEventTimeMs;
        }
        const normalized = normalizeMetaBillingActivity(account, activity);
        if (!normalized.isBillingEvent) continue;
        if (sinceMs && normalized.eventTimeMs < sinceMs) continue;
        output.push(normalized);
      }
      next = payload?.paging?.next || "";
      pages += 1;

      // Needed for Graph versions/accounts that reject `since`: when an entire
      // page is at/before the requested boundary, older pages cannot contain a
      // bill inside the requested window.
      if (sinceMs && pageNewestMs && pageNewestMs <= sinceMs) {
        reachedSinceBoundary = true;
        next = "";
      }
    }
    Object.defineProperty(output, "_fetchMeta", {
      value: {
        complete: !next || reachedSinceBoundary,
        pages,
        rawActivitiesScanned,
        oldestSeenMs,
        maxPages,
      },
      enumerable: false,
    });
    return output;
  }''',
    "billing pagination coverage",
)

# 5) New parser revision triggers a repair/backfill. One-hour overlap protects
# against delayed Meta activities while event-id de-dupe keeps it idempotent.
replace_once(
    SERVER,
'''  const forceBackfill = reason === "manual" || reason === "repair" || Number(parserRevision || 0) < 8;
  if (forceBackfill) return Number(lookbackFloor || 0);
  return Math.max(Number(lookbackFloor || 0), Number(cursorMs || 0) ? Number(cursorMs) - 20 * 60 * 1000 : 0);''',
'''  const forceBackfill = reason === "manual" || reason === "repair" || Number(parserRevision || 0) < 9;
  if (forceBackfill) return Number(lookbackFloor || 0);
  return Math.max(Number(lookbackFloor || 0), Number(cursorMs || 0) ? Number(cursorMs) - 60 * 60 * 1000 : 0);''',
    "billing backfill revision/overlap",
)

# Per-account migration revision: every account gets its own one-time 7-day
# recovery even when a workspace has more accounts than maxAccountsPerRun.
replace_once(
    SERVER,
'''  const accountCursors = state.metaBillingAccountCursors && typeof state.metaBillingAccountCursors === "object"
    ? { ...state.metaBillingAccountCursors } : {};
  try {''',
'''  const accountCursors = state.metaBillingAccountCursors && typeof state.metaBillingAccountCursors === "object"
    ? { ...state.metaBillingAccountCursors } : {};
  const accountParserRevisions = state.metaBillingAccountParserRevisions && typeof state.metaBillingAccountParserRevisions === "object"
    ? { ...state.metaBillingAccountParserRevisions } : {};
  try {''',
    "per-account billing parser revisions",
)

replace_once(
    SERVER,
'''          parserRevision: Number(state.metaBillingParserRevision || 0),
        });
        try {
          const events = await fetchMetaBillingActivitiesForAccount(account, accessToken, graphVersion, sinceMs);
          accountCursors[accountId] = now;
          return events;''',
'''          parserRevision: Number(accountParserRevisions[accountId] || 0),
        });
        try {
          const events = await fetchMetaBillingActivitiesForAccount(account, accessToken, graphVersion, sinceMs);
          const fetchMeta = events?._fetchMeta || {};
          if (fetchMeta.complete !== false) {
            accountCursors[accountId] = now;
            accountParserRevisions[accountId] = 9;
          } else {
            errors.push({
              accountId: account.accountId,
              error: `Meta activities chưa quét hết (${Number(fetchMeta.pages || 0)}/${Number(fetchMeta.maxPages || 0)} trang, ${Number(fetchMeta.rawActivitiesScanned || 0)} activity). Giữ nguyên cursor để không bỏ sót bill.`,
            });
          }
          return events;''',
    "do not advance truncated billing cursor",
)

# Make partial scans visible instead of advertising them as a fully successful sync.
replace_once(
    SERVER,
'''    const patch = {
      metaBillingEnabled: config.enabled,''',
'''    const fullySuccessful = errors.length === 0;
    const patch = {
      metaBillingEnabled: config.enabled,''',
    "partial billing success marker",
)

replace_once(
    SERVER,
'''      metaBillingLastSuccessAtMs: Date.now(),''',
'''      metaBillingLastSuccessAtMs: fullySuccessful ? Date.now() : Number(state.metaBillingLastSuccessAtMs || 0),''',
    "partial billing lastSuccessAt",
)

replace_once(
    SERVER,
'''      metaBillingAccountCursors: accountCursors,
      metaBillingParserRevision: 8,''',
'''      metaBillingAccountCursors: accountCursors,
      metaBillingAccountParserRevisions: accountParserRevisions,
      metaBillingParserRevision: 9,''',
    "persist per-account billing recovery revision",
)

replace_once(
    SERVER,
'''      metaBillingRecognized: recognized,
      metaBillingLastError: "",
      metaBillingAccountErrors: errors.slice(0, 20),''',
'''      metaBillingRecognized: recognized,
      metaBillingLastError: fullySuccessful ? "" : `${errors.length} TKQC quét billing chưa hoàn tất. Xem accountErrors.`,
      metaBillingAccountErrors: errors.slice(0, 20),''',
    "expose partial billing errors",
)

# 6) Correct the exact UI timestamp bug shown in the screenshot.
replace_once(
    SERVER,
'''        lastReceivedAtMs: Number(state.metaLastSyncAtMs || state.lastReceivedAtMs || state.lastSyncAtMs || 0),
        lastScannedAtMs: Number(state.lastScannedAtMs || 0),
        lastReason: state.lastReason || "",''',
'''        lastReceivedAtMs: Number(state.metaLastReceivedAtMs || state.metaLastSyncAtMs || state.metaLastApiAtMs || 0),
        lastScannedAtMs: Number(state.metaLastScannedAtMs || state.metaLastApiAtMs || state.metaLastSyncAtMs || 0),
        lastReason: state.metaLastReason || "",''',
    "Meta API status timing fields",
)

replace_once(
    SERVER,
'''        metaBillingLookbackDays: Math.max(1, Math.min(7, Number(body.lookbackDays || previous.metaBillingLookbackDays || 3))),''',
'''        metaBillingLookbackDays: Math.max(7, Math.min(30, Number(body.lookbackDays || previous.metaBillingLookbackDays || 7))),''',
    "billing configure lookback",
)

# UI: make 7 days the minimum/default recovery horizon.
replace_once(
    PUBLIC,
'''<div class="field" style="flex:1"><label>Dò lại lịch sử</label><select id="metaBillingLookbackDays"><option value="1">1 ngày</option><option value="2">2 ngày</option><option value="3" selected>3 ngày</option><option value="5">5 ngày</option><option value="7">7 ngày</option></select></div>''',
'''<div class="field" style="flex:1"><label>Dò lại lịch sử</label><select id="metaBillingLookbackDays"><option value="7" selected>7 ngày</option><option value="14">14 ngày</option><option value="30">30 ngày</option></select></div>''',
    "billing lookback UI",
)

# Tests for the new bounds/revision.
replace_once(
    TESTS,
'''assert.equal(cfg.syncIntervalMinutes, 5);
assert.equal(cfg.lookbackDays, 7);
assert.equal(cfg.maxAccountsPerRun, 100);''',
'''assert.equal(cfg.syncIntervalMinutes, 5);
assert.equal(cfg.lookbackDays, 30);
assert.equal(cfg.maxAccountsPerRun, 100);
assert.equal(hooks.normalizeMetaBillingConfig({ metaBillingLookbackDays: 1 }).lookbackDays, 7);
assert.equal(hooks.normalizeMetaBillingConfig({}).lookbackDays, 7);''',
    "billing config tests",
)

replace_once(
    TESTS,
'''assert.equal(hooks.resolveMetaBillingSinceMs({ reason: "manual", lookbackFloor: lookback, cursorMs: cursor, parserRevision: 8 }), lookback);
assert.equal(hooks.resolveMetaBillingSinceMs({ reason: "auto", lookbackFloor: lookback, cursorMs: cursor, parserRevision: 7 }), lookback);
assert.equal(hooks.resolveMetaBillingSinceMs({ reason: "auto", lookbackFloor: lookback, cursorMs: cursor, parserRevision: 8 }), cursor - 20*60*1000);''',
'''assert.equal(hooks.resolveMetaBillingSinceMs({ reason: "manual", lookbackFloor: lookback, cursorMs: cursor, parserRevision: 9 }), lookback);
assert.equal(hooks.resolveMetaBillingSinceMs({ reason: "auto", lookbackFloor: lookback, cursorMs: cursor, parserRevision: 8 }), lookback);
assert.equal(hooks.resolveMetaBillingSinceMs({ reason: "auto", lookbackFloor: lookback, cursorMs: cursor, parserRevision: 9 }), cursor - 60*60*1000);''',
    "billing backfill tests",
)

# All replacements matched; only now write files.
for p, text in sources.items():
    p.write_text(text, encoding="utf-8")
    print(f"[OK] updated {p.relative_to(ROOT)}")

print()
print("Fix applied.")
print("Next run:")
print("  npm run check")
print("  npm test")
print()
print("After deploy, run one manual Meta Billing sync. Existing accounts will also")
print("receive a per-account 7-day recovery backfill automatically on their next scan.")
