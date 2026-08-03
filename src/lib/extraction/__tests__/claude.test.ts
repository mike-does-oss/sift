import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.hoisted(() => vi.fn());
const constructorMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    messages = { create: (...args: unknown[]) => createMock(...args) };
    constructor(opts: unknown) {
      constructorMock(opts);
    }
  }
  return { default: Anthropic };
});

import { extractWithClaude } from "../claude";

const textSource = { kind: "text" as const, text: "Invoice total: $100.00" };
const baseInput = {
  source: textSource,
  filename: "doc.txt",
  fields: [{ id: "1", name: "total", type: "number" as const }],
  prompt: "",
  extractMultiple: false,
  apiKey: "ant-key",
};

function textResponse(obj: unknown) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(obj) }],
  };
}

describe("extractWithClaude", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a friendly error and never constructs a client when no apiKey is given", async () => {
    const result = await extractWithClaude({ ...baseInput, apiKey: undefined });
    expect(result).toEqual({ success: false, error: "Anthropic API key not set — add it in Settings" });
    expect(constructorMock).not.toHaveBeenCalled();
  });

  it("requests the grounded schema (each field wrapped as {value, quote}) and states the quote instruction in system", async () => {
    createMock.mockResolvedValue(textResponse({ total: { value: 100, quote: "$100.00" } }));

    await extractWithClaude(baseInput);

    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.output_config.format.type).toBe("json_schema");
    expect(call.output_config.format.schema.properties.total).toEqual({
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
    expect(call.system).toContain("also return `quote`");
  });

  it("unwraps a grounded response into data + quotes (single record)", async () => {
    createMock.mockResolvedValue(
      textResponse({ total: { value: 100, quote: "$100.00" }, purchase_order: { value: null, quote: null } })
    );

    const result = await extractWithClaude({
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
      textResponse({
        items: [{ name: { value: "Widget", quote: "widget" } }, { name: { value: "Gadget", quote: "gadget" } }],
      })
    );

    const result = await extractWithClaude({
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
    createMock.mockResolvedValue(textResponse({ total: 100 }));

    const result = await extractWithClaude(baseInput);
    expect(result).toEqual({ success: true, data: { total: 100 }, quotes: { total: null } });
  });

  it("returns a friendly error when the model refuses", async () => {
    createMock.mockResolvedValue({ stop_reason: "refusal", content: [] });
    const result = await extractWithClaude(baseInput);
    expect(result).toEqual({ success: false, error: "The model declined to process this document." });
  });

  it("returns a friendly error when output is truncated by max_tokens", async () => {
    createMock.mockResolvedValue({ stop_reason: "max_tokens", content: [] });
    const result = await extractWithClaude(baseInput);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("too large");
  });
});
