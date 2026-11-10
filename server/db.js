import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';
import { hashPin } from './auth.js';

// Parse PostgreSQL BIGINT (OID 20) as JavaScript number
pg.types.setTypeParser(20, (val) => (val === null ? null : Number(val)));

function loadEnvIfPresent() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}

export function getMonthKeyFromDate(date = new Date()) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

const PG_SCHEMA_SQL = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase', 'schema.sql'),
  'utf8',
);

const SQLITE_TEST_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'salesman')),
    territory TEXT NOT NULL DEFAULT '',
    pin_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS location_punches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL DEFAULT NULL,
    place_name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    punch_type TEXT NOT NULL DEFAULT 'checkin',
    punched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expense_date TEXT NOT NULL,
    month_key TEXT NOT NULL,
    place TEXT NOT NULL,
    departure TEXT NOT NULL DEFAULT '',
    arrival TEXT NOT NULL DEFAULT '',
    fare REAL NOT NULL DEFAULT 0,
    da REAL NOT NULL DEFAULT 0,
    conveyance REAL NOT NULL DEFAULT 0,
    night_stay REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    paid_by TEXT NOT NULL DEFAULT 'office' CHECK(paid_by IN ('office', 'self')),
    remarks TEXT NOT NULL DEFAULT '',
    latitude REAL DEFAULT NULL,
    longitude REAL DEFAULT NULL,
    accuracy REAL DEFAULT NULL,
    gps_place TEXT NOT NULL DEFAULT '',
    gps_punched_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    advance_date TEXT NOT NULL,
    month_key TEXT NOT NULL,
    amount REAL NOT NULL,
    mode TEXT NOT NULL DEFAULT 'UPI',
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    given_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reimbursement_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claim_date TEXT NOT NULL,
    month_key TEXT NOT NULL,
    amount REAL NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid', 'rejected')),
    admin_note TEXT NOT NULL DEFAULT '',
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TEXT DEFAULT NULL,
    paid_at TEXT DEFAULT NULL,
    payout_mode TEXT NOT NULL DEFAULT '',
    payout_ref TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`;

function createSqliteAdapter(sqliteDb) {
  const translateSql = (sql) => sql.replace(/\$(\d+)/g, '?$1');
  return {
    driver: 'sqlite',
    async get(sql, params = []) {
      const row = sqliteDb.prepare(translateSql(sql)).get(...params);
      return row ? { ...row } : undefined;
    },
    async all(sql, params = []) {
      const rows = sqliteDb.prepare(translateSql(sql)).all(...params);
      return rows.map((r) => ({ ...r }));
    },
    async run(sql, params = []) {
      const res = sqliteDb.prepare(translateSql(sql)).run(...params);
      return { rowCount: res.changes };
    },
    async close() {
      sqliteDb.close();
    },
  };
}

function createPgAdapter(pool) {
  return {
    driver: 'supabase-postgres',
    async get(sql, params = []) {
      const res = await pool.query(sql, params);
      return res.rows[0];
    },
    async all(sql, params = []) {
      const res = await pool.query(sql, params);
      return res.rows;
    },
    async run(sql, params = []) {
      const res = await pool.query(sql, params);
      return { rowCount: res.rowCount ?? 0 };
    },
    async close() {
      await pool.end();
    },
  };
}

async function bootstrapAdminFromEnvIfConfigured(db) {
  const adminPhone = String(process.env.ADMIN_PHONE || '').trim();
  const adminPin = String(process.env.ADMIN_PIN || '').trim();
  const adminName = String(process.env.ADMIN_NAME || 'Head Office Admin').trim();
  if (!adminPhone || adminPin.length < 4) return;

  const existing = await db.get("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'");
  if (Number(existing?.cnt || 0) === 0) {
    await db.run(
      `INSERT INTO users (name, phone, role, territory, pin_hash, active, created_at)
       VALUES ($1, $2, 'admin', 'Head Office', $3, 1, $4)`,
      [adminName, adminPhone, hashPin(adminPin), new Date().toISOString()],
    );
  }
}

export async function initDatabase(options = {}) {
  loadEnvIfPresent();

  if (options.mode === 'memory') {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(SQLITE_TEST_SCHEMA);
    const db = createSqliteAdapter(sqlite);
    await bootstrapAdminFromEnvIfConfigured(db);
    return db;
  }

  const connectionString =
    options.connectionString ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error(
      'Missing DATABASE_URL (Supabase PostgreSQL connection string). Set DATABASE_URL in .env or environment variables.',
    );
  }

  const isLocalPg =
    connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

  const pool = new pg.Pool({
    connectionString,
    ssl: isLocalPg ? false : { rejectUnauthorized: false },
    max: 10,
  });

  // Ensure Supabase tables and indexes exist on startup
  await pool.query(PG_SCHEMA_SQL);
  const db = createPgAdapter(pool);
  await bootstrapAdminFromEnvIfConfigured(db);
  return db;
}
