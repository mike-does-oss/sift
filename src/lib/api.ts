import type { ExtractionData } from "@/types";

/**
 * Provider identifiers.
 */
export type ProviderId = "ollama" | "anthropic" | "openai" | "gemini" | "openai-compatible";

export const PROVIDER_IDS: readonly ProviderId[] = ["ollama", "anthropic", "openai", "gemini", "openai-compatible"];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  privacy: "local" | "cloud";
  /** Models known to be usable right now (installed locally, or configured + suggestions for cloud). */
  models: string[];
  /** Human-readable caveat, e.g. "Ollama not running". Never contains key material. */
  note?: string;
  configured: boolean;
}

export interface ExtractResponse {
  success: boolean;
  data?: ExtractionData;
  error?: string;
  provider?: string;
  model?: string;
}

/**
 * The one seam between UI code and the data layer (see playbook §14). The
 * web app implements this over `fetch('/api/...')`; a future desktop shell
 * would implement the same interface over IPC. UI code should depend only on
 * this interface, never on `fetch` or route paths directly.
 */
export interface SiftApi {
  listProviders(): Promise<ProviderInfo[]>;
  /**
   * `formData` carries the same fields `POST /api/extract` accepts today
   * (`file`, `fields`, `prompt`, `extractMultiple`) plus the optional
   * per-request override fields `provider` and `model`.
   */
  extract(formData: FormData): Promise<ExtractResponse>;
}

class WebSiftApi implements SiftApi {
  async listProviders(): Promise<ProviderInfo[]> {
    const res = await fetch("/api/providers");
    if (!res.ok) {
      throw new Error(`Failed to load providers (${res.status})`);
    }
    const body = await res.json();
    return body.providers as ProviderInfo[];
  }

  async extract(formData: FormData): Promise<ExtractResponse> {
    const res = await fetch("/api/extract", { method: "POST", body: formData });
    return (await res.json()) as ExtractResponse;
  }
}

export const webSiftApi: SiftApi = new WebSiftApi();
