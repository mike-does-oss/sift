import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user";
import { getSettings } from "@/lib/settings";
import { isHosted } from "@/lib/profile";
import { proxyOllamaPull, validateModelName } from "@/lib/ollama-pull";

// Streams a real download for a while on a slow connection — Node runtime
// keeps this a plain long-lived HTTP proxy (not Edge), which is what
// `res.body` passthrough below relies on.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Hosted (§SaaS-1 T6, decision 8): there is no Ollama, and proxying a pull
  // to a tenant-supplied `ollamaBaseUrl` would be an SSRF hole — the route
  // doesn't exist on the hosted profile.
  if (isHosted()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const modelField = (body as { model?: unknown } | null)?.model;
  const validated = validateModelName(modelField);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const settings = await getSettings(user.id);
  const result = await proxyOllamaPull(settings.ollamaBaseUrl, validated.model);
  if (result.kind === "error") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Forward Ollama's NDJSON stream chunk-by-chunk — no buffering — so the
  // client sees progress lines as they arrive rather than all at once at
  // the end.
  return new NextResponse(result.body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
