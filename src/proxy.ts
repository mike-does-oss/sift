import { NextResponse, type NextRequest } from "next/server";

// Route protection (hosted profile only): Neon Auth's `auth.middleware()`
// validates the session cookie and redirects unauthenticated requests to the
// sign-in page. The matcher is scoped to `/dashboard/:path*`, so this never
// touches `/api/*` (routes self-auth via `requireUser()`; the Neon Auth API
// routes are self-authenticating) or public pages.
//
// This runs in its own (edge) bundle, so the profile check is a plain env
// read. Local profile: pure pass-through — zero auth friction, and the Neon
// Auth client is never constructed (it would throw without its env vars).
export default async function proxy(request: NextRequest): Promise<NextResponse> {
  if (process.env.SIFT_PROFILE !== "hosted") return NextResponse.next();
  // Dynamic import: the Neon Auth SDK never loads on the local profile.
  const { getAuth } = await import("@/lib/auth/server");
  return getAuth().middleware({ loginUrl: "/auth/sign-in" })(request);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
