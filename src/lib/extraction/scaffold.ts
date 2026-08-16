import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ExtractionField, FieldType } from "@/types";
import { ollamaChat } from "./ollama";
import { compatChat } from "./openaiCompatible";
import { resolveProvider, type ExtractionOverride } from "./provider-resolution";

export type ScaffoldResult =
  | { success: true; fields: ExtractionField[]; prompt: string; extractMultiple: boolean }
  | { success: false; error: string };

/** Raw (pre-post-validation) result of the meta-extraction round trip. */
type RawScaffoldResult = { success: true; data: unknown } | { success: false; error: string };

const FIELD_TYPES: readonly FieldType[] = ["text", "number", "date", "boolean", "array"];
const MAX_FIELDS = 12;
const MAX_DESCRIPTION_LENGTH = 4000;

/**
 * Validates a raw `POST /api/scaffold` request body's `description` field —
 * pure and NextRequest-free so it's directly unit-testable (mirrors the
 * `validateModelName` / route split in `src/lib/ollama-pull.ts`). The route
 * itself stays a thin wrapper around this + `scaffoldSchema`.
 */
export function validateScaffoldDescription(raw: unknown): { ok: true; description: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "description is required and must be a non-empty string" };
  }
  if (raw.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` };
  }
  return { ok: true, description: raw.trim() };
}

export const SCAFFOLD_SYSTEM_PROMPT =
  "You design document-extraction schemas. Given a task description, produce the minimal set of fields " +
  "(snake_case names, correct types, one-line description each that will guide the extraction model), a short " +
  "refined extraction prompt, and whether the task needs one record (false) or one row per repeated item (true). " +
  "extract_multiple is true ONLY when one document contains many records to extract as rows (e.g. every " +
  "transaction on a statement); if the task describes one record per document, it must be false. " +
  "No commentary.";

/**
 * Strict meta-schema: the shape scaffoldSchema asks the model to fill in,
 * describing a document-extraction schema. Deliberately omits `minItems`/
 * `maxItems` on the `fields` array — OpenAI's strict structured-output mode
 * rejects those keywords with a 400 (documented restriction: strict schemas
 * support only a subset of JSON Schema). Bounds (1..MAX_FIELDS) are enforced
 * purely in `postValidate` instead, uniformly across every engine.
 */
export const SCAFFOLD_META_SCHEMA = {
  type: "object" as const,
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "snake_case field name" },
          type: { type: "string", enum: FIELD_TYPES, description: "One of the supported field types" },
          description: {
            type: "string",
            description: "One-line description that will guide the extraction model",
          },
        },
        required: ["name", "type", "description"],
        additionalProperties: false,
      },
      description: "The minimal set of fields needed for this extraction task",
    },
    prompt: { type: "string", description: "A short refined extraction prompt" },
    extract_multiple: {
      type: "boolean",
      description: "false for one record, true for one row per repeated item",
    },
  },
  required: ["fields", "prompt", "extract_multiple"],
  additionalProperties: false,
};

/** Normalizes a raw field name into snake_case (mirrors common slugify conventions: lower, `_`-joined, alnum only). */
function toSnakeCase(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * Resolves a normalized name against names already assigned: the first
 * occurrence keeps the bare name, each later collision gets the next free
 * `<name>_2`, `<name>_3`, … suffix — so "Invoice" and "Invoice #" (both
 * normalizing to "invoice") become "invoice" and "invoice_2" instead of the
 * second silently vanishing.
 */
function dedupeName(name: string, seenCounts: Map<string, number>): string {
  const count = seenCounts.get(name) ?? 0;
  seenCounts.set(name, count + 1);
  return count === 0 ? name : `${name}_${count + 1}`;
}

/**
 * Validates and normalizes the model's raw meta-extraction response into the
 * shape the workspace field editor expects: non-empty snake_case names,
 * collisions suffixed (see `dedupeName`) rather than dropped, types
 * constrained to the supported union (defaulting to "text" like the editor's
 * own unknown-type fallback — see `schema.ts` `fieldValueSchema`'s default
 * case), capped at `MAX_FIELDS`, with generated `scaffold-<n>` ids assigned
 * sequentially over the surviving fields (no gaps from dropped entries).
 * Bounds (empty/over-cap) are enforced here rather than in the meta-schema —
 * see `SCAFFOLD_META_SCHEMA`'s comment.
 */
export function postValidate(raw: unknown): ScaffoldResult {
  if (!raw || typeof raw !== "object") {
    return { success: false, error: "The model returned an unexpected response — try rephrasing your description." };
  }
  const obj = raw as Record<string, unknown>;
  const rawFields = Array.isArray(obj.fields) ? obj.fields : [];
  const prompt = typeof obj.prompt === "string" ? obj.prompt : "";
  const extractMultiple = obj.extract_multiple === true;

  const seenCounts = new Map<string, number>();
  const fields: ExtractionField[] = [];

  for (const entry of rawFields) {
    if (fields.length >= MAX_FIELDS) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const normalized = toSnakeCase(typeof e.name === "string" ? e.name : "");
    if (!normalized) continue;
    const name = dedupeName(normalized, seenCounts);

    const type: FieldType = isFieldType(e.type) ? e.type : "text";
    const description = typeof e.description === "string" && e.description.trim() ? e.description.trim() : undefined;

    fields.push({
      id: `scaffold-${fields.length + 1}`,
      name,
      type,
      ...(description ? { description } : {}),
    });
  }

  if (fields.length === 0) {
    return {
      success: false,
      error: "The model couldn't derive any fields from that description — try adding more detail.",
    };
  }

  return { success: true, fields, prompt, extractMultiple };
}

async function scaffoldWithAnthropic(model: string, apiKey: string | undefined, description: string): Promise<RawScaffoldResult> {
  if (!apiKey) return { success: false, error: "Anthropic API key not set — add it in Settings" };
  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SCAFFOLD_SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: SCAFFOLD_META_SCHEMA } },
      messages: [{ role: "user", content: description }],
    });
    if (response.stop_reason === "refusal") {
      return { success: false, error: "The model declined to process this description." };
    }
    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) return { success: false, error: "No response from model" };
    return { success: true, data: JSON.parse(text) };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return { success: false, error: `Claude API error: ${err.message}` };
    }
    return { success: false, error: err instanceof Error ? err.message : "Scaffolding failed" };
  }
}

async function scaffoldWithOpenAI(model: string, apiKey: string | undefined, description: string): Promise<RawScaffoldResult> {
  if (!apiKey) return { success: false, error: "OpenAI API key not set — add it in Settings" };
  const openai = new OpenAI({ apiKey });
  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SCAFFOLD_SYSTEM_PROMPT },
        { role: "user", content: description },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "scaffold_schema", strict: true, schema: SCAFFOLD_META_SCHEMA },
      },
      max_tokens: 4096,
      temperature: 0,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return { success: false, error: "No response from AI model" };
    return { success: true, data: JSON.parse(content) };
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      return { success: false, error: `OpenAI API error: ${err.message}` };
    }
    return { success: false, error: err instanceof Error ? err.message : "Scaffolding failed" };
  }
}

/**
 * Meta-extraction: turns a plain-language task description into a starting
 * fields/prompt/extractMultiple config, via a one-shot structured-output call
 * to the ACTIVE provider (same resolution rules as `runExtraction` — see
 * `resolveProvider`). Ollama/openai-compatible/gemini reuse the existing
 * low-level chat helpers (`ollamaChat`/`compatChat`); claude/openai make
 * their own structured-output call since they have no shared low-level
 * helper (their extract* functions are document-extraction-specific).
 */
export async function scaffoldSchema(description: string, override?: ExtractionOverride): Promise<ScaffoldResult> {
  const resolved = await resolveProvider(override);
  if (!resolved.ok) return { success: false, error: resolved.error };

  let raw: RawScaffoldResult;
  switch (resolved.provider) {
    case "ollama":
      raw = await ollamaChat(resolved.baseUrl, resolved.model, SCAFFOLD_META_SCHEMA, SCAFFOLD_SYSTEM_PROMPT, description);
      break;
    case "gemini":
    case "openai-compatible":
      raw = await compatChat(
        resolved.baseUrl,
        resolved.apiKey,
        resolved.model,
        SCAFFOLD_META_SCHEMA,
        SCAFFOLD_SYSTEM_PROMPT,
        description
      );
      break;
    case "anthropic":
      raw = await scaffoldWithAnthropic(resolved.model, resolved.apiKey, description);
      break;
    case "openai":
      raw = await scaffoldWithOpenAI(resolved.model, resolved.apiKey, description);
      break;
  }

  if (!raw.success) return raw;
  return postValidate(raw.data);
}
