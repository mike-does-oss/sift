"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Database, Loader2 } from "lucide-react";
import { webSiftApi, type DatasetSummary } from "@/lib/api";
import { headersMatch } from "@/lib/datasets";

const NEW_DATASET_VALUE = "__new__";

interface SaveToDatasetPanelProps {
  /** Keys the given `rows` are shaped by — a dataset is offered as an append target only when its `headers` are the same SET of keys (order-insensitive). */
  fieldKeys: string[];
  /**
   * Rows to save. Server-side `rowsForHeaders` projects these onto the
   * target dataset's headers (drops extra keys, nulls missing ones), so
   * callers don't need to pre-shape them beyond using `fieldKeys` as row keys.
   */
  rows: Record<string, unknown>[];
  /** Stamped on appended rows for provenance — only meaningful when every row in `rows` comes from the same job (single extraction). Omit for multi-job saves (batches). */
  sourceJobId?: string;
  className?: string;
}

/**
 * "Save to dataset" control (§ Part 2 of the datasets UI): lets a completed
 * extraction (single, multi-row, or a batch's completed jobs) be appended to
 * an existing dataset whose headers match, or seed a brand-new one. Used
 * under the results table (`ResultsDisplay`) and on the batch detail page.
 */
export function SaveToDatasetPanel({ fieldKeys, rows, sourceJobId, className }: SaveToDatasetPanelProps) {
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(NEW_DATASET_VALUE);
  const [selectedTouched, setSelectedTouched] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ message: string; datasetId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await webSiftApi.listDatasets();
        if (!cancelled) setDatasets(list);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load datasets");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const matching = useMemo(
    () => (datasets ?? []).filter((d) => headersMatch(d.headers, fieldKeys)),
    [datasets, fieldKeys]
  );

  // Default the picker to the first matching dataset once the list loads,
  // but never override a choice the user already made. Adjusted during
  // render (not in an effect, per https://react.dev/learn/you-might-not-need-an-effect)
  // exactly once per distinct `matching` set, so it doesn't fight the user's selection.
  const matchingKey = matching.map((d) => d.id).join(",");
  const [prevMatchingKey, setPrevMatchingKey] = useState(matchingKey);
  if (matchingKey !== prevMatchingKey) {
    setPrevMatchingKey(matchingKey);
    if (!selectedTouched && matching.length > 0) {
      setSelected(matching[0].id);
    }
  }

  if (fieldKeys.length === 0) return null;

  const handleSave = async () => {
    if (rows.length === 0 || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    setSuccess(null);
    try {
      if (selected === NEW_DATASET_VALUE) {
        const name = newName.trim();
        if (!name) {
          setSaveError("Name is required");
          return;
        }
        const dataset = await webSiftApi.createDataset({ name, headers: fieldKeys, rows });
        setDatasets((prev) => [dataset, ...(prev ?? [])]);
        setSuccess({
          message: `Added ${rows.length} row${rows.length === 1 ? "" : "s"} to ${dataset.name}`,
          datasetId: dataset.id,
        });
        setNewName("");
        setSelected(dataset.id);
        setSelectedTouched(true);
      } else {
        const { added, rowCount } = await webSiftApi.appendRows(selected, rows, sourceJobId);
        const target = datasets?.find((d) => d.id === selected);
        setDatasets((prev) => prev?.map((d) => (d.id === selected ? { ...d, rowCount } : d)) ?? prev);
        setSuccess({
          message: `Added ${added} row${added === 1 ? "" : "s"} to ${target?.name ?? "dataset"}`,
          datasetId: selected,
        });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = !isSaving && rows.length > 0 && (selected !== NEW_DATASET_VALUE || newName.trim() !== "");

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)]">
          <Database className="w-3.5 h-3.5" />
          Save to dataset
        </div>

        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setSelectedTouched(true);
            setSuccess(null);
            setSaveError(null);
          }}
          disabled={isSaving}
          aria-label="Dataset"
          className="px-2.5 py-1.5 input-base text-xs disabled:opacity-50"
        >
          {matching.map((d) => (
            <option key={d.id} value={d.id}>
              Append to: {d.name} ({d.rowCount} row{d.rowCount === 1 ? "" : "s"})
            </option>
          ))}
          <option value={NEW_DATASET_VALUE}>New dataset…</option>
        </select>

        {selected === NEW_DATASET_VALUE && (
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Dataset name"
            disabled={isSaving}
            className="px-2.5 py-1.5 input-base text-xs w-40 disabled:opacity-50"
          />
        )}

        <button
          onClick={handleSave}
          disabled={!canSave}
          // Machined secondary plate, NOT btn-primary: this panel renders on
          // views (extract workspace, batch detail) that already carry their
          // one phosphor plate — a second glowing button breaks law 1.
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--hairline-strong)] bg-[var(--panel-raised)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-50"
        >
          {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>

      {loadError && <p className="text-xs text-[var(--error)]">Couldn&apos;t load datasets: {loadError}</p>}
      {saveError && <p className="text-xs text-[var(--error)]">{saveError}</p>}
      {success && (
        <p className="text-xs text-[var(--success)]">
          {success.message} —{" "}
          <Link href={`/dashboard/datasets/${success.datasetId}`} className="font-medium underline underline-offset-2">
            view
          </Link>
        </p>
      )}
    </div>
  );
}
