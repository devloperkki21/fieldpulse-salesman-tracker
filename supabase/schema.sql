-- FieldPulse Salesman Tracker — Supabase PostgreSQL Schema (Isolated Schema)
-- Runs automatically on server boot when DATABASE_URL is configured,
-- or can be run directly inside Supabase SQL Editor.

CREATE SCHEMA IF NOT EXISTS fieldpulse;

CREATE TABLE IF NOT EXISTS fieldpulse.users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'salesman')),
  territory TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fieldpulse.location_punches (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES fieldpulse.users(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION DEFAULT NULL,
  place_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  punch_type TEXT NOT NULL DEFAULT 'checkin',
  punched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fieldpulse.expenses (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES fieldpulse.users(id) ON DELETE CASCADE,
  expense_date TEXT NOT NULL,
  month_key TEXT NOT NULL,
  place TEXT NOT NULL,
  departure TEXT NOT NULL DEFAULT '',
  arrival TEXT NOT NULL DEFAULT '',
  fare DOUBLE PRECISION NOT NULL DEFAULT 0,
  da DOUBLE PRECISION NOT NULL DEFAULT 0,
  conveyance DOUBLE PRECISION NOT NULL DEFAULT 0,
  night_stay DOUBLE PRECISION NOT NULL DEFAULT 0,
  total DOUBLE PRECISION NOT NULL DEFAULT 0,
  paid_by TEXT NOT NULL DEFAULT 'office' CHECK (paid_by IN ('office', 'self')),
  remarks TEXT NOT NULL DEFAULT '',
  latitude DOUBLE PRECISION DEFAULT NULL,
  longitude DOUBLE PRECISION DEFAULT NULL,
  accuracy DOUBLE PRECISION DEFAULT NULL,
  gps_place TEXT NOT NULL DEFAULT '',
  gps_punched_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fieldpulse.advances (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES fieldpulse.users(id) ON DELETE CASCADE,
  advance_date TEXT NOT NULL,
  month_key TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  mode TEXT NOT NULL DEFAULT 'UPI',
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  given_by BIGINT REFERENCES fieldpulse.users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fieldpulse.reimbursement_claims (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES fieldpulse.users(id) ON DELETE CASCADE,
  claim_date TEXT NOT NULL,
  month_key TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  admin_note TEXT NOT NULL DEFAULT '',
  reviewed_by BIGINT REFERENCES fieldpulse.users(id) ON DELETE SET NULL,
  reviewed_at TEXT DEFAULT NULL,
  paid_at TEXT DEFAULT NULL,
  payout_mode TEXT NOT NULL DEFAULT '',
  payout_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fp_expenses_user_month ON fieldpulse.expenses(user_id, month_key);
CREATE INDEX IF NOT EXISTS idx_fp_advances_user_month ON fieldpulse.advances(user_id, month_key);
CREATE INDEX IF NOT EXISTS idx_fp_claims_user_month ON fieldpulse.reimbursement_claims(user_id, month_key);
CREATE INDEX IF NOT EXISTS idx_fp_punches_user_time ON fieldpulse.location_punches(user_id, punched_at);
