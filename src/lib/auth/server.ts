import { createNeonAuth } from "@neondatabase/auth/next/server";

// Neon Auth (Better Auth SDK) — hosted profile only. The singleton is created
// lazily so this module stays importable on the local profile (and in builds)
// where NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET aren't set: nothing
// throws until something actually exercises auth, which only hosted code
// paths do (guarded by `isHosted()` at every call site).
let instance: ReturnType<typeof createNeonAuth> | null = null;

export function getAuth(): ReturnType<typeof createNeonAuth> {
  if (!instance) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret) {
      throw new Error(
        "Neon Auth is not configured: NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET are required on the hosted profile (SIFT_PROFILE=hosted)."
      );
    }
    instance = createNeonAuth({ baseUrl, cookies: { secret } });
  }
  return instance;
}
