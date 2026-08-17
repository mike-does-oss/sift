import type { ReactNode } from "react";
import { SiftWordmark } from "@/components/brand/SiftWordmark";

// Shared chrome for the hosted sign-in/sign-up pages: sift wordmark above a
// single elevated card, on the §13 field-green surface. Server component —
// the interactive form inside is the client boundary.
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--surface-base)] grain-overlay p-4">
      <div className="mb-6">
        <SiftWordmark markSize={34} textClassName="text-2xl" />
      </div>
      <div className="w-full max-w-sm rounded-xl card-elevated p-6">{children}</div>
    </main>
  );
}
