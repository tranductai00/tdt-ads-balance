"use strict";

const { Pool } = require("pg");

const DELETE_FIELD = Symbol("delete-field");
const SENTINEL = Symbol("t-balance-store-sentinel");

function sentinel(type, values = []) {
  return { [SENTINEL]: true, type, values };
}

const FieldValue = Object.freeze({
  serverTimestamp: () => sentinel("serverTimestamp"),
  delete: () => sentinel("delete"),
  arrayUnion: (...values) => sentinel("arrayUnion", values),
});

function isSentinel(value) {
  return Boolean(value && typeof value === "object" && value[SENTINEL]);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function resolveValue(value, currentValue, nowIso) {
  if (isSentinel(value)) {
    if (value.type === "serverTimestamp") return nowIso;
    if (value.type === "delete") return DELETE_FIELD;
    if (value.type === "arrayUnion") {
      const base = Array.isArray(currentValue) ? [...currentValue] : [];
      for (const item of value.values || []) {
        const resolved = resolveValue(item, undefined, nowIso);
        if (resolved === DELETE_FIELD) continue;
        if (!base.some((existing) => deepEqual(existing, resolved))) base.push(resolved);
      }
      return base;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const resolved = resolveValue(item, undefined, nowIso);
      return resolved === DELETE_FIELD ? null : resolved;
    });
  }

  if (isPlainObject(value)) {
    const out = {};
    const current = isPlainObject(currentValue) ? currentValue : {};
    for (const [key, child] of Object.entries(value)) {
      const resolved = resolveValue(child, current[key], nowIso);
      if (resolved !== DELETE_FIELD) out[key] = resolved;
    }
    return out;
  }

  if (value instanceof Date) return value.toISOString();
  return value;
}

function deepMerge(current, patch, nowIso) {
  const base = isPlainObject(current) ? { ...current } : {};
  if (!isPlainObject(patch)) {
    const resolved = resolveValue(patch, current, nowIso);
    return resolved === DELETE_FIELD ? undefined : resolved;
  }

  for (const [key, incoming] of Object.entries(patch)) {
    if (isSentinel(incoming)) {
      const resolved = resolveValue(incoming, base[key], nowIso);
      if (resolved === DELETE_FIELD) delete base[key];
      else base[key] = resolved;
      continue;
    }

    if (isPlainObject(incoming)) {
      base[key] = deepMerge(base[key], incoming, nowIso);
      continue;
    }

    const resolved = resolveValue(incoming, base[key], nowIso);
    if (resolved === DELETE_FIELD) delete base[key];
    else base[key] = resolved;
  }
  return base;
}

function normalizePath(path) {
  const normalized = String(path || "").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  if (!normalized) throw new Error("Store path không hợp lệ.");
  return normalized;
}

function directChildOf(collectionPath, docPath) {
  const prefix = `${collectionPath}/`;
  if (!docPath.startsWith(prefix)) return false;
  const rest = docPath.slice(prefix.length);
  return Boolean(rest) && !rest.includes("/");
}

function fieldAt(data, fieldPath) {
  return String(fieldPath || "").split(".").filter(Boolean).reduce((value, part) => value?.[part], data);
}

class DocumentSnapshot {
  constructor(ref, row) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = Boolean(row);
    this._data = row ? structuredClone(row.data || {}) : undefined;
  }
  data() { return this.exists ? structuredClone(this._data) : undefined; }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(callback, thisArg) { this.docs.forEach(callback, thisArg); }
}

class DocumentRef {
  constructor(db, path) {
    this._db = db;
    this.path = normalizePath(path);
    this.id = this.path.split("/").pop();
  }
  collection(name) { return new CollectionRef(this._db, `${this.path}/${normalizePath(name)}`); }
  async get() { return this._db._getDoc(this); }
  async set(data, options = {}) { await this._db._setDoc(this, data, options); return this; }
  async update(data) {
    await this._db.runTransaction(async (tx) => {
      const snap = await tx.get(this);
      if (!snap.exists) { const error = new Error(`Document không tồn tại: ${this.path}`); error.code = "NOT_FOUND"; throw error; }
      tx.set(this, data, { merge: true });
    });
    return this;
  }
  async delete() { await this._db._deleteDoc(this); }
}

class Query {
  constructor(db, collectionPath, state = {}) {
    this._db = db;
    this.collectionPath = normalizePath(collectionPath);
    this._filters = state.filters ? [...state.filters] : [];
    this._orderBy = state.orderBy || null;
    this._limit = state.limit || null;
  }
  where(field, operator, value) {
    if (operator !== "==") throw new Error(`Store chỉ hỗ trợ where ==, nhận ${operator}`);
    return new Query(this._db, this.collectionPath, { filters: [...this._filters, { field, operator, value }], orderBy: this._orderBy, limit: this._limit });
  }
  orderBy(field, direction = "asc") {
    const dir = String(direction || "asc").toLowerCase() === "desc" ? "desc" : "asc";
    return new Query(this._db, this.collectionPath, { filters: this._filters, orderBy: { field, direction: dir }, limit: this._limit });
  }
  limit(value) {
    const n = Math.max(1, Math.min(5000, Number(value || 1)));
    return new Query(this._db, this.collectionPath, { filters: this._filters, orderBy: this._orderBy, limit: n });
  }
  async get() { return this._db._getQuery(this); }
}

class CollectionRef extends Query {
  constructor(db, path) {
    super(db, path);
    this.path = normalizePath(path);
    this.id = this.path.split("/").pop();
  }
  doc(id) { return new DocumentRef(this._db, `${this.path}/${normalizePath(id)}`); }
}

class Transaction {
  constructor(db, client) {
    this._db = db;
    this._client = client;
    this._mutations = [];
  }
  async get(ref) { return this._db._getDoc(ref, this._client, true); }
  set(ref, data, options = {}) {
    this._mutations.push({ type: "set", ref, data, options });
    return this;
  }
  update(ref, data) {
    this._mutations.push({ type: "set", ref, data, options: { merge: true }, requireExists: true });
    return this;
  }
  delete(ref) {
    this._mutations.push({ type: "delete", ref });
    return this;
  }
  async _flush() {
    for (const mutation of this._mutations) {
      if (mutation.type === "set") {
        if (mutation.requireExists) {
          const snap = await this._db._getDoc(mutation.ref, this._client, true);
          if (!snap.exists) { const error = new Error(`Document không tồn tại: ${mutation.ref.path}`); error.code = "NOT_FOUND"; throw error; }
        }
        await this._db._setDoc(mutation.ref, mutation.data, mutation.options, this._client);
      } else if (mutation.type === "delete") await this._db._deleteDoc(mutation.ref, this._client);
    }
  }
}

class PostgresStore {
  constructor() {
    const connectionString = String(
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.NEON_DATABASE_URL ||
      ""
    ).trim();
    this.connectionString = connectionString;
    const local = /(?:localhost|127\.0\.0\.1)/i.test(connectionString);
    this.pool = connectionString ? new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX || (process.env.VERCEL ? 3 : 10)),
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
      ssl: local ? false : { rejectUnauthorized: false },
    }) : null;
    this._schemaReady = null;
  }

  _requirePool() {
    if (this.pool) return this.pool;
    const error = new Error("Thiếu DATABASE_URL. Hãy kết nối Neon Postgres trong Vercel Storage/Marketplace rồi Redeploy.");
    error.code = "DATABASE_URL_REQUIRED";
    throw error;
  }

  collection(name) { return new CollectionRef(this, normalizePath(name)); }

  async ensureSchema(client = null) {
    if (this._schemaReady) return this._schemaReady;
    const run = async () => {
      const executor = client || this._requirePool();
      await executor.query(`
        CREATE TABLE IF NOT EXISTS tb_documents (
          path TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await executor.query(`CREATE INDEX IF NOT EXISTS tb_documents_path_idx ON tb_documents (path text_pattern_ops)`);
    };
    if (client) return run();
    this._schemaReady = run().catch((error) => {
      this._schemaReady = null;
      throw error;
    });
    return this._schemaReady;
  }

  async _getDoc(ref, client = null, forUpdate = false) {
    await this.ensureSchema(client);
    const executor = client || this._requirePool();
    const suffix = forUpdate ? " FOR UPDATE" : "";
    const result = await executor.query(`SELECT data FROM tb_documents WHERE path = $1${suffix}`, [ref.path]);
    return new DocumentSnapshot(ref, result.rows[0] || null);
  }

  async _setDoc(ref, data, options = {}, client = null) {
    await this.ensureSchema(client);

    // Firestore set(..., {merge:true}) là atomic trên document. Khi gọi ngoài
    // transaction, dùng SERIALIZABLE + row lock để không làm mất patch nếu
    // nhiều Vercel Fluid requests cập nhật cùng document đồng thời.
    if (options?.merge && !client) {
      let lastError;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const isolated = await this._requirePool().connect();
        try {
          await isolated.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
          await this._setDoc(ref, data, options, isolated);
          await isolated.query("COMMIT");
          return;
        } catch (error) {
          lastError = error;
          try { await isolated.query("ROLLBACK"); } catch {}
          if (!["40001", "40P01"].includes(String(error?.code || "")) || attempt >= 5) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
        } finally {
          isolated.release();
        }
      }
      throw lastError;
    }

    const executor = client || this._requirePool();
    const nowIso = new Date().toISOString();
    let next;

    if (options?.merge) {
      const currentResult = await executor.query("SELECT data FROM tb_documents WHERE path = $1 FOR UPDATE", [ref.path]);
      const current = currentResult.rows[0]?.data || {};
      next = deepMerge(current, data, nowIso);
    } else {
      next = resolveValue(data, undefined, nowIso);
      if (next === DELETE_FIELD || next === undefined) next = {};
    }

    await executor.query(`
      INSERT INTO tb_documents(path, data, created_at, updated_at)
      VALUES ($1, $2::jsonb, NOW(), NOW())
      ON CONFLICT(path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [ref.path, JSON.stringify(next)]);
  }

  async _deleteDoc(ref, client = null) {
    await this.ensureSchema(client);
    const executor = client || this._requirePool();
    await executor.query("DELETE FROM tb_documents WHERE path = $1", [ref.path]);
  }

  async _getQuery(query, client = null) {
    await this.ensureSchema(client);
    const executor = client || this._requirePool();
    const prefix = `${query.collectionPath}/`;
    const result = await executor.query(
      "SELECT path, data FROM tb_documents WHERE LEFT(path, LENGTH($1)) = $1",
      [prefix],
    );
    let rows = result.rows.filter((row) => directChildOf(query.collectionPath, row.path));

    for (const filter of query._filters || []) {
      rows = rows.filter((row) => deepEqual(fieldAt(row.data, filter.field), filter.value));
    }

    if (query._orderBy) {
      const { field, direction } = query._orderBy;
      const sign = direction === "desc" ? -1 : 1;
      rows.sort((a, b) => {
        const av = fieldAt(a.data, field);
        const bv = fieldAt(b.data, field);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
        return String(av).localeCompare(String(bv)) * sign;
      });
    }

    if (query._limit) rows = rows.slice(0, query._limit);
    const docs = rows.map((row) => new DocumentSnapshot(new DocumentRef(this, row.path), row));
    return new QuerySnapshot(docs);
  }

  async runTransaction(callback, attempts = 5) {
    await this.ensureSchema();
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const client = await this._requirePool().connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const tx = new Transaction(this, client);
        const result = await callback(tx);
        await tx._flush();
        await client.query("COMMIT");
        return result;
      } catch (error) {
        lastError = error;
        try { await client.query("ROLLBACK"); } catch {}
        if (!["40001", "40P01"].includes(String(error?.code || "")) || attempt >= attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, 30 * attempt));
      } finally {
        client.release();
      }
    }
    throw lastError;
  }

  async healthCheck() {
    await this.ensureSchema();
    const result = await this._requirePool().query("SELECT NOW() AS now");
    return { ok: true, now: result.rows[0]?.now || null };
  }
}

let singleton = null;
function getStore() {
  if (!singleton) singleton = new PostgresStore();
  return singleton;
}

module.exports = { getStore, FieldValue };
