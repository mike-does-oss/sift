import { describe, it, expect, vi, afterEach } from "vitest";
import { ollamaChat, extractWithOllama } from "../ollama";

describe("ollamaChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /api/chat with stream:false, the schema as format, model, and both messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '{"a":1}' } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const schema = { type: "object", properties: { a: { type: "number" } } };
    await ollamaChat("http://localhost:11434", "gemma3:4b", schema, "system prompt", "user text");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.stream).toBe(false);
    expect(body.format).toEqual(schema);
    expect(body.model).toBe("gemma3:4b");
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user text" },
    ]);
  });

  it("returns parsed data on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: '{"a":1}' } }),
      })
    );

    const result = await ollamaChat("http://localhost:11434", "gemma3:4b", {}, "sys", "user");
    expect(result).toEqual({ success: true, data: { a: 1 } });
  });

  it("maps a fetch rejection (connection refused) to a helpful error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"))
    );

    const result = await ollamaChat("http://localhost:11434", "gemma3:4b", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("is it running");
  });

  it("maps a 404 / 'not found' body to an ollama pull hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'model "gemma3:4b" not found, try pulling it first',
      })
    );

    const result = await ollamaChat("http://localhost:11434", "gemma3:4b", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("ollama pull");
  });

  it("returns an error when the response content is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: "not json" } }),
      })
    );

    const result = await ollamaChat("http://localhost:11434", "gemma3:4b", {}, "sys", "user");
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("Ollama returned invalid JSON");
  });

  it("omits the images key on the user message when no images are given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "{}" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await ollamaChat("http://localhost:11434", "gemma3:4b", {}, "sys", "user text");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1]).toEqual({ role: "user", content: "user text" });
  });

  it("adds an images array to the user message when images are given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "{}" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await ollamaChat("http://localhost:11434", "gemma3:4b", {}, "sys", "user text", ["base64pixels"]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1]).toEqual({ role: "user", content: "user text", images: ["base64pixels"] });
  });
});

describe("extractWithOllama", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an image source as the ollama images array (multimodal request shape)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '{"app_name":"Sift"}' } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractWithOllama({
      source: { kind: "image", base64: "aGVsbG8=", mediaType: "image/png" },
      filename: "receipt.png",
      fields: [{ id: "1", name: "app_name", type: "text" }],
      prompt: "",
      extractMultiple: false,
      baseUrl: "http://localhost:11434",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].images).toEqual(["aGVsbG8="]);
    expect(body.messages[1].content).not.toContain("DOCUMENT TEXT");
    expect(result).toEqual({ success: true, data: { app_name: "Sift" } });
  });

  it("includes a field's description in the field list line when present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "{}" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractWithOllama({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "total", type: "number", description: "The subtotal before tax" }],
      prompt: "",
      extractMultiple: false,
      baseUrl: "http://localhost:11434",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain("- total (number): The subtotal before tax");
  });

  it("omits the colon/description suffix for a field with no description", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "{}" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractWithOllama({
      source: { kind: "text", text: "doc text" },
      filename: "doc.txt",
      fields: [{ id: "1", name: "total", type: "number" }],
      prompt: "",
      extractMultiple: false,
      baseUrl: "http://localhost:11434",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain("- total (number)\n");
    expect(body.messages[1].content).not.toContain("- total (number):");
  });

  it("returns a friendly error for a pdf source with no extractable text, without calling ollama", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractWithOllama({
      source: { kind: "pdf", base64: "AAAA", text: "" },
      filename: "scan.pdf",
      fields: [{ id: "1", name: "total", type: "text" }],
      prompt: "",
      extractMultiple: false,
      baseUrl: "http://localhost:11434",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("No selectable text found");
  });
});
