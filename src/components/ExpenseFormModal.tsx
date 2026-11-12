import { useEffect, useState } from 'react';
import { Crosshair, Loader2, MapPin, X } from 'lucide-react';
import type { ExpenseEntry, LocationPunch } from '../types';
import { formatINR, getTodayDateStr } from '../utils/format';
import { captureBrowserLocation, formatCoords } from '../utils/geo';

interface ExpenseFormModalProps {
  open: boolean;
  editing?: ExpenseEntry | null;
  latestPunch?: LocationPunch | null;
  onClose: () => void;
  onSave: (payload: {
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
  }) => Promise<void>;
}

export function ExpenseFormModal({
  open,
  editing,
  latestPunch,
  onClose,
  onSave,
}: ExpenseFormModalProps) {
  const [expenseDate, setExpenseDate] = useState(getTodayDateStr());
  const [place, setPlace] = useState('');
  const [departure, setDeparture] = useState('08:30');
  const [arrival, setArrival] = useState('13:00');
  const [fare, setFare] = useState('');
  const [da, setDa] = useState('');
  const [conveyance, setConveyance] = useState('');
  const [nightStay, setNightStay] = useState('');
  const [paidBy, setPaidBy] = useState<'office' | 'self'>('office');
  const [remarks, setRemarks] = useState('');

  const [gps, setGps] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
    place_name: string;
    capturedAt: string;
  } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function detectGpsLocation(overwritePlace = true) {
    setGpsLoading(true);
    setGpsError('');
    try {
      const loc = await captureBrowserLocation();
      setGps({
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        place_name: loc.place_name,
        capturedAt: loc.capturedAt,
      });
      if (overwritePlace) {
        setPlace(loc.place_name);
      }
    } catch (err) {
      setGpsError(err instanceof Error ? err.message : 'Unable to capture GPS location');
    } finally {
      setGpsLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setFormError('');
    setGpsError('');
    if (editing) {
      setExpenseDate(editing.expense_date);
      setPlace(editing.place);
      setDeparture(editing.departure || '');
      setArrival(editing.arrival || '');
      setFare(editing.fare ? String(editing.fare) : '');
      setDa(editing.da ? String(editing.da) : '');
      setConveyance(editing.conveyance ? String(editing.conveyance) : '');
      setNightStay(editing.night_stay ? String(editing.night_stay) : '');
      setPaidBy(editing.paid_by);
      setRemarks(editing.remarks || '');
      setGps(
        editing.latitude !== null && editing.longitude !== null
          ? {
              latitude: editing.latitude,
              longitude: editing.longitude,
              accuracy: editing.accuracy,
              place_name: editing.gps_place || editing.place,
              capturedAt: editing.gps_punched_at || editing.created_at,
            }
          : null,
      );
    } else {
      setExpenseDate(getTodayDateStr());
      setPlace('');
      setDeparture('09:00');
      setArrival(new Date().toTimeString().slice(0, 5));
      setFare('');
      setDa('');
      setConveyance('');
      setNightStay('');
      setPaidBy('office');
      setRemarks('');
      setGps(null);
      void detectGpsLocation(true);
    }
  }, [open, editing]);

  if (!open) return null;

  const fareNum = Math.max(0, Number(fare) || 0);
  const daNum = Math.max(0, Number(da) || 0);
  const convNum = Math.max(0, Number(conveyance) || 0);
  const stayNum = Math.max(0, Number(nightStay) || 0);
  const total = Math.round((fareNum + daNum + convNum + stayNum) * 100) / 100;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing && (!gps || !place.trim())) {
      setFormError('Live GPS location must be captured before saving. Tap "Detect GPS" above.');
      return;
    }
    if (!place.trim()) {
      setFormError('GPS place name is missing.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await onSave({
        expense_date: expenseDate,
        place: place.trim(),
        departure,
        arrival,
        fare: fareNum,
        da: daNum,
        conveyance: convNum,
        night_stay: stayNum,
        paid_by: paidBy,
        remarks: remarks.trim(),
        latitude: gps ? gps.latitude : null,
        longitude: gps ? gps.longitude : null,
        accuracy: gps ? gps.accuracy : null,
        gps_place: gps ? gps.place_name : place.trim(),
        gps_punched_at: gps ? gps.capturedAt : null,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[#E5E3DC] bg-[#FAFAF8] shadow-2xl sm:rounded-3xl">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#E5E3DC] bg-white px-5 py-4">
          <div>
            <h2 className="text-base font-bold tracking-tight text-[#111315]">
              {editing ? 'Edit Travel & Expense' : 'Add Travel & Expense'}
            </h2>
            <p className="text-xs text-[#5D646E]">
              Place, timings & Fare / DA / Conveyance / Night Stay
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E5E3DC] text-[#5D646E] hover:bg-[#F3F2ED] hover:text-[#111315]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Live GPS Stamp Box */}
          <div className="rounded-2xl border border-[#E5E3DC] bg-white p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
                  Auto GPS Location (Required)
                </p>
                {gpsLoading ? (
                  <p className="mt-1 text-xs font-medium text-[#0F766E]">
                    Detecting your live browser location...
                  </p>
                ) : gps ? (
                  <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[#0F766E]">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{gps.place_name}</span>
                  </div>
                ) : (
                  <p className="mt-0.5 text-xs text-[#C2410C]">
                    Location lock required to capture expense place automatically
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void detectGpsLocation(true)}
                disabled={gpsLoading}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#0D9488] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#0F766E] disabled:opacity-60"
              >
                {gpsLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Crosshair className="h-3.5 w-3.5" />
                )}
                {gps ? 'Refresh GPS' : 'Detect GPS'}
              </button>
            </div>
            {gps && (
              <p className="font-mono-num mt-1.5 text-[11px] text-[#5D646E]">
                {formatCoords(gps.latitude, gps.longitude)}
                {gps.accuracy ? ` · ±${gps.accuracy}m` : ''}
              </p>
            )}
            {gpsError && (
              <div className="mt-2 space-y-2 rounded-lg bg-[#FFF7ED] px-2.5 py-2 text-xs text-[#C2410C]">
                <p>{gpsError}</p>
                {latestPunch && !editing && (
                  <button
                    type="button"
                    onClick={() => {
                      const fallbackPlace =
                        latestPunch.place_name ||
                        formatCoords(latestPunch.latitude, latestPunch.longitude);
                      setGps({
                        latitude: latestPunch.latitude,
                        longitude: latestPunch.longitude,
                        accuracy: latestPunch.accuracy,
                        place_name: fallbackPlace,
                        capturedAt: latestPunch.punched_at,
                      });
                      setPlace(fallbackPlace);
                      setGpsError('');
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#111315] px-2.5 text-[11px] font-semibold text-white hover:bg-black"
                  >
                    <MapPin className="h-3 w-3" />
                    Use Last Punched GPS ({latestPunch.place_name || 'Saved Pin'})
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                Date
              </label>
              <input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                required
                className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-white px-3 text-sm text-[#111315] outline-none focus:border-[#111315]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                Place (Auto-picked from GPS)
              </label>
              <input
                type="text"
                value={place}
                readOnly
                placeholder={gpsLoading ? 'Fetching GPS place...' : 'Waiting for GPS lock'}
                required
                className="h-11 w-full cursor-not-allowed rounded-xl border border-[#E5E3DC] bg-[#F3F2ED] px-3 text-sm font-medium text-[#111315] outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                Departure
              </label>
              <input
                type="time"
                value={departure}
                onChange={(e) => setDeparture(e.target.value)}
                className="font-mono-num h-11 w-full rounded-xl border border-[#E5E3DC] bg-white px-3 text-sm text-[#111315] outline-none focus:border-[#111315]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
                Arrival
              </label>
              <input
                type="time"
                value={arrival}
                onChange={(e) => setArrival(e.target.value)}
                className="font-mono-num h-11 w-full rounded-xl border border-[#E5E3DC] bg-white px-3 text-sm text-[#111315] outline-none focus:border-[#111315]"
              />
            </div>
          </div>

          {/* 4 Numeric Expense Fields */}
          <div className="rounded-2xl border border-[#E5E3DC] bg-white p-3.5">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
              Expense Breakdown (₹)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#5D646E]">
                  Fare (₹)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={fare}
                  onChange={(e) => setFare(e.target.value)}
                  placeholder="0"
                  className="font-mono-num h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm font-medium text-[#111315] outline-none focus:border-[#111315] focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#5D646E]">
                  DA (₹)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={da}
                  onChange={(e) => setDa(e.target.value)}
                  placeholder="0"
                  className="font-mono-num h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm font-medium text-[#111315] outline-none focus:border-[#111315] focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#5D646E]">
                  Conveyance (₹)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={conveyance}
                  onChange={(e) => setConveyance(e.target.value)}
                  placeholder="0"
                  className="font-mono-num h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm font-medium text-[#111315] outline-none focus:border-[#111315] focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#5D646E]">
                  Night Stay (₹)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={nightStay}
                  onChange={(e) => setNightStay(e.target.value)}
                  placeholder="0"
                  className="font-mono-num h-11 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 text-sm font-medium text-[#111315] outline-none focus:border-[#111315] focus:bg-white"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[#E5E3DC] pt-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#5D646E]">
                Auto Calculated Total
              </span>
              <span className="font-mono-num text-xl font-bold text-[#111315]">
                {formatINR(total)}
              </span>
            </div>
          </div>

          {/* Payment Source */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#5D646E]">
              Paid From
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaidBy('office')}
                className={`h-11 rounded-xl border text-xs font-semibold transition-colors ${
                  paidBy === 'office'
                    ? 'border-[#111315] bg-[#111315] text-white'
                    : 'border-[#E5E3DC] bg-white text-[#5D646E]'
                }`}
              >
                Office Advance
              </button>
              <button
                type="button"
                onClick={() => setPaidBy('self')}
                className={`h-11 rounded-xl border text-xs font-semibold transition-colors ${
                  paidBy === 'self'
                    ? 'border-[#C2410C] bg-[#FFF7ED] text-[#C2410C]'
                    : 'border-[#E5E3DC] bg-white text-[#5D646E]'
                }`}
              >
                Own Pocket (Self)
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-[#5D646E]">
              Remarks / Trip Notes
            </label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Write route, client visit, hotel, or bill details here"
              className="h-11 w-full rounded-xl border border-[#E5E3DC] bg-white px-3 text-sm text-[#111315] outline-none focus:border-[#111315]"
            />
          </div>

          {formError && (
            <p className="rounded-xl bg-[#FFF7ED] px-3 py-2 text-xs font-medium text-[#C2410C]">
              {formError}
            </p>
          )}

          <div className="flex gap-2.5 pt-1 pb-safe">
            <button
              type="button"
              onClick={onClose}
              className="h-12 flex-1 rounded-xl border border-[#E5E3DC] bg-white text-sm font-semibold text-[#5D646E]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!editing && (gpsLoading || !gps || !place.trim()))}
              className="h-12 flex-[2] rounded-xl bg-[#111315] text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
            >
              {saving
                ? 'Saving...'
                : !editing && gpsLoading
                  ? 'Detecting GPS...'
                  : editing
                    ? 'Update Entry'
                    : 'Save Expense Row'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

