import { describe, it, expect, vi, afterEach } from "vitest";
import { compatChat, extractWithOpenAICompatible } from "../openaiCompatible";

describe("compatChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to {base}/chat/completions with model, temperature:0, strict json_schema, and both messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const schema = { type: "object", properties: { a: { type: "number" } } };
    await compatChat("http://localhost:11434/v1", undefined, "gemma3:4b", schema, "system prompt", "user text");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("gemma3:4b");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "extraction", strict: true, schema },
    });
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user text" },
    ]);
  });

  it("omits the Authorization header when no apiKey is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await compatChat("http://localhost:11434/v1", undefined, "gemma3:4b", {}, "sys", "user");
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it("sends a Bearer Authorization header when an apiKey is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await compatChat("https://api.example.com/v1", "sk-test-123", "some-model", {}, "sys", "user");
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer sk-test-123");
  });

  it("returns parsed data on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }),
      })
    );

    const result = await compatChat("http://localhost:11434/v1", undefined, "gemma3:4b", {}, "sys", "user");
    expect(result).toEqual({ success: true, data: { a: 1 } });
  });

  it("maps a fetch rejection (unreachable base URL) to a helpful error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const result = await compatChat("http://localhost:9999/v1", undefined, "gemma3:4b", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe(
      "Can't reach http://localhost:9999/v1 — check the base URL"
    );
  });

  it("maps a 401 response to an API-key-rejected error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "Unauthorized" })
    );

    const result = await compatChat("https://api.example.com/v1", "bad-key", "some-model", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("API key rejected");
  });

  it("maps a 403 response to an API-key-rejected error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Forbidden" })
    );

    const result = await compatChat("https://api.example.com/v1", "bad-key", "some-model", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("API key rejected");
  });

  it("maps a 404 response to a model-not-found error naming the model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" })
    );

    const result = await compatChat("http://localhost:11434/v1", undefined, "nonexistent-model", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe(
      'Model "nonexistent-model" not found at this endpoint'
    );
  });

  it("maps a model_not_found error body (non-404 status) to the same friendly error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { code: "model_not_found", message: "no such model" } }),
      })
    );

    const result = await compatChat("https://api.example.com/v1", "key", "ghost-model", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe('Model "ghost-model" not found at this endpoint');
  });

  it("returns an error when the response content is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "not json" } }] }),
      })
    );

    const result = await compatChat("http://localhost:11434/v1", undefined, "gemma3:4b", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("invalid JSON");
  });

  it("returns an error when there is no content at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: {} }] }),
      })
    );

    const result = await compatChat("http://localhost:11434/v1", undefined, "gemma3:4b", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Empty response");
  });

  it("accepts a content-part array (vision) as the user message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const parts = [
      { type: "text" as const, text: "describe this" },
      { type: "image_url" as const, image_url: { url: "data:image/png;base64,aGVsbG8=" } },
    ];
    await compatChat("http://localhost:11434/v1", undefined, "gemma3:4b", {}, "sys", parts);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1]).toEqual({ role: "user", content: parts });
  });
});

describe("extractWithOpenAICompatible", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an image source as an image_url data URL (vision request shape)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"app_name":{"value":"Sift","quote":"Sift"}}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractWithOpenAICompatible({
      source: { kind: "image", base64: "aGVsbG8=", mediaType: "image/png" },
      filename: "receipt.png",
      fields: [{ id: "1", name: "app_name", type: "text" }],
      prompt: "",
      extractMultiple: false,
      grounded: true,
      baseUrl: "http://localhost:11434/v1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toEqual([
      { type: "text", text: expect.any(String) },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
    ]);
    expect(result).toEqual({ success: true, data: { app_name: "Sift" }, quotes: { app_name: "Sift" } });
  });

  it("includes a field's description in the field list line when present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "total", type: "number", description: "The subtotal before tax" }],
      prompt: "",
      extractMultiple: false,
      baseUrl: "http://localhost:11434/v1",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain("- total (number): The subtotal before tax");
  });

  it("omits the colon/description suffix for a field with no description", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{}" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "total", type: "number" }],
      prompt: "",
      extractMultiple: false,
      baseUrl: "http://localhost:11434/v1",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain("- total (number)\n");
    expect(body.messages[1].content).not.toContain("- total (number):");
  });

  it("returns a friendly error for a pdf source with no extractable text, without calling the endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractWithOpenAICompatible({
      source: { kind: "pdf", base64: "AAAA", text: "" },
      filename: "scan.pdf",
      fields: [{ id: "1", name: "total", type: "text" }],
      prompt: "",
      extractMultiple: false,
      baseUrl: "http://localhost:11434/v1",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("No selectable text found");
  });

  it("requests the grounded schema (each field wrapped as {value, quote}) and states the quote instruction", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"total":{"value":100,"quote":"$100.00"}}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "total", type: "number" }],
      prompt: "",
      extractMultiple: false,
      grounded: true,
      baseUrl: "http://localhost:11434/v1",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format.json_schema.schema.properties.total).toEqual({
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
    expect(body.messages[0].content).toContain("also return `quote`");
  });

  it("unwraps a grounded response into data + quotes (single record)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  total: { value: 100, quote: "$100.00" },
                  purchase_order: { value: null, quote: null },
                }),
              },
            },
          ],
        }),
      })
    );

    const result = await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [
        { id: "1", name: "total", type: "number" },
        { id: "2", name: "purchase_order", type: "text" },
      ],
      prompt: "",
      extractMultiple: false,
      grounded: true,
      baseUrl: "http://localhost:11434/v1",
    });

    expect(result).toEqual({
      success: true,
      data: { total: 100, purchase_order: null },
      quotes: { total: "$100.00", purchase_order: null },
    });
  });

  it("unwraps a grounded multi-row response into aligned data + quotes arrays", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    { name: { value: "Widget", quote: "widget" } },
                    { name: { value: "Gadget", quote: "gadget" } },
                  ],
                }),
              },
            },
          ],
        }),
      })
    );

    const result = await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "name", type: "text" }],
      prompt: "",
      extractMultiple: true,
      grounded: true,
      baseUrl: "http://localhost:11434/v1",
    });

    expect(result).toEqual({
      success: true,
      data: [{ name: "Widget" }, { name: "Gadget" }],
      quotes: [{ name: "widget" }, { name: "gadget" }],
    });
  });

  it("treats a flat (non-grounded) value from the model defensively — value kept, quote null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"total":100}' } }] }),
      })
    );

    const result = await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "total", type: "number" }],
      prompt: "",
      extractMultiple: false,
      grounded: true,
      baseUrl: "http://localhost:11434/v1",
    });

    expect(result).toEqual({ success: true, data: { total: 100 }, quotes: { total: null } });
  });
});

describe("extractWithOpenAICompatible — ungrounded (default, §T2.5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Exact system prompt this engine sent pre-T1 (commit 56055aa) — the
  // byte-identical target for an ungrounded (default) request.
  const PRE_T1_SYSTEM =
    "You are a precise data extraction assistant. Extract the requested fields from the document and return JSON matching the schema. Use null for missing values. Dates in ISO 8601 (YYYY-MM-DD). Numbers without currency symbols. Copy values exactly as written in the document; do not translate, reformat, or normalize unless a field description says otherwise.";

  it("requests the flat pre-T1 schema and system prompt when grounded is omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"total":100}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "total", type: "number" }],
      prompt: "",
      extractMultiple: false,
      baseUrl: "http://localhost:11434/v1",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format.json_schema.schema.properties.total).toEqual({
      type: ["number", "null"],
      description: "The total as a numeric value",
    });
    expect(body.messages[0].content).toBe(PRE_T1_SYSTEM);
    expect(body.messages[0].content).not.toContain("quote");
  });

  it("requests the flat schema and system prompt when grounded: false is explicit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"total":100}' } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "total", type: "number" }],
      prompt: "",
      extractMultiple: false,
      grounded: false,
      baseUrl: "http://localhost:11434/v1",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toBe(PRE_T1_SYSTEM);
  });

  it("returns the flat value directly with no quotes key (single record)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"total":100}' } }] }),
      })
    );

    const result = await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "total", type: "number" }],
      prompt: "",
      extractMultiple: false,
      baseUrl: "http://localhost:11434/v1",
    });

    expect(result).toEqual({ success: true, data: { total: 100 } });
    expect(result).not.toHaveProperty("quotes");
  });

  it("returns the flat items array directly with no quotes key (multi-row)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ items: [{ name: "Widget" }, { name: "Gadget" }] }) } }],
        }),
      })
    );

    const result = await extractWithOpenAICompatible({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "name", type: "text" }],
      prompt: "",
      extractMultiple: true,
      baseUrl: "http://localhost:11434/v1",
    });

    expect(result).toEqual({ success: true, data: [{ name: "Widget" }, { name: "Gadget" }] });
    expect(result).not.toHaveProperty("quotes");
  });
});
