export type Role = 'admin' | 'salesman';

export interface User {
  id: number;
  name: string;
  phone: string;
  role: Role;
  territory: string;
  active: boolean;
  created_at: string;
}

export interface LocationPunch {
  id: number;
  user_id: number;
  user_name?: string;
  user_territory?: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  place_name: string;
  address: string;
  note: string;
  punch_type: 'checkin' | 'trip_entry';
  punched_at: string;
}

export interface ExpenseEntry {
  id: number;
  user_id: number;
  expense_date: string;
  month_key: string;
  place: string;
  departure: string;
  arrival: string;
  fare: number;
  da: number;
  conveyance: number;
  night_stay: number;
  total: number;
  paid_by: 'office' | 'self';
  remarks: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  gps_place: string;
  gps_punched_at: string | null;
  running_balance?: number;
  created_at: string;
  updated_at: string;
}

export interface AdvanceEntry {
  id: number;
  user_id: number;
  advance_date: string;
  month_key: string;
  amount: number;
  mode: string;
  reference: string;
  note: string;
  given_by: number | null;
  created_at: string;
}

export type ClaimStatus = 'pending' | 'approved' | 'paid' | 'rejected';

export interface ReimbursementClaim {
  id: number;
  user_id: number;
  user_name?: string;
  user_phone?: string;
  user_territory?: string;
  claim_date: string;
  month_key: string;
  amount: number;
  reason: string;
  status: ClaimStatus;
  admin_note: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  paid_at: string | null;
  payout_mode: string;
  payout_ref: string;
  created_at: string;
}

export interface LedgerMonthTotals {
  advance: number;
  fare: number;
  da: number;
  conveyance: number;
  nightStay: number;
  totalExpenses: number;
  selfPaidExpenses: number;
  paidClaims: number;
  pendingClaims: number;
  netMonthChange: number;
  closingBalance: number;
  tripCount: number;
}

export interface LiveWallet {
  totalAdvances: number;
  totalExpenses: number;
  totalPaidClaims: number;
  activeClaims: number;
  liveBalance: number;
  cashInHand: number;
  outOfPocketDue: number;
  unclaimedOutOfPocket: number;
}

export interface LedgerEvent {
  kind: 'advance' | 'expense' | 'reimbursement';
  date: string;
  delta: number;
  runningBalance: number;
  data: ExpenseEntry | AdvanceEntry | ReimbursementClaim;
}

export interface SalesmanLedger {
  monthKey: string;
  openingBalance: number;
  month: LedgerMonthTotals;
  live: LiveWallet;
  expenses: ExpenseEntry[];
  advances: AdvanceEntry[];
  claims: ReimbursementClaim[];
  ledgerEvents: LedgerEvent[];
}

export interface MonthlyPoint {
  monthKey: string;
  advance: number;
  spent: number;
  reimbursed: number;
  fare: number;
  da: number;
  conveyance: number;
  nightStay: number;
  outOfPocket: number;
  trips: number;
}

export interface SalesmanDashboardData {
  user: User;
  monthKey: string;
  ledger: SalesmanLedger;
  monthlySeries: MonthlyPoint[];
  latestPunch: LocationPunch | null;
  recentPunches: LocationPunch[];
}

export interface AdminSalesmanSummary {
  user: User;
  latestPunch: LocationPunch | null;
  month: LedgerMonthTotals;
  openingBalance: number;
  live: LiveWallet;
  expenses: ExpenseEntry[];
  advances: AdvanceEntry[];
}

export interface AdminOverviewData {
  monthKey: string;
  summary: {
    monthAdvance: number;
    monthSpent: number;
    monthFare: number;
    monthDa: number;
    monthConveyance: number;
    monthNightStay: number;
    totalCashInHand: number;
    totalOutOfPocket: number;
    totalTrips: number;
    activeSalesmen: number;
    punchedCount: number;
    pendingClaimsCount: number;
    pendingClaimsAmount: number;
  };
  salesmen: AdminSalesmanSummary[];
  claims: ReimbursementClaim[];
  recentPunches: LocationPunch[];
  monthlySeries: MonthlyPoint[];
}

