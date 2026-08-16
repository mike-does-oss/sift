import type { ReactNode } from "react";
import { Layers } from "lucide-react";

// Shared chrome for the hosted sign-in/sign-up pages: sift wordmark above a
// single elevated card, on the §13 field-green surface. Server component —
// the interactive form inside is the client boundary.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--surface-base)] grain-overlay p-4">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-muted)]">
          <Layers className="h-4.5 w-4.5 text-white" />
        </div>
        <span className="font-display text-2xl text-[var(--text-primary)]">Sift</span>
      </div>
      <div className="w-full max-w-sm rounded-xl card-elevated p-6">{children}</div>
    </main>
  );
}
