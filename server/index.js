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
    const user = await db.findUserById(payload.id);
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
    await db.ping();
    res.json({ ok: true, database: db.driver, time: new Date().toISOString() });
  }));

  // First-time Admin setup check (only active when 0 admin accounts exist in live DB)
  app.get('/api/auth/setup-status', asyncHandler(async (_req, res) => {
    const count = await db.countAdmins();
    res.json({ needsSetup: count === 0 });
  }));

  app.post('/api/auth/setup', asyncHandler(async (req, res) => {
    const existing = await db.countAdmins();
    if (existing > 0) {
      return res.status(403).json({ error: 'Admin account is already configured. Please sign in.' });
    }

    const name = String(req.body?.name || '').trim().slice(0, 100);
    const phone = String(req.body?.phone || '').trim().slice(0, 40);
    const pin = String(req.body?.pin || '').trim();
    if (!name || !phone || pin.length < 4) {
      return res.status(400).json({ error: 'Name, Admin ID, and a 4+ digit PIN are required' });
    }

    const inserted = await db.createUser({
      name,
      phone,
      role: 'admin',
      territory: 'Head Office',
      pin_hash: hashPin(pin),
      active: 1,
      created_at: new Date().toISOString(),
    });

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
    const user = await db.findUserByPhone(phone);
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

    const salesmanRow = await db.findUserById(targetId);
    if (!salesmanRow || salesmanRow.role !== 'salesman') {
      return res.status(404).json({ error: 'Salesman not found' });
    }

    const monthKey = isValidMonthKey(req.query.month)
      ? req.query.month
      : getMonthKeyFromDate();

    const [expenses, advances, claims, punches] = await Promise.all([
      db.listExpensesByUser(targetId),
      db.listAdvancesByUser(targetId),
      db.listClaimsByUser(targetId),
      db.listPunchesByUser(targetId, 15),
    ]);

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

    const punch = await db.createPunch({
      user_id: req.user.id,
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
      place_name: placeName,
      address,
      note,
      punch_type: punchType,
      punched_at: new Date().toISOString(),
    });

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

    const expense = await db.createExpense({
      user_id: targetUserId,
      expense_date: expenseDate,
      month_key: monthKey,
      place,
      departure,
      arrival,
      fare,
      da,
      conveyance,
      night_stay: nightStay,
      total,
      paid_by: paidBy,
      remarks,
      latitude: hasGps ? lat : null,
      longitude: hasGps ? lng : null,
      accuracy: hasGps && Number.isFinite(acc) ? Math.round(acc) : null,
      gps_place: gpsPlace,
      gps_punched_at: gpsPunchedAt,
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (hasGps && req.body?.record_punch !== false) {
      await db.createPunch({
        user_id: targetUserId,
        latitude: lat,
        longitude: lng,
        accuracy: Number.isFinite(acc) ? Math.round(acc) : null,
        place_name: gpsPlace || place,
        address: gpsPlace || place,
        note: `Trip logged: ${place}`,
        punch_type: 'trip_entry',
        punched_at: nowIso,
      });
    }

    return res.status(201).json({ expense });
  }));

  // Update Expense Row
  app.put('/api/expenses/:id', requireAuth, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.getExpenseById(id);
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

    const updated = await db.updateExpense(id, {
      expense_date: expenseDate,
      month_key: monthKey,
      place,
      departure,
      arrival,
      fare,
      da,
      conveyance,
      night_stay: nightStay,
      total,
      paid_by: paidBy,
      remarks,
      updated_at: nowIso,
    });

    return res.json({ expense: updated });
  }));

  // Delete Expense Row
  app.delete('/api/expenses/:id', requireAuth, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.getExpenseById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Expense entry not found' });
    }
    if (req.user.role !== 'admin' && Number(existing.user_id) !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.deleteExpense(id);
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

    const claim = await db.createClaim({
      user_id: targetUserId,
      claim_date: claimDate,
      month_key: monthKey,
      amount,
      reason,
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    return res.status(201).json({ claim });
  }));

  // Admin Overview
  app.get('/api/admin/overview', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const monthKey = isValidMonthKey(req.query.month)
      ? req.query.month
      : getMonthKeyFromDate();

    const [salesmenRows, allExpenses, allAdvances, allClaims, latestPunches, recentPunches] =
      await Promise.all([
        db.listSalesmen(),
        db.listAllExpenses(),
        db.listAllAdvances(),
        db.listAllClaimsWithUsers(),
        db.listLatestPunches(),
        db.listRecentPunchesWithUsers(30),
      ]);

    const latestPunchByUser = new Map(latestPunches.map((p) => [Number(p.user_id), p]));

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

    const target = await db.findUserById(userId);
    if (!target || target.role !== 'salesman') {
      return res.status(404).json({ error: 'Salesman not found' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Advance amount must be greater than 0' });
    }

    const advance = await db.createAdvance({
      user_id: userId,
      advance_date: advanceDate,
      month_key: advanceDate.slice(0, 7),
      amount,
      mode,
      reference,
      note,
      given_by: req.user.id,
      created_at: new Date().toISOString(),
    });

    return res.status(201).json({ advance });
  }));

  app.delete('/api/admin/advances/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.getAdvanceById(id);
    if (!existing) return res.status(404).json({ error: 'Advance not found' });
    await db.deleteAdvance(id);
    return res.json({ deleted: true, id });
  }));

  // Admin: Update Reimbursement Claim Status
  app.patch('/api/admin/claims/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const claim = await db.getClaimById(id);
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

    const updated = await db.updateClaim(id, {
      status: nextStatus,
      admin_note: adminNote,
      reviewed_by: req.user.id,
      reviewed_at: nowIso,
      paid_at: paidAt,
      payout_mode: payoutMode,
      payout_ref: payoutRef,
    });

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
    const exists = await db.findUserByPhone(phone);
    if (exists) {
      return res.status(409).json({ error: 'A user with this mobile/ID already exists' });
    }

    const created = await db.createUser({
      name,
      phone,
      role: 'salesman',
      territory,
      pin_hash: hashPin(pin),
      active: 1,
      created_at: new Date().toISOString(),
    });

    return res.status(201).json({ user: sanitizeUser(created) });
  }));

  app.patch('/api/admin/salesmen/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.findUserById(id);
    if (!existing || existing.role !== 'salesman') {
      return res.status(404).json({ error: 'Salesman not found' });
    }

    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 100) : existing.name;
    const territory = req.body?.territory !== undefined ? String(req.body.territory).trim().slice(0, 120) : existing.territory;
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : existing.active;
    const newPin = req.body?.pin ? String(req.body.pin).trim() : '';
    const pinHash = newPin.length >= 4 ? hashPin(newPin) : existing.pin_hash;

    const updated = await db.updateSalesman(id, {
      name: name || existing.name,
      territory,
      active,
      pin_hash: pinHash,
    });

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
