import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { hashPin } from './auth.js';

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

const CLAIM_STATUS_RANK = { pending: 0, approved: 1, paid: 2, rejected: 3 };

function sortClaimsWithUsers(claims, userMap) {
  return claims
    .map((c) => {
      const u = userMap.get(Number(c.user_id));
      return {
        ...c,
        user_name: u?.name || '',
        user_phone: u?.phone || '',
        user_territory: u?.territory || '',
      };
    })
    .sort((a, b) => {
      const ra = CLAIM_STATUS_RANK[a.status] ?? 9;
      const rb = CLAIM_STATUS_RANK[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
      return Number(b.id) - Number(a.id);
    });
}

function createSupabaseApiStore(supabase) {
  const unwrap = (res) => {
    if (res.error) throw new Error(res.error.message || 'Supabase query failed');
    return res.data;
  };

  return {
    driver: 'supabase-api',
    async ping() {
      const res = await supabase.from('fp_users').select('id', { count: 'exact', head: true });
      if (res.error) throw new Error(res.error.message);
      return true;
    },
    async countAdmins() {
      const res = await supabase
        .from('fp_users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if (res.error) throw new Error(res.error.message);
      return res.count ?? 0;
    },
    async findUserById(id) {
      return unwrap(
        await supabase.from('fp_users').select('*').eq('id', Number(id)).maybeSingle(),
      );
    },
    async findUserByPhone(phone) {
      return unwrap(
        await supabase.from('fp_users').select('*').eq('phone', phone).maybeSingle(),
      );
    },
    async findUsersByIdentifier(identifier) {
      const clean = String(identifier || '').trim();
      if (!clean) return [];
      const byPhone = unwrap(
        await supabase.from('fp_users').select('*').eq('phone', clean),
      );
      if (byPhone.length > 0) return byPhone;
      const escaped = clean.replace(/[%_\\]/g, '\\$&');
      const byName = unwrap(
        await supabase.from('fp_users').select('*').ilike('name', escaped),
      );
      const needle = clean.toLowerCase();
      return byName.filter((u) => String(u.name || '').trim().toLowerCase() === needle);
    },
    async createUser(fields) {
      return unwrap(
        await supabase.from('fp_users').insert(fields).select('*').single(),
      );
    },
    async listSalesmen() {
      return unwrap(
        await supabase
          .from('fp_users')
          .select('*')
          .eq('role', 'salesman')
          .order('active', { ascending: false })
          .order('name', { ascending: true }),
      );
    },
    async updateSalesman(id, fields) {
      return unwrap(
        await supabase
          .from('fp_users')
          .update(fields)
          .eq('id', Number(id))
          .eq('role', 'salesman')
          .select('*')
          .maybeSingle(),
      );
    },

    async listExpensesByUser(userId) {
      return unwrap(
        await supabase
          .from('fp_expenses')
          .select('*')
          .eq('user_id', Number(userId))
          .order('expense_date', { ascending: true })
          .order('id', { ascending: true }),
      );
    },
    async listAllExpenses() {
      return unwrap(
        await supabase
          .from('fp_expenses')
          .select('*')
          .order('expense_date', { ascending: true })
          .order('id', { ascending: true }),
      );
    },
    async getExpenseById(id) {
      return unwrap(
        await supabase.from('fp_expenses').select('*').eq('id', Number(id)).maybeSingle(),
      );
    },
    async createExpense(fields) {
      return unwrap(
        await supabase.from('fp_expenses').insert(fields).select('*').single(),
      );
    },
    async updateExpense(id, fields) {
      return unwrap(
        await supabase
          .from('fp_expenses')
          .update(fields)
          .eq('id', Number(id))
          .select('*')
          .single(),
      );
    },
    async deleteExpense(id) {
      unwrap(await supabase.from('fp_expenses').delete().eq('id', Number(id)));
    },

    async listAdvancesByUser(userId) {
      return unwrap(
        await supabase
          .from('fp_advances')
          .select('*')
          .eq('user_id', Number(userId))
          .order('advance_date', { ascending: true })
          .order('id', { ascending: true }),
      );
    },
    async listAllAdvances() {
      return unwrap(
        await supabase
          .from('fp_advances')
          .select('*')
          .order('advance_date', { ascending: true })
          .order('id', { ascending: true }),
      );
    },
    async getAdvanceById(id) {
      return unwrap(
        await supabase.from('fp_advances').select('*').eq('id', Number(id)).maybeSingle(),
      );
    },
    async createAdvance(fields) {
      return unwrap(
        await supabase.from('fp_advances').insert(fields).select('*').single(),
      );
    },
    async deleteAdvance(id) {
      unwrap(await supabase.from('fp_advances').delete().eq('id', Number(id)));
    },

    async listClaimsByUser(userId) {
      return unwrap(
        await supabase
          .from('fp_reimbursement_claims')
          .select('*')
          .eq('user_id', Number(userId))
          .order('claim_date', { ascending: true })
          .order('id', { ascending: true }),
      );
    },
    async listAllClaimsWithUsers() {
      const [claimsRes, usersRes] = await Promise.all([
        supabase.from('fp_reimbursement_claims').select('*'),
        supabase.from('fp_users').select('id, name, phone, territory'),
      ]);
      const claims = unwrap(claimsRes);
      const users = unwrap(usersRes);
      const userMap = new Map(users.map((u) => [Number(u.id), u]));
      return sortClaimsWithUsers(claims, userMap);
    },
    async getClaimById(id) {
      return unwrap(
        await supabase
          .from('fp_reimbursement_claims')
          .select('*')
          .eq('id', Number(id))
          .maybeSingle(),
      );
    },
    async createClaim(fields) {
      return unwrap(
        await supabase.from('fp_reimbursement_claims').insert(fields).select('*').single(),
      );
    },
    async updateClaim(id, fields) {
      return unwrap(
        await supabase
          .from('fp_reimbursement_claims')
          .update(fields)
          .eq('id', Number(id))
          .select('*')
          .single(),
      );
    },
    async deleteClaim(id) {
      unwrap(await supabase.from('fp_reimbursement_claims').delete().eq('id', Number(id)));
    },

    async listPunchesByUser(userId, limit = 15) {
      return unwrap(
        await supabase
          .from('fp_location_punches')
          .select('*')
          .eq('user_id', Number(userId))
          .order('punched_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit),
      );
    },
    async listLatestPunches() {
      const punches = unwrap(
        await supabase
          .from('fp_location_punches')
          .select('*')
          .order('id', { ascending: false })
          .limit(500),
      );
      const seen = new Map();
      for (const p of punches) {
        const uid = Number(p.user_id);
        if (!seen.has(uid)) seen.set(uid, p);
      }
      return Array.from(seen.values());
    },
    async listRecentPunchesWithUsers(limit = 30) {
      const [punchesRes, usersRes] = await Promise.all([
        supabase
          .from('fp_location_punches')
          .select('*')
          .order('punched_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit),
        supabase.from('fp_users').select('id, name, territory'),
      ]);
      const punches = unwrap(punchesRes);
      const users = unwrap(usersRes);
      const userMap = new Map(users.map((u) => [Number(u.id), u]));
      return punches.map((p) => {
        const u = userMap.get(Number(p.user_id));
        return {
          ...p,
          user_name: u?.name || '',
          user_territory: u?.territory || '',
        };
      });
    },
    async createPunch(fields) {
      return unwrap(
        await supabase.from('fp_location_punches').insert(fields).select('*').single(),
      );
    },
    async getPunchById(id) {
      return unwrap(
        await supabase.from('fp_location_punches').select('*').eq('id', Number(id)).maybeSingle(),
      );
    },
    async deletePunch(id) {
      unwrap(await supabase.from('fp_location_punches').delete().eq('id', Number(id)));
    },
    async close() {
      // Stateless HTTPS client
    },
  };
}

function createSqlStore({ driver, get, all, run, close }) {
  return {
    driver,
    async ping() {
      await get('SELECT 1 AS ok');
      return true;
    },
    async countAdmins() {
      const row = await get("SELECT COUNT(*) AS cnt FROM public.fp_users WHERE role = 'admin'");
      return Number(row?.cnt || 0);
    },
    async findUserById(id) {
      return (await get('SELECT * FROM public.fp_users WHERE id = $1', [Number(id)])) || null;
    },
    async findUserByPhone(phone) {
      return (await get('SELECT * FROM public.fp_users WHERE phone = $1', [phone])) || null;
    },
    async findUsersByIdentifier(identifier) {
      const clean = String(identifier || '').trim();
      if (!clean) return [];
      const byPhone = await all('SELECT * FROM public.fp_users WHERE phone = $1', [clean]);
      if (byPhone.length > 0) return byPhone;
      return all('SELECT * FROM public.fp_users WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))', [
        clean,
      ]);
    },
    async createUser({ name, phone, role, territory, pin_hash, active, created_at }) {
      return get(
        `INSERT INTO public.fp_users (name, phone, role, territory, pin_hash, active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [name, phone, role, territory, pin_hash, active, created_at],
      );
    },
    async listSalesmen() {
      return all(
        "SELECT * FROM public.fp_users WHERE role = 'salesman' ORDER BY active DESC, name ASC",
      );
    },
    async updateSalesman(id, { name, territory, active, pin_hash }) {
      return (
        (await get(
          `UPDATE public.fp_users SET name = $1, territory = $2, active = $3, pin_hash = $4
           WHERE id = $5 AND role = 'salesman'
           RETURNING *`,
          [name, territory, active, pin_hash, Number(id)],
        )) || null
      );
    },

    async listExpensesByUser(userId) {
      return all(
        'SELECT * FROM public.fp_expenses WHERE user_id = $1 ORDER BY expense_date ASC, id ASC',
        [Number(userId)],
      );
    },
    async listAllExpenses() {
      return all('SELECT * FROM public.fp_expenses ORDER BY expense_date ASC, id ASC');
    },
    async getExpenseById(id) {
      return (await get('SELECT * FROM public.fp_expenses WHERE id = $1', [Number(id)])) || null;
    },
    async createExpense(f) {
      return get(
        `INSERT INTO public.fp_expenses (
          user_id, expense_date, month_key, place, departure, arrival,
          fare, da, conveyance, night_stay, total, paid_by, remarks,
          latitude, longitude, accuracy, gps_place, gps_punched_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING *`,
        [
          f.user_id,
          f.expense_date,
          f.month_key,
          f.place,
          f.departure,
          f.arrival,
          f.fare,
          f.da,
          f.conveyance,
          f.night_stay,
          f.total,
          f.paid_by,
          f.remarks,
          f.latitude,
          f.longitude,
          f.accuracy,
          f.gps_place,
          f.gps_punched_at,
          f.created_at,
          f.updated_at,
        ],
      );
    },
    async updateExpense(id, f) {
      return get(
        `UPDATE public.fp_expenses SET
          expense_date = $1, month_key = $2, place = $3, departure = $4, arrival = $5,
          fare = $6, da = $7, conveyance = $8, night_stay = $9, total = $10,
          paid_by = $11, remarks = $12, updated_at = $13
         WHERE id = $14
         RETURNING *`,
        [
          f.expense_date,
          f.month_key,
          f.place,
          f.departure,
          f.arrival,
          f.fare,
          f.da,
          f.conveyance,
          f.night_stay,
          f.total,
          f.paid_by,
          f.remarks,
          f.updated_at,
          Number(id),
        ],
      );
    },
    async deleteExpense(id) {
      await run('DELETE FROM public.fp_expenses WHERE id = $1', [Number(id)]);
    },

    async listAdvancesByUser(userId) {
      return all(
        'SELECT * FROM public.fp_advances WHERE user_id = $1 ORDER BY advance_date ASC, id ASC',
        [Number(userId)],
      );
    },
    async listAllAdvances() {
      return all('SELECT * FROM public.fp_advances ORDER BY advance_date ASC, id ASC');
    },
    async getAdvanceById(id) {
      return (await get('SELECT * FROM public.fp_advances WHERE id = $1', [Number(id)])) || null;
    },
    async createAdvance(f) {
      return get(
        `INSERT INTO public.fp_advances (user_id, advance_date, month_key, amount, mode, reference, note, given_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [f.user_id, f.advance_date, f.month_key, f.amount, f.mode, f.reference, f.note, f.given_by, f.created_at],
      );
    },
    async deleteAdvance(id) {
      await run('DELETE FROM public.fp_advances WHERE id = $1', [Number(id)]);
    },

    async listClaimsByUser(userId) {
      return all(
        'SELECT * FROM public.fp_reimbursement_claims WHERE user_id = $1 ORDER BY claim_date ASC, id ASC',
        [Number(userId)],
      );
    },
    async listAllClaimsWithUsers() {
      return all(
        `SELECT rc.*, u.name AS user_name, u.phone AS user_phone, u.territory AS user_territory
         FROM public.fp_reimbursement_claims rc
         JOIN public.fp_users u ON u.id = rc.user_id
         ORDER BY CASE rc.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END, rc.created_at DESC, rc.id DESC`,
      );
    },
    async getClaimById(id) {
      return (
        (await get('SELECT * FROM public.fp_reimbursement_claims WHERE id = $1', [Number(id)])) ||
        null
      );
    },
    async createClaim(f) {
      return get(
        `INSERT INTO public.fp_reimbursement_claims (user_id, claim_date, month_key, amount, reason, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [f.user_id, f.claim_date, f.month_key, f.amount, f.reason, f.status, f.created_at],
      );
    },
    async updateClaim(id, f) {
      return get(
        `UPDATE public.fp_reimbursement_claims
         SET status = $1, admin_note = $2, reviewed_by = $3, reviewed_at = $4,
             paid_at = $5, payout_mode = $6, payout_ref = $7
         WHERE id = $8
         RETURNING *`,
        [f.status, f.admin_note, f.reviewed_by, f.reviewed_at, f.paid_at, f.payout_mode, f.payout_ref, Number(id)],
      );
    },
    async deleteClaim(id) {
      await run('DELETE FROM public.fp_reimbursement_claims WHERE id = $1', [Number(id)]);
    },

    async listPunchesByUser(userId, limit = 15) {
      return all(
        'SELECT * FROM public.fp_location_punches WHERE user_id = $1 ORDER BY punched_at DESC, id DESC LIMIT $2',
        [Number(userId), limit],
      );
    },
    async listLatestPunches() {
      return all(
        `SELECT lp.*
         FROM public.fp_location_punches lp
         INNER JOIN (
           SELECT user_id, MAX(id) AS max_id
           FROM public.fp_location_punches
           GROUP BY user_id
         ) latest ON lp.id = latest.max_id`,
      );
    },
    async listRecentPunchesWithUsers(limit = 30) {
      return all(
        `SELECT lp.*, u.name AS user_name, u.territory AS user_territory
         FROM public.fp_location_punches lp
         JOIN public.fp_users u ON u.id = lp.user_id
         ORDER BY lp.punched_at DESC, lp.id DESC
         LIMIT $1`,
        [limit],
      );
    },
    async createPunch(f) {
      return get(
        `INSERT INTO public.fp_location_punches
          (user_id, latitude, longitude, accuracy, place_name, address, note, punch_type, punched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [f.user_id, f.latitude, f.longitude, f.accuracy, f.place_name, f.address, f.note, f.punch_type, f.punched_at],
      );
    },
    async getPunchById(id) {
      return (
        (await get('SELECT * FROM public.fp_location_punches WHERE id = $1', [Number(id)])) || null
      );
    },
    async deletePunch(id) {
      await run('DELETE FROM public.fp_location_punches WHERE id = $1', [Number(id)]);
    },
    close,
  };
}

const SQLITE_TEST_SCHEMA = `
  CREATE TABLE IF NOT EXISTS fp_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'salesman')),
    territory TEXT NOT NULL DEFAULT '',
    pin_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fp_location_punches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES fp_users(id) ON DELETE CASCADE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    accuracy REAL DEFAULT NULL,
    place_name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    punch_type TEXT NOT NULL DEFAULT 'checkin',
    punched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fp_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES fp_users(id) ON DELETE CASCADE,
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

  CREATE TABLE IF NOT EXISTS fp_advances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES fp_users(id) ON DELETE CASCADE,
    advance_date TEXT NOT NULL,
    month_key TEXT NOT NULL,
    amount REAL NOT NULL,
    mode TEXT NOT NULL DEFAULT 'UPI',
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    given_by INTEGER REFERENCES fp_users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fp_reimbursement_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES fp_users(id) ON DELETE CASCADE,
    claim_date TEXT NOT NULL,
    month_key TEXT NOT NULL,
    amount REAL NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid', 'rejected')),
    admin_note TEXT NOT NULL DEFAULT '',
    reviewed_by INTEGER REFERENCES fp_users(id) ON DELETE SET NULL,
    reviewed_at TEXT DEFAULT NULL,
    paid_at TEXT DEFAULT NULL,
    payout_mode TEXT NOT NULL DEFAULT '',
    payout_ref TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`;

async function bootstrapAdminFromEnvIfConfigured(db) {
  const adminPhone = String(process.env.ADMIN_PHONE || '').trim();
  const adminPin = String(process.env.ADMIN_PIN || '').trim();
  const adminName = String(process.env.ADMIN_NAME || 'Head Office Admin').trim();
  if (!adminPhone || adminPin.length < 4) return;

  const existing = await db.countAdmins();
  if (existing === 0) {
    await db.createUser({
      name: adminName,
      phone: adminPhone,
      role: 'admin',
      territory: 'Head Office',
      pin_hash: hashPin(adminPin),
      active: 1,
      created_at: new Date().toISOString(),
    });
  }
}

export async function initDatabase(options = {}) {
  loadEnvIfPresent();

  if (options.mode === 'memory') {
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(SQLITE_TEST_SCHEMA);
    const normalizeSql = (sql) =>
      sql.replace(/public\.(fp_\w+)/g, '$1').replace(/\$(\d+)/g, '?$1');

    const db = createSqlStore({
      driver: 'sqlite-memory',
      async get(sql, params = []) {
        const row = sqlite.prepare(normalizeSql(sql)).get(...params);
        return row ? { ...row } : undefined;
      },
      async all(sql, params = []) {
        return sqlite.prepare(normalizeSql(sql)).all(...params).map((r) => ({ ...r }));
      },
      async run(sql, params = []) {
        return sqlite.prepare(normalizeSql(sql)).run(...params);
      },
      async close() {
        sqlite.close();
      },
    });
    await bootstrapAdminFromEnvIfConfigured(db);
    return db;
  }

  // Primary mode: Supabase HTTPS API (no database password required)
  const supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL;
  const supabaseKey =
    options.supabaseKey ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const db = createSupabaseApiStore(supabase);
    await db.ping();
    await bootstrapAdminFromEnvIfConfigured(db);
    return db;
  }

  // Fallback mode: Direct PostgreSQL URI if explicitly provided
  const connectionString =
    options.connectionString ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error(
      'Missing SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or DATABASE_URL). Set them in .env or environment variables.',
    );
  }

  const pgSchemaSql = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase', 'schema.sql'),
    'utf8',
  );
  const isLocalPg =
    connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

  const pool = new pg.Pool({
    connectionString,
    ssl: isLocalPg ? false : { rejectUnauthorized: false },
    max: 10,
  });

  await pool.query(pgSchemaSql);
  const db = createSqlStore({
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
  });
  await bootstrapAdminFromEnvIfConfigured(db);
  return db;
}
