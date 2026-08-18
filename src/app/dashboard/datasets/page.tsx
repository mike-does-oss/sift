"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Database, Download, Eye, Trash2 } from "lucide-react";
import { webSiftApi, type DatasetSummary } from "@/lib/api";

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await webSiftApi.listDatasets();
      setDatasets(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't load datasets.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await webSiftApi.deleteDataset(id);
      setDatasets((prev) => prev.filter((d) => d.id !== id));
      setConfirmDeleteId(null);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete dataset");
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl text-[var(--text-primary)] flex items-center gap-3">
          <Database className="w-6 h-6 text-[var(--accent)]" />
          Datasets
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          Extraction results collected over time, appended from single extractions and batches.
        </p>
      </div>

      {deleteError && <p className="text-sm text-[var(--error)]">{deleteError}</p>}
      {loadError && <p className="text-sm text-[var(--error)]">{loadError}</p>}

      {isLoading ? (
        <div className="h-6 w-40 rounded-full bg-[var(--surface-overlay)] animate-pulse" />
      ) : datasets.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">
          Datasets collect extraction results over time — run an extraction and choose Save to dataset.
        </p>
      ) : (
        <div className="space-y-2">
          {datasets.map((d) => (
            <div key={d.id} className="card-elevated rounded-xl p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{d.name}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {d.headers.map((header) => (
                    <span
                      key={header}
                      className="data px-2 py-0.5 rounded-full bg-[var(--surface-overlay)] text-[var(--text-tertiary)] text-[11px]"
                    >
                      {header}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-[var(--text-tertiary)] mt-2 tabular-nums">
                  {d.rowCount} row{d.rowCount === 1 ? "" : "s"} · created {new Date(d.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <Link
                  href={`/dashboard/datasets/${d.id}`}
                  aria-label={`View ${d.name}`}
                  title="View"
                  className="hit-44 p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
                >
                  <Eye className="w-4 h-4" />
                </Link>
                <a
                  href={`/api/datasets/${d.id}/csv`}
                  aria-label={`Download ${d.name} as CSV`}
                  title="Download CSV"
                  className="hit-44 p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
                >
                  <Download className="w-4 h-4" />
                </a>
                {confirmDeleteId === d.id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleDelete(d.id)}
                      className="px-2 py-1.5 rounded-md text-xs font-medium text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmDeleteId(d.id);
                    }}
                    className="hit-44 p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                    aria-label={`Delete ${d.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
