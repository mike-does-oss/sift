import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { ProfileProvider } from "@/components/ProfileContext";
import { isHosted } from "@/lib/profile";

// Hosted: this layout reads the session cookie (`getSession()`), so it must
// render dynamically rather than being statically optimized. (`dynamic` must
// be a static export, so it applies on local too — same markup, just rendered
// per-request instead of prerendered.)
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Route protection lives in `src/proxy.ts` (Neon Auth middleware, matcher
  // scoped to /dashboard/:path*) — by the time this renders on hosted, the
  // request carries a valid session. The session is fetched here only to put
  // the signed-in email in the Sidebar's account block. Local profile: no
  // auth exists; `null` hides the account block entirely.
  const hosted = isHosted();
  let accountEmail: string | null = null;
  if (hosted) {
    const { getAuth } = await import("@/lib/auth/server");
    const { data: session } = await getAuth().getSession();
    accountEmail = session?.user.email ?? "";
  }

  return (
    <ProfileProvider hosted={hosted}>
      <div className="flex min-h-screen bg-[var(--surface-base)] grain-overlay">
        <Sidebar accountEmail={accountEmail} />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </ProfileProvider>
  );
}
