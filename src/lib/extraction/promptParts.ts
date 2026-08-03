import type { ExtractionData } from "@/types";
import { unwrapGrounded } from "./schema";
import {
  QUOTE_INSTRUCTION,
  VERBATIM_INSTRUCTION,
  buildExamplesBlock,
  type ExtractionInput,
  type ExtractionOutput,
} from "./types";

/**
 * Shared request-shaping for the two chat-completions-style text engines
 * (`ollama.ts`, `openaiCompatible.ts`) — factored out because the
 * grounded/ungrounded system prompt and the user-message instruction were
 * byte-identical between the two (verified with `diff` in the final review
 * for the grounded-extraction milestone, S4). `claude.ts`/`openai.ts` build
 * their prompts differently (native document blocks via each SDK) and are
 * intentionally not part of this — see the review's S4 for why only these
 * two engines share a helper.
 */

/**
 * The system prompt every text engine sends — identical modulo whether the
 * request is grounded (in which case `QUOTE_INSTRUCTION` asks the model to
 * also return a source `quote` per field, alongside `VERBATIM_INSTRUCTION`).
 */
export function textEngineSystemPrompt(grounded: boolean): string {
  return grounded
    ? `You are a precise data extraction assistant. Extract the requested fields from the document and return JSON matching the schema. Use null for missing values. Dates in ISO 8601 (YYYY-MM-DD). Numbers without currency symbols. ${VERBATIM_INSTRUCTION} ${QUOTE_INSTRUCTION}`
    : `You are a precise data extraction assistant. Extract the requested fields from the document and return JSON matching the schema. Use null for missing values. Dates in ISO 8601 (YYYY-MM-DD). Numbers without currency symbols. ${VERBATIM_INSTRUCTION}`;
}

/**
 * The user-message instruction preceding the document text/image — prompt
 * context, the field list, and (§T3) any few-shot examples appended via
 * `buildExamplesBlock`. Mode-independent: grounding only changes the system
 * prompt + schema, never this text.
 */
export function textEngineInstruction(
  input: Pick<ExtractionInput, "prompt" | "extractMultiple" | "fields" | "examples">
): string {
  return `${input.prompt ? `Context: ${input.prompt}\n\n` : ""}Extract ${input.extractMultiple ? "ALL records with" : ""} these fields:\n${input.fields
    .map((f) => `- ${f.name} (${f.type})${f.description ? `: ${f.description}` : ""}`)
    .join("\n")}${buildExamplesBlock(input.examples)}`;
}

/**
 * The tail every text engine runs on a successful raw response: pass
 * ungrounded results through as-is (unwrapping a `{ items: [...] }`
 * container for `extractMultiple`), or funnel a grounded response through
 * `unwrapGrounded` to split values from source quotes.
 */
export function finalizeTextEngineOutput(
  out: ExtractionOutput,
  grounded: boolean,
  extractMultiple: boolean
): ExtractionOutput {
  if (!out.success) return out;
  if (!grounded) {
    if (extractMultiple) {
      const d = out.data as Record<string, unknown>;
      return { success: true, data: (Array.isArray(d) ? d : (d.items as never)) ?? d };
    }
    return out;
  }
  const { data, quotes } = unwrapGrounded(out.data, extractMultiple);
  return { success: true, data: data as ExtractionData, quotes };
}
