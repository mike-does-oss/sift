import type { TemplateExample } from "@/types";

/** §T3: templates.examples is capped at 5 entries — a handful is enough to steer a small model's output shape without bloating every prompt. */
export const MAX_TEMPLATE_EXAMPLES = 5;

/**
 * Validates the optional `examples` field shared by the templates API,
 * `/api/extract`, and `/api/batches` — `Array<{ output: Record<string,
 * unknown> }>`, capped at `MAX_TEMPLATE_EXAMPLES`, each `output` a plain
 * (non-array, non-null) object. `raw` is already-parsed JSON (callers that
 * receive a JSON string, e.g. the extract route's form field, parse it
 * first). Returns `{ ok: true, examples: undefined }` when `raw` is
 * `undefined` — nothing to validate, nothing to store — so callers can treat
 * an absent field as a no-op rather than special-casing it.
 */
export function validateExamples(
  raw: unknown
): { ok: true; examples: TemplateExample[] | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, examples: undefined };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "examples must be an array" };
  }
  if (raw.length > MAX_TEMPLATE_EXAMPLES) {
    return { ok: false, error: `examples must be ${MAX_TEMPLATE_EXAMPLES} or fewer` };
  }

  const examples: TemplateExample[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: "each example must be an object of the form { output: {...} }" };
    }
    const output = (entry as Record<string, unknown>).output;
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      return { ok: false, error: "each example's `output` must be a plain object" };
    }
    examples.push({ output: output as Record<string, unknown> });
  }
  return { ok: true, examples };
}
