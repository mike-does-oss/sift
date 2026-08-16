"use client";

import { createContext, useContext, type ReactNode } from "react";

// §SaaS-1 T6: `SIFT_PROFILE` is a server-only env var, so client components
// learn the active profile through this context, provided once by the
// dashboard layout (a server component that reads `isHosted()`). The default
// is `false` — any surface rendered outside the provider behaves exactly like
// the local profile, which is the safe direction (nothing hosted-only leaks
// into local UI, and hosted API routes enforce their own policy regardless).
const HostedContext = createContext(false);

export function ProfileProvider({ hosted, children }: { hosted: boolean; children: ReactNode }) {
  return <HostedContext.Provider value={hosted}>{children}</HostedContext.Provider>;
}

/** True when the app runs as the hosted multi-tenant service. */
export function useHosted(): boolean {
  return useContext(HostedContext);
}
