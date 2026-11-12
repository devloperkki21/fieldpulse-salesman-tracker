import { useEffect, useState } from 'react';
import { ArrowRight, MapPin, ShieldCheck, Smartphone } from 'lucide-react';
import { api, setStoredToken } from '../api';
import type { User } from '../types';

interface LoginScreenProps {
  onSuccess: (user: User) => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [roleTab, setRoleTab] = useState<'salesman' | 'admin'>('salesman');

  const [setupName, setSetupName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .setupStatus()
      .then((res) => setNeedsSetup(res.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.login(phone.trim(), pin.trim());
      setStoredToken(res.token);
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid login credentials');
    } finally {
      setLoading(false);
    }
  }

  async function handleInitialSetup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.setupAdmin({
        name: setupName.trim(),
        phone: phone.trim(),
        pin: pin.trim(),
      });
      setStoredToken(res.token);
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create admin account');
    } finally {
      setLoading(false);
    }
  }

  function switchRoleTab(next: 'salesman' | 'admin') {
    setRoleTab(next);
    setError('');
    setPhone('');
    setPin('');
  }

  return (
    <div className="flex min-h-screen flex-col justify-between bg-[#FAFAF8] px-4 py-8 sm:items-center sm:justify-center">
      <div className="mx-auto w-full max-w-md space-y-6">
        {/* Minimal Brand Header */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E5E3DC] bg-white px-3 py-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="gps-pulse relative inline-flex h-2.5 w-2.5 rounded-full bg-[#0D9488]" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#111315]">
              FieldPulse Ledger
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111315] sm:text-3xl">
            Salesman Location &amp; Expense Tracker
          </h1>
          <p className="text-sm text-[#5D646E]">
            Live GPS check-in, travel allowance ledger, running balance &amp; reimbursement claims.
          </p>
        </div>

        {/* Auth or Initial Admin Setup Card */}
        {needsSetup ? (
          <div className="rounded-3xl border border-[#E5E3DC] bg-white p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#0D9488]" />
              <div>
                <h2 className="text-base font-bold text-[#111315]">
                  First-Time Admin Setup
                </h2>
                <p className="text-xs text-[#5D646E]">
                  Create your head office administrator account to start adding salesmen.
                </p>
              </div>
            </div>

            <form onSubmit={handleInitialSetup} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#5D646E]">
                  Admin Full Name
                </label>
                <input
                  type="text"
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  placeholder="Enter your name"
                  required
                  className="h-12 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3.5 text-sm font-medium text-[#111315] outline-none transition-colors focus:border-[#111315] focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#5D646E]">
                  Admin Login ID / Mobile
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. admin or mobile number"
                  required
                  className="font-mono-num h-12 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3.5 text-sm font-medium text-[#111315] outline-none transition-colors focus:border-[#111315] focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#5D646E]">
                  Create PIN (4+ digits)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  minLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                  required
                  className="font-mono-num h-12 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3.5 text-sm font-medium tracking-widest text-[#111315] outline-none transition-colors focus:border-[#111315] focus:bg-white"
                />
              </div>

              {error && (
                <p className="rounded-xl bg-[#FFF7ED] px-3.5 py-2.5 text-xs font-medium text-[#C2410C]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0D9488] text-sm font-semibold text-white transition-colors hover:bg-[#0F766E] disabled:opacity-60"
              >
                <span>{loading ? 'Creating Account...' : 'Create Admin Account'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>
        ) : (
          <div className="rounded-3xl border border-[#E5E3DC] bg-white p-5 sm:p-6">
            {/* Role Switch */}
            <div className="mb-5 grid grid-cols-2 rounded-2xl bg-[#F3F2ED] p-1">
              <button
                type="button"
                onClick={() => switchRoleTab('salesman')}
                className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all ${
                  roleTab === 'salesman'
                    ? 'bg-white text-[#111315] shadow-xs'
                    : 'text-[#5D646E] hover:text-[#111315]'
                }`}
              >
                <Smartphone className="h-4 w-4" />
                Salesman
              </button>
              <button
                type="button"
                onClick={() => switchRoleTab('admin')}
                className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all ${
                  roleTab === 'admin'
                    ? 'bg-white text-[#111315] shadow-xs'
                    : 'text-[#5D646E] hover:text-[#111315]'
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                Admin
              </button>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#5D646E]">
                  {roleTab === 'admin' ? 'Name, Admin ID, or Mobile' : 'Name or Mobile Number'}
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={
                    roleTab === 'admin'
                      ? 'Enter your name, admin ID, or mobile'
                      : 'Enter your name or mobile number'
                  }
                  required
                  className="h-12 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3.5 text-sm font-medium text-[#111315] outline-none transition-colors focus:border-[#111315] focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#5D646E]">
                  PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter your PIN"
                  required
                  className="font-mono-num h-12 w-full rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3.5 text-sm font-medium tracking-widest text-[#111315] outline-none transition-colors focus:border-[#111315] focus:bg-white"
                />
              </div>

              {error && (
                <p className="rounded-xl bg-[#FFF7ED] px-3.5 py-2.5 text-xs font-medium text-[#C2410C]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || needsSetup === null}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#111315] text-sm font-semibold text-white transition-colors hover:bg-black active:scale-[0.99] disabled:opacity-60"
              >
                <span>{loading ? 'Signing in...' : `Sign In as ${roleTab === 'admin' ? 'Admin' : 'Salesman'}`}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}

        <div className="flex items-center justify-center gap-1.5 text-xs text-[#5D646E]">
          <MapPin className="h-3.5 w-3.5 text-[#0D9488]" />
          <span>Browser location access is requested when punching your live position.</span>
        </div>
      </div>
    </div>
  );
}
