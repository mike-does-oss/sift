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
};

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
