export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="font-display text-4xl" style={{ color: "var(--text-primary)" }}>
        Sift
      </h1>
      <p style={{ color: "var(--text-secondary)" }}>Local-first document extraction.</p>
    </main>
  );
}
