import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Crosshair,
  Download,
  ExternalLink,
  IndianRupee,
  LayoutGrid,
  Loader2,
  LogOut,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Table2,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { ExpenseEntry, SalesmanDashboardData, User } from '../types';
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
import {
  buildGoogleMapsUrl,
  captureBrowserLocation,
  formatCoords,
  getGeoPermissionState,
  type GeoPermissionState,
} from '../utils/geo';
import { ExpenseFormModal } from './ExpenseFormModal';
import { MonthSelector } from './MonthSelector';
import { MonthlyChart } from './MonthlyChart';

interface SalesmanDashboardProps {
  user: User;
  onLogout: () => void;
}

type SalesmanTab = 'punch' | 'table' | 'wallet' | 'chart';

export function SalesmanDashboard({ user, onLogout }: SalesmanDashboardProps) {
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
  const [activeTab, setActiveTab] = useState<SalesmanTab>('punch');
  const [tableViewMode, setTableViewMode] = useState<'table' | 'cards'>('table');

  const [data, setData] = useState<SalesmanDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // GPS Punch states
  const [geoState, setGeoState] = useState<GeoPermissionState>('prompt');
  const [livePreview, setLivePreview] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
  } | null>(null);
  const [punchNote, setPunchNote] = useState('');
  const [punching, setPunching] = useState(false);
  const [punchMsg, setPunchMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Expense modal states
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseEntry | null>(null);

  // Add Office Balance / Tour Fund modal states
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false);
  const [advDate, setAdvDate] = useState(getTodayDateStr());
  const [advAmount, setAdvAmount] = useState('');
  const [advMode, setAdvMode] = useState('Cash');
  const [advRef, setAdvRef] = useState('');
  const [advNote, setAdvNote] = useState('');
  const [advSaving, setAdvSaving] = useState(false);
  const [advError, setAdvError] = useState('');

  // Reimbursement claim form
  const [claimAmount, setClaimAmount] = useState('');
  const [claimReason, setClaimReason] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimFeedback, setClaimFeedback] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.salesmanDashboard(monthKey);
      setData(res);
      if (res.ledger.live.unclaimedOutOfPocket > 0) {
        setClaimAmount(String(res.ledger.live.unclaimedOutOfPocket));
      } else {
        setClaimAmount('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [monthKey]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    let watchId: number | null = null;
    void getGeoPermissionState().then((state) => {
      setGeoState(state);
      if (state === 'granted' && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            setLivePreview({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: Number.isFinite(pos.coords.accuracy)
                ? Math.round(pos.coords.accuracy)
                : null,
            });
          },
          () => {
            // Ignore passive watch errors; explicit punch handles errors visibly
          },
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 },
        );
      }
    });
    return () => {
      if (watchId !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  async function handleLiveLocationPunch(customNote?: string) {
    setPunching(true);
    setPunchMsg(null);
    try {
      const loc = await captureBrowserLocation();
      setGeoState('granted');
      const res = await api.punchLocation({
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        place_name: loc.place_name,
        address: loc.address,
        note: (customNote ?? punchNote).trim() || 'Live field check-in',
        punch_type: 'checkin',
      });
      setPunchNote('');
      setPunchMsg({
        type: 'ok',
        text: `Location punched: ${res.punch.place_name || formatCoords(loc.latitude, loc.longitude)}`,
      });
      await loadDashboard();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GPS punch failed';
      void getGeoPermissionState().then(setGeoState);
      setPunchMsg({ type: 'err', text: msg });
    } finally {
      setPunching(false);
    }
  }

  async function handleSaveExpense(payload: Parameters<typeof api.createExpense>[0]) {
    if (editingExpense) {
      await api.updateExpense(editingExpense.id, payload);
    } else {
      await api.createExpense(payload);
    }
    setEditingExpense(null);
    await loadDashboard();
  }

  async function handleDeleteExpense(id: number) {
    if (!window.confirm('Delete this expense row? Running balance will recalculate.')) return;
    await api.deleteExpense(id);
    await loadDashboard();
  }

  async function handleSaveAdvance(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(advAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setAdvError('Please enter a valid advance amount.');
      return;
    }
    setAdvSaving(true);
    setAdvError('');
    try {
      await api.addAdvance({
        advance_date: advDate,
        amount,
        mode: advMode,
        reference: advRef.trim(),
        note: advNote.trim() || 'Office tour advance',
      });
      setAdvAmount('');
      setAdvRef('');
      setAdvNote('');
      setAdvanceModalOpen(false);
      await loadDashboard();
    } catch (err) {
      setAdvError(err instanceof Error ? err.message : 'Failed to add office balance');
    } finally {
      setAdvSaving(false);
    }
  }

  async function handleDeleteOwnAdvance(id: number) {
    if (!window.confirm('Delete this office balance entry? Running balance will recalculate.')) return;
    await api.deleteOwnAdvance(id);
    await loadDashboard();
  }

  async function handleSubmitClaim(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(claimAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setClaimFeedback('Enter a valid reimbursement amount.');
      return;
    }
    setClaiming(true);
    setClaimFeedback('');
    try {
      await api.submitClaim({
        claim_date: getTodayDateStr(),
        month_key: monthKey,
        amount: amt,
        reason: claimReason.trim() || `Out-of-pocket reimbursement for ${formatMonthLabel(monthKey, true)}`,
      });
      setClaimReason('');
      setClaimFeedback('Reimbursement claim sent to Admin.');
      await loadDashboard();
    } catch (err) {
      setClaimFeedback(err instanceof Error ? err.message : 'Failed to submit claim');
    } finally {
      setClaiming(false);
    }
  }

  const ledger = data?.ledger;
  const live = ledger?.live;
  const month = ledger?.month;
  const latestPunch = data?.latestPunch;

  const isNegativeBalance = (live?.liveBalance ?? 0) < 0;

  return (
    <div className="min-h-screen bg-[#FAFAF8] pb-24">
      {/* Top Minimal App Bar */}
      <header className="sticky top-0 z-30 border-b border-[#E5E3DC] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-[#0D9488]" />
              <p className="truncate text-sm font-bold tracking-tight text-[#111315]">
                {user.name}
              </p>
            </div>
            <p className="truncate text-[11px] text-[#5D646E]">
              {user.territory || 'Field Sales'} · {user.phone}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <MonthSelector monthKey={monthKey} onChange={setMonthKey} compact />
            <button
              type="button"
              onClick={onLogout}
              title="Logout"
              aria-label="Logout"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E5E3DC] bg-white text-[#5D646E] transition-colors hover:bg-[#F3F2ED] hover:text-[#111315]"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 pt-4">
        {error && (
          <div className="flex items-center justify-between rounded-2xl border border-[#C2410C]/30 bg-[#FFF7ED] px-4 py-3 text-xs font-medium text-[#C2410C]">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="ml-2 underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Always-Visible Live Running Balance Ribbon */}
        {ledger && live && month && (
          <section className="rounded-3xl border border-[#E5E3DC] bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
                  Live Running Balance
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
                  <span
                    className={`font-mono-num text-3xl font-bold tracking-tight ${
                      live.outOfPocketDue > 0
                        ? 'text-[#C2410C]'
                        : isNegativeBalance
                          ? 'text-[#111315]'
                          : 'text-[#111315]'
                    }`}
                  >
                    {formatSignedINR(live.liveBalance)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      live.outOfPocketDue > 0
                        ? 'bg-[#FFF7ED] text-[#C2410C]'
                        : live.officeDeficit > 0
                          ? 'bg-[#F3F2ED] text-[#5D646E]'
                          : 'bg-[#0D9488]/12 text-[#0F766E]'
                    }`}
                  >
                    {live.outOfPocketDue > 0
                      ? 'Out-of-Pocket Due'
                      : live.officeDeficit > 0
                        ? 'Office Advance Needed'
                        : 'Cash in Hand'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdvDate(getTodayDateStr());
                    setAdvError('');
                    setAdvanceModalOpen(true);
                  }}
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-[#0D9488]/40 bg-[#0D9488]/10 px-3.5 text-xs font-semibold text-[#0F766E] transition-colors hover:bg-[#0D9488]/15 active:scale-[0.98]"
                >
                  <IndianRupee className="h-3.5 w-3.5" />
                  Add Office Balance
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingExpense(null);
                    setExpenseModalOpen(true);
                  }}
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[#111315] px-4 text-xs font-semibold text-white transition-colors hover:bg-black active:scale-[0.98]"
                >
                  <Plus className="h-4 w-4" />
                  Add Trip / Expense
                </button>
              </div>
            </div>

            {/* 3-Column Accounting Split: Office Advance | Total Spent | Reimbursed */}
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[#E5E3DC] pt-3.5">
              <div className="rounded-xl bg-[#FAFAF8] px-2.5 py-2 sm:px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5D646E]">
                  Office Advance
                </p>
                <p className="font-mono-num mt-0.5 text-sm font-bold text-[#0F766E] sm:text-base">
                  {formatINR(month.advance)}
                </p>
                <p className="text-[10px] text-[#5D646E]">
                  {formatMonthLabel(monthKey, true)}
                </p>
              </div>
              <div className="rounded-xl bg-[#FAFAF8] px-2.5 py-2 sm:px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5D646E]">
                  Total Spent
                </p>
                <p className="font-mono-num mt-0.5 text-sm font-bold text-[#111315] sm:text-base">
                  {formatINR(month.totalExpenses)}
                </p>
                <p className="text-[10px] text-[#5D646E]">
                  Office {formatINR(month.officePaidExpenses)} · Self {formatINR(month.selfPaidExpenses)}
                </p>
              </div>
              <div className="rounded-xl bg-[#FAFAF8] px-2.5 py-2 sm:px-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5D646E]">
                  Reimbursed
                </p>
                <p className="font-mono-num mt-0.5 text-sm font-bold text-[#111315] sm:text-base">
                  {formatINR(live.totalPaidClaims)}
                </p>
                <p className="text-[10px] text-[#5D646E]">
                  {live.activeClaims > 0
                    ? `${formatINR(live.activeClaims)} pending`
                    : 'All settled'}
                </p>
              </div>
            </div>

            {/* Missing Office Advance Helper Strip */}
            {live.officeDeficit > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#E5E3DC] bg-[#FAFAF8] px-3.5 py-2.5">
                <div className="text-xs text-[#111315]">
                  <span className="font-semibold">
                    {formatINR(live.officeDeficit)} spent from Office funds
                  </span>{' '}
                  without a matching Office Advance recorded yet.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAdvDate(getTodayDateStr());
                    setAdvError('');
                    setAdvanceModalOpen(true);
                  }}
                  className="rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                >
                  + Add Office Balance
                </button>
              </div>
            )}

            {/* Out-of-Pocket Reimbursement Alert Strip */}
            {live.unclaimedOutOfPocket > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#C2410C]/25 bg-[#FFF7ED] px-3.5 py-2.5">
                <div className="text-xs text-[#C2410C]">
                  <span className="font-semibold">
                    {formatINR(live.unclaimedOutOfPocket)} spent from own pocket
                  </span>{' '}
                  — ready to claim reimbursement.
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('wallet')}
                  className="rounded-lg bg-[#C2410C] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Claim Now
                </button>
              </div>
            )}
          </section>
        )}

        {/* TAB 1: LIVE LOCATION PUNCH & OVERVIEW */}
        {activeTab === 'punch' && (
          <div className="space-y-4">
            {/* Browser Geolocation Punch Card */}
            <section className="rounded-3xl border border-[#E5E3DC] bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span
                      className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                        geoState === 'denied' ? 'bg-[#C2410C]' : 'bg-[#0D9488]'
                      }`}
                    />
                  </span>
                  <h2 className="text-sm font-bold text-[#111315]">
                    Live Browser Location Punch
                  </h2>
                </div>
                <span className="rounded-full border border-[#E5E3DC] bg-[#FAFAF8] px-2.5 py-0.5 text-[11px] font-medium text-[#5D646E]">
                  {geoState === 'granted'
                    ? 'GPS Allowed'
                    : geoState === 'denied'
                      ? 'GPS Blocked'
                      : geoState === 'unsupported'
                        ? 'No GPS'
                        : 'Needs Browser Permission'}
                </span>
              </div>

              <p className="mt-1.5 text-xs text-[#5D646E]">
                Tap below to share your exact browser GPS location with Admin in real time.
              </p>
              {livePreview && (
                <p className="font-mono-num mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488]/10 px-2.5 py-1 text-[11px] font-medium text-[#0F766E]">
                  <span>Live GPS Lock: {formatCoords(livePreview.latitude, livePreview.longitude)}</span>
                  {livePreview.accuracy ? <span>· ±{livePreview.accuracy}m</span> : null}
                </p>
              )}

              {/* Quick Check-in Note + Big Thumb-Friendly Punch CTA */}
              <div className="mt-3.5 space-y-2.5">
                <input
                  type="text"
                  value={punchNote}
                  onChange={(e) => setPunchNote(e.target.value)}
                  placeholder="Optional note (e.g. Reached dealer market)"
                  className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3.5 text-sm text-[#111315] outline-none focus:border-[#111315] focus:bg-white"
                />
                <div className="flex flex-wrap gap-1.5">
                  {['Market Check-in', 'Client Visit', 'In Transit', 'Day End'].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setPunchNote(tag)}
                      className="rounded-lg border border-[#E5E3DC] bg-[#FAFAF8] px-2.5 py-1 text-[11px] font-medium text-[#5D646E] hover:border-[#111315]/40 hover:text-[#111315]"
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={punching}
                  onClick={() => void handleLiveLocationPunch()}
                  className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#0D9488] text-sm font-bold text-white transition-all hover:bg-[#0F766E] active:scale-[0.99] disabled:opacity-60"
                >
                  {punching ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Fetching Exact Browser GPS...
                    </>
                  ) : (
                    <>
                      <Crosshair className="h-4 w-4" />
                      Punch Live Location Now
                    </>
                  )}
                </button>
              </div>

              {punchMsg && (
                <div
                  className={`mt-3 rounded-xl px-3.5 py-2.5 text-xs font-medium ${
                    punchMsg.type === 'ok'
                      ? 'bg-[#0D9488]/10 text-[#0F766E]'
                      : 'bg-[#FFF7ED] text-[#C2410C]'
                  }`}
                >
                  {punchMsg.text}
                </div>
              )}

              {/* Latest Punched Location Readout */}
              {latestPunch && (
                <div className="mt-4 rounded-2xl border border-[#E5E3DC] bg-[#FAFAF8] p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5D646E]">
                        Last Punched Location · {formatRelativeTime(latestPunch.punched_at)}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-[#111315]">
                        <MapPin className="h-4 w-4 shrink-0 text-[#0D9488]" />
                        <span className="truncate">
                          {latestPunch.place_name || formatCoords(latestPunch.latitude, latestPunch.longitude)}
                        </span>
                      </p>
                      {latestPunch.address && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-[#5D646E]">
                          {latestPunch.address}
                        </p>
                      )}
                    </div>
                    <a
                      href={buildGoogleMapsUrl(latestPunch.latitude, latestPunch.longitude)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-[#E5E3DC] bg-white px-2.5 text-xs font-semibold text-[#111315] hover:bg-[#F3F2ED]"
                    >
                      Map
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="font-mono-num mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#5D646E]">
                    <span>{formatCoords(latestPunch.latitude, latestPunch.longitude)}</span>
                    {latestPunch.accuracy && <span>±{latestPunch.accuracy}m accuracy</span>}
                    <span>{formatTimeClock(latestPunch.punched_at)}</span>
                  </div>
                </div>
              )}
            </section>

            {/* Recent Location Punch History */}
            <section className="rounded-3xl border border-[#E5E3DC] bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#5D646E]">
                  Recent GPS Punches
                </h3>
                <button
                  type="button"
                  onClick={() => void loadDashboard()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#5D646E] hover:text-[#111315]"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              {data?.recentPunches.length ? (
                <div className="divide-y divide-[#E5E3DC]">
                  {data.recentPunches.slice(0, 6).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[#111315]">
                          {p.place_name || formatCoords(p.latitude, p.longitude)}
                        </p>
                        <p className="truncate text-xs text-[#5D646E]">
                          {p.note || (p.punch_type === 'trip_entry' ? 'Trip logged' : 'Check-in')}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono-num text-xs font-medium text-[#111315]">
                          {formatTimeClock(p.punched_at)}
                        </p>
                        <p className="text-[11px] text-[#5D646E]">
                          {formatRelativeTime(p.punched_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-[#5D646E]">
                  No GPS punches recorded yet. Tap &ldquo;Punch Live Location Now&rdquo; above.
                </p>
              )}
            </section>
          </div>
        )}

        {/* TAB 2: EXPENSE & TRAVEL LEDGER TABLE */}
        {activeTab === 'table' && ledger && month && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#111315]">
                  Travel &amp; Expense Ledger ({formatMonthLabel(monthKey, true)})
                </h2>
                <p className="text-xs text-[#5D646E]">
                  Opening Balance: <span className="font-mono-num font-semibold">{formatSignedINR(ledger.openingBalance)}</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Toggle Spreadsheet Table vs Mobile Cards */}
                <div className="inline-flex rounded-xl border border-[#E5E3DC] bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setTableViewMode('table')}
                    className={`inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold ${
                      tableViewMode === 'table'
                        ? 'bg-[#111315] text-white'
                        : 'text-[#5D646E]'
                    }`}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    Table
                  </button>
                  <button
                    type="button"
                    onClick={() => setTableViewMode('cards')}
                    className={`inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold ${
                      tableViewMode === 'cards'
                        ? 'bg-[#111315] text-white'
                        : 'text-[#5D646E]'
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Cards
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    downloadExpensesCsv({
                      filename: `${user.name.replace(/\s+/g, '_')}_${monthKey}_ledger.csv`,
                      salesmanName: user.name,
                      expenses: ledger.expenses,
                    })
                  }
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E5E3DC] bg-white px-3 text-xs font-semibold text-[#111315] hover:bg-[#F3F2ED]"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </button>
              </div>
            </div>

            {ledger.expenses.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-[#D0CDC3] bg-white p-8 text-center">
                <p className="text-sm font-semibold text-[#111315]">
                  No trips logged for {formatMonthLabel(monthKey)}
                </p>
                <p className="mt-1 text-xs text-[#5D646E]">
                  Add your Place, Departure, Arrival, Fare, DA, Conveyance &amp; Night Stay.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingExpense(null);
                    setExpenseModalOpen(true);
                  }}
                  className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-xl bg-[#111315] px-4 text-xs font-semibold text-white"
                >
                  <Plus className="h-4 w-4" />
                  Add First Entry
                </button>
              </div>
            ) : tableViewMode === 'table' ? (
              <div className="overflow-hidden rounded-3xl border border-[#E5E3DC] bg-white">
                <div className="ledger-scroll overflow-x-auto">
                  <table className="w-full min-w-[820px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#E5E3DC] bg-[#FAFAF8] text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
                        <th className="sticky left-0 z-10 bg-[#FAFAF8] px-3.5 py-3">Date / Place</th>
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
                      {ledger.expenses.map((row) => (
                        <tr key={row.id} className="hover:bg-[#FAFAF8]">
                          <td className="sticky left-0 z-10 bg-white px-3.5 py-3">
                            <div className="font-semibold text-[#111315]">{row.place}</div>
                            {row.remarks && (
                              <div className="max-w-[200px] truncate text-[11px] text-[#5D646E]">
                                {row.remarks}
                              </div>
                            )}
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
                          <td className="font-mono-num px-3 py-3 text-[#111315]">
                            {row.departure || '—'}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-[#111315]">
                            {row.arrival || '—'}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right text-[#111315]">
                            {formatINR(row.fare)}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right text-[#111315]">
                            {formatINR(row.da)}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right text-[#111315]">
                            {formatINR(row.conveyance)}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right text-[#111315]">
                            {formatINR(row.night_stay)}
                          </td>
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
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingExpense(row);
                                  setExpenseModalOpen(true);
                                }}
                                aria-label="Edit"
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5D646E] hover:bg-[#F3F2ED] hover:text-[#111315]"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteExpense(row.id)}
                                aria-label="Delete"
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5D646E] hover:bg-[#FFF7ED] hover:text-[#C2410C]"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[#E5E3DC] bg-[#FAFAF8] font-bold text-[#111315]">
                        <td className="sticky left-0 z-10 bg-[#FAFAF8] px-3.5 py-3">
                          Month Totals ({month.tripCount})
                        </td>
                        <td className="px-3 py-3" />
                        <td className="px-3 py-3" />
                        <td className="font-mono-num px-3 py-3 text-right">{formatINR(month.fare)}</td>
                        <td className="font-mono-num px-3 py-3 text-right">{formatINR(month.da)}</td>
                        <td className="font-mono-num px-3 py-3 text-right">{formatINR(month.conveyance)}</td>
                        <td className="font-mono-num px-3 py-3 text-right">{formatINR(month.nightStay)}</td>
                        <td className="font-mono-num px-3 py-3 text-right text-sm">{formatINR(month.totalExpenses)}</td>
                        <td
                          className={`font-mono-num px-3 py-3 text-right ${
                            month.closingBalance < 0 ? 'text-[#C2410C]' : 'text-[#0F766E]'
                          }`}
                        >
                          {formatSignedINR(month.closingBalance)}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {ledger.expenses.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-2xl border border-[#E5E3DC] bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-[#111315]">{row.place}</span>
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
                        {row.remarks && (
                          <p className="mt-0.5 text-xs text-[#5D646E]">{row.remarks}</p>
                        )}
                        <p className="font-mono-num mt-0.5 text-xs text-[#5D646E]">
                          {formatShortDate(row.expense_date)} · Dep {row.departure || '--'} → Arr {row.arrival || '--'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono-num text-base font-bold text-[#111315]">
                          {formatINR(row.total)}
                        </p>
                        <p
                          className={`font-mono-num text-[11px] font-semibold ${
                            (row.running_balance ?? 0) < 0 ? 'text-[#C2410C]' : 'text-[#0F766E]'
                          }`}
                        >
                          Bal {formatSignedINR(row.running_balance ?? 0)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-xl bg-[#FAFAF8] p-2 text-center">
                      <div>
                        <span className="block text-[10px] text-[#5D646E]">Fare</span>
                        <span className="font-mono-num text-xs font-semibold">{formatINR(row.fare)}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-[#5D646E]">DA</span>
                        <span className="font-mono-num text-xs font-semibold">{formatINR(row.da)}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-[#5D646E]">Conv.</span>
                        <span className="font-mono-num text-xs font-semibold">{formatINR(row.conveyance)}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-[#5D646E]">Stay</span>
                        <span className="font-mono-num text-xs font-semibold">{formatINR(row.night_stay)}</span>
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-xs text-[#5D646E]">
                      <div className="truncate">
                        {row.latitude !== null && row.longitude !== null ? (
                          <a
                            href={buildGoogleMapsUrl(row.latitude, row.longitude)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[#0F766E] underline"
                          >
                            <MapPin className="h-3 w-3" />
                            {row.gps_place || 'GPS Tagged'}
                          </a>
                        ) : (
                          <span>{row.remarks || 'No GPS tag'}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingExpense(row);
                            setExpenseModalOpen(true);
                          }}
                          className="font-semibold text-[#111315]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteExpense(row.id)}
                          className="font-semibold text-[#C2410C]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: OFFICE ADVANCES & REIMBURSEMENT CLAIMS */}
        {activeTab === 'wallet' && ledger && live && month && (
          <div className="space-y-4">
            {/* Calculation Breakdown */}
            <section className="rounded-3xl border border-[#E5E3DC] bg-white p-4 sm:p-5">
              <h2 className="text-sm font-bold text-[#111315]">
                Running Balance Formula
              </h2>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#5D646E]">Total Office Advances Received (All time)</span>
                  <span className="font-mono-num font-semibold text-[#0F766E]">
                    +{formatINR(live.totalAdvances)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5D646E]">Total Reimbursements Paid Back</span>
                  <span className="font-mono-num font-semibold text-[#0F766E]">
                    +{formatINR(live.totalPaidClaims)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5D646E]">Total Travel &amp; Field Expenses</span>
                  <span className="font-mono-num font-semibold text-[#111315]">
                    -{formatINR(live.totalExpenses)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-[#E5E3DC] pt-2 text-sm font-bold">
                  <span className="text-[#111315]">Live Net Balance</span>
                  <span
                    className={`font-mono-num ${
                      live.liveBalance < 0 ? 'text-[#C2410C]' : 'text-[#0F766E]'
                    }`}
                  >
                    {formatSignedINR(live.liveBalance)}
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-[#E5E3DC] bg-[#FAFAF8] p-3 text-xs">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#5D646E]">
                  {formatMonthLabel(monthKey)} Ledger Summary
                </p>
                <div className="grid grid-cols-2 gap-y-1.5">
                  <span className="text-[#5D646E]">Opening Carry-Forward</span>
                  <span className="font-mono-num text-right font-semibold">
                    {formatSignedINR(ledger.openingBalance)}
                  </span>
                  <span className="text-[#5D646E]">+ Office Advance ({formatMonthLabel(monthKey, true)})</span>
                  <span className="font-mono-num text-right font-semibold text-[#0F766E]">
                    +{formatINR(month.advance)}
                  </span>
                  <span className="text-[#5D646E]">+ Reimbursed ({formatMonthLabel(monthKey, true)})</span>
                  <span className="font-mono-num text-right font-semibold text-[#0F766E]">
                    +{formatINR(month.paidClaims)}
                  </span>
                  <span className="text-[#5D646E]">- Month Expenses</span>
                  <span className="font-mono-num text-right font-semibold text-[#111315]">
                    -{formatINR(month.totalExpenses)}
                  </span>
                  <span className="border-t border-[#E5E3DC] pt-1 font-bold text-[#111315]">
                    Month Closing Balance
                  </span>
                  <span
                    className={`font-mono-num border-t border-[#E5E3DC] pt-1 text-right font-bold ${
                      month.closingBalance < 0 ? 'text-[#C2410C]' : 'text-[#0F766E]'
                    }`}
                  >
                    {formatSignedINR(month.closingBalance)}
                  </span>
                </div>
              </div>
            </section>

            {/* Submit Reimbursement Claim */}
            <section className="rounded-3xl border border-[#E5E3DC] bg-white p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-[#111315]">
                    Claim Reimbursement
                  </h3>
                  <p className="mt-0.5 text-xs text-[#5D646E]">
                    Spent from your own pocket? Submit a claim to Admin for settlement.
                  </p>
                </div>
                {live.unclaimedOutOfPocket > 0 && (
                  <span className="font-mono-num rounded-lg bg-[#FFF7ED] px-2.5 py-1 text-xs font-bold text-[#C2410C]">
                    Due: {formatINR(live.unclaimedOutOfPocket)}
                  </span>
                )}
              </div>

              <form onSubmit={handleSubmitClaim} className="mt-3.5 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                      Claim Amount (₹)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="any"
                      value={claimAmount}
                      onChange={(e) => setClaimAmount(e.target.value)}
                      placeholder={String(live.unclaimedOutOfPocket || 500)}
                      required
                      className="font-mono-num h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm font-semibold text-[#111315] outline-none focus:border-[#111315] focus:bg-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                      Reason / Trip Note
                    </label>
                    <input
                      type="text"
                      value={claimReason}
                      onChange={(e) => setClaimReason(e.target.value)}
                      placeholder="e.g. Jaipur → Ajmer fare & hotel paid by personal UPI"
                      className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm text-[#111315] outline-none focus:border-[#111315] focus:bg-white"
                    />
                  </div>
                </div>

                {claimFeedback && (
                  <p className="rounded-xl bg-[#FAFAF8] px-3 py-2 text-xs font-medium text-[#111315]">
                    {claimFeedback}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={claiming}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] text-xs font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-60 sm:w-auto sm:px-5"
                >
                  <Receipt className="h-4 w-4" />
                  {claiming ? 'Submitting Claim...' : 'Submit Reimbursement Claim'}
                </button>
              </form>
            </section>

            {/* Office Advances Received in Selected Month */}
            <section className="rounded-3xl border border-[#E5E3DC] bg-white p-4">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#5D646E]">
                    Office Advances / Tour Funds ({formatMonthLabel(monthKey, true)})
                  </h3>
                  <p className="font-mono-num text-xs font-bold text-[#0F766E]">
                    Total Received: {formatINR(month.advance)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAdvDate(getTodayDateStr());
                    setAdvError('');
                    setAdvanceModalOpen(true);
                  }}
                  className="inline-flex h-9 items-center gap-1 rounded-xl bg-[#0D9488] px-3 text-xs font-semibold text-white hover:bg-[#0F766E]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Office Balance
                </button>
              </div>
              {ledger.advances.length ? (
                <div className="divide-y divide-[#E5E3DC]">
                  {ledger.advances.map((adv) => (
                    <div key={adv.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0D9488]/10 text-[#0F766E]">
                          <ArrowDownLeft className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#111315]">
                            {adv.note || 'Office Advance'}
                          </p>
                          <p className="text-xs text-[#5D646E]">
                            {formatShortDate(adv.advance_date)} · {adv.mode}
                            {adv.reference ? ` · ${adv.reference}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono-num text-sm font-bold text-[#0F766E]">
                          +{formatINR(adv.amount)}
                        </span>
                        {Number(adv.given_by) === user.id && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteOwnAdvance(adv.id)}
                            aria-label="Delete office balance"
                            className="rounded-lg p-1.5 text-[#5D646E] hover:bg-[#FFF7ED] hover:text-[#C2410C]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-3 text-xs text-[#5D646E]">
                  No office advances recorded in {formatMonthLabel(monthKey)}. Tap &ldquo;Add Office Balance&rdquo; above if you received tour funds.
                </p>
              )}
            </section>

            {/* Reimbursement Claims History */}
            <section className="rounded-3xl border border-[#E5E3DC] bg-white p-4">
              <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[#5D646E]">
                Reimbursement Claims ({formatMonthLabel(monthKey, true)})
              </h3>
              {ledger.claims.length ? (
                <div className="divide-y divide-[#E5E3DC]">
                  {ledger.claims.map((claim) => (
                    <div key={claim.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F3F2ED] text-[#111315]">
                          {claim.status === 'paid' ? (
                            <CheckCircle2 className="h-4 w-4 text-[#0F766E]" />
                          ) : claim.status === 'rejected' ? (
                            <ArrowUpRight className="h-4 w-4 text-[#C2410C]" />
                          ) : (
                            <Clock className="h-4 w-4 text-[#B45309]" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-[#111315]">
                            {claim.reason || 'Reimbursement Claim'}
                          </p>
                          <p className="text-xs text-[#5D646E]">
                            {formatShortDate(claim.claim_date)}
                            {claim.payout_ref ? ` · Paid Ref: ${claim.payout_ref}` : ''}
                          </p>
                          {claim.admin_note && (
                            <p className="mt-1 text-xs text-[#5D646E]">
                              Admin note: {claim.admin_note}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono-num text-sm font-bold text-[#111315]">
                          {formatINR(claim.amount)}
                        </p>
                        <span
                          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            claim.status === 'paid'
                              ? 'bg-[#0D9488]/12 text-[#0F766E]'
                              : claim.status === 'approved'
                                ? 'bg-[#111315] text-white'
                                : claim.status === 'rejected'
                                  ? 'bg-[#FFF7ED] text-[#C2410C]'
                                  : 'bg-[#F3F2ED] text-[#5D646E]'
                          }`}
                        >
                          {claim.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-3 text-xs text-[#5D646E]">
                  No reimbursement claims submitted for {formatMonthLabel(monthKey)}.
                </p>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: MONTHLY TRACKING CHART */}
        {activeTab === 'chart' && data && month && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#111315]">
                Monthly Expense &amp; Balance Analytics
              </h2>
              <button
                type="button"
                onClick={() =>
                  downloadExpensesCsv({
                    filename: `${user.name.replace(/\s+/g, '_')}_${monthKey}_ledger.csv`,
                    salesmanName: user.name,
                    expenses: data.ledger.expenses,
                  })
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#E5E3DC] bg-white px-3 text-xs font-semibold text-[#111315]"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>

            <MonthlyChart
              series={data.monthlySeries}
              selectedMonthKey={monthKey}
              onSelectMonth={setMonthKey}
              fare={month.fare}
              da={month.da}
              conveyance={month.conveyance}
              nightStay={month.nightStay}
            />
          </div>
        )}
      </main>

      {/* Fixed Mobile Bottom Navigation Bar (Thumb Zone >=48px targets) */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-[#E5E3DC] bg-white/95 backdrop-blur-md">
        <div className="mx-auto grid max-w-4xl grid-cols-4 px-2 pt-1.5">
          {[
            { id: 'punch' as const, label: 'Punch GPS', icon: Navigation },
            { id: 'table' as const, label: 'Expenses', icon: Table2 },
            { id: 'wallet' as const, label: 'Balance', icon: Wallet },
            { id: 'chart' as const, label: 'Monthly', icon: BarChart3 },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] font-semibold transition-colors ${
                  active ? 'text-[#0F766E]' : 'text-[#5D646E] hover:text-[#111315]'
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <ExpenseFormModal
        open={expenseModalOpen}
        editing={editingExpense}
        latestPunch={latestPunch}
        onClose={() => {
          setExpenseModalOpen(false);
          setEditingExpense(null);
        }}
        onSave={handleSaveExpense}
      />

      {advanceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl border border-[#E5E3DC] bg-[#FAFAF8] shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-[#E5E3DC] bg-white px-5 py-4 rounded-t-3xl">
              <div>
                <h2 className="text-base font-bold tracking-tight text-[#111315]">
                  Add Office Balance / Tour Fund
                </h2>
                <p className="text-xs text-[#5D646E]">
                  Record money received from office for this trip or tour
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdvanceModalOpen(false)}
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E5E3DC] text-[#5D646E] hover:bg-[#F3F2ED] hover:text-[#111315]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAdvance} className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                  Trip / Tour Name
                </label>
                <input
                  type="text"
                  value={advNote}
                  onChange={(e) => setAdvNote(e.target.value)}
                  placeholder="e.g. Jaipur Tour Budget / Week 2 Advance"
                  required
                  className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-white px-3 text-sm text-[#111315] outline-none focus:border-[#111315]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                    Amount Received (₹)
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
                    className="font-mono-num h-11 w-full rounded-xl border border-[#E5E3DC] bg-white px-3 text-sm font-semibold text-[#111315] outline-none focus:border-[#111315]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                    Date
                  </label>
                  <input
                    type="date"
                    value={advDate}
                    onChange={(e) => setAdvDate(e.target.value)}
                    required
                    className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-white px-3 text-sm text-[#111315] outline-none focus:border-[#111315]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                    Mode
                  </label>
                  <select
                    value={advMode}
                    onChange={(e) => setAdvMode(e.target.value)}
                    className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-white px-3 text-sm text-[#111315] outline-none focus:border-[#111315]"
                  >
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                    Reference (Optional)
                  </label>
                  <input
                    type="text"
                    value={advRef}
                    onChange={(e) => setAdvRef(e.target.value)}
                    placeholder="UTR / Voucher no."
                    className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-white px-3 text-sm text-[#111315] outline-none focus:border-[#111315]"
                  />
                </div>
              </div>

              {advError && (
                <p className="rounded-xl bg-[#FFF7ED] px-3 py-2 text-xs font-medium text-[#C2410C]">
                  {advError}
                </p>
              )}

              <div className="flex gap-2.5 pt-1 pb-safe">
                <button
                  type="button"
                  onClick={() => setAdvanceModalOpen(false)}
                  className="h-12 flex-1 rounded-xl border border-[#E5E3DC] bg-white text-sm font-semibold text-[#5D646E]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={advSaving}
                  className="h-12 flex-[2] rounded-xl bg-[#0D9488] text-sm font-semibold text-white transition-colors hover:bg-[#0F766E] disabled:opacity-60"
                >
                  {advSaving ? 'Saving...' : 'Add Office Balance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

