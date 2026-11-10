/**
 * Pure accounting and running-balance helpers for salesman expense & advance tracking.
 */

export function roundMoney(value) {
  const num = Number(value) || 0;
  return Math.round(num * 100) / 100;
}

export function computeExpenseTotal(fields) {
  const fare = Math.max(0, Number(fields.fare) || 0);
  const da = Math.max(0, Number(fields.da) || 0);
  const conveyance = Math.max(0, Number(fields.conveyance) || 0);
  const nightStay = Math.max(0, Number(fields.night_stay ?? fields.nightStay) || 0);
  return roundMoney(fare + da + conveyance + nightStay);
}

/**
 * Computes full monthly summary, all-time live wallet status, and chronological
 * row-by-row running balance for a single salesman.
 */
export function computeSalesmanLedger({
  expenses = [],
  advances = [],
  claims = [],
  monthKey,
}) {
  // Sort chronologically for consistent ledger progression
  const priorAdvances = advances
    .filter((a) => a.month_key < monthKey)
    .reduce((acc, a) => acc + Number(a.amount || 0), 0);
  const priorExpenses = expenses
    .filter((e) => e.month_key < monthKey)
    .reduce((acc, e) => acc + Number(e.total || 0), 0);
  const priorPaidClaims = claims
    .filter((c) => c.status === 'paid' && c.month_key < monthKey)
    .reduce((acc, c) => acc + Number(c.amount || 0), 0);

  const openingBalance = roundMoney(priorAdvances + priorPaidClaims - priorExpenses);

  const monthExpenseRows = expenses.filter((e) => e.month_key === monthKey);
  const monthAdvanceRows = advances.filter((a) => a.month_key === monthKey);
  const monthClaimRows = claims.filter((c) => c.month_key === monthKey);

  const monthTotals = monthExpenseRows.reduce(
    (acc, e) => {
      acc.fare += Number(e.fare || 0);
      acc.da += Number(e.da || 0);
      acc.conveyance += Number(e.conveyance || 0);
      acc.nightStay += Number(e.night_stay || 0);
      acc.total += Number(e.total || 0);
      if (e.paid_by === 'self') acc.selfPaid += Number(e.total || 0);
      return acc;
    },
    { fare: 0, da: 0, conveyance: 0, nightStay: 0, total: 0, selfPaid: 0 },
  );

  const monthAdvance = roundMoney(
    monthAdvanceRows.reduce((acc, a) => acc + Number(a.amount || 0), 0),
  );
  const monthPaidClaims = roundMoney(
    monthClaimRows
      .filter((c) => c.status === 'paid')
      .reduce((acc, c) => acc + Number(c.amount || 0), 0),
  );
  const monthPendingClaims = roundMoney(
    monthClaimRows
      .filter((c) => c.status === 'pending' || c.status === 'approved')
      .reduce((acc, c) => acc + Number(c.amount || 0), 0),
  );

  const monthClosingBalance = roundMoney(
    openingBalance + monthAdvance + monthPaidClaims - monthTotals.total,
  );

  // All-time live running wallet across all months
  const allAdvances = roundMoney(
    advances.reduce((acc, a) => acc + Number(a.amount || 0), 0),
  );
  const allExpenses = roundMoney(
    expenses.reduce((acc, e) => acc + Number(e.total || 0), 0),
  );
  const allPaidClaims = roundMoney(
    claims
      .filter((c) => c.status === 'paid')
      .reduce((acc, c) => acc + Number(c.amount || 0), 0),
  );
  const allActiveClaims = roundMoney(
    claims
      .filter((c) => c.status === 'pending' || c.status === 'approved')
      .reduce((acc, c) => acc + Number(c.amount || 0), 0),
  );

  const liveBalance = roundMoney(allAdvances + allPaidClaims - allExpenses);
  const cashInHand = liveBalance > 0 ? liveBalance : 0;
  const outOfPocketDue = liveBalance < 0 ? roundMoney(Math.abs(liveBalance)) : 0;
  const unclaimedOutOfPocket = roundMoney(Math.max(0, outOfPocketDue - allActiveClaims));

  // Build chronological timeline for the selected month to attach runningBalance to each row
  const timeline = [
    ...monthAdvanceRows.map((a) => ({
      kind: 'advance',
      sortDate: a.advance_date,
      sortTime: '00:00',
      sortCreated: a.created_at || '',
      id: a.id,
      delta: Number(a.amount || 0),
      row: a,
    })),
    ...monthClaimRows
      .filter((c) => c.status === 'paid')
      .map((c) => ({
        kind: 'reimbursement',
        sortDate: (c.paid_at || c.claim_date).slice(0, 10),
        sortTime: '23:58',
        sortCreated: c.paid_at || c.created_at || '',
        id: c.id,
        delta: Number(c.amount || 0),
        row: c,
      })),
    ...monthExpenseRows.map((e) => ({
      kind: 'expense',
      sortDate: e.expense_date,
      sortTime: e.departure || '12:00',
      sortCreated: e.created_at || '',
      id: e.id,
      delta: -Number(e.total || 0),
      row: e,
    })),
  ].sort((a, b) => {
    if (a.sortDate !== b.sortDate) return a.sortDate.localeCompare(b.sortDate);
    if (a.sortTime !== b.sortTime) return a.sortTime.localeCompare(b.sortTime);
    if (a.sortCreated !== b.sortCreated) return a.sortCreated.localeCompare(b.sortCreated);
    return a.id - b.id;
  });

  let running = openingBalance;
  const expenseRunningMap = new Map();
  const ledgerEvents = timeline.map((item) => {
    running = roundMoney(running + item.delta);
    if (item.kind === 'expense') {
      expenseRunningMap.set(item.id, running);
    }
    return {
      kind: item.kind,
      date: item.sortDate,
      delta: roundMoney(item.delta),
      runningBalance: running,
      data: item.row,
    };
  });

  const enrichedExpenses = monthExpenseRows
    .map((e) => ({
      ...e,
      running_balance: expenseRunningMap.get(e.id) ?? monthClosingBalance,
    }))
    .sort((a, b) => {
      if (a.expense_date !== b.expense_date) {
        return b.expense_date.localeCompare(a.expense_date);
      }
      return b.id - a.id;
    });

  return {
    monthKey,
    openingBalance,
    month: {
      advance: monthAdvance,
      fare: roundMoney(monthTotals.fare),
      da: roundMoney(monthTotals.da),
      conveyance: roundMoney(monthTotals.conveyance),
      nightStay: roundMoney(monthTotals.nightStay),
      totalExpenses: roundMoney(monthTotals.total),
      selfPaidExpenses: roundMoney(monthTotals.selfPaid),
      paidClaims: monthPaidClaims,
      pendingClaims: monthPendingClaims,
      netMonthChange: roundMoney(monthAdvance + monthPaidClaims - monthTotals.total),
      closingBalance: monthClosingBalance,
      tripCount: monthExpenseRows.length,
    },
    live: {
      totalAdvances: allAdvances,
      totalExpenses: allExpenses,
      totalPaidClaims: allPaidClaims,
      activeClaims: allActiveClaims,
      liveBalance,
      cashInHand,
      outOfPocketDue,
      unclaimedOutOfPocket,
    },
    expenses: enrichedExpenses,
    advances: [...monthAdvanceRows].sort((a, b) => b.advance_date.localeCompare(a.advance_date) || b.id - a.id),
    claims: [...monthClaimRows].sort((a, b) => b.claim_date.localeCompare(a.claim_date) || b.id - a.id),
    ledgerEvents,
  };
}

/**
 * Generates last N months keys (YYYY-MM) ending at anchorMonthKey (inclusive), sorted ascending.
 */
export function getRecentMonthKeys(anchorMonthKey, count = 6) {
  const [yStr, mStr] = anchorMonthKey.split('-');
  let year = Number(yStr);
  let month = Number(mStr);
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys;
}

export function computeMonthlySeries({ expenses = [], advances = [], claims = [], monthKeys }) {
  return monthKeys.map((mk) => {
    const mExp = expenses.filter((e) => e.month_key === mk);
    const mAdv = advances.filter((a) => a.month_key === mk);
    const mPaid = claims.filter((c) => c.month_key === mk && c.status === 'paid');

    const fare = roundMoney(mExp.reduce((s, e) => s + Number(e.fare || 0), 0));
    const da = roundMoney(mExp.reduce((s, e) => s + Number(e.da || 0), 0));
    const conveyance = roundMoney(mExp.reduce((s, e) => s + Number(e.conveyance || 0), 0));
    const nightStay = roundMoney(mExp.reduce((s, e) => s + Number(e.night_stay || 0), 0));
    const spent = roundMoney(fare + da + conveyance + nightStay);
    const advance = roundMoney(mAdv.reduce((s, a) => s + Number(a.amount || 0), 0));
    const reimbursed = roundMoney(mPaid.reduce((s, c) => s + Number(c.amount || 0), 0));

    return {
      monthKey: mk,
      advance,
      spent,
      reimbursed,
      fare,
      da,
      conveyance,
      nightStay,
      outOfPocket: spent > advance + reimbursed ? roundMoney(spent - advance - reimbursed) : 0,
      trips: mExp.length,
    };
  });
}

