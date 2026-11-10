import type { ExpenseEntry } from '../types';

export function formatINR(value: number): string {
  const num = Number(value) || 0;
  const hasFraction = Math.abs(num % 1) > 0.001;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatSignedINR(value: number): string {
  const num = Number(value) || 0;
  if (num > 0) return `+${formatINR(num)}`;
  if (num < 0) return `-${formatINR(Math.abs(num))}`;
  return formatINR(0);
}

export function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getTodayDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const dt = new Date(y, m - 1 + deltaMonths, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(monthKey: string, short = false): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('en-IN', {
    month: short ? 'short' : 'long',
    year: 'numeric',
  });
}

export function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return dateStr;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function formatRelativeTime(isoStr: string | null | undefined): string {
  if (!isoStr) return 'Never';
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatTimeClock(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const str = String(val ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadExpensesCsv({
  filename,
  salesmanName,
  expenses,
}: {
  filename: string;
  salesmanName?: string;
  expenses: Array<ExpenseEntry & { salesmanName?: string }>;
}) {
  const headers = [
    'Date',
    'Salesman',
    'Place',
    'Departure',
    'Arrival',
    'Fare',
    'DA',
    'Conveyance',
    'Night Stay',
    'Total',
    'Paid By',
    'Running Balance',
    'GPS Lat,Lng',
    'GPS Place',
    'Remarks',
  ];

  const rows = expenses.map((e) => [
    e.expense_date,
    e.salesmanName || salesmanName || '',
    e.place,
    e.departure,
    e.arrival,
    e.fare,
    e.da,
    e.conveyance,
    e.night_stay,
    e.total,
    e.paid_by === 'self' ? 'Self (Claimable)' : 'Office Advance',
    e.running_balance ?? '',
    e.latitude !== null && e.longitude !== null ? `${e.latitude.toFixed(5)},${e.longitude.toFixed(5)}` : '',
    e.gps_place || '',
    e.remarks || '',
  ]);

  const totals = expenses.reduce(
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

  rows.push([
    'TOTAL',
    '',
    `${expenses.length} entries`,
    '',
    '',
    totals.fare,
    totals.da,
    totals.conveyance,
    totals.nightStay,
    totals.total,
    '',
    '',
    '',
    '',
    '',
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\n');

  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

