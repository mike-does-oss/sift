"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UPLOAD_ACCEPT_ATTR, filterSupportedFiles } from "@/lib/upload-accept";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, UploadCloud, Download, FileText, Check, Clock, Play, Settings2 } from "lucide-react";
import { uploadDocument } from "@/lib/upload-client";
import { toCsv, jobsToRows, downloadText } from "@/lib/export";
import { OutputSettingsFields, type OutputSettingsValue } from "@/components";
import { useHosted } from "@/components/ProfileContext";

interface Schedule {
  id: string;
  name: string;
  cadence: "daily" | "weekly";
  hourUtc: number;
  dayOfWeek: number | null;
  active: boolean;
  lastRunAt: string | null;
  outputDir: string | null;
  outputFormat: "csv" | "json" | "both";
  keepResults: boolean;
}

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

interface Doc {
  id: string;
  filename: string;
  processedAt: string | null;
  createdAt: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

function describeCadence(s: Schedule): string {
  const hour = `${String(s.hourUtc).padStart(2, "0")}:00 UTC`;
  if (s.cadence === "daily") return `Daily at ${hour}`;
  return `Weekly on ${DAYS[s.dayOfWeek ?? 0]} at ${hour}`;
}

/** Groups jobs into "runs" by rounding createdAt down to the minute — jobs
 * kicked off together (a batch produced by one schedule tick) share a run. */
function groupByRun(jobs: JobRow[]): { key: string; label: string; rows: JobRow[] }[] {
  const groups = new Map<string, JobRow[]>();
  for (const row of jobs) {
    const minute = row.job.createdAt.slice(0, 16); // YYYY-MM-DDTHH:MM
    const existing = groups.get(minute);
    if (existing) existing.push(row);
    else groups.set(minute, [row]);
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, rows]) => ({
      key,
      label: new Date(rows[0].job.createdAt).toLocaleString(),
      rows,
    }));
}

export default function ScheduleDetailPage() {
  // §SaaS-1 T6: output folders are a local-filesystem feature — the whole
  // OUTPUT card (view + edit) is hidden on hosted (the server also rejects
  // any outputDir there). Local rendering is unchanged.
  const hosted = useHosted();
  const { id } = useParams<{ id: string }>();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [isEditingOutput, setIsEditingOutput] = useState(false);
  const [outputDraft, setOutputDraft] = useState<OutputSettingsValue>({
    outputDir: "",
    outputFormat: "csv",
    keepResults: true,
  });
  const [isSavingOutput, setIsSavingOutput] = useState(false);
  const [outputSaveError, setOutputSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [scheduleRes, docsRes] = await Promise.all([
        fetch(`/api/schedules/${id}`),
        fetch(`/api/documents?scheduleId=${id}`),
      ]);
      if (scheduleRes.status === 404) {
        setNotFound(true);
        return;
      }
      if (!scheduleRes.ok) {
        setLoadError("Couldn't load this schedule.");
        return;
      }
      const data = await scheduleRes.json();
      setSchedule(data.schedule);
      setJobs(data.jobs ?? []);
      setLoadError(null);
      if (docsRes.ok) setDocs((await docsRes.json()).documents ?? []);
    } catch {
      // Network failure. Before the schedule first loads this drives the
      // inline error state below; after that the page keeps its data and the
      // user can retry via the upload flow or Retry affordance.
      setLoadError("Couldn't load this schedule. Check your connection.");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const runs = useMemo(() => groupByRun(jobs), [jobs]);

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const supported = filterSupportedFiles(fileList);
    setIsUploading(true);
    setUploadError(null);
    try {
      for (const file of supported) {
        await uploadDocument(file, id);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      // Reload regardless of outcome — files uploaded before a failure are
      // already persisted server-side and should still show up in the inbox.
      await load();
      setIsUploading(false);
    }
  };

  const handleRunNow = async () => {
    setIsRunning(true);
    setRunError(null);
    setRunNotice(null);
    try {
      const res = await fetch(`/api/schedules/${id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRunError(data.error || "Couldn't run this schedule.");
        return;
      }
      const count = typeof data.jobsCreated === "number" ? data.jobsCreated : 0;
      setRunNotice(
        count === 0
          ? "No documents in the inbox to process."
          : `Queued ${count} document${count === 1 ? "" : "s"} for extraction.`
      );
    } catch {
      setRunError("Couldn't run this schedule. Check your connection.");
    } finally {
      await load();
      setIsRunning(false);
    }
  };

  const startEditingOutput = () => {
    if (!schedule) return;
    setOutputDraft({
      outputDir: schedule.outputDir ?? "",
      outputFormat: schedule.outputFormat,
      keepResults: schedule.keepResults,
    });
    setOutputSaveError(null);
    setIsEditingOutput(true);
  };

  const handleSaveOutput = async () => {
    setIsSavingOutput(true);
    setOutputSaveError(null);
    try {
      const response = await fetch(`/api/schedules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputDir: outputDraft.outputDir.trim(),
          outputFormat: outputDraft.outputFormat,
          keepResults: outputDraft.keepResults,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setOutputSaveError(data.error || "Couldn't save output settings.");
        return;
      }
      setSchedule(data.schedule);
      setIsEditingOutput(false);
    } catch {
      setOutputSaveError("Couldn't save output settings. Check your connection.");
    } finally {
      setIsSavingOutput(false);
    }
  };

  const downloadRunCsv = (run: { label: string; rows: JobRow[] }) => {
    const rows = jobsToRows(
      run.rows
        .filter((r) => r.job.status === "completed")
        .map((r) => ({ result: r.job.result, filename: r.filename }))
    );
    downloadText(`run-${run.label.replace(/[^\d]/g, "-")}.csv`, toCsv(rows), "text/csv");
  };

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
        <p className="text-sm text-[var(--text-tertiary)]">Schedule not found.</p>
        <Link href="/dashboard/schedules" className="text-sm text-[var(--accent)] font-medium">
          Back to schedules
        </Link>
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="p-8 max-w-3xl mx-auto space-y-3">
        <p className="text-sm text-[var(--error)]">
          {loadError ?? "Couldn't load this schedule."}
        </p>
        <div className="flex items-center gap-4">
          <button onClick={load} className="px-3 py-2 rounded-lg btn-primary text-xs">
            Retry
          </button>
          <Link href="/dashboard/schedules" className="text-sm text-[var(--accent)] font-medium">
            Back to schedules
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <Link
        href="/dashboard/schedules"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Schedules
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-[var(--text-primary)]">{schedule.name}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {describeCadence(schedule)} · {schedule.active ? "Active" : "Paused"}
            {schedule.lastRunAt && ` · Last ran ${new Date(schedule.lastRunAt).toLocaleString()}`}
          </p>
          {schedule.outputDir && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Writing results to <span className="font-mono">{schedule.outputDir}</span>
            </p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <button
            onClick={handleRunNow}
            disabled={isRunning}
            className="flex items-center gap-2 px-3 py-2 rounded-lg btn-primary text-xs disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {isRunning ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      {runNotice && (
        <p className="text-sm text-[var(--success)]">{runNotice}</p>
      )}
      {runError && <p className="text-sm text-[var(--error)]">{runError}</p>}

      {!hosted && (
      <section className="card-elevated rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
            Output
          </h2>
          {!isEditingOutput && (
            <button
              onClick={startEditingOutput}
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              Edit
            </button>
          )}
        </div>

        {isEditingOutput ? (
          <div className="space-y-4">
            <OutputSettingsFields value={outputDraft} onChange={setOutputDraft} />
            {outputSaveError && <p className="text-sm text-[var(--error)]">{outputSaveError}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveOutput}
                disabled={isSavingOutput}
                className="px-3 py-2 rounded-lg btn-primary text-xs disabled:opacity-50"
              >
                {isSavingOutput ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => {
                  setIsEditingOutput(false);
                  setOutputSaveError(null);
                }}
                disabled={isSavingOutput}
                className="px-3 py-2 rounded-lg text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : schedule.outputDir ? (
          <p className="text-sm text-[var(--text-secondary)]">
            Results are written to <span className="font-mono text-[var(--text-tertiary)]">{schedule.outputDir}</span> as{" "}
            {schedule.outputFormat === "both" ? "CSV and JSON" : schedule.outputFormat.toUpperCase()}.{" "}
            {schedule.keepResults
              ? "Results also stay in the app's database."
              : "Results are cleared from History once the file is written."}
          </p>
        ) : (
          <p className="text-sm text-[var(--text-tertiary)]">
            Not configured — results stay in the app&apos;s database only.
          </p>
        )}
      </section>
      )}

      <section className="card-elevated rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
          Inbox
        </h2>
        <label className="relative flex flex-col items-center justify-center w-full py-8 px-6 border border-dashed border-[var(--border-default)] rounded-xl cursor-pointer hover:border-[var(--accent-muted)] hover:bg-[var(--surface-elevated)] transition-all">
          <input
            type="file"
            accept={UPLOAD_ACCEPT_ATTR}
            multiple
            onChange={(e) => handleFilesSelected(e.target.files)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <UploadCloud className="w-6 h-6 text-[var(--text-tertiary)] mb-2" strokeWidth={1.5} />
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {isUploading ? "Uploading…" : "Drop documents here or browse files"}
          </p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Picked up on the next scheduled run, or click Run now above
          </p>
        </label>
        {uploadError && <p className="text-sm text-[var(--error)]">{uploadError}</p>}

        {docs.length > 0 && (
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-inset)] text-sm"
              >
                <FileText className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
                <span className="flex-1 truncate text-[var(--text-primary)]">{d.filename}</span>
                {d.processedAt ? (
                  <span className="flex items-center gap-1 text-xs text-[var(--success)]">
                    <Check className="w-3.5 h-3.5" /> Processed
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
                    <Clock className="w-3.5 h-3.5" /> Pending
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {docs.length === 0 && (
          <p className="text-xs text-[var(--text-tertiary)]">No documents in this inbox yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
          Run history
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">No runs yet.</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const completed = run.rows.filter((r) => r.job.status === "completed").length;
              const failed = run.rows.filter((r) => r.job.status === "failed").length;
              return (
                <details key={run.key} className="card-elevated rounded-xl overflow-hidden group">
                  <summary className="px-4 py-3 flex items-center justify-between cursor-pointer select-none list-none">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{run.label}</p>
                      <p className="text-xs text-[var(--text-tertiary)] mt-0.5 tabular-nums">
                        {run.rows.length} document{run.rows.length === 1 ? "" : "s"}
                        {failed > 0 && ` · ${failed} failed`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {completed > 0 && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            downloadRunCsv(run);
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          CSV
                        </button>
                      )}
                    </div>
                  </summary>
                  <div className="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                    {run.rows.map(({ job, filename }) => (
                      <div key={job.id} className="flex items-start gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[var(--text-primary)] truncate">
                            {filename ?? "Unknown file"}
                          </p>
                          {job.status === "failed" && job.error && (
                            <p className="text-xs text-[var(--error)] mt-1">{job.error}</p>
                          )}
                        </div>
                        <StatusBadge status={job.status} />
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
