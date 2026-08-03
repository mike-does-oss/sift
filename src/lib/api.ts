import type { ExtractionData } from "@/types";
import type { SystemInfo, ModelRec } from "@/lib/model-recommend";

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

/**
 * One line of Ollama's `POST /api/pull` NDJSON stream, as surfaced to
 * `SiftApi.pullModel`'s progress callback. `completed`/`total` are per-layer
 * byte counts (present once Ollama starts downloading a layer's `digest`) —
 * see `src/lib/pull-progress.ts` for summing them into an overall percent.
 */
export interface PullProgress {
  status: string;
  digest?: string;
  completed?: number;
  total?: number;
}

/** Summary shape returned by dataset list/create/fetch endpoints. */
export interface DatasetSummary {
  id: string;
  name: string;
  headers: string[];
  rowCount: number;
  createdAt: string;
}

export interface DatasetRow {
  id: string;
  row: Record<string, unknown>;
  addedAt: string;
}

export interface CreateDatasetInput {
  name: string;
  headers: string[];
  rows?: Record<string, unknown>[];
}

export interface ExtractResponse {
  success: boolean;
  data?: ExtractionData;
  error?: string;
  provider?: string;
  model?: string;
  /**
   * The document text the model saw (or, for PDFs, the extracted text layer
   * used for anchoring highlights even when the engine read the PDF natively
   * via vision) — absent for images, which have no text representation.
   * Additive field (Task 5): older callers that ignore it are unaffected.
   */
  text?: string;
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
  /**
   * Downloads an Ollama model via `POST /api/providers/pull`, invoking
   * `onProgress` once per NDJSON line the server forwards. Resolves once the
   * stream ends with a "success" status; rejects with the stream's error
   * line, an HTTP error, or (if `signal` fires) an `AbortError`.
   */
  pullModel(model: string, onProgress: (progress: PullProgress) => void, signal?: AbortSignal): Promise<void>;
  /**
   * Machine hardware (RAM/arch/platform) plus model recommendations sized to
   * it — see `src/lib/model-recommend.ts`. Backs the "Recommended for this
   * machine" list in Settings and the workspace empty-local affordance.
   */
  getSystemInfo(): Promise<{ system: SystemInfo; recommendations: ModelRec[] }>;
  /** Datasets — the local, durable results store (`/api/datasets`). */
  listDatasets(): Promise<DatasetSummary[]>;
  createDataset(input: CreateDatasetInput): Promise<DatasetSummary>;
  appendRows(
    datasetId: string,
    rows: Record<string, unknown>[],
    sourceJobId?: string
  ): Promise<{ added: number; rowCount: number }>;
  getDataset(id: string): Promise<{ dataset: DatasetSummary; rows: DatasetRow[] }>;
  deleteDataset(id: string): Promise<void>;
  deleteRow(datasetId: string, rowId: string): Promise<{ rowCount: number }>;
}

interface OllamaPullLine {
  status?: string;
  error?: string;
  digest?: string;
  completed?: number;
  total?: number;
}

function parsePullLine(line: string): OllamaPullLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as OllamaPullLine;
  } catch {
    return null; // ignore malformed lines rather than failing the whole download
  }
}

/** Extracts a route's `{ error }` JSON body, falling back to a generic message. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return data.error as string;
  } catch {
    // no JSON error body — fall back to the generic message
  }
  return fallback;
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

  async pullModel(
    model: string,
    onProgress: (progress: PullProgress) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch("/api/providers/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal,
    });

    if (!res.ok || !res.body) {
      let message = `Failed to start model download (${res.status})`;
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch {
        // no JSON error body — fall back to the generic message above
      }
      throw new Error(message);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastStatus = "";

    const handleLine = (raw: string) => {
      const parsed = parsePullLine(raw);
      if (!parsed) return;
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.status) {
        lastStatus = parsed.status;
        onProgress({
          status: parsed.status,
          digest: parsed.digest,
          completed: parsed.completed,
          total: parsed.total,
        });
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // The last split segment is either empty (buffer ended on a newline)
      // or a partial line split across chunk boundaries — keep it for next
      // time instead of parsing it early.
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }
    if (buffer) handleLine(buffer);

    if (lastStatus !== "success") {
      throw new Error(
        lastStatus ? `Download ended unexpectedly (last status: "${lastStatus}").` : "Download ended unexpectedly."
      );
    }
  }

  async getSystemInfo(): Promise<{ system: SystemInfo; recommendations: ModelRec[] }> {
    const res = await fetch("/api/system");
    if (!res.ok) {
      throw new Error(`Failed to load system info (${res.status})`);
    }
    return (await res.json()) as { system: SystemInfo; recommendations: ModelRec[] };
  }

  async listDatasets(): Promise<DatasetSummary[]> {
    const res = await fetch("/api/datasets");
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to load datasets (${res.status})`));
    }
    const body = await res.json();
    return body.datasets as DatasetSummary[];
  }

  async createDataset(input: CreateDatasetInput): Promise<DatasetSummary> {
    const res = await fetch("/api/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to create dataset (${res.status})`));
    }
    const body = await res.json();
    return body.dataset as DatasetSummary;
  }

  async appendRows(
    datasetId: string,
    rows: Record<string, unknown>[],
    sourceJobId?: string
  ): Promise<{ added: number; rowCount: number }> {
    const res = await fetch(`/api/datasets/${datasetId}/rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, sourceJobId }),
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to append rows (${res.status})`));
    }
    return (await res.json()) as { added: number; rowCount: number };
  }

  async getDataset(id: string): Promise<{ dataset: DatasetSummary; rows: DatasetRow[] }> {
    const res = await fetch(`/api/datasets/${id}`);
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to load dataset (${res.status})`));
    }
    return (await res.json()) as { dataset: DatasetSummary; rows: DatasetRow[] };
  }

  async deleteDataset(id: string): Promise<void> {
    const res = await fetch(`/api/datasets/${id}`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to delete dataset (${res.status})`));
    }
  }

  async deleteRow(datasetId: string, rowId: string): Promise<{ rowCount: number }> {
    const res = await fetch(`/api/datasets/${datasetId}/rows?rowId=${encodeURIComponent(rowId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to delete row (${res.status})`));
    }
    return (await res.json()) as { rowCount: number };
  }
}

export const webSiftApi: SiftApi = new WebSiftApi();
