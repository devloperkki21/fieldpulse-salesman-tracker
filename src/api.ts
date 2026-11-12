import type {
  AdminOverviewData,
  AdvanceEntry,
  ExpenseEntry,
  LocationPunch,
  ReimbursementClaim,
  SalesmanDashboardData,
  User,
} from './types';

const TOKEN_STORAGE_KEY = 'fieldpulse_session_token';

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage issues in restricted browsers
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  setupStatus() {
    return request<{ needsSetup: boolean }>('/api/auth/setup-status');
  },
  setupAdmin(payload: { name: string; phone: string; pin: string }) {
    return request<{ token: string; user: User }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  login(identifier: string, pin: string) {
    return request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, phone: identifier, pin }),
    });
  },
  me() {
    return request<{ user: User }>('/api/auth/me');
  },
  salesmanDashboard(monthKey: string, userId?: number) {
    const qs = new URLSearchParams({ month: monthKey });
    if (userId) qs.set('userId', String(userId));
    return request<SalesmanDashboardData>(`/api/salesman/dashboard?${qs.toString()}`);
  },
  punchLocation(payload: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    place_name: string;
    address: string;
    note?: string;
    punch_type?: 'checkin' | 'trip_entry';
  }) {
    return request<{ punch: LocationPunch }>('/api/location/punch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  createExpense(payload: {
    expense_date: string;
    place: string;
    departure: string;
    arrival: string;
    fare: number;
    da: number;
    conveyance: number;
    night_stay: number;
    paid_by: 'office' | 'self';
    remarks: string;
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number | null;
    gps_place?: string;
    gps_punched_at?: string | null;
    user_id?: number;
  }) {
    return request<{ expense: ExpenseEntry }>('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateExpense(
    id: number,
    payload: Partial<{
      expense_date: string;
      place: string;
      departure: string;
      arrival: string;
      fare: number;
      da: number;
      conveyance: number;
      night_stay: number;
      paid_by: 'office' | 'self';
      remarks: string;
    }>,
  ) {
    return request<{ expense: ExpenseEntry }>(`/api/expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  deleteExpense(id: number) {
    return request<{ deleted: boolean; id: number }>(`/api/expenses/${id}`, {
      method: 'DELETE',
    });
  },
  submitClaim(payload: {
    claim_date: string;
    month_key: string;
    amount: number;
    reason: string;
  }) {
    return request<{ claim: ReimbursementClaim }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  addAdvance(payload: {
    advance_date: string;
    amount: number;
    mode: string;
    reference: string;
    note: string;
  }) {
    return request<{ advance: AdvanceEntry }>('/api/advances', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  deleteOwnAdvance(id: number) {
    return request<{ deleted: boolean; id: number }>(`/api/advances/${id}`, {
      method: 'DELETE',
    });
  },
  adminOverview(monthKey: string) {
    return request<AdminOverviewData>(`/api/admin/overview?month=${encodeURIComponent(monthKey)}`);
  },
  giveAdvance(payload: {
    user_id: number;
    advance_date: string;
    amount: number;
    mode: string;
    reference: string;
    note: string;
  }) {
    return request<{ advance: AdvanceEntry }>('/api/admin/advances', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  deleteAdvance(id: number) {
    return request<{ deleted: boolean; id: number }>(`/api/admin/advances/${id}`, {
      method: 'DELETE',
    });
  },
  updateClaimStatus(
    id: number,
    payload: {
      status: 'approved' | 'paid' | 'rejected' | 'pending';
      admin_note?: string;
      payout_mode?: string;
      payout_ref?: string;
    },
  ) {
    return request<{ claim: ReimbursementClaim }>(`/api/admin/claims/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  deleteClaim(id: number) {
    return request<{ deleted: boolean; id: number }>(`/api/admin/claims/${id}`, {
      method: 'DELETE',
    });
  },
  deletePunch(id: number) {
    return request<{ deleted: boolean; id: number }>(`/api/admin/punches/${id}`, {
      method: 'DELETE',
    });
  },
  createSalesman(payload: { name: string; phone: string; territory: string; pin: string }) {
    return request<{ user: User }>('/api/admin/salesmen', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateSalesman(
    id: number,
    payload: Partial<{ name: string; territory: string; active: boolean; pin: string }>,
  ) {
    return request<{ user: User }>(`/api/admin/salesmen/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};
