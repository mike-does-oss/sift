import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user";
import { scaffoldSchema, validateScaffoldDescription } from "@/lib/extraction/scaffold";
import { isProviderId } from "@/lib/api";
import { byoKeyActive, quotaGate } from "@/lib/gates";
import { getMonthlyUsage } from "@/lib/usage";
import type { ExtractionOverride } from "@/lib/extraction/provider-resolution";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: { description?: unknown; provider?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const validated = validateScaffoldDescription(body?.description);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  // Optional per-request provider/model override (§S3: scaffold must
  // dispatch through the same active-provider resolution as /api/extract,
  // not silently fall back to the configured default).
  const providerField = body?.provider;
  const modelField = body?.model;
  let override: ExtractionOverride | undefined;
  if (providerField !== undefined) {
    if (!isProviderId(providerField)) {
      return NextResponse.json({ error: `Unknown provider "${String(providerField)}"` }, { status: 400 });
    }
    override = { provider: providerField, model: typeof modelField === "string" && modelField ? modelField : undefined };
  }

  // §SaaS-1 hosted gates (T5 reviewer finding): scaffolding is a real LLM
  // call on the platform key, so it takes the same quota gate as /api/extract
  // — otherwise a free tenant gets unlimited unmetered platform calls. It
  // gates only (never counts toward usage: no job row). BYO users are exempt,
  // and their scaffold runs on their own key via the hosted resolution path.
  // The synthetic "local" plan bypasses everything, and on hosted the
  // provider/model pair is a billing decision, so the override is discarded.
  if (user.plan !== "local") {
    override = undefined;
    if (!byoKeyActive(user)) {
      const denial = quotaGate(user.plan, await getMonthlyUsage(user.id), 1);
      if (denial) {
        return NextResponse.json({ error: denial.error, code: denial.code }, { status: denial.status });
      }
    }
  }

  const result = await scaffoldSchema(validated.description, override, user.id);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ fields: result.fields, prompt: result.prompt, extractMultiple: result.extractMultiple });
}
