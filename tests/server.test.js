import test from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../server/db.js';
import { createApp } from '../server/index.js';
import { computeExpenseTotal, computeSalesmanLedger } from '../server/balance.js';

async function startTestServer() {
  const db = await initDatabase({ mode: 'memory' });
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const port = server.address().port;
  return {
    db,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
}

async function apiJson(baseUrl, path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

test('computeExpenseTotal and computeSalesmanLedger calculate running balance and reimbursement accurately', () => {
  assert.equal(
    computeExpenseTotal({ fare: 450.5, da: 300, conveyance: 150.25, night_stay: 1200 }),
    2100.75,
  );

  const ledger = computeSalesmanLedger({
    monthKey: '2026-11',
    advances: [
      { id: 1, month_key: '2026-10', advance_date: '2026-10-05', amount: 5000, created_at: '2026-10-05T09:00:00Z' },
      { id: 2, month_key: '2026-11', advance_date: '2026-11-02', amount: 3000, created_at: '2026-11-02T09:00:00Z' },
    ],
    expenses: [
      { id: 10, month_key: '2026-10', expense_date: '2026-10-12', fare: 1500, da: 500, conveyance: 300, night_stay: 1700, total: 4000, paid_by: 'office', created_at: '2026-10-12T18:00:00Z' },
      { id: 11, month_key: '2026-11', expense_date: '2026-11-05', fare: 1200, da: 400, conveyance: 200, night_stay: 2800, total: 4600, paid_by: 'self', created_at: '2026-11-05T18:00:00Z' },
    ],
    claims: [
      { id: 20, month_key: '2026-11', claim_date: '2026-11-06', amount: 600, status: 'pending', created_at: '2026-11-06T10:00:00Z' },
    ],
  });

  assert.equal(ledger.openingBalance, 1000);
  assert.equal(ledger.month.closingBalance, -600);
  assert.equal(ledger.live.liveBalance, -600);
  assert.equal(ledger.live.outOfPocketDue, 600);
  assert.equal(ledger.live.activeClaims, 600);
  assert.equal(ledger.live.unclaimedOutOfPocket, 0);
});

test('Clean production bootstrap: initial admin setup, salesman creation, GPS punch, advance, expense & reimbursement settlement', async () => {
  const srv = await startTestServer();
  try {
    // 1. Fresh DB starts with zero test users and needsSetup = true
    const statusBefore = await apiJson(srv.baseUrl, '/api/auth/setup-status');
    assert.equal(statusBefore.status, 200);
    assert.equal(statusBefore.data.needsSetup, true);

    // 2. Complete first-time Admin setup
    const setupRes = await apiJson(srv.baseUrl, '/api/auth/setup', {
      method: 'POST',
      body: { name: 'Head Admin', phone: 'admin01', pin: '4321' },
    });
    assert.equal(setupRes.status, 201);
    const adminToken = setupRes.data.token;
    assert.equal(setupRes.data.user.role, 'admin');

    const statusAfter = await apiJson(srv.baseUrl, '/api/auth/setup-status');
    assert.equal(statusAfter.data.needsSetup, false);

    // 3. Admin creates a real salesman and issues an office advance
    const createSalesman = await apiJson(srv.baseUrl, '/api/admin/salesmen', {
      method: 'POST',
      token: adminToken,
      body: { name: 'Field Rep 1', phone: '9000011111', territory: 'North Zone', pin: '5678' },
    });
    assert.equal(createSalesman.status, 201);
    const salesmanId = createSalesman.data.user.id;

    const today = new Date().toISOString().slice(0, 10);
    const monthKey = today.slice(0, 7);

    const advRes = await apiJson(srv.baseUrl, '/api/admin/advances', {
      method: 'POST',
      token: adminToken,
      body: { user_id: salesmanId, advance_date: today, amount: 1000, mode: 'UPI', note: 'Initial advance' },
    });
    assert.equal(advRes.status, 201);

    // 4. Salesman logs in
    const loginSalesman = await apiJson(srv.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { phone: '9000011111', pin: '5678' },
    });
    assert.equal(loginSalesman.status, 200);
    const salesmanToken = loginSalesman.data.token;

    // Salesman cannot access Admin overview
    const forbidden = await apiJson(srv.baseUrl, '/api/admin/overview', { token: salesmanToken });
    assert.equal(forbidden.status, 403);

    // 5. Punch live GPS location
    const punchRes = await apiJson(srv.baseUrl, '/api/location/punch', {
      method: 'POST',
      token: salesmanToken,
      body: {
        latitude: 28.6139,
        longitude: 77.209,
        accuracy: 10,
        place_name: 'Connaught Place',
        address: 'Connaught Place, New Delhi',
        note: 'Client check-in',
      },
    });
    assert.equal(punchRes.status, 201);
    assert.equal(punchRes.data.punch.place_name, 'Connaught Place');

    // 6. Add an expense row exceeding the ₹1,000 advance (₹1,500 total => ₹500 out-of-pocket)
    const expRes = await apiJson(srv.baseUrl, '/api/expenses', {
      method: 'POST',
      token: salesmanToken,
      body: {
        expense_date: today,
        place: 'Delhi → Noida',
        departure: '09:00',
        arrival: '11:00',
        fare: 500,
        da: 400,
        conveyance: 600,
        night_stay: 0,
        paid_by: 'self',
        latitude: 28.5355,
        longitude: 77.391,
        gps_place: 'Sector 18, Noida',
      },
    });
    assert.equal(expRes.status, 201);
    assert.equal(expRes.data.expense.total, 1500);

    const dashBefore = await apiJson(srv.baseUrl, `/api/salesman/dashboard?month=${monthKey}`, {
      token: salesmanToken,
    });
    assert.equal(dashBefore.status, 200);
    assert.equal(dashBefore.data.ledger.live.liveBalance, -500);
    assert.equal(dashBefore.data.ledger.live.outOfPocketDue, 500);

    // 7. Submit & settle reimbursement claim
    const claimRes = await apiJson(srv.baseUrl, '/api/claims', {
      method: 'POST',
      token: salesmanToken,
      body: { claim_date: today, month_key: monthKey, amount: 500, reason: 'Noida travel excess' },
    });
    assert.equal(claimRes.status, 201);

    const settleRes = await apiJson(srv.baseUrl, `/api/admin/claims/${claimRes.data.claim.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'paid', payout_mode: 'UPI', payout_ref: 'UTR-9001' },
    });
    assert.equal(settleRes.status, 200);
    assert.equal(settleRes.data.claim.status, 'paid');

    const dashAfter = await apiJson(srv.baseUrl, `/api/salesman/dashboard?month=${monthKey}`, {
      token: salesmanToken,
    });
    assert.equal(dashAfter.data.ledger.live.liveBalance, 0);
    assert.equal(dashAfter.data.ledger.live.outOfPocketDue, 0);
  } finally {
    await srv.close();
  }
});
