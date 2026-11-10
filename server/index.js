import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { initDatabase, getMonthKeyFromDate } from './db.js';
import { hashPin, signToken, verifyPin, verifyToken } from './auth.js';
import {
  computeExpenseTotal,
  computeMonthlySeries,
  computeSalesmanLedger,
  getRecentMonthKeys,
  roundMoney,
} from './balance.js';

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone,
    role: row.role,
    territory: row.territory,
    active: Boolean(row.active),
    created_at: row.created_at,
  };
}

function isValidMonthKey(val) {
  return typeof val === 'string' && /^\d{4}-\d{2}$/.test(val);
}

function isValidDate(val) {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val);
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const requireAuth = asyncHandler(async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = await db.get('SELECT * FROM users WHERE id = $1', [payload.id]);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Account inactive or not found' });
    }
    req.user = sanitizeUser(user);
    return next();
  });

  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return next();
  }

  app.get('/api/health', asyncHandler(async (_req, res) => {
    await db.get('SELECT 1 AS ok');
    res.json({ ok: true, database: db.driver, time: new Date().toISOString() });
  }));

  // First-time Admin setup check (only active when 0 admin accounts exist in live DB)
  app.get('/api/auth/setup-status', asyncHandler(async (_req, res) => {
    const row = await db.get("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'");
    res.json({ needsSetup: Number(row?.cnt || 0) === 0 });
  }));

  app.post('/api/auth/setup', asyncHandler(async (req, res) => {
    const existing = await db.get("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'");
    if (Number(existing?.cnt || 0) > 0) {
      return res.status(403).json({ error: 'Admin account is already configured. Please sign in.' });
    }

    const name = String(req.body?.name || '').trim().slice(0, 100);
    const phone = String(req.body?.phone || '').trim().slice(0, 40);
    const pin = String(req.body?.pin || '').trim();
    if (!name || !phone || pin.length < 4) {
      return res.status(400).json({ error: 'Name, Admin ID, and a 4+ digit PIN are required' });
    }

    const nowIso = new Date().toISOString();
    const inserted = await db.get(
      `INSERT INTO users (name, phone, role, territory, pin_hash, active, created_at)
       VALUES ($1, $2, 'admin', 'Head Office', $3, 1, $4)
       RETURNING *`,
      [name, phone, hashPin(pin), nowIso],
    );

    const clean = sanitizeUser(inserted);
    const token = signToken({ id: clean.id, role: clean.role });
    return res.status(201).json({ token, user: clean });
  }));

  app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const phone = String(req.body?.phone || '').trim();
    const pin = String(req.body?.pin || '').trim();
    if (!phone || !pin) {
      return res.status(400).json({ error: 'Login ID and PIN are required' });
    }
    const user = await db.get('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!user || !user.active || !verifyPin(pin, user.pin_hash)) {
      return res.status(401).json({ error: 'Invalid credentials or inactive account' });
    }
    const clean = sanitizeUser(user);
    const token = signToken({ id: clean.id, role: clean.role });
    return res.json({ token, user: clean });
  }));

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // Salesman Dashboard
  app.get('/api/salesman/dashboard', requireAuth, asyncHandler(async (req, res) => {
    const targetId =
      req.user.role === 'admin' && req.query.userId
        ? Number(req.query.userId)
        : req.user.id;

    if (req.user.role !== 'admin' && targetId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot view another salesman dashboard' });
    }

    const salesmanRow = await db.get('SELECT * FROM users WHERE id = $1', [targetId]);
    if (!salesmanRow || salesmanRow.role !== 'salesman') {
      return res.status(404).json({ error: 'Salesman not found' });
    }

    const monthKey = isValidMonthKey(req.query.month)
      ? req.query.month
      : getMonthKeyFromDate();

    const expenses = await db.all(
      'SELECT * FROM expenses WHERE user_id = $1 ORDER BY expense_date ASC, id ASC',
      [targetId],
    );
    const advances = await db.all(
      'SELECT * FROM advances WHERE user_id = $1 ORDER BY advance_date ASC, id ASC',
      [targetId],
    );
    const claims = await db.all(
      'SELECT * FROM reimbursement_claims WHERE user_id = $1 ORDER BY claim_date ASC, id ASC',
      [targetId],
    );
    const punches = await db.all(
      'SELECT * FROM location_punches WHERE user_id = $1 ORDER BY punched_at DESC, id DESC LIMIT 15',
      [targetId],
    );

    const ledger = computeSalesmanLedger({ expenses, advances, claims, monthKey });
    const monthKeys = getRecentMonthKeys(monthKey, 6);
    const monthlySeries = computeMonthlySeries({ expenses, advances, claims, monthKeys });

    return res.json({
      user: sanitizeUser(salesmanRow),
      monthKey,
      ledger,
      monthlySeries,
      latestPunch: punches[0] || null,
      recentPunches: punches,
    });
  }));

  // Live Location Punch (from browser Geolocation API)
  app.post('/api/location/punch', requireAuth, asyncHandler(async (req, res) => {
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const accuracy =
      req.body?.accuracy !== undefined && req.body?.accuracy !== null
        ? Number(req.body.accuracy)
        : null;
    const placeName = String(req.body?.place_name || '').trim().slice(0, 160);
    const address = String(req.body?.address || '').trim().slice(0, 300);
    const note = String(req.body?.note || '').trim().slice(0, 200);
    const punchType = req.body?.punch_type === 'trip_entry' ? 'trip_entry' : 'checkin';

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return res.status(400).json({ error: 'Valid latitude is required' });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Valid longitude is required' });
    }

    const punchedAt = new Date().toISOString();
    const punch = await db.get(
      `INSERT INTO location_punches
        (user_id, latitude, longitude, accuracy, place_name, address, note, punch_type, punched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.user.id,
        latitude,
        longitude,
        Number.isFinite(accuracy) ? Math.round(accuracy) : null,
        placeName,
        address,
        note,
        punchType,
        punchedAt,
      ],
    );

    return res.status(201).json({ punch });
  }));

  // Create Expense Row
  app.post('/api/expenses', requireAuth, asyncHandler(async (req, res) => {
    const targetUserId =
      req.user.role === 'admin' && req.body?.user_id
        ? Number(req.body.user_id)
        : req.user.id;

    const expenseDate = String(req.body?.expense_date || '').trim();
    const place = String(req.body?.place || '').trim().slice(0, 160);
    const departure = String(req.body?.departure || '').trim().slice(0, 32);
    const arrival = String(req.body?.arrival || '').trim().slice(0, 32);
    const fare = Math.max(0, roundMoney(req.body?.fare));
    const da = Math.max(0, roundMoney(req.body?.da));
    const conveyance = Math.max(0, roundMoney(req.body?.conveyance));
    const nightStay = Math.max(0, roundMoney(req.body?.night_stay));
    const paidBy = req.body?.paid_by === 'self' ? 'self' : 'office';
    const remarks = String(req.body?.remarks || '').trim().slice(0, 300);

    if (!isValidDate(expenseDate)) {
      return res.status(400).json({ error: 'Valid expense_date (YYYY-MM-DD) is required' });
    }
    if (!place) {
      return res.status(400).json({ error: 'Place is required' });
    }

    const total = computeExpenseTotal({ fare, da, conveyance, night_stay: nightStay });
    const monthKey = expenseDate.slice(0, 7);
    const nowIso = new Date().toISOString();

    const lat = req.body?.latitude !== undefined && req.body?.latitude !== null ? Number(req.body.latitude) : null;
    const lng = req.body?.longitude !== undefined && req.body?.longitude !== null ? Number(req.body.longitude) : null;
    const acc = req.body?.accuracy !== undefined && req.body?.accuracy !== null ? Number(req.body.accuracy) : null;
    const hasGps = Number.isFinite(lat) && Number.isFinite(lng);
    const gpsPlace = hasGps ? String(req.body?.gps_place || place).trim().slice(0, 160) : '';
    const gpsPunchedAt = hasGps ? (req.body?.gps_punched_at || nowIso) : null;

    const expense = await db.get(
      `INSERT INTO expenses (
        user_id, expense_date, month_key, place, departure, arrival,
        fare, da, conveyance, night_stay, total, paid_by, remarks,
        latitude, longitude, accuracy, gps_place, gps_punched_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *`,
      [
        targetUserId,
        expenseDate,
        monthKey,
        place,
        departure,
        arrival,
        fare,
        da,
        conveyance,
        nightStay,
        total,
        paidBy,
        remarks,
        hasGps ? lat : null,
        hasGps ? lng : null,
        hasGps && Number.isFinite(acc) ? Math.round(acc) : null,
        gpsPlace,
        gpsPunchedAt,
        nowIso,
        nowIso,
      ],
    );

    if (hasGps && req.body?.record_punch !== false) {
      await db.run(
        `INSERT INTO location_punches
          (user_id, latitude, longitude, accuracy, place_name, address, note, punch_type, punched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'trip_entry', $8)`,
        [
          targetUserId,
          lat,
          lng,
          Number.isFinite(acc) ? Math.round(acc) : null,
          gpsPlace || place,
          gpsPlace || place,
          `Trip logged: ${place}`,
          nowIso,
        ],
      );
    }

    return res.status(201).json({ expense });
  }));

  // Update Expense Row
  app.put('/api/expenses/:id', requireAuth, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.get('SELECT * FROM expenses WHERE id = $1', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Expense entry not found' });
    }
    if (req.user.role !== 'admin' && Number(existing.user_id) !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const expenseDate = req.body?.expense_date ? String(req.body.expense_date).trim() : existing.expense_date;
    const place = req.body?.place !== undefined ? String(req.body.place).trim().slice(0, 160) : existing.place;
    const departure = req.body?.departure !== undefined ? String(req.body.departure).trim().slice(0, 32) : existing.departure;
    const arrival = req.body?.arrival !== undefined ? String(req.body.arrival).trim().slice(0, 32) : existing.arrival;
    const fare = req.body?.fare !== undefined ? Math.max(0, roundMoney(req.body.fare)) : existing.fare;
    const da = req.body?.da !== undefined ? Math.max(0, roundMoney(req.body.da)) : existing.da;
    const conveyance = req.body?.conveyance !== undefined ? Math.max(0, roundMoney(req.body.conveyance)) : existing.conveyance;
    const nightStay = req.body?.night_stay !== undefined ? Math.max(0, roundMoney(req.body.night_stay)) : existing.night_stay;
    const paidBy = req.body?.paid_by !== undefined ? (req.body.paid_by === 'self' ? 'self' : 'office') : existing.paid_by;
    const remarks = req.body?.remarks !== undefined ? String(req.body.remarks).trim().slice(0, 300) : existing.remarks;

    if (!isValidDate(expenseDate) || !place) {
      return res.status(400).json({ error: 'Valid expense_date and place are required' });
    }

    const total = computeExpenseTotal({ fare, da, conveyance, night_stay: nightStay });
    const monthKey = expenseDate.slice(0, 7);
    const nowIso = new Date().toISOString();

    const updated = await db.get(
      `UPDATE expenses SET
        expense_date = $1, month_key = $2, place = $3, departure = $4, arrival = $5,
        fare = $6, da = $7, conveyance = $8, night_stay = $9, total = $10,
        paid_by = $11, remarks = $12, updated_at = $13
       WHERE id = $14
       RETURNING *`,
      [
        expenseDate,
        monthKey,
        place,
        departure,
        arrival,
        fare,
        da,
        conveyance,
        nightStay,
        total,
        paidBy,
        remarks,
        nowIso,
        id,
      ],
    );

    return res.json({ expense: updated });
  }));

  // Delete Expense Row
  app.delete('/api/expenses/:id', requireAuth, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.get('SELECT * FROM expenses WHERE id = $1', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Expense entry not found' });
    }
    if (req.user.role !== 'admin' && Number(existing.user_id) !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.run('DELETE FROM expenses WHERE id = $1', [id]);
    return res.json({ deleted: true, id });
  }));

  // Submit Reimbursement Claim (Salesman)
  app.post('/api/claims', requireAuth, asyncHandler(async (req, res) => {
    const targetUserId =
      req.user.role === 'admin' && req.body?.user_id
        ? Number(req.body.user_id)
        : req.user.id;

    const claimDate = isValidDate(req.body?.claim_date)
      ? req.body.claim_date
      : new Date().toISOString().slice(0, 10);
    const monthKey = isValidMonthKey(req.body?.month_key)
      ? req.body.month_key
      : claimDate.slice(0, 7);
    const amount = roundMoney(req.body?.amount);
    const reason = String(req.body?.reason || '').trim().slice(0, 300);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Claim amount must be greater than 0' });
    }

    const nowIso = new Date().toISOString();
    const claim = await db.get(
      `INSERT INTO reimbursement_claims (user_id, claim_date, month_key, amount, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING *`,
      [targetUserId, claimDate, monthKey, amount, reason, nowIso],
    );

    return res.status(201).json({ claim });
  }));

  // Admin Overview
  app.get('/api/admin/overview', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const monthKey = isValidMonthKey(req.query.month)
      ? req.query.month
      : getMonthKeyFromDate();

    const salesmenRows = await db.all(
      "SELECT * FROM users WHERE role = 'salesman' ORDER BY active DESC, name ASC",
    );
    const allExpenses = await db.all('SELECT * FROM expenses ORDER BY expense_date ASC, id ASC');
    const allAdvances = await db.all('SELECT * FROM advances ORDER BY advance_date ASC, id ASC');
    const allClaims = await db.all(
      `SELECT rc.*, u.name AS user_name, u.phone AS user_phone, u.territory AS user_territory
       FROM reimbursement_claims rc
       JOIN users u ON u.id = rc.user_id
       ORDER BY CASE rc.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END, rc.created_at DESC, rc.id DESC`,
    );

    const latestPunches = await db.all(
      `SELECT lp.*
       FROM location_punches lp
       INNER JOIN (
         SELECT user_id, MAX(id) AS max_id
         FROM location_punches
         GROUP BY user_id
       ) latest ON lp.id = latest.max_id`,
    );
    const latestPunchByUser = new Map(latestPunches.map((p) => [Number(p.user_id), p]));

    const recentPunches = await db.all(
      `SELECT lp.*, u.name AS user_name, u.territory AS user_territory
       FROM location_punches lp
       JOIN users u ON u.id = lp.user_id
       ORDER BY lp.punched_at DESC, lp.id DESC
       LIMIT 30`,
    );

    const salesmen = salesmenRows.map((row) => {
      const uid = Number(row.id);
      const sExpenses = allExpenses.filter((e) => Number(e.user_id) === uid);
      const sAdvances = allAdvances.filter((a) => Number(a.user_id) === uid);
      const sClaims = allClaims.filter((c) => Number(c.user_id) === uid);
      const ledger = computeSalesmanLedger({
        expenses: sExpenses,
        advances: sAdvances,
        claims: sClaims,
        monthKey,
      });
      return {
        user: sanitizeUser(row),
        latestPunch: latestPunchByUser.get(uid) || null,
        month: ledger.month,
        openingBalance: ledger.openingBalance,
        live: ledger.live,
        expenses: ledger.expenses,
        advances: ledger.advances,
      };
    });

    const summary = salesmen.reduce(
      (acc, s) => {
        acc.monthAdvance = roundMoney(acc.monthAdvance + s.month.advance);
        acc.monthSpent = roundMoney(acc.monthSpent + s.month.totalExpenses);
        acc.monthFare = roundMoney(acc.monthFare + s.month.fare);
        acc.monthDa = roundMoney(acc.monthDa + s.month.da);
        acc.monthConveyance = roundMoney(acc.monthConveyance + s.month.conveyance);
        acc.monthNightStay = roundMoney(acc.monthNightStay + s.month.nightStay);
        acc.totalCashInHand = roundMoney(acc.totalCashInHand + s.live.cashInHand);
        acc.totalOutOfPocket = roundMoney(acc.totalOutOfPocket + s.live.outOfPocketDue);
        acc.totalTrips += s.month.tripCount;
        if (s.user.active) acc.activeSalesmen += 1;
        if (s.latestPunch) acc.punchedCount += 1;
        return acc;
      },
      {
        monthAdvance: 0,
        monthSpent: 0,
        monthFare: 0,
        monthDa: 0,
        monthConveyance: 0,
        monthNightStay: 0,
        totalCashInHand: 0,
        totalOutOfPocket: 0,
        totalTrips: 0,
        activeSalesmen: 0,
        punchedCount: 0,
      },
    );

    const pendingClaims = allClaims.filter((c) => c.status === 'pending' || c.status === 'approved');
    summary.pendingClaimsCount = pendingClaims.length;
    summary.pendingClaimsAmount = roundMoney(
      pendingClaims.reduce((sum, c) => sum + Number(c.amount || 0), 0),
    );

    const monthKeys = getRecentMonthKeys(monthKey, 6);
    const monthlySeries = computeMonthlySeries({
      expenses: allExpenses,
      advances: allAdvances,
      claims: allClaims,
      monthKeys,
    });

    return res.json({
      monthKey,
      summary,
      salesmen,
      claims: allClaims,
      recentPunches,
      monthlySeries,
    });
  }));

  // Admin: Give Office Advance to Salesman
  app.post('/api/admin/advances', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const userId = Number(req.body?.user_id);
    const advanceDate = isValidDate(req.body?.advance_date)
      ? req.body.advance_date
      : new Date().toISOString().slice(0, 10);
    const amount = roundMoney(req.body?.amount);
    const mode = String(req.body?.mode || 'UPI').trim().slice(0, 40);
    const reference = String(req.body?.reference || '').trim().slice(0, 80);
    const note = String(req.body?.note || '').trim().slice(0, 200);

    const target = await db.get("SELECT id FROM users WHERE id = $1 AND role = 'salesman'", [userId]);
    if (!target) {
      return res.status(404).json({ error: 'Salesman not found' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Advance amount must be greater than 0' });
    }

    const monthKey = advanceDate.slice(0, 7);
    const nowIso = new Date().toISOString();
    const advance = await db.get(
      `INSERT INTO advances (user_id, advance_date, month_key, amount, mode, reference, note, given_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, advanceDate, monthKey, amount, mode, reference, note, req.user.id, nowIso],
    );

    return res.status(201).json({ advance });
  }));

  app.delete('/api/admin/advances/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.get('SELECT id FROM advances WHERE id = $1', [id]);
    if (!existing) return res.status(404).json({ error: 'Advance not found' });
    await db.run('DELETE FROM advances WHERE id = $1', [id]);
    return res.json({ deleted: true, id });
  }));

  // Admin: Update Reimbursement Claim Status
  app.patch('/api/admin/claims/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const claim = await db.get('SELECT * FROM reimbursement_claims WHERE id = $1', [id]);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found' });
    }

    const nextStatus = String(req.body?.status || '').trim();
    if (!['approved', 'paid', 'rejected', 'pending'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid claim status' });
    }

    const adminNote =
      req.body?.admin_note !== undefined
        ? String(req.body.admin_note).trim().slice(0, 300)
        : claim.admin_note;
    const payoutMode =
      req.body?.payout_mode !== undefined
        ? String(req.body.payout_mode).trim().slice(0, 40)
        : claim.payout_mode;
    const payoutRef =
      req.body?.payout_ref !== undefined
        ? String(req.body.payout_ref).trim().slice(0, 80)
        : claim.payout_ref;

    const nowIso = new Date().toISOString();
    const paidAt = nextStatus === 'paid' ? claim.paid_at || nowIso : null;

    const updated = await db.get(
      `UPDATE reimbursement_claims
       SET status = $1, admin_note = $2, reviewed_by = $3, reviewed_at = $4,
           paid_at = $5, payout_mode = $6, payout_ref = $7
       WHERE id = $8
       RETURNING *`,
      [nextStatus, adminNote, req.user.id, nowIso, paidAt, payoutMode, payoutRef, id],
    );

    return res.json({ claim: updated });
  }));

  // Admin: Create or Update Salesman
  app.post('/api/admin/salesmen', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const phone = String(req.body?.phone || '').trim().slice(0, 30);
    const territory = String(req.body?.territory || '').trim().slice(0, 120);
    const pin = String(req.body?.pin || '').trim();

    if (!name || !phone || pin.length < 4) {
      return res.status(400).json({ error: 'Name, mobile/ID, and a 4+ digit PIN are required' });
    }
    const exists = await db.get('SELECT id FROM users WHERE phone = $1', [phone]);
    if (exists) {
      return res.status(409).json({ error: 'A user with this mobile/ID already exists' });
    }

    const nowIso = new Date().toISOString();
    const created = await db.get(
      `INSERT INTO users (name, phone, role, territory, pin_hash, active, created_at)
       VALUES ($1, $2, 'salesman', $3, $4, 1, $5)
       RETURNING *`,
      [name, phone, territory, hashPin(pin), nowIso],
    );

    return res.status(201).json({ user: sanitizeUser(created) });
  }));

  app.patch('/api/admin/salesmen/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.get("SELECT * FROM users WHERE id = $1 AND role = 'salesman'", [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Salesman not found' });
    }

    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 100) : existing.name;
    const territory = req.body?.territory !== undefined ? String(req.body.territory).trim().slice(0, 120) : existing.territory;
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : existing.active;
    const newPin = req.body?.pin ? String(req.body.pin).trim() : '';
    const pinHash = newPin.length >= 4 ? hashPin(newPin) : existing.pin_hash;

    const updated = await db.get(
      `UPDATE users SET name = $1, territory = $2, active = $3, pin_hash = $4
       WHERE id = $5
       RETURNING *`,
      [name || existing.name, territory, active, pinHash, id],
    );

    return res.json({ user: sanitizeUser(updated) });
  }));

  // Serve built static frontend in production
  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const port = Number(process.env.PORT || 3001);
  const db = await initDatabase();
  const app = createApp(db);
  app.listen(port, '0.0.0.0', () => {
    console.log(`FieldPulse live server (${db.driver}) running on http://localhost:${port}`);
  });
}
