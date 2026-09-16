"use client";

import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { DAY_INFO, type EventDayId } from "@/lib/days";

interface StatsResponse {
  stats: { day: EventDayId; label: string; total: number; booked: number; locked: number; free: number }[];
  totalBookings: number;
}

interface BookingRow {
  id: string;
  publicId: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
  emailStatus: "PENDING" | "SENT" | "FAILED";
  seats: { day: EventDayId; seatNumber: number }[];
  seatCount: number;
}

interface BookingsResponse {
  bookings: BookingRow[];
  total: number;
  page: number;
  pageSize: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function AdminDashboard() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [dayFilter, setDayFilter] = useState<EventDayId | "">("");
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<BookingRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: stats } = useSWR<StatsResponse>("/api/admin/stats", fetcher, { refreshInterval: 10000 });

  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (dayFilter) query.set("day", dayFilter);
  query.set("page", String(page));
  query.set("pageSize", "20");

  const { data: bookingsData, mutate } = useSWR<BookingsResponse>(`/api/admin/bookings?${query.toString()}`, fetcher);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await fetch(`/api/admin/bookings/${pendingDelete.id}`, { method: "DELETE" });
      setPendingDelete(null);
      await mutate();
    } finally {
      setDeleting(false);
    }
  }

  const totalPages = bookingsData ? Math.max(1, Math.ceil(bookingsData.total / bookingsData.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-xmas-green">Admin felület</h1>
        <button type="button" onClick={handleLogout} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
          Kijelentkezés
        </button>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats?.stats.map((s) => (
          <div key={s.day} className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="font-semibold text-xmas-green">{s.label}</h2>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt>Foglalt</dt>
                <dd className="font-medium">
                  {s.booked} / {s.total}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Szabad</dt>
                <dd className="font-medium">
                  {s.free} / {s.total}
                </dd>
              </div>
              {s.locked > 0 && (
                <div className="flex justify-between text-amber-700">
                  <dt>Ideiglenesen zárolt</dt>
                  <dd className="font-medium">{s.locked}</dd>
                </div>
              )}
            </dl>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="search" className="mb-1 block text-sm font-medium">
              Keresés (név, e-mail, telefon, azonosító)
            </label>
            <input
              id="search"
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="min-h-11 rounded-lg border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="dayFilter" className="mb-1 block text-sm font-medium">
              Nap
            </label>
            <select
              id="dayFilter"
              value={dayFilter}
              onChange={(e) => {
                setDayFilter(e.target.value as EventDayId | "");
                setPage(1);
              }}
              className="min-h-11 rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">Összes</option>
              {Object.entries(DAY_INFO).map(([id, info]) => (
                <option key={id} value={id}>
                  {info.label}
                </option>
              ))}
            </select>
          </div>
          {/* File download endpoint, not a page route - a <Link> would be wrong here. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/admin/bookings/export"
            className="min-h-11 rounded-lg bg-xmas-green px-4 py-2.5 font-semibold text-white flex items-center"
          >
            CSV exportálása
          </a>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600">
                <th className="py-2 pr-3">Azonosító</th>
                <th className="py-2 pr-3">Név</th>
                <th className="py-2 pr-3">E-mail</th>
                <th className="py-2 pr-3">Telefon</th>
                <th className="py-2 pr-3">Helyek</th>
                <th className="py-2 pr-3">Foglalva</th>
                <th className="py-2 pr-3">E-mail státusz</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {bookingsData?.bookings.map((b) => (
                <tr key={b.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-mono">{b.publicId}</td>
                  <td className="py-2 pr-3">{b.name}</td>
                  <td className="py-2 pr-3">{b.email}</td>
                  <td className="py-2 pr-3">{b.phone}</td>
                  <td className="py-2 pr-3">
                    {b.seats.map((s) => `${DAY_INFO[s.day].short} #${s.seatNumber}`).join(", ")}
                  </td>
                  <td className="py-2 pr-3">{new Date(b.createdAt).toLocaleString("hu-HU")}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        b.emailStatus === "SENT"
                          ? "text-green-700"
                          : b.emailStatus === "FAILED"
                            ? "text-xmas-red"
                            : "text-amber-700"
                      }
                    >
                      {b.emailStatus}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => setPendingDelete(b)}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs text-xmas-red hover:bg-red-50"
                    >
                      Törlés
                    </button>
                  </td>
                </tr>
              ))}
              {bookingsData && bookingsData.bookings.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-gray-500">
                    Nincs találat.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span>
            {bookingsData?.total ?? 0} foglalás összesen
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            >
              Előző
            </button>
            <span className="px-2 py-1.5">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-gray-300 px-3 py-1.5 disabled:opacity-40"
            >
              Következő
            </button>
          </div>
        </div>
      </section>

      {pendingDelete && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl bg-white p-5">
            <h2 className="font-semibold text-xmas-red">Foglalás törlése</h2>
            <p className="mt-2 text-sm text-gray-700">
              Biztosan törlöd <strong>{pendingDelete.name}</strong> ({pendingDelete.publicId}) foglalását? A hozzá
              tartozó helyek újra szabaddá válnak. Ez a művelet nem vonható vissza.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                Mégsem
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-lg bg-xmas-red px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {deleting ? "Törlés…" : "Végleges törlés"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
