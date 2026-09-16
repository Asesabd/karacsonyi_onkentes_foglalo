"use client";

import { useEffect, useState } from "react";

interface CountdownTimerProps {
  expiresAt: string;
  onExpire: () => void;
}

export default function CountdownTimer({ expiresAt, onExpire }: CountdownTimerProps) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(expiresAt).getTime() - Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = new Date(expiresAt).getTime() - Date.now();
      setRemainingMs(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const isUrgent = totalSeconds <= 60;

  return (
    <div
      role="timer"
      aria-live="polite"
      className={`rounded-lg border px-4 py-2 text-center font-semibold ${
        isUrgent ? "border-xmas-red bg-red-50 text-xmas-red" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      A kiválasztott helyeket még{" "}
      <span className="tabular-nums">
        {minutes}:{seconds}
      </span>{" "}
      percig tartjuk fenn.
    </div>
  );
}
