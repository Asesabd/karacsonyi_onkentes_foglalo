"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ALL_DAY_IDS, DAY_INFO, SEATS_PER_DAY, type EventDayId } from "@/lib/days";
import DaySelector from "@/components/DaySelector";
import SeatGrid, { type SeatInfo } from "@/components/SeatGrid";
import SelectionSummary from "@/components/SelectionSummary";
import Legend from "@/components/Legend";
import CheckoutForm from "@/components/CheckoutForm";

type SeatsByDay = Record<EventDayId, SeatInfo[]>;

const EMPTY_SEATS: SeatsByDay = { DEC_24: [], DEC_25: [], DEC_26: [] };

function emptySelections(): Record<EventDayId, Set<number>> {
  return { DEC_24: new Set(), DEC_25: new Set(), DEC_26: new Set() };
}

async function fetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Nem sikerült betölteni a helyek állapotát.");
  return res.json() as Promise<{ seats: SeatsByDay }>;
}

interface LockInfo {
  lockToken: string;
  expiresAt: string;
  seats: { day: EventDayId; seatNumber: number }[];
}

type Phase = "selecting" | "checkout";

export default function BookingApp() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("selecting");
  const [activeDay, setActiveDay] = useState<EventDayId>("DEC_24");
  const [selections, setSelections] = useState(emptySelections);
  const [lock, setLock] = useState<LockInfo | null>(null);
  const [lockLoading, setLockLoading] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data } = useSWR("/api/seats", fetcher, {
    refreshInterval: phase === "selecting" ? 4000 : 0,
    revalidateOnFocus: true,
    fallbackData: { seats: EMPTY_SEATS },
  });

  const seatsByDay = data?.seats ?? EMPTY_SEATS;

  // If the live seat map says a seat we've locally selected (but not yet
  // locked) is no longer FREE, drop it from the selection and let the user
  // know - the server is always the source of truth, this is just UX.
  useEffect(() => {
    if (phase !== "selecting") return;
    setSelections((prev) => {
      let changed = false;
      const next = emptySelections();
      for (const day of ALL_DAY_IDS) {
        const statusByNumber = new Map(seatsByDay[day]?.map((s) => [s.seatNumber, s.status]));
        const kept = new Set<number>();
        for (const seatNumber of prev[day]) {
          if (statusByNumber.get(seatNumber) === "FREE") {
            kept.add(seatNumber);
          } else {
            changed = true;
          }
        }
        next[day] = kept;
      }
      if (!changed) return prev;
      setLockError("Néhány kiválasztott helyet időközben más lefoglalt, ezért levettük a listáról.");
      return next;
    });
  }, [seatsByDay, phase]);

  const freeCounts = useMemo(() => {
    const counts = {} as Record<EventDayId, number>;
    for (const day of ALL_DAY_IDS) {
      counts[day] = (seatsByDay[day] ?? []).filter((s) => s.status === "FREE").length;
    }
    return counts;
  }, [seatsByDay]);

  const selectedCounts = useMemo(() => {
    const counts = {} as Record<EventDayId, number>;
    for (const day of ALL_DAY_IDS) counts[day] = selections[day].size;
    return counts;
  }, [selections]);

  function toggleSeat(day: EventDayId, seatNumber: number) {
    setSelections((prev) => {
      const nextForDay = new Set(prev[day]);
      if (nextForDay.has(seatNumber)) {
        nextForDay.delete(seatNumber);
      } else {
        nextForDay.add(seatNumber);
      }
      return { ...prev, [day]: nextForDay };
    });
  }

  async function handleProceed() {
    setLockError(null);
    setLockLoading(true);
    try {
      const selectionsPayload = ALL_DAY_IDS.filter((day) => selections[day].size > 0).map((day) => ({
        day,
        seatNumbers: Array.from(selections[day]),
      }));

      const res = await fetch("/api/locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: selectionsPayload, website: "" }),
      });
      const body = await res.json();

      if (!res.ok) {
        if (body?.error?.code === "SEATS_UNAVAILABLE") {
          const unavailable: { day: EventDayId; seatNumber: number }[] = body.error.unavailable ?? [];
          setSelections((prev) => {
            const next = emptySelections();
            for (const day of ALL_DAY_IDS) next[day] = new Set(prev[day]);
            for (const u of unavailable) next[u.day].delete(u.seatNumber);
            return next;
          });
        }
        setLockError(body?.error?.message ?? "Nem sikerült zárolni a kiválasztott helyeket.");
        return;
      }

      setLock(body);
      setPhase("checkout");
    } catch {
      setLockError("Hálózati hiba történt. Kérjük, próbáld újra.");
    } finally {
      setLockLoading(false);
    }
  }

  async function releaseLockIfAny() {
    if (!lock) return;
    try {
      await fetch("/api/locks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockToken: lock.lockToken }),
      });
    } catch {
      // best-effort only - the lock will expire on its own within 10 minutes
    }
  }

  function handleExpire() {
    setLock(null);
    setPhase("selecting");
    setSelections(emptySelections());
    setLockError("A 10 perces foglalási idő lejárt. Kérjük, válaszd ki újra a helyeket.");
  }

  async function handleBack() {
    await releaseLockIfAny();
    setLock(null);
    setPhase("selecting");
  }

  async function handleSubmitCheckout(fields: {
    name: string;
    email: string;
    phone: string;
    website: string;
    formRenderedAt: number;
  }) {
    if (!lock) return;
    setSubmitting(true);
    setCheckoutError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockToken: lock.lockToken, ...fields }),
      });
      const body = await res.json();

      if (!res.ok) {
        if (body?.error?.code === "LOCK_EXPIRED") {
          setLock(null);
          setPhase("selecting");
          setLockError(body.error.message);
          return;
        }
        setCheckoutError(body?.error?.message ?? "Nem sikerült véglegesíteni a foglalást.");
        return;
      }

      router.push(`/confirmation/${body.publicId}`);
    } catch {
      setCheckoutError("Hálózati hiba történt. Kérjük, próbáld újra.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "checkout" && lock) {
    return (
      <CheckoutForm
        lockedSeats={lock.seats}
        expiresAt={lock.expiresAt}
        onExpire={handleExpire}
        onBack={handleBack}
        onSubmit={handleSubmitCheckout}
        submitting={submitting}
        errorMessage={checkoutError}
      />
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <DaySelector activeDay={activeDay} onSelect={setActiveDay} freeCounts={freeCounts} selectedCounts={selectedCounts} />

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-xmas-green">{DAY_INFO[activeDay].label}</h2>
          <p className="text-sm text-gray-600" aria-live="polite">
            {freeCounts[activeDay] ?? SEATS_PER_DAY} szabad hely az {SEATS_PER_DAY}-ból
          </p>
        </div>
        <Legend />
        <div className="mt-4">
          <SeatGrid
            dayLabel={DAY_INFO[activeDay].label}
            seats={seatsByDay[activeDay] ?? []}
            selected={selections[activeDay]}
            onToggle={(seatNumber) => toggleSeat(activeDay, seatNumber)}
          />
        </div>
      </div>

      <SelectionSummary selections={selections} onProceed={handleProceed} loading={lockLoading} error={lockError} />
    </div>
  );
}
