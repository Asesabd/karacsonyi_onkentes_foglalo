"use client";

import { ALL_DAY_IDS, DAY_INFO, type EventDayId } from "@/lib/days";

interface SelectionSummaryProps {
  selections: Record<EventDayId, Set<number>>;
  onProceed: () => void;
  loading: boolean;
  error: string | null;
}

export default function SelectionSummary({ selections, onProceed, loading, error }: SelectionSummaryProps) {
  const dayEntries = ALL_DAY_IDS.map((day) => ({ day, seats: Array.from(selections[day]).sort((a, b) => a - b) })).filter(
    (e) => e.seats.length > 0,
  );
  const total = dayEntries.reduce((sum, e) => sum + e.seats.length, 0);

  return (
    <div className="sticky bottom-0 -mx-4 border-t-2 border-xmas-green bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:border-gray-200 sm:p-4 sm:shadow-sm">
      {error && (
        <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-xmas-red">
          {error}
        </p>
      )}

      {total === 0 ? (
        <p className="text-sm text-gray-600">Válassz ki legalább egy helyet a foglaláshoz.</p>
      ) : (
        <div className="mb-2 space-y-1 text-sm">
          {dayEntries.map(({ day, seats }) => (
            <div key={day} className="flex justify-between text-gray-700">
              <span>{DAY_INFO[day].label}</span>
              <span className="font-medium">{seats.length} hely</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-xmas-green" aria-live="polite">
          {total} hely kiválasztva
        </p>
        <button
          type="button"
          onClick={onProceed}
          disabled={total === 0 || loading}
          className="min-h-11 rounded-lg bg-xmas-red px-5 py-2.5 font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Foglalás előkészítése…" : "Tovább a foglaláshoz"}
        </button>
      </div>
    </div>
  );
}
