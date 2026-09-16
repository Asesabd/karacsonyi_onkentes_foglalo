import BookingApp from "@/components/BookingApp";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-xmas-green sm:text-3xl">🎄 Karácsonyi Önkéntes Program</h1>
        <p className="mt-1 text-gray-600">Válaszd ki a napot és a helyeket, amikor önkénteskedni szeretnél.</p>
      </header>
      <BookingApp />
    </main>
  );
}
