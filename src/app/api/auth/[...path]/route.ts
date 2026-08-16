import { isHosted } from "@/lib/profile";

// Hosted: mounts every Neon Auth API operation (sign-in, sign-up, session,
// sign-out, …) under /api/auth/*. Local: the auth surface must not exist at
// all — plain 404, and the Neon Auth SDK is never even imported (dynamic
// import below).
type Ctx = { params: Promise<{ path: string[] }> };

const notFound = () => new Response("Not Found", { status: 404 });

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  if (!isHosted()) return notFound();
  const { getAuth } = await import("@/lib/auth/server");
  return getAuth().handler().GET(req, ctx);
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  if (!isHosted()) return notFound();
  const { getAuth } = await import("@/lib/auth/server");
  return getAuth().handler().POST(req, ctx);
}
