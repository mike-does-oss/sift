import { describe, it, expect, vi, afterEach } from "vitest";
import { compatChat } from "../openaiCompatible";

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
});
