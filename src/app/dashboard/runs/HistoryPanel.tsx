"use client";

import { useEffect, useState } from "react";
import { isProviderId, type ProviderId } from "@/lib/api";

interface Job {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  source: "single" | "batch" | "schedule";
  result: unknown;
  error: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

interface JobRow {
  job: Job;
  filename: string | null;
}

const SOURCE_LABELS: Record<Job["source"], string> = {
  single: "Single",
  batch: "Batch",
  schedule: "Schedule",
};

// Record<ProviderId, string> (not Record<string, string>) so adding a
// provider id without a label here is a compile error, not silent drift.
const PROVIDER_LABELS: Record<ProviderId, string> = {
  ollama: "Local",
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  "openai-compatible": "OpenAI-compatible",
};

/** `job.provider` is a plain string from the DB (may predate a provider, or be corrupted) — only index the label map once it's confirmed to be a known id. */
function labelForProvider(id: string): string {
  return isProviderId(id) ? PROVIDER_LABELS[id] : id;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-[var(--surface-overlay)] text-[var(--text-tertiary)]",
  processing: "bg-[var(--accent-subtle)] text-[var(--accent)]",
  completed: "bg-[var(--success-subtle)] text-[var(--success)]",
  failed: "bg-[var(--error-subtle)] text-[var(--error)]",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        STATUS_STYLES[status] ?? STATUS_STYLES.pending
      }`}
    >
      {status}
    </span>
  );
}

// UI-2 U1: the former /dashboard/history page body, rendered as the History
// tab of /dashboard/runs. Keeps its own data fetching; the runs page owns the
// header, tab bar, and outer container.
export function HistoryPanel() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/history?limit=100");
        if (res.ok) setJobs((await res.json()).jobs ?? []);
      } catch {
        // transient network failure — the page renders with whatever loaded
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--text-tertiary)]">
        Every extraction job across single, batch, and scheduled runs.
      </p>

      {isLoading ? (
        <div className="h-6 w-40 rounded-full bg-[var(--surface-overlay)] animate-pulse" />
      ) : jobs.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">No extractions yet.</p>
      ) : (
        <div className="card-elevated rounded-xl overflow-hidden divide-y divide-[var(--border-subtle)]">
          {jobs.map(({ job, filename }) => (
            <details key={job.id} className="group">
              <summary className="px-4 py-3 flex items-center gap-4 cursor-pointer select-none list-none hover:bg-[var(--surface-overlay)]/30 transition-colors">
                <span className="w-40 flex-shrink-0 text-xs text-[var(--text-tertiary)] tabular-nums">
                  {new Date(job.createdAt).toLocaleString()}
                </span>
                <span className="w-20 flex-shrink-0 text-xs font-medium text-[var(--text-secondary)]">
                  {SOURCE_LABELS[job.source]}
                </span>
                <span className="data flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">
                  {filename ?? "—"}
                </span>
                <span className="data w-32 flex-shrink-0 text-xs text-[var(--text-tertiary)] truncate">
                  {job.provider ? `${labelForProvider(job.provider)} · ${job.model ?? "—"}` : "—"}
                </span>
                <StatusBadge status={job.status} />
              </summary>
              <div className="px-4 pb-4">
                {job.status === "failed" && job.error && (
                  <p className="text-xs text-[var(--error)] mb-2">{job.error}</p>
                )}
                <pre className="data p-3 rounded-lg bg-[var(--surface-inset)] text-xs text-[var(--text-secondary)] overflow-x-auto border border-[var(--border-subtle)] max-h-64">
                  {job.result ? JSON.stringify(job.result, null, 2) : "No result"}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
