"use client";

import { useCallback, useEffect, useState } from "react";
import { UPLOAD_ACCEPT_ATTR, UPLOAD_FORMATS_LABEL, filterSupportedFiles } from "@/lib/upload-accept";
import Link from "next/link";
import { Layers, UploadCloud, X, FileText } from "lucide-react";
import { uploadDocument } from "@/lib/upload-client";
import type { TemplateExample } from "@/types";

interface Template {
  id: string;
  name: string;
  fields: unknown[];
  prompt: string;
  extractMultiple: boolean;
  examples?: TemplateExample[];
}

interface Batch {
  id: string;
  name: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  createdAt: string;
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

function batchStatus(b: Batch): "processing" | "completed" | "failed" {
  if (b.completedCount + b.failedCount < b.totalCount) return "processing";
  if (b.failedCount > 0 && b.completedCount === 0) return "failed";
  return "completed";
}

export default function BatchesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [templatesRes, batchesRes] = await Promise.all([
        fetch("/api/templates"),
        fetch("/api/batches"),
      ]);
      if (templatesRes.ok) setTemplates((await templatesRes.json()).templates ?? []);
      if (batchesRes.ok) setBatches((await batchesRes.json()).batches ?? []);
    } catch {
      // transient network failure — the page renders with whatever loaded
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="h-6 w-40 rounded-full bg-[var(--surface-overlay)] animate-pulse" />
      </div>
    );
  }

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;
  const canSubmit = files.length > 0 && templateId && name.trim() && !isSubmitting;

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList) return;
    const supported = filterSupportedFiles(fileList);
    setFiles(supported);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!selectedTemplate) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const documentIds: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading ${i + 1} of ${files.length}…`);
        const doc = await uploadDocument(files[i]);
        documentIds.push(doc.id);
      }
      setProgress("Creating batch…");
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          documentIds,
          template: {
            fields: selectedTemplate.fields,
            prompt: selectedTemplate.prompt,
            extractMultiple: selectedTemplate.extractMultiple,
            examples: selectedTemplate.examples,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Failed to create batch");
        return;
      }
      window.location.href = `/dashboard/batches/${data.batchId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
      setProgress("");
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-2xl text-[var(--text-primary)] flex items-center gap-3">
          <Layers className="w-6 h-6 text-[var(--accent)]" />
          Batches
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          Extract from multiple documents at once.
        </p>
      </div>

      <section className="card-elevated rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
          New batch
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
            Drop documents here or browse files
          </p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">{UPLOAD_FORMATS_LABEL}</p>
        </label>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface-inset)] text-sm"
              >
                <FileText className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" />
                <span className="flex-1 truncate text-[var(--text-primary)]">{file.name}</span>
                <button
                  onClick={() => removeFile(index)}
                  className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Batch name"
            className="px-3 py-2 rounded-lg input-base text-sm"
          />
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="px-3 py-2 rounded-lg input-base text-sm"
            aria-label="Template"
          >
            <option value="">Select a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {templates.length === 0 && (
          <p className="text-xs text-[var(--text-tertiary)]">
            No templates yet.{" "}
            <Link href="/dashboard/templates" className="text-[var(--accent)] font-medium">
              Create one
            </Link>{" "}
            to run a batch.
          </p>
        )}

        {error && <p className="text-sm text-[var(--error)]">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-3 px-6 rounded-xl btn-primary text-sm disabled:opacity-50"
        >
          {isSubmitting
            ? progress || "Working…"
            : `Run batch (${files.length} file${files.length === 1 ? "" : "s"})`}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
          Past batches
        </h2>
        {batches.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">No batches yet.</p>
        ) : (
          <div className="space-y-2">
            {batches.map((b) => (
              <Link
                key={b.id}
                href={`/dashboard/batches/${b.id}`}
                className="card-elevated rounded-xl p-4 flex items-center justify-between hover:border-[var(--accent-muted)] transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{b.name}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5 tabular-nums">
                    {b.completedCount + b.failedCount} / {b.totalCount} processed
                  </p>
                </div>
                <StatusBadge status={batchStatus(b)} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
