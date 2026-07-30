import { describe, it, expect, vi, afterEach } from "vitest";
import { ollamaChat } from "../ollama";

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
});
