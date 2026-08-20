"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import { webSiftApi, type DatasetSummary, type DatasetRow } from "@/lib/api";
import { PAGE_SIZE, clampPage, pageSlice } from "@/lib/pagination";
import { PaginationBar } from "@/components";

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

export default function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  const [confirmingRowId, setConfirmingRowId] = useState<string | null>(null);
  // §13 pagination — read-only table, so no edit/anchor concerns like
  // ResultsDisplay's; the one thing to get right is that per-row delete
  // always targets the right row regardless of which page it's showing on.
  // That falls out for free here since delete is keyed by `r.id` (server
  // row id), never by array/page index — `page` only ever drives which
  // slice of `rows` is rendered. Not persisted back into state when a
  // delete shrinks it out of range; `clampPage` below recomputes a valid
  // page from the raw `page` + current `rows.length` on every render.
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const data = await webSiftApi.getDataset(id);
      setDataset(data.dataset);
      setRows(data.rows);
      setLoadError(null);
    } catch (err) {
      // Covers both a real 404 ("Not found" — the route's own error body) and
      // transient network failures; either way there's nothing to render.
      setLoadError(err instanceof Error ? err.message : "Couldn't load this dataset.");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const handleDeleteRow = async (rowId: string) => {
    setDeletingRowId(rowId);
    setRowError(null);
    try {
      const { rowCount } = await webSiftApi.deleteRow(id, rowId);
      setRows((prev) => prev.filter((r) => r.id !== rowId));
      setDataset((prev) => (prev ? { ...prev, rowCount } : prev));
      setConfirmingRowId(null);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Failed to delete row");
    } finally {
      setDeletingRowId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="h-6 w-40 rounded bg-[var(--surface-overlay)] animate-pulse" />
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-3">
        <p className="text-sm text-[var(--error)]">{loadError ?? "Couldn't load this dataset."}</p>
        <div className="flex items-center gap-4">
          <button onClick={load} className="px-3 py-2 btn-primary text-xs">
            Retry
          </button>
          <Link
            href="/dashboard/datasets"
            className="text-sm text-[var(--text-secondary)] font-medium underline underline-offset-2 hover:text-[var(--text-primary)]"
          >
            Back to datasets
          </Link>
        </div>
      </div>
    );
  }

  const currentPage = clampPage(page, rows.length, PAGE_SIZE);
  const { startIndex, endIndex } = pageSlice(currentPage, rows.length, PAGE_SIZE);
  const pageRows = rows.slice(startIndex, endIndex);

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <Link
        href="/dashboard/datasets"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Datasets
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-[var(--text-primary)]">{dataset.name}</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1 tabular-nums">
            {dataset.rowCount} row{dataset.rowCount === 1 ? "" : "s"} · created{" "}
            {new Date(dataset.createdAt).toLocaleDateString()}
          </p>
        </div>
        <a
          href={`/api/datasets/${dataset.id}/csv`}
          className="flex items-center gap-1.5 px-3 py-2 rounded border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors flex-shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          CSV
        </a>
      </div>

      {rowError && <p className="text-sm text-[var(--error)]">{rowError}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">No rows yet.</p>
      ) : (
        <div className="card-elevated overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-inset)]">
                  {dataset.headers.map((header) => (
                    <th key={header} className="data px-3 py-2 text-left text-xs font-medium text-[var(--text-tertiary)]">
                      {header}
                    </th>
                  ))}
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface-overlay)]/30 transition-colors align-top"
                  >
                    {dataset.headers.map((header) => (
                      <td key={header} className="data px-3 py-2.5 text-[var(--text-primary)] whitespace-pre-wrap break-words">
                        {stringifyCell(r.row[header])}
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      {confirmingRowId === r.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleDeleteRow(r.id)}
                            disabled={deletingRowId === r.id}
                            className="px-2 py-1.5 rounded text-xs font-medium text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors disabled:opacity-50"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmingRowId(null)}
                            className="px-2 py-1.5 rounded text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setRowError(null);
                            setConfirmingRowId(r.id);
                          }}
                          aria-label="Delete row"
                          title="Delete row"
                          className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PAGE_SIZE && (
            <PaginationBar
              page={currentPage}
              rowCount={rows.length}
              pageSize={PAGE_SIZE}
              onPageChange={(next) => setPage(clampPage(next, rows.length, PAGE_SIZE))}
            />
          )}
        </div>
      )}
    </div>
  );
}
