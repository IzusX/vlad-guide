import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Страница не найдена.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
          ← На главную
        </Link>
      </main>
    </>
  );
}
