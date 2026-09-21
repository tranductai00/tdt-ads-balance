'use strict';
const assert = require('node:assert/strict');
const Module = require('module');
const original = Module._load;
const docs = new Map();
function ref(path) {
  return { path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`),
    async get() { return { exists: docs.has(path), data: () => docs.get(path), ref: this, id: this.id }; },
    async set(value, opts) { docs.set(path, opts?.merge ? { ...docs.get(path), ...value } : value); } };
}
function collection(path) { return { doc: id => ref(`${path}/${id}`), async get() { return { docs: await Promise.all([...docs.keys()].filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(k => ref(k).get())) }; } }; }
const db = { collection, async runTransaction(fn) { return fn({ get: r => r.get(), set: (r,v,o) => r.set(v,o) }); } };
Module._load = function(name, parent, main) {
  if (name === './store' && parent.filename.endsWith('google-sheets.js')) return { getStore: () => db, FieldValue: { serverTimestamp: () => 'now' } };
  if (name === 'web-push') return { setVapidDetails() {}, async sendNotification() {} };
  if (name === 'pg') return { Pool: class {} };
  return original.call(this, name, parent, main);
};
process.env.NODE_ENV = 'test';
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
process.env.GOOGLE_CLIENT_ID = '123456789012-test.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test';
const gs = require('../server/google-sheets');
const hooks = require('../server/meta-runtime').__metaBillingTestHooks;
const statePath = 't_balance_google_sheets/w';
const base = { spreadsheetId: 'a'.repeat(25), sheetName: 'VND', headerRow: 2, accountIdColumn: 'C', dateStartColumn: 'G', dateEndColumn: 'AK', scanMaxRow: 5000 };
docs.set(statePath, { ...base, usdReport: { ...base, sheetName: 'USD' }, googleSheetAutoEnabled: true, googleSheetOnlyVnd: false, googleSheetStartFromMs: 1, googleAccessTokenEnc: hooks.encryptSecret('google-test'), googleAccessTokenExpiresAtMs: Date.now() + 3600000 });
function event(id, currency, amount, status = 'pending', date = '2026-09-21T03:00:00Z') { const e = { accountId: '1234567890123456', currency, amount, status, eventType: 'ad_account_billing_charge', eventTime: date, eventTimeMs: Date.parse(date) }; docs.set(`t_balance_meta_billing_events/w/items/${id}`, e); return e; }
const usd = event('u1', 'USD', 12.34); event('u2', 'USD', 0.01); const vnd = event('v1', 'VND', 150000); event('bad', 'USD', 999, 'estimated'); event('unknown', '', 900); event('nan', 'USD', Infinity);
const cells = new Map(); let failAfterWrite = false, duplicate = false;
function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
global.fetch = async (url, options = {}) => {
  const u = new URL(url), range = decodeURIComponent(u.pathname.split('/values/')[1] || '');
  if (!range) return response({ properties: { title: 'Report' }, sheets: ['VND','USD','USD2'].map(title => ({ properties: { title } })) });
  if (options.method === 'PUT') {
    const value = JSON.parse(options.body).values[0][0]; assert.equal(typeof value, 'number'); assert.equal(u.searchParams.get('valueInputOption'), 'RAW'); cells.set(range, value);
    if (failAfterWrite) { failAfterWrite = false; throw new Error('Simulated lost response'); }
    return response({ updatedCells: 1 });
  }
  if (range.includes('C1:')) return response({ values: duplicate ? [['1234567890123456'], ['1234567890123456']] : [[], [], ['1234567890123456']] });
  if (range.includes('G2:')) return response({ values: [['21/09/2026']] });
  return response({ values: [[cells.get(range) || 0]] });
};
(async () => {
  assert.equal(hooks.metaMoneyToMajor('1234', 'USD'), 12.34);
  assert.equal(hooks.metaMoneyToMajor('150000', 'VND'), 150000);
  assert.equal(gs.moneySum([{amount:0.1},{amount:0.2}], 'USD'), 0.3);
  assert.equal(gs.sheetCfg(docs.get(statePath), 'USD').sheetName, 'USD');
  const first = await gs.fillAll('w'); assert.deepEqual(first.errors, []); assert.equal(first.written, 2);
  assert.equal(cells.get("'USD'!G3"), 12.35); assert.equal(cells.get("'VND'!G3"), 150000);
  await gs.fillAll('w'); assert.equal(cells.get("'USD'!G3"), 12.35);
  const next = event('u3', 'USD', 0.65); await gs.autoSyncEventGroups('w', [next]); assert.equal(cells.get("'USD'!G3"), 13);
  // Destination change: baseline isolated, preserve pre-existing value, retry after applied write.
  await gs.saveSheetSettings('w', { ...base, currency: 'USD', sheetName: 'USD2' });
  cells.set("'USD2'!G3", 5); failAfterWrite = true;
  const failed = await gs.autoSyncEventGroups('w', [usd]); assert.equal(failed.errors.length, 1); assert.equal(cells.get("'USD2'!G3"), 18);
  const retried = await gs.autoSyncEventGroups('w', [usd]); assert.deepEqual(retried.errors, []); assert.equal(cells.get("'USD2'!G3"), 18);
  await assert.rejects(gs.saveSheetSettings('w', { ...base, currency: 'USD' }), /hai tab/);
  duplicate = true; const ambiguous = await gs.fillAll('w'); assert.equal(ambiguous.errors.length, 2); duplicate = false;
  // Upgrade legacy VND baseline without adding already written bills a second time.
  for (const key of [...docs.keys()]) if (key.startsWith('t_balance_google_sheet_daily/')) docs.delete(key);
  const legacyId = require('crypto').createHash('sha256').update('w|1234567890123456|2026-09-21').digest('hex');
  docs.set(`t_balance_google_sheet_daily/w/items/${legacyId}`, { sheetCell: 'G3', baselineInitialized: true, baselineAmount: 150000 });
  cells.set("'VND'!G3", 300000);
  await gs.autoSyncEventGroups('w', [vnd]); assert.equal(cells.get("'VND'!G3"), 300000);
  assert.deepEqual(hooks.metaTokens('a\nb\na'), ['a','b']);
  // Discovery union and retained inactive accounts. Paging token is never forwarded.
  global.fetch = async (url, options) => {
    const u = new URL(url); assert.equal(u.searchParams.has('access_token'), false);
    const token = options.headers.Authorization.split(' ')[1];
    if (token === 'bad') return response({error:{code:190,message:'expired'}},400);
    const ids = token === 'a' ? ['1','2'] : ['2','3'];
    return response({data: ids.map(id => ({account_id:id, currency:'USD', balance:'1234', account_status:2}))});
  };
  const accounts = await hooks.fetchMetaAdAccounts('a\nb\nbad', 'v23.0');
  assert.deepEqual(accounts.accounts.map(a=>a.accountId), ['1','2','3']); assert.equal(accounts.tokenErrors.length, 1); assert.equal(accounts.accounts[0].balance, 12.34);
  await hooks.metaGraphFetch('https://graph.facebook.com/v23.0/me?access_token=old', ['bad','a']);
  await assert.rejects(hooks.metaGraphFetch('https://example.com/steal', 'a'), /URL/);
  console.log('PASS multi-token discovery, currency routing, USD cents, retries, duplicate mapping, RAW numeric writes');
})().catch(error => { console.error(error); process.exitCode = 1; });
