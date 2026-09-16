import ConfirmationView from "@/components/ConfirmationView";

export default async function ConfirmationPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return (
    <main className="mx-auto max-w-lg px-4 py-6 sm:py-10">
      <ConfirmationView publicId={publicId} />
    </main>
  );
}
