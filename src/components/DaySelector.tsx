"use client";

import { ALL_DAY_IDS, DAY_INFO, SEATS_PER_DAY, type EventDayId } from "@/lib/days";

interface DaySelectorProps {
  activeDay: EventDayId;
  onSelect: (day: EventDayId) => void;
  freeCounts: Record<EventDayId, number>;
  selectedCounts: Record<EventDayId, number>;
}

export default function DaySelector({ activeDay, onSelect, freeCounts, selectedCounts }: DaySelectorProps) {
  return (
    <div role="tablist" aria-label="Nap kiválasztása" className="flex flex-wrap gap-2">
      {ALL_DAY_IDS.map((day) => {
        const isActive = day === activeDay;
        const selectedCount = selectedCounts[day] ?? 0;
        return (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(day)}
            className={`relative rounded-xl border-2 px-4 py-3 text-left transition-colors ${
              isActive
                ? "border-xmas-green bg-xmas-green text-white"
                : "border-gray-200 bg-white text-gray-800 hover:border-xmas-green"
            }`}
          >
            <div className="font-semibold">{DAY_INFO[day].label}</div>
            <div className={`text-xs ${isActive ? "text-green-100" : "text-gray-500"}`}>
              {freeCounts[day] ?? SEATS_PER_DAY} szabad hely az {SEATS_PER_DAY}-ból
            </div>
            {selectedCount > 0 && (
              <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-xmas-red px-1.5 text-xs font-bold text-white">
                {selectedCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
