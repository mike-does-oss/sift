import type { TemplateExample } from "@/types";

/** §T3: templates.examples is capped at 5 entries — a handful is enough to steer a small model's output shape without bloating every prompt. */
export const MAX_TEMPLATE_EXAMPLES = 5;

/**
 * Combined byte (char) cap across every example's `output`, measured as the
 * sum of `JSON.stringify(output).length` — this is what actually gets
 * inlined into every prompt via `buildExamplesBlock`, so the cap bounds
 * prompt bloat regardless of how the 5-entry count cap is split across
 * examples. See S5 in the grounded-milestone final review: an unbounded
 * `output` was a token-burn / context-window footgun.
 */
export const MAX_TEMPLATE_EXAMPLES_BYTES = 8192;

/**
 * Validates the optional `examples` field shared by the templates API,
 * `/api/extract`, and `/api/batches` — `Array<{ output: Record<string,
 * unknown> }>`, capped at `MAX_TEMPLATE_EXAMPLES` entries and
 * `MAX_TEMPLATE_EXAMPLES_BYTES` combined, each `output` a plain (non-array,
 * non-null) object. `raw` is already-parsed JSON (callers that receive a
 * JSON string, e.g. the extract route's form field, parse it first).
 * Returns `{ ok: true, examples: undefined }` when `raw` is `undefined` OR
 * `null` — nothing to validate, nothing to store — so callers can treat an
 * absent field as a no-op rather than special-casing it. `null` matters
 * because that's what the nullable `templates.examples` column round-trips
 * as through drizzle for every template saved before this field existed (or
 * saved without examples) — this is the shared choke point all four
 * examples-consuming routes call through, so normalizing here fixes it
 * everywhere at once (see B1, final-review-grounded.md).
 */
export function validateExamples(
  raw: unknown
): { ok: true; examples: TemplateExample[] | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, examples: undefined };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "examples must be an array" };
  }
  if (raw.length > MAX_TEMPLATE_EXAMPLES) {
    return { ok: false, error: `examples must be ${MAX_TEMPLATE_EXAMPLES} or fewer` };
  }

  const examples: TemplateExample[] = [];
  let totalBytes = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: "each example must be an object of the form { output: {...} }" };
    }
    const output = (entry as Record<string, unknown>).output;
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      return { ok: false, error: "each example's `output` must be a plain object" };
    }
    totalBytes += JSON.stringify(output).length;
    examples.push({ output: output as Record<string, unknown> });
  }
  if (totalBytes > MAX_TEMPLATE_EXAMPLES_BYTES) {
    return { ok: false, error: "Examples are too large — keep them under 8KB combined." };
  }
  return { ok: true, examples };
}
