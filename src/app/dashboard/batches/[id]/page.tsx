"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, FileWarning, Database } from "lucide-react";
import { toCsv, jobsToRows, downloadText } from "@/lib/export";
import { SaveToDatasetPanel } from "@/components";

interface Job {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  error: string | null;
  result: unknown;
  createdAt: string;
}

interface JobRow {
  job: Job;
  filename: string | null;
}

interface Batch {
  id: string;
  name: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: string;
  /** `{ fields, prompt, extractMultiple }` at the time the batch was created — see `templates`/`jobs` in the schema comment. Loosely typed here since only `fields[].name` is used (see `fieldKeysFromSnapshot`). */
  templateSnapshot: unknown;
  outputDir: string | null;
}

/** Same key derivation `jobsToRows` implicitly relies on (result object keys == template field names) — read directly from the batch's `templateSnapshot.fields`, defensively, since it's untyped JSON from the DB. */
function fieldKeysFromSnapshot(snapshot: unknown): string[] {
  if (typeof snapshot !== "object" || snapshot === null || !("fields" in snapshot)) return [];
  const fields = (snapshot as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .map((f) => (typeof f === "object" && f !== null && "name" in f ? (f as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === "string" && name.trim() !== "");
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

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSavePanel, setShowSavePanel] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/batches/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        setLoadError("Couldn't load this batch.");
        return;
      }
      const data = await res.json();
      setBatch(data.batch);
      setJobs(data.jobs ?? []);
      setLoadError(null);
    } catch {
      // Network failure. Before the batch first loads this drives the inline
      // error state below; after that the page keeps its data and the next
      // poll tick silently retries.
      setLoadError("Couldn't load this batch. Check your connection.");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const processed = batch ? batch.completedCount + batch.failedCount : 0;
  const isDone = batch ? processed >= batch.totalCount : false;

  useEffect(() => {
    if (notFound) return;
    // Poll while the batch is still processing — and also while the initial
    // load has failed, so transient network blips self-heal without a refresh.
    const shouldPoll = batch ? !isDone : loadError !== null;
    if (!shouldPoll) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [batch, isDone, loadError, notFound, load]);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="h-6 w-40 rounded-full bg-[var(--surface-overlay)] animate-pulse" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <p className="text-sm text-[var(--text-tertiary)]">Batch not found.</p>
        <Link href="/dashboard/batches" className="text-sm text-[var(--accent)] font-medium">
          Back to batches
        </Link>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="p-8 max-w-3xl mx-auto space-y-3">
        <p className="text-sm text-[var(--error)]">
          {loadError ?? "Couldn't load this batch."}
        </p>
        <div className="flex items-center gap-4">
          <button onClick={load} className="px-3 py-2 rounded-lg btn-primary text-xs">
            Retry
          </button>
          <Link href="/dashboard/batches" className="text-sm text-[var(--accent)] font-medium">
            Back to batches
          </Link>
        </div>
      </div>
    );
  }

  const pct = batch.totalCount > 0 ? Math.min(100, (processed / batch.totalCount) * 100) : 0;

  const handleDownloadCsv = () => {
    const rows = jobsToRows(
      jobs
        .filter((j) => j.job.status === "completed")
        .map((j) => ({ result: j.job.result, filename: j.filename }))
    );
    downloadText(`${batch.name}.csv`, toCsv(rows), "text/csv");
  };

  const handleDownloadJson = () => {
    const results = jobs.filter((j) => j.job.status === "completed").map((j) => j.job.result);
    downloadText(`${batch.name}.json`, JSON.stringify(results, null, 2), "application/json");
  };

  // Same completed-job filtering `handleDownloadCsv` uses, flattened through
  // the same `jobsToRows` helper — the dataset's headers are the template's
  // field keys, not whatever extra columns jobsToRows adds (e.g. `_document`);
  // the save route projects each row onto the target dataset's headers server-side.
  const fieldKeys = fieldKeysFromSnapshot(batch.templateSnapshot);
  const datasetRows = jobsToRows(
    jobs.filter((j) => j.job.status === "completed").map((j) => ({ result: j.job.result, filename: j.filename }))
  );

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <Link
        href="/dashboard/batches"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Batches
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-[var(--text-primary)]">{batch.name}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1 tabular-nums">
            {processed} / {batch.totalCount} processed
            {batch.failedCount > 0 && ` · ${batch.failedCount} failed`}
          </p>
          {batch.outputDir && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Writing results to <span className="font-mono">{batch.outputDir}</span>
            </p>
          )}
        </div>
        {isDone && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleDownloadCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            <button
              onClick={handleDownloadJson}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              JSON
            </button>
            {fieldKeys.length > 0 && datasetRows.length > 0 && (
              <button
                onClick={() => setShowSavePanel((prev) => !prev)}
                aria-expanded={showSavePanel}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  showSavePanel
                    ? "border-[var(--accent-muted)] text-[var(--accent)] bg-[var(--accent-subtle)]"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)]"
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                Save to dataset
              </button>
            )}
          </div>
        )}
      </div>

      {showSavePanel && fieldKeys.length > 0 && (
        <div className="card-elevated rounded-xl p-4">
          <SaveToDatasetPanel fieldKeys={fieldKeys} rows={datasetRows} />
        </div>
      )}

      <div className="h-1.5 w-full rounded-full bg-[var(--surface-overlay)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            batch.failedCount > 0 ? "bg-[var(--error)]" : "bg-[var(--accent)]"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="card-elevated rounded-xl divide-y divide-[var(--border-subtle)] overflow-hidden">
        {jobs.map(({ job, filename }) => (
          <div key={job.id} className="flex items-start gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="data text-sm font-medium text-[var(--text-primary)] truncate">
                {filename ?? "Unknown file"}
              </p>
              {job.status === "failed" && job.error && (
                <p className="text-xs text-[var(--error)] mt-1 flex items-start gap-1.5">
                  <FileWarning className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  {job.error}
                </p>
              )}
            </div>
            <StatusBadge status={job.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
