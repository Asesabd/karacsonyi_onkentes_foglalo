import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karácsonyi Önkéntes Program - Helyfoglalás",
  description: "Foglalj helyet a karácsonyi önkéntes programra December 24-26. között.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
