import type { ReactNode } from "react";
import { SiftWordmark } from "@/components/brand/SiftWordmark";

// Shared chrome for the hosted sign-in/sign-up pages, set in the bench
// grammar (DESIGN.md): the wordmark above a single machined panel — hairline
// border, 6px radius, elevation by line (no shadow) — on the instrument
// case. Server component — the interactive form inside is the client
// boundary. Both calibrations apply (the forced-dark scope is landing-only).
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--case)] p-4">
      <div className="mb-6">
        <SiftWordmark markSize={34} textClassName="text-2xl" />
      </div>
      <div className="card-elevated w-full max-w-sm p-6">{children}</div>
    </main>
  );
}
