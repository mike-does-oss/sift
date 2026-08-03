import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.hoisted(() => vi.fn());
const constructorMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => {
  class APIError extends Error {}
  class OpenAI {
    static APIError = APIError;
    chat = { completions: { create: (...args: unknown[]) => createMock(...args) } };
    files = { create: vi.fn(), delete: vi.fn() };
    constructor(opts: unknown) {
      constructorMock(opts);
    }
  }
  return { default: OpenAI };
});

import { extractWithOpenAI } from "../openai";

const textSource = { kind: "text" as const, text: "Invoice total: $100.00" };
const baseInput = {
  source: textSource,
  filename: "doc.txt",
  fields: [{ id: "1", name: "total", type: "number" as const }],
  prompt: "",
  extractMultiple: false,
  apiKey: "oai-key",
  grounded: true,
};
// Same request, but with the toggle entirely omitted — mirrors what the
// dashboard sends by default and what jobs/batches always send (§T2.5).
const baseInputNoGrounded = {
  source: textSource,
  filename: "doc.txt",
  fields: [{ id: "1", name: "total", type: "number" as const }],
  prompt: "",
  extractMultiple: false,
  apiKey: "oai-key",
};

// Exact system prompt OpenAI sent pre-T1 (commit 56055aa) for a single-record
// extraction — the byte-identical target for an ungrounded (default) request.
const PRE_T1_SYSTEM_SINGLE = `You are a precise data extraction assistant. Extract specific information from the provided document and return it as structured JSON.

Rules:
- Extract ONLY the requested fields from the document
- Examine the entire document carefully (all pages, or the full text/image provided)
- If a value cannot be found, use null
- For dates, use ISO 8601 format (YYYY-MM-DD)
- For numbers, return numeric values without currency symbols or units
- For arrays/lists, return an array of strings
- Be precise and accurate - do not make up information
- Copy values exactly as written in the document; do not translate, reformat, or normalize unless a field description says otherwise.`;

function chatResponse(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] };
}

describe("extractWithOpenAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a friendly error and never constructs a client when no apiKey is given", async () => {
    const result = await extractWithOpenAI({ ...baseInput, apiKey: undefined });
    expect(result).toEqual({ success: false, error: "OpenAI API key not set — add it in Settings" });
    expect(constructorMock).not.toHaveBeenCalled();
  });

  it("requests the grounded schema (each field wrapped as {value, quote}) and states the quote instruction in system", async () => {
    createMock.mockResolvedValue(chatResponse({ total: { value: 100, quote: "$100.00" } }));

    await extractWithOpenAI(baseInput);

    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.response_format.json_schema.strict).toBe(true);
    expect(call.response_format.json_schema.schema.properties.total).toEqual({
      type: "object",
      properties: {
        value: { type: ["number", "null"], description: "The total as a numeric value" },
        quote: {
          type: ["string", "null"],
          description: "Exact text from the document this value was taken from, verbatim; null if not directly present.",
        },
      },
      required: ["value", "quote"],
      additionalProperties: false,
    });
    expect(call.messages[0].content).toContain("also return `quote`");
  });

  it("unwraps a grounded response into data + quotes (single record)", async () => {
    createMock.mockResolvedValue(
      chatResponse({ total: { value: 100, quote: "$100.00" }, purchase_order: { value: null, quote: null } })
    );

    const result = await extractWithOpenAI({
      ...baseInput,
      fields: [
        { id: "1", name: "total", type: "number" },
        { id: "2", name: "purchase_order", type: "text" },
      ],
    });

    expect(result).toEqual({
      success: true,
      data: { total: 100, purchase_order: null },
      quotes: { total: "$100.00", purchase_order: null },
    });
  });

  it("unwraps a grounded multi-row response into aligned data + quotes arrays", async () => {
    createMock.mockResolvedValue(
      chatResponse({
        items: [{ name: { value: "Widget", quote: "widget" } }, { name: { value: "Gadget", quote: "gadget" } }],
      })
    );

    const result = await extractWithOpenAI({
      ...baseInput,
      fields: [{ id: "1", name: "name", type: "text" }],
      extractMultiple: true,
    });

    expect(result).toEqual({
      success: true,
      data: [{ name: "Widget" }, { name: "Gadget" }],
      quotes: [{ name: "widget" }, { name: "gadget" }],
    });
  });

  it("treats a flat (non-grounded) value from the model defensively — value kept, quote null", async () => {
    createMock.mockResolvedValue(chatResponse({ total: 100 }));

    const result = await extractWithOpenAI(baseInput);
    expect(result).toEqual({ success: true, data: { total: 100 }, quotes: { total: null } });
  });

  it("returns a friendly error when there is no response content", async () => {
    createMock.mockResolvedValue({ choices: [{ message: {} }] });
    const result = await extractWithOpenAI(baseInput);
    expect(result).toEqual({ success: false, error: "No response from AI model" });
  });
});

describe("extractWithOpenAI — ungrounded (default, §T2.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests the flat pre-T1 schema and system prompt when grounded is omitted", async () => {
    createMock.mockResolvedValue(chatResponse({ total: 100 }));

    await extractWithOpenAI(baseInputNoGrounded);

    const call = createMock.mock.calls[0][0];
    expect(call.response_format.json_schema.schema.properties.total).toEqual({
      type: ["number", "null"],
      description: "The total as a numeric value",
    });
    expect(call.messages[0].content).toBe(PRE_T1_SYSTEM_SINGLE);
    expect(call.messages[0].content).not.toContain("quote");
  });

  it("requests the flat schema and system prompt when grounded: false is explicit", async () => {
    createMock.mockResolvedValue(chatResponse({ total: 100 }));

    await extractWithOpenAI({ ...baseInput, grounded: false });

    const call = createMock.mock.calls[0][0];
    expect(call.response_format.json_schema.schema.properties.total).toEqual({
      type: ["number", "null"],
      description: "The total as a numeric value",
    });
    expect(call.messages[0].content).toBe(PRE_T1_SYSTEM_SINGLE);
  });

  it("returns the flat value directly with no quotes key (single record)", async () => {
    createMock.mockResolvedValue(chatResponse({ total: 100 }));

    const result = await extractWithOpenAI({ ...baseInput, grounded: false });
    expect(result).toEqual({ success: true, data: { total: 100 } });
    expect(result).not.toHaveProperty("quotes");
  });

  it("returns the flat items array directly with no quotes key (multi-row)", async () => {
    createMock.mockResolvedValue(chatResponse({ items: [{ name: "Widget" }, { name: "Gadget" }] }));

    const result = await extractWithOpenAI({
      ...baseInput,
      grounded: false,
      fields: [{ id: "1", name: "name", type: "text" }],
      extractMultiple: true,
    });

    expect(result).toEqual({ success: true, data: [{ name: "Widget" }, { name: "Gadget" }] });
    expect(result).not.toHaveProperty("quotes");
  });
});
