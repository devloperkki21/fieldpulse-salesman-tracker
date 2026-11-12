import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  Download,
  ExternalLink,
  IndianRupee,
  LogOut,
  MapPin,
  Plus,
  Receipt,
  RefreshCw,
  Table2,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { AdminOverviewData, ExpenseEntry, User } from '../types';
import {
  downloadExpensesCsv,
  formatINR,
  formatMonthLabel,
  formatRelativeTime,
  formatShortDate,
  formatSignedINR,
  formatTimeClock,
  getCurrentMonthKey,
  getTodayDateStr,
} from '../utils/format';
import { buildGoogleMapsUrl, formatCoords } from '../utils/geo';
import { LiveMap, type MapMarkerItem } from './LiveMap';
import { MonthSelector } from './MonthSelector';
import { MonthlyChart } from './MonthlyChart';

interface AdminDashboardProps {
  user: User;
  onLogout: () => void;
}

type AdminTab = 'live' | 'ledger' | 'finance' | 'team';

export function AdminDashboard({ user, onLogout }: AdminDashboardProps) {
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
  const [activeTab, setActiveTab] = useState<AdminTab>('live');
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Live map focus
  const [focusedSalesmanId, setFocusedSalesmanId] = useState<number | null>(null);

  // Ledger filter
  const [selectedSalesmanId, setSelectedSalesmanId] = useState<number | 'all'>('all');

  // Give advance form
  const [advUserId, setAdvUserId] = useState<string>('');
  const [advDate, setAdvDate] = useState(getTodayDateStr());
  const [advAmount, setAdvAmount] = useState('');
  const [advMode, setAdvMode] = useState('UPI');
  const [advRef, setAdvRef] = useState('');
  const [advNote, setAdvNote] = useState('');
  const [advSaving, setAdvSaving] = useState(false);
  const [advMsg, setAdvMsg] = useState('');

  // Claim settlement modal state
  const [settlingClaimId, setSettlingClaimId] = useState<number | null>(null);
  const [payoutMode, setPayoutMode] = useState('UPI');
  const [payoutRef, setPayoutRef] = useState('');
  const [adminNote, setAdminNote] = useState('');

  // Add salesman form
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newTerritory, setNewTerritory] = useState('');
  const [newPin, setNewPin] = useState('');
  const [teamMsg, setTeamMsg] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.adminOverview(monthKey);
      setOverview(res);
      setAdvUserId((prev) => {
        if (prev) return prev;
        const firstActive = res.salesmen.find((s) => s.user.active) || res.salesmen[0];
        return firstActive ? String(firstActive.user.id) : '';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin overview');
    } finally {
      setLoading(false);
    }
  }, [monthKey]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const mapMarkers: MapMarkerItem[] = useMemo(() => {
    if (!overview) return [];
    return overview.salesmen
      .filter((s) => s.latestPunch !== null)
      .map((s) => ({
        id: s.user.id,
        name: s.user.name,
        territory: s.user.territory,
        latitude: s.latestPunch!.latitude,
        longitude: s.latestPunch!.longitude,
        place_name: s.latestPunch!.place_name,
        punched_at: s.latestPunch!.punched_at,
        accuracy: s.latestPunch!.accuracy,
      }));
  }, [overview]);

  const filteredExpenses: Array<ExpenseEntry & { salesmanName: string }> = useMemo(() => {
    if (!overview) return [];
    const list: Array<ExpenseEntry & { salesmanName: string }> = [];
    for (const s of overview.salesmen) {
      if (selectedSalesmanId !== 'all' && s.user.id !== selectedSalesmanId) continue;
      for (const e of s.expenses) {
        list.push({ ...e, salesmanName: s.user.name });
      }
    }
    return list.sort((a, b) => {
      if (a.expense_date !== b.expense_date) return b.expense_date.localeCompare(a.expense_date);
      return b.id - a.id;
    });
  }, [overview, selectedSalesmanId]);

  const ledgerTotals = useMemo(() => {
    return filteredExpenses.reduce(
      (acc, e) => {
        acc.fare += e.fare;
        acc.da += e.da;
        acc.conveyance += e.conveyance;
        acc.nightStay += e.night_stay;
        acc.total += e.total;
        return acc;
      },
      { fare: 0, da: 0, conveyance: 0, nightStay: 0, total: 0 },
    );
  }, [filteredExpenses]);

  const allMonthAdvances = useMemo(() => {
    if (!overview) return [];
    return overview.salesmen
      .flatMap((s) => s.advances.map((a) => ({ ...a, salesmanName: s.user.name })))
      .sort((a, b) => b.advance_date.localeCompare(a.advance_date) || b.id - a.id);
  }, [overview]);

  async function handleGiveAdvance(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(advAmount);
    if (!advUserId || !Number.isFinite(amount) || amount <= 0) {
      setAdvMsg('Select salesman and enter a valid amount.');
      return;
    }
    setAdvSaving(true);
    setAdvMsg('');
    try {
      await api.giveAdvance({
        user_id: Number(advUserId),
        advance_date: advDate,
        amount,
        mode: advMode,
        reference: advRef.trim(),
        note: advNote.trim() || 'Office advance',
      });
      setAdvAmount('');
      setAdvRef('');
      setAdvNote('');
      setAdvMsg('Advance recorded & live balance updated.');
      await loadOverview();
    } catch (err) {
      setAdvMsg(err instanceof Error ? err.message : 'Failed to record advance');
    } finally {
      setAdvSaving(false);
    }
  }

  async function handleDeleteAdvance(id: number) {
    if (!window.confirm('Remove this advance record?')) return;
    await api.deleteAdvance(id);
    await loadOverview();
  }

  async function handleDeleteExpense(id: number) {
    if (!window.confirm('Delete this expense entry? Running balance will recalculate.')) return;
    await api.deleteExpense(id);
    await loadOverview();
  }

  async function handleDeletePunch(id: number) {
    if (!window.confirm('Delete this GPS location punch entry?')) return;
    await api.deletePunch(id);
    await loadOverview();
  }

  async function handleDeleteClaim(id: number) {
    if (!window.confirm('Delete this reimbursement claim entry?')) return;
    await api.deleteClaim(id);
    await loadOverview();
  }

  async function handleClaimAction(
    claimId: number,
    status: 'approved' | 'paid' | 'rejected',
  ) {
    await api.updateClaimStatus(claimId, {
      status,
      admin_note: adminNote.trim(),
      payout_mode: status === 'paid' ? payoutMode : '',
      payout_ref: status === 'paid' ? payoutRef.trim() : '',
    });
    setSettlingClaimId(null);
    setPayoutRef('');
    setAdminNote('');
    await loadOverview();
  }

  async function handleAddSalesman(e: React.FormEvent) {
    e.preventDefault();
    setTeamMsg('');
    try {
      await api.createSalesman({
        name: newName.trim(),
        phone: newPhone.trim(),
        territory: newTerritory.trim(),
        pin: newPin.trim(),
      });
      setNewName('');
      setNewPhone('');
      setNewTerritory('');
      setNewPin('');
      setTeamMsg('Salesman account created.');
      await loadOverview();
    } catch (err) {
      setTeamMsg(err instanceof Error ? err.message : 'Could not add salesman');
    }
  }

  async function handleToggleSalesman(id: number, active: boolean) {
    await api.updateSalesman(id, { active: !active });
    await loadOverview();
  }

  const summary = overview?.summary;

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-12">
      {/* Top Admin Command Header */}
      <header className="sticky top-0 z-30 border-b border-[#E5E3DC] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#111315] text-xs font-bold text-white">
              FP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-[#111315]">
                  Admin Control Center
                </h1>
                <span className="rounded-full bg-[#0D9488]/12 px-2 py-0.5 text-[10px] font-bold text-[#0F766E]">
                  {summary?.activeSalesmen ?? 0} Active
                </span>
              </div>
              <p className="text-[11px] text-[#5D646E]">Signed in as {user.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <MonthSelector monthKey={monthKey} onChange={setMonthKey} compact />
            <button
              type="button"
              onClick={() => void loadOverview()}
              aria-label="Refresh"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E5E3DC] bg-white text-[#5D646E] hover:text-[#111315]"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Logout"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E5E3DC] bg-white text-[#5D646E] hover:text-[#111315]"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {[
            { id: 'live' as const, label: 'Live Locations', icon: MapPin },
            { id: 'ledger' as const, label: 'Monthly Table', icon: Table2 },
            {
              id: 'finance' as const,
              label: `Advances & Claims${summary?.pendingClaimsCount ? ` (${summary.pendingClaimsCount})` : ''}`,
              icon: Receipt,
            },
            { id: 'team' as const, label: 'Monthly Chart & Team', icon: BarChart3 },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[#111315] text-white'
                    : 'text-[#5D646E] hover:bg-[#F3F2ED] hover:text-[#111315]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 pt-5">
        {error && (
          <div className="rounded-2xl border border-[#C2410C]/30 bg-[#FFF7ED] px-4 py-3 text-xs font-medium text-[#C2410C]">
            {error}
          </div>
        )}

        {/* Top KPI Strip */}
        {summary && (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-[#E5E3DC] bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
                Office Advances ({formatMonthLabel(monthKey, true)})
              </p>
              <p className="font-mono-num mt-1.5 text-xl font-bold text-[#0F766E]">
                {formatINR(summary.monthAdvance)}
              </p>
              <p className="mt-0.5 text-[11px] text-[#5D646E]">Issued to field staff</p>
            </div>

            <div className="rounded-2xl border border-[#E5E3DC] bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
                Total Field Spend
              </p>
              <p className="font-mono-num mt-1.5 text-xl font-bold text-[#111315]">
                {formatINR(summary.monthSpent)}
              </p>
              <p className="mt-0.5 text-[11px] text-[#5D646E]">
                Across {summary.totalTrips} logged trips
              </p>
            </div>

            <div className="rounded-2xl border border-[#E5E3DC] bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
                Cash In Hand (Live)
              </p>
              <p className="font-mono-num mt-1.5 text-xl font-bold text-[#111315]">
                {formatINR(summary.totalCashInHand)}
              </p>
              <p className="mt-0.5 text-[11px] text-[#5D646E]">Unspent office advance</p>
            </div>

            <div className="rounded-2xl border border-[#E5E3DC] bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
                Reimbursement Payable
              </p>
              <p className="font-mono-num mt-1.5 text-xl font-bold text-[#C2410C]">
                {formatINR(summary.totalOutOfPocket)}
              </p>
              <p className="mt-0.5 text-[11px] text-[#5D646E]">
                {summary.pendingClaimsCount} active claim(s) · {formatINR(summary.pendingClaimsAmount)}
              </p>
            </div>
          </section>
        )}

        {/* TAB 1: LIVE LOCATIONS */}
        {activeTab === 'live' && overview && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-3">
              <LiveMap markers={mapMarkers} focusId={focusedSalesmanId} heightClass="h-72 sm:h-96" />

              {/* Recent Punch Timeline */}
              <section className="rounded-3xl border border-[#E5E3DC] bg-white p-4">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#5D646E]">
                  Live Punch Feed
                </h2>
                <div className="divide-y divide-[#E5E3DC]">
                  {overview.recentPunches.slice(0, 8).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-[#111315]">
                          {p.user_name}{' '}
                          <span className="font-normal text-[#5D646E]">
                            · {p.place_name || formatCoords(p.latitude, p.longitude)}
                          </span>
                        </p>
                        <p className="truncate text-[11px] text-[#5D646E]">
                          {p.note || 'GPS Check-in'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="font-mono-num text-[11px] text-[#5D646E]">
                          {formatTimeClock(p.punched_at)}
                        </span>
                        <a
                          href={buildGoogleMapsUrl(p.latitude, p.longitude)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-[#E5E3DC] px-2 py-1 text-[11px] font-semibold text-[#111315] hover:bg-[#F3F2ED]"
                        >
                          Map
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleDeletePunch(p.id)}
                          aria-label="Delete GPS punch"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#5D646E] hover:bg-[#FFF7ED] hover:text-[#C2410C]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Salesman Live Status Cards */}
            <div className="space-y-3 lg:col-span-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#5D646E]">
                Salesman Live Status ({overview.salesmen.length})
              </h2>
              {overview.salesmen.map((item) => {
                const punch = item.latestPunch;
                const isDue = item.live.liveBalance < 0;
                const isFocused = focusedSalesmanId === item.user.id;

                return (
                  <div
                    key={item.user.id}
                    className={`rounded-3xl border bg-white p-4 transition-colors ${
                      isFocused ? 'border-[#0D9488] ring-1 ring-[#0D9488]/30' : 'border-[#E5E3DC]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              punch ? 'bg-[#0D9488]' : 'bg-[#D0CDC3]'
                            }`}
                          />
                          <h3 className="text-sm font-bold text-[#111315]">
                            {item.user.name}
                          </h3>
                        </div>
                        <p className="text-xs text-[#5D646E]">
                          {item.user.territory || 'General'} · {item.user.phone}
                        </p>
                      </div>
                      <span
                        className={`font-mono-num rounded-xl px-2.5 py-1 text-xs font-bold ${
                          isDue
                            ? 'bg-[#FFF7ED] text-[#C2410C]'
                            : 'bg-[#0D9488]/10 text-[#0F766E]'
                        }`}
                      >
                        {formatSignedINR(item.live.liveBalance)}
                      </span>
                    </div>

                    {punch ? (
                      <div className="mt-3 rounded-2xl bg-[#FAFAF8] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-xs font-semibold text-[#111315]">
                            <MapPin className="h-3.5 w-3.5 text-[#0D9488]" />
                            {punch.place_name || formatCoords(punch.latitude, punch.longitude)}
                          </span>
                          <span className="text-[11px] font-medium text-[#0F766E]">
                            {formatRelativeTime(punch.punched_at)}
                          </span>
                        </div>
                        <p className="font-mono-num mt-1 text-[11px] text-[#5D646E]">
                          {formatCoords(punch.latitude, punch.longitude)}
                          {punch.accuracy ? ` · ±${punch.accuracy}m` : ''}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-3 rounded-2xl bg-[#FAFAF8] px-3 py-2 text-xs text-[#5D646E]">
                        No location punched yet
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {punch && (
                        <>
                          <button
                            type="button"
                            onClick={() => setFocusedSalesmanId(item.user.id)}
                            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#E5E3DC] bg-white px-3 text-xs font-semibold text-[#111315] hover:bg-[#F3F2ED]"
                          >
                            Focus Pin
                          </button>
                          <a
                            href={buildGoogleMapsUrl(punch.latitude, punch.longitude)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#E5E3DC] bg-white px-3 text-xs font-semibold text-[#111315] hover:bg-[#F3F2ED]"
                          >
                            Google Maps
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSalesmanId(item.user.id);
                          setActiveTab('ledger');
                        }}
                        className="inline-flex h-9 items-center gap-1 rounded-xl bg-[#111315] px-3 text-xs font-semibold text-white"
                      >
                        Ledger
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAdvUserId(String(item.user.id));
                          setActiveTab('finance');
                        }}
                        className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#0D9488]/40 bg-[#0D9488]/10 px-3 text-xs font-semibold text-[#0F766E] hover:bg-[#0D9488]/15"
                      >
                        + Advance
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: MONTHLY LEDGER TABLE */}
        {activeTab === 'ledger' && overview && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedSalesmanId}
                  onChange={(e) =>
                    setSelectedSalesmanId(
                      e.target.value === 'all' ? 'all' : Number(e.target.value),
                    )
                  }
                  className="h-10 rounded-xl border border-[#E5E3DC] bg-white px-3 text-xs font-semibold text-[#111315] outline-none"
                >
                  <option value="all">All Salesmen ({overview.salesmen.length})</option>
                  {overview.salesmen.map((s) => (
                    <option key={s.user.id} value={s.user.id}>
                      {s.user.name} ({formatSignedINR(s.live.liveBalance)})
                    </option>
                  ))}
                </select>
                <span className="text-xs text-[#5D646E]">
                  Showing {filteredExpenses.length} entries in {formatMonthLabel(monthKey)}
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  downloadExpensesCsv({
                    filename: `Admin_${monthKey}_Salesman_Ledger.csv`,
                    expenses: filteredExpenses,
                  })
                }
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#111315] px-3.5 text-xs font-semibold text-white"
              >
                <Download className="h-3.5 w-3.5" />
                Export Monthly CSV
              </button>
            </div>

            {selectedSalesmanId !== 'all' && (() => {
              const chosen = overview.salesmen.find((s) => s.user.id === selectedSalesmanId);
              if (!chosen) return null;
              return (
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#E5E3DC] bg-white p-3 sm:grid-cols-5">
                  <div>
                    <span className="block text-[10px] font-semibold uppercase text-[#5D646E]">
                      Opening Bal
                    </span>
                    <span className="font-mono-num text-xs font-bold text-[#111315]">
                      {formatSignedINR(chosen.openingBalance)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-semibold uppercase text-[#5D646E]">
                      Month Advance
                    </span>
                    <span className="font-mono-num text-xs font-bold text-[#0F766E]">
                      +{formatINR(chosen.month.advance)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-semibold uppercase text-[#5D646E]">
                      Month Spent
                    </span>
                    <span className="font-mono-num text-xs font-bold text-[#111315]">
                      -{formatINR(chosen.month.totalExpenses)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-semibold uppercase text-[#5D646E]">
                      Reimbursed
                    </span>
                    <span className="font-mono-num text-xs font-bold text-[#0F766E]">
                      +{formatINR(chosen.month.paidClaims)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-semibold uppercase text-[#5D646E]">
                      Live Balance
                    </span>
                    <span
                      className={`font-mono-num text-xs font-bold ${
                        chosen.live.liveBalance < 0 ? 'text-[#C2410C]' : 'text-[#0F766E]'
                      }`}
                    >
                      {formatSignedINR(chosen.live.liveBalance)}
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="overflow-hidden rounded-3xl border border-[#E5E3DC] bg-white">
              <div className="ledger-scroll overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E5E3DC] bg-[#FAFAF8] text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
                      <th className="sticky left-0 z-10 bg-[#FAFAF8] px-3.5 py-3">Date / Salesman</th>
                      <th className="px-3 py-3">Place</th>
                      <th className="px-3 py-3">Departure</th>
                      <th className="px-3 py-3">Arrival</th>
                      <th className="px-3 py-3 text-right">Fare</th>
                      <th className="px-3 py-3 text-right">DA</th>
                      <th className="px-3 py-3 text-right">Conveyance</th>
                      <th className="px-3 py-3 text-right">Night Stay</th>
                      <th className="px-3 py-3 text-right">Total</th>
                      <th className="px-3 py-3 text-right">Run. Bal</th>
                      <th className="px-3 py-3 text-center">GPS</th>
                      <th className="px-3 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E3DC]">
                    {filteredExpenses.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-4 py-8 text-center text-xs text-[#5D646E]">
                          No expense entries found for this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredExpenses.map((row) => (
                        <tr key={row.id} className="hover:bg-[#FAFAF8]">
                          <td className="sticky left-0 z-10 bg-white px-3.5 py-3">
                            <div className="font-semibold text-[#111315]">{row.salesmanName}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#5D646E]">
                              <span>{formatShortDate(row.expense_date)}</span>
                              {row.paid_by === 'self' ? (
                                <span className="rounded bg-[#FFF7ED] px-1.5 py-0.5 text-[10px] font-semibold text-[#C2410C]">
                                  Own Pocket
                                </span>
                              ) : (
                                <span className="rounded bg-[#0D9488]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#0F766E]">
                                  Office
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 font-medium text-[#111315]">
                            <div>{row.place}</div>
                            {row.remarks && (
                              <div className="max-w-[200px] truncate text-[11px] text-[#5D646E]">
                                {row.remarks}
                              </div>
                            )}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-[#111315]">
                            {row.departure || '—'}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-[#111315]">
                            {row.arrival || '—'}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right">{formatINR(row.fare)}</td>
                          <td className="font-mono-num px-3 py-3 text-right">{formatINR(row.da)}</td>
                          <td className="font-mono-num px-3 py-3 text-right">{formatINR(row.conveyance)}</td>
                          <td className="font-mono-num px-3 py-3 text-right">{formatINR(row.night_stay)}</td>
                          <td className="font-mono-num px-3 py-3 text-right font-bold text-[#111315]">
                            {formatINR(row.total)}
                          </td>
                          <td
                            className={`font-mono-num px-3 py-3 text-right font-semibold ${
                              (row.running_balance ?? 0) < 0 ? 'text-[#C2410C]' : 'text-[#0F766E]'
                            }`}
                          >
                            {formatSignedINR(row.running_balance ?? 0)}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {row.latitude !== null && row.longitude !== null ? (
                              <a
                                href={buildGoogleMapsUrl(row.latitude, row.longitude)}
                                target="_blank"
                                rel="noreferrer"
                                title={row.gps_place || formatCoords(row.latitude, row.longitude)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#0D9488]/10 text-[#0F766E]"
                              >
                                <MapPin className="h-3.5 w-3.5" />
                              </a>
                            ) : (
                              <span className="text-[#5D646E]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => void handleDeleteExpense(row.id)}
                              aria-label="Delete expense entry"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5D646E] hover:bg-[#FFF7ED] hover:text-[#C2410C]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {filteredExpenses.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-[#E5E3DC] bg-[#FAFAF8] font-bold text-[#111315]">
                        <td className="sticky left-0 z-10 bg-[#FAFAF8] px-3.5 py-3">
                          Totals ({filteredExpenses.length})
                        </td>
                        <td colSpan={3} />
                        <td className="font-mono-num px-3 py-3 text-right">{formatINR(ledgerTotals.fare)}</td>
                        <td className="font-mono-num px-3 py-3 text-right">{formatINR(ledgerTotals.da)}</td>
                        <td className="font-mono-num px-3 py-3 text-right">{formatINR(ledgerTotals.conveyance)}</td>
                        <td className="font-mono-num px-3 py-3 text-right">{formatINR(ledgerTotals.nightStay)}</td>
                        <td className="font-mono-num px-3 py-3 text-right text-sm">{formatINR(ledgerTotals.total)}</td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </section>
        )}

        {/* TAB 3: OFFICE ADVANCES & REIMBURSEMENT CLAIMS */}
        {activeTab === 'finance' && overview && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Issue Office Advance */}
            <div className="space-y-4">
              <section className="rounded-3xl border border-[#E5E3DC] bg-white p-5">
                <div className="flex items-center gap-2">
                  <IndianRupee className="h-4 w-4 text-[#0D9488]" />
                  <h2 className="text-sm font-bold text-[#111315]">
                    Give Office Advance to Salesman
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-[#5D646E]">
                  Immediately credits the salesman&apos;s live running balance.
                </p>

                <form onSubmit={handleGiveAdvance} className="mt-4 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                        Salesman
                      </label>
                      <select
                        value={advUserId}
                        onChange={(e) => setAdvUserId(e.target.value)}
                        className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm font-medium text-[#111315] outline-none"
                      >
                        {overview.salesmen.map((s) => (
                          <option key={s.user.id} value={s.user.id}>
                            {s.user.name} ({formatSignedINR(s.live.liveBalance)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                        Advance Date
                      </label>
                      <input
                        type="date"
                        value={advDate}
                        onChange={(e) => setAdvDate(e.target.value)}
                        required
                        className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm text-[#111315] outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                        Amount (₹)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="1"
                        step="any"
                        value={advAmount}
                        onChange={(e) => setAdvAmount(e.target.value)}
                        placeholder="5000"
                        required
                        className="font-mono-num h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm font-semibold text-[#111315] outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                        Mode
                      </label>
                      <select
                        value={advMode}
                        onChange={(e) => setAdvMode(e.target.value)}
                        className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm text-[#111315] outline-none"
                      >
                        <option value="UPI">UPI</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Cash">Cash</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      value={advRef}
                      onChange={(e) => setAdvRef(e.target.value)}
                      placeholder="UTR / Ref (Optional)"
                      className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm text-[#111315] outline-none"
                    />
                    <input
                      type="text"
                      value={advNote}
                      onChange={(e) => setAdvNote(e.target.value)}
                      placeholder="Note (e.g. Rajasthan tour)"
                      className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm text-[#111315] outline-none"
                    />
                  </div>

                  {advMsg && (
                    <p className="rounded-xl bg-[#0D9488]/10 px-3 py-2 text-xs font-medium text-[#0F766E]">
                      {advMsg}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={advSaving}
                    className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#0D9488] text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" />
                    {advSaving ? 'Saving...' : 'Issue Office Advance'}
                  </button>
                </form>
              </section>

              {/* Month's Issued Advances */}
              <section className="rounded-3xl border border-[#E5E3DC] bg-white p-4">
                <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[#5D646E]">
                  Advances Issued in {formatMonthLabel(monthKey, true)}
                </h3>
                {allMonthAdvances.length ? (
                  <div className="divide-y divide-[#E5E3DC]">
                    {allMonthAdvances.map((adv) => (
                      <div key={adv.id} className="flex items-center justify-between gap-2 py-2.5">
                        <div>
                          <p className="text-xs font-bold text-[#111315]">
                            {adv.salesmanName}{' '}
                            <span className="font-normal text-[#5D646E]">· {adv.mode}</span>
                          </p>
                          <p className="text-[11px] text-[#5D646E]">
                            {formatShortDate(adv.advance_date)}
                            {adv.note ? ` · ${adv.note}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono-num text-xs font-bold text-[#0F766E]">
                            {formatINR(adv.amount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleDeleteAdvance(adv.id)}
                            aria-label="Delete advance"
                            className="rounded-lg p-1.5 text-[#5D646E] hover:bg-[#FFF7ED] hover:text-[#C2410C]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-3 text-xs text-[#5D646E]">No advances in this month.</p>
                )}
              </section>
            </div>

            {/* Reimbursement Claims Approval & Payout Queue */}
            <section className="rounded-3xl border border-[#E5E3DC] bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-[#111315]">
                    Reimbursement Claims Queue
                  </h2>
                  <p className="text-xs text-[#5D646E]">
                    Approve &amp; settle claims when salesmen spend from their own pocket.
                  </p>
                </div>
              </div>

              {overview.claims.length === 0 ? (
                <p className="py-8 text-center text-xs text-[#5D646E]">
                  No reimbursement claims submitted yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {overview.claims.map((claim) => {
                    const isSettling = settlingClaimId === claim.id;
                    return (
                      <div
                        key={claim.id}
                        className="rounded-2xl border border-[#E5E3DC] bg-[#FAFAF8] p-3.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-[#111315]">
                                {claim.user_name}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                  claim.status === 'paid'
                                    ? 'bg-[#0D9488]/12 text-[#0F766E]'
                                    : claim.status === 'approved'
                                      ? 'bg-[#111315] text-white'
                                      : claim.status === 'rejected'
                                        ? 'bg-[#FFF7ED] text-[#C2410C]'
                                        : 'bg-white text-[#B45309] ring-1 ring-[#B45309]/30'
                                }`}
                              >
                                {claim.status}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-[#5D646E]">
                              {claim.reason || 'Out-of-pocket claim'}
                            </p>
                            <p className="text-[11px] text-[#5D646E]">
                              {formatShortDate(claim.claim_date)} · Month {claim.month_key}
                              {claim.payout_ref ? ` · Ref: ${claim.payout_ref}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono-num text-base font-bold text-[#111315]">
                              {formatINR(claim.amount)}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleDeleteClaim(claim.id)}
                              aria-label="Delete claim"
                              className="rounded-lg p-1.5 text-[#5D646E] hover:bg-[#FFF7ED] hover:text-[#C2410C]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {(claim.status === 'pending' || claim.status === 'approved') && (
                          <div className="mt-3 border-t border-[#E5E3DC] pt-3">
                            {!isSettling ? (
                              <div className="flex flex-wrap gap-2">
                                {claim.status === 'pending' && (
                                  <button
                                    type="button"
                                    onClick={() => void handleClaimAction(claim.id, 'approved')}
                                    className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#E5E3DC] bg-white px-3 text-xs font-semibold text-[#111315] hover:bg-[#F3F2ED]"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    Approve
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSettlingClaimId(claim.id);
                                    setPayoutMode('UPI');
                                    setPayoutRef('');
                                    setAdminNote('');
                                  }}
                                  className="inline-flex h-9 items-center gap-1 rounded-xl bg-[#0D9488] px-3 text-xs font-semibold text-white hover:bg-[#0F766E]"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Mark Paid &amp; Settle
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleClaimAction(claim.id, 'rejected')}
                                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#C2410C]/30 bg-white px-3 text-xs font-semibold text-[#C2410C]"
                                >
                                  <X className="h-3.5 w-3.5" />
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2 rounded-xl bg-white p-3">
                                <div className="grid grid-cols-2 gap-2">
                                  <select
                                    value={payoutMode}
                                    onChange={(e) => setPayoutMode(e.target.value)}
                                    className="h-9 rounded-lg border border-[#E5E3DC] px-2 text-xs"
                                  >
                                    <option value="UPI">UPI</option>
                                    <option value="Bank Transfer">Bank Transfer</option>
                                    <option value="Cash">Cash</option>
                                  </select>
                                  <input
                                    type="text"
                                    value={payoutRef}
                                    onChange={(e) => setPayoutRef(e.target.value)}
                                    placeholder="Payout UTR / Ref"
                                    className="h-9 rounded-lg border border-[#E5E3DC] px-2.5 text-xs"
                                  />
                                </div>
                                <input
                                  type="text"
                                  value={adminNote}
                                  onChange={(e) => setAdminNote(e.target.value)}
                                  placeholder="Optional settlement note"
                                  className="h-9 w-full rounded-lg border border-[#E5E3DC] px-2.5 text-xs"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleClaimAction(claim.id, 'paid')}
                                    className="h-9 flex-1 rounded-lg bg-[#0D9488] text-xs font-bold text-white"
                                  >
                                    Confirm Payout
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSettlingClaimId(null)}
                                    className="h-9 rounded-lg border border-[#E5E3DC] px-3 text-xs font-semibold text-[#5D646E]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: MONTHLY CHARTS & TEAM MANAGEMENT */}
        {activeTab === 'team' && overview && summary && (
          <div className="space-y-5">
            <MonthlyChart
              series={overview.monthlySeries}
              selectedMonthKey={monthKey}
              onSelectMonth={setMonthKey}
              fare={summary.monthFare}
              da={summary.monthDa}
              conveyance={summary.monthConveyance}
              nightStay={summary.monthNightStay}
            />

            {/* Per-Salesman Monthly Summary Table */}
            <section className="overflow-hidden rounded-3xl border border-[#E5E3DC] bg-white">
              <div className="border-b border-[#E5E3DC] px-5 py-3.5">
                <h2 className="text-sm font-bold text-[#111315]">
                  Salesman-Wise Monthly Summary ({formatMonthLabel(monthKey)})
                </h2>
              </div>
              <div className="ledger-scroll overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#E5E3DC] bg-[#FAFAF8] text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
                      <th className="px-4 py-3">Salesman</th>
                      <th className="px-3 py-3 text-right">Trips</th>
                      <th className="px-3 py-3 text-right">Office Advance</th>
                      <th className="px-3 py-3 text-right">Spent</th>
                      <th className="px-3 py-3 text-right">Live Balance</th>
                      <th className="px-4 py-3 text-right">Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E3DC]">
                    {overview.salesmen.map((s) => (
                      <tr key={s.user.id}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#111315]">{s.user.name}</div>
                          <div className="text-[11px] text-[#5D646E]">
                            {s.user.territory || 'Field'} · {s.user.phone}
                          </div>
                        </td>
                        <td className="font-mono-num px-3 py-3 text-right">{s.month.tripCount}</td>
                        <td className="font-mono-num px-3 py-3 text-right text-[#0F766E]">
                          {formatINR(s.month.advance)}
                        </td>
                        <td className="font-mono-num px-3 py-3 text-right font-semibold">
                          {formatINR(s.month.totalExpenses)}
                        </td>
                        <td
                          className={`font-mono-num px-3 py-3 text-right font-bold ${
                            s.live.liveBalance < 0 ? 'text-[#C2410C]' : 'text-[#0F766E]'
                          }`}
                        >
                          {formatSignedINR(s.live.liveBalance)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleToggleSalesman(s.user.id, s.user.active)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                              s.user.active
                                ? 'bg-[#0D9488]/10 text-[#0F766E]'
                                : 'bg-[#F3F2ED] text-[#5D646E]'
                            }`}
                          >
                            {s.user.active ? 'Active' : 'Disabled'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Add New Salesman */}
            <section className="rounded-3xl border border-[#E5E3DC] bg-white p-5">
              <div className="mb-3 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[#111315]" />
                <h2 className="text-sm font-bold text-[#111315]">Add New Salesman</h2>
              </div>

              <form onSubmit={handleAddSalesman} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full Name"
                  required
                  className="h-11 rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm outline-none focus:border-[#111315] focus:bg-white"
                />
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Mobile / Login ID"
                  required
                  className="font-mono-num h-11 rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm outline-none focus:border-[#111315] focus:bg-white"
                />
                <input
                  type="text"
                  value={newTerritory}
                  onChange={(e) => setNewTerritory(e.target.value)}
                  placeholder="Territory (e.g. Pune)"
                  className="h-11 rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm outline-none focus:border-[#111315] focus:bg-white"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="4-digit PIN"
                  minLength={4}
                  required
                  className="font-mono-num h-11 rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm outline-none focus:border-[#111315] focus:bg-white"
                />
                <button
                  type="submit"
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#111315] px-4 text-xs font-bold text-white hover:bg-black"
                >
                  <Users className="h-4 w-4" />
                  Create Account
                </button>
              </form>
              {teamMsg && <p className="mt-2.5 text-xs font-medium text-[#0F766E]">{teamMsg}</p>}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

