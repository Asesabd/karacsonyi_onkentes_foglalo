"use client";

import type { SeatStatusId } from "@/lib/days";

export interface SeatInfo {
  seatNumber: number;
  status: SeatStatusId;
}

interface SeatGridProps {
  dayLabel: string;
  seats: SeatInfo[];
  selected: Set<number>;
  onToggle: (seatNumber: number) => void;
  disabled?: boolean;
}

function seatClasses(displayState: "free" | "selected" | "locked" | "booked") {
  switch (displayState) {
    case "selected":
      return "bg-xmas-green border-xmas-green text-white shadow-md scale-[1.03]";
    case "locked":
      return "bg-amber-200 border-amber-300 text-amber-900 cursor-not-allowed";
    case "booked":
      return "bg-gray-300 border-gray-300 text-gray-500 cursor-not-allowed line-through";
    default:
      return "bg-white border-gray-300 text-gray-800 hover:border-xmas-green hover:bg-green-50";
  }
}

function statusText(displayState: "free" | "selected" | "locked" | "booked") {
  switch (displayState) {
    case "selected":
      return "kiválasztva";
    case "locked":
      return "ideiglenesen zárolva";
    case "booked":
      return "foglalt";
    default:
      return "szabad";
  }
}

export default function SeatGrid({ dayLabel, seats, selected, onToggle, disabled }: SeatGridProps) {
  return (
    <div
      className="grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10"
      role="group"
      aria-label={`${dayLabel} helyei`}
    >
      {seats.map((seat) => {
        const isSelected = selected.has(seat.seatNumber);
        const displayState: "free" | "selected" | "locked" | "booked" = isSelected
          ? "selected"
          : seat.status === "BOOKED"
            ? "booked"
            : seat.status === "LOCKED"
              ? "locked"
              : "free";
        const isClickable = !disabled && (displayState === "free" || displayState === "selected");

        return (
          <button
            key={seat.seatNumber}
            type="button"
            disabled={!isClickable}
            aria-pressed={isSelected}
            aria-label={`${seat.seatNumber}. hely, ${dayLabel}, ${statusText(displayState)}`}
            onClick={() => onToggle(seat.seatNumber)}
            className={`relative flex aspect-square min-h-11 items-center justify-center rounded-lg border-2 text-sm font-semibold transition-all ${seatClasses(displayState)} ${
              isClickable ? "cursor-pointer" : ""
            }`}
          >
            {seat.seatNumber}
            {displayState === "locked" && (
              <span className="absolute -top-1.5 -right-1.5 text-xs" aria-hidden="true">
                🔒
              </span>
            )}
            {displayState === "booked" && (
              <span className="absolute -top-1.5 -right-1.5 text-xs" aria-hidden="true">
                ✕
              </span>
            )}
            {displayState === "selected" && (
              <span className="absolute -top-1.5 -right-1.5 text-xs" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
