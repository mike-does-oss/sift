/** Detects whether a local Ollama daemon is reachable, for first-run onboarding. */
export async function detectOllama(
  baseUrl = "http://127.0.0.1:11434",
): Promise<{ running: boolean; models: string[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) return { running: false, models: [] };
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    return { running: true, models: (body.models ?? []).map((m) => m.name) };
  } catch {
    return { running: false, models: [] };
  } finally {
    clearTimeout(timeout);
  }
}
