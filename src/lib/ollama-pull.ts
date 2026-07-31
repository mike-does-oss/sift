// Testable core of `POST /api/providers/pull` (see src/app/api/providers/pull/route.ts).
// Kept free of `next/server` so it can be unit tested with a mocked `fetch`
// without pulling in the Next.js request/response machinery.

const MODEL_NAME_PATTERN = /^[A-Za-z0-9._:/-]+$/;

export type ModelNameValidation = { ok: true; model: string } | { ok: false; error: string };

/**
 * Validates a model name coming from the request body. Trims surrounding
 * whitespace, then requires the result to be non-empty and made up only of
 * `[A-Za-z0-9._:/-]` — this value is only ever used as a JSON body field
 * (never interpolated into a shell command or URL path), but keeping the
 * accepted character set tight costs nothing and rules out anything with
 * embedded whitespace or control characters.
 */
export function validateModelName(raw: unknown): ModelNameValidation {
  if (typeof raw !== "string") {
    return { ok: false, error: '"model" is required and must be a string.' };
  }
  const model = raw.trim();
  if (!model) {
    return { ok: false, error: '"model" is required and must be a string.' };
  }
  if (!MODEL_NAME_PATTERN.test(model)) {
    return { ok: false, error: '"model" may only contain letters, numbers, and . _ : / -' };
  }
  return { ok: true, model };
}

export type PullProxyResult =
  | { kind: "stream"; body: ReadableStream<Uint8Array> }
  | { kind: "error"; status: number; error: string };

/**
 * Proxies `POST {baseUrl}/api/pull` with `{ model, stream: true }`. On
 * success, returns Ollama's NDJSON response body untouched — the caller
 * pipes it straight through to the client, chunk by chunk, with no
 * buffering, so progress lines arrive as Ollama reports them.
 *
 * Connection failures map to a 502 "Can't reach Ollama…" error, matching the
 * friendly copy used by `POST /api/providers/test`. Non-OK upstream
 * responses forward the upstream status with its body text folded into the
 * error message.
 */
export async function proxyOllamaPull(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch = fetch
): Promise<PullProxyResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
    });
  } catch {
    return {
      kind: "error",
      status: 502,
      error: `Can't reach Ollama at ${baseUrl} — is it running? (start it with \`ollama serve\`)`,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      kind: "error",
      status: res.status,
      error: body ? `Ollama error (${res.status}): ${body.slice(0, 200)}` : `Ollama error (${res.status})`,
    };
  }

  if (!res.body) {
    return { kind: "error", status: 502, error: "Ollama returned an empty response." };
  }

  return { kind: "stream", body: res.body };
}
