import Link from "next/link";

export default function Demo() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-bold tracking-widest">ORBIS VICTOR</h1>
      <p>The campaign awaits. Game demo coming soon.</p>
      <Link href="/" className="rounded border px-6 py-3 focus-visible:outline-2 focus-visible:outline-offset-4">Return to title</Link>
    </main>
  );
}
