import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatMonthLabel, getCurrentMonthKey, shiftMonthKey } from '../utils/format';

interface MonthSelectorProps {
  monthKey: string;
  onChange: (nextMonthKey: string) => void;
  compact?: boolean;
}

export function MonthSelector({ monthKey, onChange, compact = false }: MonthSelectorProps) {
  const currentMonth = getCurrentMonthKey();
  const isCurrent = monthKey === currentMonth;

  return (
    <div className="inline-flex items-center rounded-xl border border-[#E5E3DC] bg-white p-0.5">
      <button
        type="button"
        onClick={() => onChange(shiftMonthKey(monthKey, -1))}
        aria-label="Previous month"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[#5D646E] transition-colors hover:bg-[#F3F2ED] hover:text-[#111315] active:scale-95"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange(currentMonth)}
        title={isCurrent ? 'Current month' : 'Click to jump to current month'}
        className={`px-2.5 text-center font-medium tracking-tight text-[#111315] transition-colors hover:text-[#0F766E] ${
          compact ? 'min-w-[88px] text-xs' : 'min-w-[116px] text-sm'
        }`}
      >
        {formatMonthLabel(monthKey, compact)}
      </button>
      <button
        type="button"
        onClick={() => onChange(shiftMonthKey(monthKey, 1))}
        aria-label="Next month"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[#5D646E] transition-colors hover:bg-[#F3F2ED] hover:text-[#111315] active:scale-95"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

