"use client";

import { useEffect, useState } from "react";
import { isProviderId, type ProviderId } from "@/lib/api";
import { PaginationBar } from "@/components/PaginationBar";
import { StatusLed } from "@/components/dashboard/StatusLed";
import { PAGE_SIZE, clampPage, pageSlice } from "@/lib/pagination";
import {
  HISTORY_FILTERS,
  HISTORY_FILTER_LABELS,
  filterJobs,
  jobIdentity,
  snapshotResultView,
  formatResultValue,
  type HistoryFilter,
} from "@/lib/job-display";

interface Job {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  source: "single" | "batch" | "schedule";
  sourceFilename: string | null;
  templateSnapshot: unknown;
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

/**
 * Expanded-row detail: a mini field→value table keyed to the job's
 * templateSnapshot (a single-object result reads as key→value rows; a
 * multi-row result as a small columnar table), with the raw JSON pre kept
 * only as the fallback — for values outside the snapshot, or for results
 * that aren't table-shaped at all.
 */
function JobResultDetail({ job }: { job: Job }) {
  const view = snapshotResultView(job.templateSnapshot, job.result);

  if (!view) {
    return (
      <pre className="data p-3 rounded bg-[var(--surface-inset)] text-xs text-[var(--text-secondary)] overflow-x-auto border border-[var(--border-subtle)] max-h-64">
        {job.result ? JSON.stringify(job.result, null, 2) : "No result"}
      </pre>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded bg-[var(--surface-inset)] border border-[var(--border-subtle)] overflow-x-auto max-h-64 overflow-y-auto">
        {view.rows.length === 1 ? (
          <table className="w-full text-xs">
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {view.fieldNames.map((name) => (
                <tr key={name}>
                  <td className="data px-3 py-1.5 text-[var(--text-tertiary)] whitespace-nowrap align-top w-0">
                    {name}
                  </td>
                  <td className="data px-3 py-1.5 text-[var(--text-primary)]">
                    {formatResultValue(view.rows[0][name])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                {view.fieldNames.map((name) => (
                  <th key={name} className="data px-3 py-1.5 text-left font-medium text-[var(--text-tertiary)] whitespace-nowrap">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {view.rows.map((row, i) => (
                <tr key={i}>
                  {view.fieldNames.map((name) => (
                    <td key={name} className="data px-3 py-1.5 text-[var(--text-primary)] align-top">
                      {formatResultValue(row[name])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {view.extras && (
        <pre className="data p-3 rounded bg-[var(--surface-inset)] text-xs text-[var(--text-secondary)] overflow-x-auto border border-[var(--border-subtle)] max-h-40">
          {JSON.stringify(view.extras.length === 1 ? view.extras[0] : view.extras, null, 2)}
        </pre>
      )}
    </div>
  );
}

// UI-2 U1: the former /dashboard/history page body, rendered as the History
// tab of /dashboard/runs. Keeps its own data fetching; the runs page owns the
// header, tab bar, and outer container.
export function HistoryPanel() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Status/source filter + §13 pagination over the fetched rows — all
  // client-side (the fetch limit stays put; this is navigation, not a new
  // data contract). Page resets on a filter change, and clampPage covers a
  // shrink either way.
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [page, setPage] = useState(1);

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

  const filtered = filterJobs(jobs, filter);
  const currentPage = clampPage(page, filtered.length, PAGE_SIZE);
  const { startIndex, endIndex } = pageSlice(currentPage, filtered.length, PAGE_SIZE);
  const pageRows = filtered.slice(startIndex, endIndex);

  const selectFilter = (next: HistoryFilter) => {
    setFilter(next);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--text-tertiary)]">
        Every extraction job across single, batch, and scheduled runs.
      </p>

      {isLoading ? (
        <div className="h-6 w-40 rounded bg-[var(--surface-overlay)] animate-pulse" />
      ) : jobs.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">No extractions yet.</p>
      ) : (
        <>
          {/* §13 segmented pill bar — same idiom as the runs tab bar. */}
          <div className="flex items-center rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-0.5 text-xs font-medium w-fit">
            {HISTORY_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => selectFilter(key)}
                aria-pressed={filter === key}
                className={`px-3 py-1.5 rounded-[3px] transition-colors ${
                  filter === key
                    ? "bg-[var(--panel-raised)] text-[var(--text-primary)] border border-[var(--hairline-strong)]"
                    : "border border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {HISTORY_FILTER_LABELS[key]}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">
              No {HISTORY_FILTER_LABELS[filter].toLowerCase()} runs in the last {jobs.length} jobs.
            </p>
          ) : (
            <div className="card-elevated overflow-hidden">
              <div className="divide-y divide-[var(--border-subtle)]">
                {pageRows.map(({ job, filename }) => (
                  <details key={job.id} className="group">
                    <summary className="px-4 py-3 flex items-center gap-4 cursor-pointer select-none list-none hover:bg-[var(--surface-overlay)]/30 transition-colors">
                      <span className="w-40 flex-shrink-0 text-xs text-[var(--text-tertiary)] tabular-nums">
                        {new Date(job.createdAt).toLocaleString()}
                      </span>
                      <span className="w-20 flex-shrink-0 text-xs font-medium text-[var(--text-secondary)]">
                        {SOURCE_LABELS[job.source]}
                      </span>
                      <span className="data flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">
                        {jobIdentity(filename, job.sourceFilename, job.templateSnapshot)}
                      </span>
                      <span className="data w-32 flex-shrink-0 text-xs text-[var(--text-tertiary)] truncate">
                        {job.provider ? `${labelForProvider(job.provider)} · ${job.model ?? "—"}` : "—"}
                      </span>
                      <StatusLed status={job.status} className="w-28 justify-end" />
                    </summary>
                    <div className="px-4 pb-4">
                      {job.status === "failed" && job.error && (
                        <p className="text-xs text-[var(--error)] mb-2">{job.error}</p>
                      )}
                      <JobResultDetail job={job} />
                    </div>
                  </details>
                ))}
              </div>
              {filtered.length > PAGE_SIZE && (
                <PaginationBar page={currentPage} rowCount={filtered.length} onPageChange={setPage} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
