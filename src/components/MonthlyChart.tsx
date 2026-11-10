import type { MonthlyPoint } from '../types';
import { formatINR, formatMonthLabel } from '../utils/format';

interface MonthlyChartProps {
  series: MonthlyPoint[];
  selectedMonthKey: string;
  onSelectMonth?: (monthKey: string) => void;
  fare: number;
  da: number;
  conveyance: number;
  nightStay: number;
}

export function MonthlyChart({
  series,
  selectedMonthKey,
  onSelectMonth,
  fare,
  da,
  conveyance,
  nightStay,
}: MonthlyChartProps) {
  const maxVal = Math.max(
    1000,
    ...series.map((p) => Math.max(p.advance, p.spent)),
  );

  const categoryTotal = fare + da + conveyance + nightStay;
  const categories = [
    { key: 'Fare', amount: fare, color: '#111315' },
    { key: 'DA', amount: da, color: '#0D9488' },
    { key: 'Conveyance', amount: conveyance, color: '#5D646E' },
    { key: 'Night Stay', amount: nightStay, color: '#C2410C' },
  ];

  return (
    <div className="space-y-4">
      {/* Category Breakdown */}
      <div className="rounded-2xl border border-[#E5E3DC] bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
              Expense Split ({formatMonthLabel(selectedMonthKey, true)})
            </p>
            <p className="font-mono-num mt-0.5 text-lg font-semibold text-[#111315]">
              {formatINR(categoryTotal)}
            </p>
          </div>
          <span className="rounded-lg bg-[#F3F2ED] px-2.5 py-1 text-xs font-medium text-[#5D646E]">
            4 Heads
          </span>
        </div>

        {/* Stacked ratio bar */}
        <div className="mb-4 flex h-2.5 w-full overflow-hidden rounded-full bg-[#F3F2ED]">
          {categoryTotal > 0 ? (
            categories.map((cat) => {
              const pct = (cat.amount / categoryTotal) * 100;
              if (pct <= 0) return null;
              return (
                <div
                  key={cat.key}
                  style={{ width: `${pct}%`, backgroundColor: cat.color }}
                  className="h-full transition-all duration-300"
                  title={`${cat.key}: ${formatINR(cat.amount)}`}
                />
              );
            })
          ) : (
            <div className="h-full w-full bg-[#E5E3DC]" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {categories.map((cat) => {
            const pct = categoryTotal > 0 ? Math.round((cat.amount / categoryTotal) * 100) : 0;
            return (
              <div
                key={cat.key}
                className="rounded-xl border border-[#E5E3DC] bg-[#FAFAF8] px-3 py-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-xs font-medium text-[#5D646E]">{cat.key}</span>
                </div>
                <p className="font-mono-num mt-1 text-sm font-semibold text-[#111315]">
                  {formatINR(cat.amount)}
                </p>
                <p className="font-mono-num text-[11px] text-[#5D646E]">{pct}%</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 6-Month Trend: Office Advance vs Total Spent */}
      <div className="rounded-2xl border border-[#E5E3DC] bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5D646E]">
              6-Month Tracking
            </p>
            <p className="text-xs text-[#5D646E]">
              Tap any month bar to open that month&apos;s ledger
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#5D646E]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#0D9488]" />
              Office Advance
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#111315]" />
              Spent
            </span>
          </div>
        </div>

        <div className="grid grid-cols-6 items-end gap-2 pt-2">
          {series.map((point) => {
            const advH = Math.max(point.advance > 0 ? 6 : 0, Math.round((point.advance / maxVal) * 120));
            const expH = Math.max(point.spent > 0 ? 6 : 0, Math.round((point.spent / maxVal) * 120));
            const isSelected = point.monthKey === selectedMonthKey;
            const shortMonth = formatMonthLabel(point.monthKey, true).split(' ')[0];

            return (
              <button
                key={point.monthKey}
                type="button"
                onClick={() => onSelectMonth?.(point.monthKey)}
                className={`group flex flex-col items-center rounded-xl p-1.5 transition-colors ${
                  isSelected ? 'bg-[#F3F2ED] ring-1 ring-[#111315]/15' : 'hover:bg-[#FAFAF8]'
                }`}
              >
                <div className="flex h-[126px] items-end justify-center gap-1">
                  <div
                    style={{ height: `${advH}px` }}
                    className="w-3 rounded-t bg-[#0D9488]/85 transition-all sm:w-4"
                    title={`Advance: ${formatINR(point.advance)}`}
                  />
                  <div
                    style={{ height: `${expH}px` }}
                    className={`w-3 rounded-t transition-all sm:w-4 ${
                      point.outOfPocket > 0 ? 'bg-[#C2410C]' : 'bg-[#111315]'
                    }`}
                    title={`Spent: ${formatINR(point.spent)}`}
                  />
                </div>
                <span
                  className={`mt-2 text-[11px] font-medium ${
                    isSelected ? 'font-semibold text-[#111315]' : 'text-[#5D646E]'
                  }`}
                >
                  {shortMonth}
                </span>
                <span className="font-mono-num text-[10px] text-[#5D646E]">
                  {point.spent >= 1000 ? `${(point.spent / 1000).toFixed(1)}k` : point.spent}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

