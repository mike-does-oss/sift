import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSettingsMock = vi.fn();
vi.mock("@/lib/settings", () => ({ getSettings: () => getSettingsMock() }));

// Mirrors claude.test.ts's Anthropic SDK mock — scaffoldSchema makes its own
// structured-output call for the anthropic provider (no shared low-level
// helper, unlike ollama/compat — see scaffold.ts's dispatch comment).
const anthropicCreateMock = vi.hoisted(() => vi.fn());
const anthropicConstructorMock = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    messages = { create: (...args: unknown[]) => anthropicCreateMock(...args) };
    constructor(opts: unknown) {
      anthropicConstructorMock(opts);
    }
  }
  return { default: Anthropic };
});

// Mirrors openai.test.ts's OpenAI SDK mock, same reasoning as above.
const openaiCreateMock = vi.hoisted(() => vi.fn());
const openaiConstructorMock = vi.hoisted(() => vi.fn());
vi.mock("openai", () => {
  class APIError extends Error {}
  class OpenAI {
    static APIError = APIError;
    chat = { completions: { create: (...args: unknown[]) => openaiCreateMock(...args) } };
    constructor(opts: unknown) {
      openaiConstructorMock(opts);
    }
  }
  return { default: OpenAI };
});

import { scaffoldSchema, validateScaffoldDescription, postValidate, SCAFFOLD_SYSTEM_PROMPT, SCAFFOLD_META_SCHEMA } from "../scaffold";

const BASE_SETTINGS = {
  provider: "ollama" as const,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "gemma3:4b",
  anthropicApiKey: "ant-key",
  anthropicModel: "claude-sonnet-5",
  openaiApiKey: "oai-key",
  openaiModel: "gpt-4o",
  geminiApiKey: "gm-key",
  geminiModel: "gemini-2.0-flash",
  compatBaseUrl: "http://localhost:11434/v1",
  compatApiKey: "compat-key",
  compatModel: "gemma3:4b",
};

function scaffoldPayload(fields: unknown, promptText = "Extract data", extractMultiple = false) {
  return JSON.stringify({ fields, prompt: promptText, extract_multiple: extractMultiple });
}

function anthropicTextResponse(obj: unknown) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(obj) }],
  };
}

function openaiChatResponse(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

// The strict-mode-incompatible keywords OpenAI's structured-output rejects
// with a 400 when present on an array schema (documented restriction) —
// asserted absent everywhere SCAFFOLD_META_SCHEMA is sent.
function expectNoArrayBoundsKeywords(fieldsSchema: Record<string, unknown>) {
  expect(fieldsSchema).not.toHaveProperty("minItems");
  expect(fieldsSchema).not.toHaveProperty("maxItems");
}

describe("SCAFFOLD_META_SCHEMA", () => {
  it("omits minItems/maxItems on the fields array (OpenAI strict-mode compatibility)", () => {
    expectNoArrayBoundsKeywords(SCAFFOLD_META_SCHEMA.properties.fields as Record<string, unknown>);
  });
});

describe("scaffoldSchema — ollama meta-schema request shape", () => {
  beforeEach(() => {
    getSettingsMock.mockReturnValue(BASE_SETTINGS);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to {baseUrl}/api/chat with the meta-schema as `format`, the scaffold system prompt, and the description as the user message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: scaffoldPayload([
            { name: "vendor", type: "text", description: "The vendor name" },
            { name: "total", type: "number", description: "The invoice total" },
          ]),
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scaffoldSchema("extract the vendor and total from supplier invoices");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("gemma3:4b");
    expect(body.stream).toBe(false);
    expect(body.format.properties.fields).toBeDefined();
    expectNoArrayBoundsKeywords(body.format.properties.fields);
    expect(body.format.properties.fields.items.properties.type.enum).toEqual([
      "text",
      "number",
      "date",
      "boolean",
      "array",
    ]);
    expect(body.messages).toEqual([
      { role: "system", content: SCAFFOLD_SYSTEM_PROMPT },
      { role: "user", content: "extract the vendor and total from supplier invoices" },
    ]);

    expect(result).toEqual({
      success: true,
      fields: [
        { id: "scaffold-1", name: "vendor", type: "text", description: "The vendor name" },
        { id: "scaffold-2", name: "total", type: "number", description: "The invoice total" },
      ],
      prompt: "Extract data",
      extractMultiple: false,
    });
  });

  it("surfaces the engine's friendly error (e.g. Ollama unreachable) unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const result = await scaffoldSchema("extract the vendor");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("is it running");
  });
});

describe("scaffoldSchema — anthropic meta-call request shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, provider: "anthropic" });
  });

  it("calls messages.create with the scaffold system prompt, the meta-schema (no array bounds keywords), and the description as the user message", async () => {
    anthropicCreateMock.mockResolvedValue(
      anthropicTextResponse({
        fields: [{ name: "vendor", type: "text", description: "d" }],
        prompt: "p",
        extract_multiple: false,
      })
    );

    const result = await scaffoldSchema("extract the vendor");

    expect(anthropicConstructorMock).toHaveBeenCalledWith({ apiKey: "ant-key" });
    const call = anthropicCreateMock.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-5");
    expect(call.system).toBe(SCAFFOLD_SYSTEM_PROMPT);
    expect(call.messages).toEqual([{ role: "user", content: "extract the vendor" }]);
    expect(call.output_config.format.type).toBe("json_schema");
    expectNoArrayBoundsKeywords(call.output_config.format.schema.properties.fields);

    expect(result.success).toBe(true);
  });

  it("returns a friendly error and never constructs a client when no apiKey is given", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, provider: "anthropic", anthropicApiKey: "" });
    const result = await scaffoldSchema("extract the vendor");
    expect(result).toEqual({ success: false, error: "Anthropic API key not set — add it in Settings" });
    expect(anthropicConstructorMock).not.toHaveBeenCalled();
  });
});

describe("scaffoldSchema — openai meta-call request shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, provider: "openai" });
  });

  it("calls chat.completions.create with a strict json_schema response_format (no array bounds keywords) and the scaffold system/user messages", async () => {
    openaiCreateMock.mockResolvedValue(
      openaiChatResponse({
        fields: [{ name: "vendor", type: "text", description: "d" }],
        prompt: "p",
        extract_multiple: false,
      })
    );

    const result = await scaffoldSchema("extract the vendor");

    expect(openaiConstructorMock).toHaveBeenCalledWith({ apiKey: "oai-key" });
    const call = openaiCreateMock.mock.calls[0][0];
    expect(call.model).toBe("gpt-4o");
    expect(call.messages).toEqual([
      { role: "system", content: SCAFFOLD_SYSTEM_PROMPT },
      { role: "user", content: "extract the vendor" },
    ]);
    expect(call.response_format.type).toBe("json_schema");
    expect(call.response_format.json_schema.strict).toBe(true);
    expectNoArrayBoundsKeywords(call.response_format.json_schema.schema.properties.fields);

    expect(result.success).toBe(true);
  });

  it("returns a friendly error and never constructs a client when no apiKey is given", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, provider: "openai", openaiApiKey: "" });
    const result = await scaffoldSchema("extract the vendor");
    expect(result).toEqual({ success: false, error: "OpenAI API key not set — add it in Settings" });
    expect(openaiConstructorMock).not.toHaveBeenCalled();
  });
});

describe("scaffoldSchema — provider resolution reuse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the same friendly error runExtraction would when no Gemini key is configured", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, provider: "gemini", geminiApiKey: "" });
    const result = await scaffoldSchema("extract fields");
    expect(result).toEqual({ success: false, error: "Gemini API key not set — add it in Settings" });
  });

  it("dispatches openai-compatible/gemini through compatChat against the resolved base URL", async () => {
    getSettingsMock.mockReturnValue({ ...BASE_SETTINGS, provider: "openai-compatible" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: scaffoldPayload([{ name: "total", type: "number", description: "d" }]) } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scaffoldSchema("extract the total");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/v1/chat/completions");
    expect(result.success).toBe(true);
  });
});

describe("scaffoldSchema — post-validation", () => {
  beforeEach(() => {
    getSettingsMock.mockReturnValue(BASE_SETTINGS);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function runWithFields(fields: unknown, promptText = "p", extractMultiple = false) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: scaffoldPayload(fields, promptText, extractMultiple) } }),
      })
    );
    return scaffoldSchema("some description");
  }

  it("normalizes names to snake_case", async () => {
    const result = await runWithFields([{ name: "Invoice Number", type: "text", description: "d" }]);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.fields[0].name).toBe("invoice_number");
  });

  it("suffixes (rather than drops) a field whose normalized name collides with an earlier one", async () => {
    const result = await runWithFields([
      { name: "Total", type: "number", description: "first" },
      { name: "total", type: "text", description: "second, should be suffixed not dropped" },
    ]);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.fields.map((f) => f.name)).toEqual(["total", "total_2"]);
    expect(result.fields).toHaveLength(2);
  });

  it("drops fields with an empty/unnormalizable name", async () => {
    const result = await runWithFields([
      { name: "   ", type: "text", description: "d" },
      { name: "vendor", type: "text", description: "d" },
    ]);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].name).toBe("vendor");
    // ids are sequential over surviving fields, not the original index
    expect(result.fields[0].id).toBe("scaffold-1");
  });

  it("falls back unknown/invalid types to text", async () => {
    const result = await runWithFields([{ name: "weird", type: "currency", description: "d" }]);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.fields[0].type).toBe("text");
  });

  it("caps fields at 12, dropping the rest", async () => {
    const fields = Array.from({ length: 15 }, (_, i) => ({ name: `field_${i}`, type: "text", description: "d" }));
    const result = await runWithFields(fields);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.fields).toHaveLength(12);
    expect(result.fields[11].id).toBe("scaffold-12");
  });

  it("returns a friendly error when no fields survive validation", async () => {
    const result = await runWithFields([{ name: "", type: "text", description: "d" }]);
    expect(result).toEqual({
      success: false,
      error: "The model couldn't derive any fields from that description — try adding more detail.",
    });
  });

  it("returns a friendly error when the model response isn't a JSON object at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: { content: "null" } }) })
    );
    const result = await scaffoldSchema("desc");
    expect(result.success).toBe(false);
  });

  it("passes extract_multiple through as extractMultiple", async () => {
    const result = await runWithFields([{ name: "item", type: "text", description: "d" }], "p", true);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.extractMultiple).toBe(true);
  });
});

// Bounds are enforced purely in postValidate now (not the meta-schema — see
// SCAFFOLD_META_SCHEMA's comment), so these exercise it directly rather than
// through a full scaffoldSchema round trip.
describe("postValidate — field count bounds", () => {
  it("lower bound: an empty fields array returns a friendly error, not an empty success", () => {
    const result = postValidate({ fields: [], prompt: "p", extract_multiple: false });
    expect(result).toEqual({
      success: false,
      error: "The model couldn't derive any fields from that description — try adding more detail.",
    });
  });

  it("upper bound: more than 12 fields is capped at exactly 12, not rejected", () => {
    const fields = Array.from({ length: 20 }, (_, i) => ({ name: `f_${i}`, type: "text", description: "d" }));
    const result = postValidate({ fields, prompt: "p", extract_multiple: false });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.fields).toHaveLength(12);
    expect(result.fields.map((f) => f.name)).toEqual(fields.slice(0, 12).map((f) => f.name));
  });

  it("suffixes collisions from 'Invoice' / 'Invoice #' into invoice / invoice_2", () => {
    const result = postValidate({
      fields: [
        { name: "Invoice", type: "text", description: "d" },
        { name: "Invoice #", type: "text", description: "d" },
      ],
      prompt: "p",
      extract_multiple: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.fields.map((f) => f.name)).toEqual(["invoice", "invoice_2"]);
  });

  it("suffixes collisions from 'Total ($)' / 'total' into total / total_2", () => {
    const result = postValidate({
      fields: [
        { name: "Total ($)", type: "number", description: "d" },
        { name: "total", type: "number", description: "d" },
      ],
      prompt: "p",
      extract_multiple: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.fields.map((f) => f.name)).toEqual(["total", "total_2"]);
  });

  it("suffixes a third collision as _3", () => {
    const result = postValidate({
      fields: [
        { name: "Total", type: "number", description: "d" },
        { name: "total!!", type: "number", description: "d" },
        { name: "  total  ", type: "number", description: "d" },
      ],
      prompt: "p",
      extract_multiple: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.fields.map((f) => f.name)).toEqual(["total", "total_2", "total_3"]);
  });
});

describe("validateScaffoldDescription", () => {
  it("rejects a missing description", () => {
    expect(validateScaffoldDescription(undefined)).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects a non-string description", () => {
    expect(validateScaffoldDescription(42)).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects an empty or whitespace-only description", () => {
    expect(validateScaffoldDescription("").ok).toBe(false);
    expect(validateScaffoldDescription("   ").ok).toBe(false);
  });

  it("rejects a description over 4000 characters", () => {
    const result = validateScaffoldDescription("a".repeat(4001));
    expect(result.ok).toBe(false);
  });

  it("accepts and trims a valid description at the boundary", () => {
    const description = "a".repeat(4000);
    expect(validateScaffoldDescription(description)).toEqual({ ok: true, description });
    expect(validateScaffoldDescription(`  ${description.slice(0, 10)}  `)).toEqual({
      ok: true,
      description: description.slice(0, 10),
    });
  });
});
