import { describe, it, expect, vi } from "vitest";
import { proxyOllamaPull, validateModelName } from "../ollama-pull";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("validateModelName", () => {
  it("rejects a missing model", () => {
    expect(validateModelName(undefined)).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects a non-string model", () => {
    expect(validateModelName(123)).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects an empty or whitespace-only model", () => {
    expect(validateModelName("").ok).toBe(false);
    expect(validateModelName("   ").ok).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateModelName("  all-minilm  ")).toEqual({ ok: true, model: "all-minilm" });
  });

  it("rejects embedded whitespace", () => {
    expect(validateModelName("gemma3 4b").ok).toBe(false);
  });

  it("rejects characters outside [A-Za-z0-9._:/-]", () => {
    expect(validateModelName("gemma3;rm -rf").ok).toBe(false);
    expect(validateModelName("model$(whoami)").ok).toBe(false);
  });

  it("accepts the allowed character set, including tag separators", () => {
    expect(validateModelName("gemma3:4b")).toEqual({ ok: true, model: "gemma3:4b" });
    expect(validateModelName("library/all-minilm")).toEqual({ ok: true, model: "library/all-minilm" });
    expect(validateModelName("foo.bar_is-not-a-thing:v1")).toEqual({
      ok: true,
      model: "foo.bar_is-not-a-thing:v1",
    });
  });
});

describe("proxyOllamaPull", () => {
  it("POSTs to {base}/api/pull with stream:true and the model passed through", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      body: streamFromChunks(['{"status":"success"}\n']),
    });

    await proxyOllamaPull("http://localhost:11434", "all-minilm", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/pull");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ model: "all-minilm", stream: true });
  });

  it("passes the upstream NDJSON stream through untouched, chunk by chunk", async () => {
    const chunks = [
      '{"status":"pulling manifest"}\n',
      '{"status":"pulling abc","digest":"sha256:abc","total":100,"completed":50}\n',
      '{"status":"success"}\n',
    ];
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, body: streamFromChunks(chunks) });

    const result = await proxyOllamaPull("http://localhost:11434", "all-minilm", fetchImpl);

    expect(result.kind).toBe("stream");
    if (result.kind !== "stream") throw new Error("expected stream result");
    const text = await readAll(result.body);
    expect(text).toBe(chunks.join(""));
  });

  it("maps a connection failure to a friendly 502 error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));

    const result = await proxyOllamaPull("http://localhost:11434", "all-minilm", fetchImpl);

    expect(result).toEqual({
      kind: "error",
      status: 502,
      error: expect.stringContaining("Can't reach Ollama"),
    });
  });

  it("forwards a non-OK upstream status and folds the body into the error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'model "no-such-model-xyz" not found',
    });

    const result = await proxyOllamaPull("http://localhost:11434", "no-such-model-xyz", fetchImpl);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected error result");
    expect(result.status).toBe(404);
    expect(result.error).toContain("404");
    expect(result.error).toContain("no-such-model-xyz");
  });

  it("errors out gracefully if the upstream response has no body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, body: null });

    const result = await proxyOllamaPull("http://localhost:11434", "all-minilm", fetchImpl);

    expect(result.kind).toBe("error");
  });
});

it("rejects model names longer than 128 characters", () => {
  const result = validateModelName("a".repeat(129));
  expect(result.ok).toBe(false);
});
