"use client";

import { motion } from "framer-motion";
import { Check, Copy, Download, AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ExtractionField, ExtractionData, ExtractionResult } from "@/types";

interface ResultsDisplayProps {
  results: ExtractionData | null;
  fields: ExtractionField[];
  isLoading: boolean;
  error: string | null;
}

export function ResultsDisplay({
  results,
  fields,
  isLoading,
  error,
}: ResultsDisplayProps) {
  const [copied, setCopied] = useState(false);

  const isArray = Array.isArray(results);
  const resultsArray: ExtractionResult[] = isArray ? results : results ? [results] : [];

  const handleCopy = () => {
    if (results) {
      navigator.clipboard.writeText(JSON.stringify(results, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (results) {
      const blob = new Blob([JSON.stringify(results, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "extracted-data.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleDownloadCSV = () => {
    if (!results || resultsArray.length === 0) return;

    const headers = fields.map((f) => f.name);
    const rows = resultsArray.map((row) =>
      fields.map((f) => {
        const value = row[f.name];
        if (value === null || value === undefined) return "";
        if (Array.isArray(value)) return `"${value.join(", ")}"`;
        if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      })
    );

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "extracted-data.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  };

  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="card-elevated rounded-xl overflow-hidden"
      >
        <div className="p-5">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)]">
                Extracting data...
              </h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                Analyzing document with AI
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {fields.map((field, i) => (
              <div key={field.id} className="flex items-center gap-3">
                <div
                  className="w-24 h-3 rounded animate-shimmer"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
                <div
                  className="flex-1 h-3 rounded animate-shimmer"
                  style={{ animationDelay: `${i * 80 + 40}ms` }}
                />
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-[var(--error)]/20 bg-[var(--error-subtle)] p-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[var(--error)]/10 flex items-center justify-center">
            <AlertCircle className="w-4 h-4 text-[var(--error)]" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--error)]">
              Extraction failed
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{error}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (!results || resultsArray.length === 0) {
    return null;
  }

  // Multiple results - show as table
  if (isArray && resultsArray.length > 1) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="card-elevated rounded-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--success-subtle)] flex items-center justify-center">
              <Check className="w-4 h-4 text-[var(--success)]" strokeWidth={2.5} />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--text-primary)]">
                Complete
              </h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                {resultsArray.length} rows extracted
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-[var(--success)]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              JSON
            </motion.button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-inset)]">
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-tertiary)] w-10">
                  #
                </th>
                {fields.map((field) => (
                  <th
                    key={field.id}
                    className="data px-4 py-2 text-left text-xs font-medium text-[var(--text-tertiary)]"
                  >
                    {field.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultsArray.map((row, index) => (
                <motion.tr
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--surface-overlay)]/30 transition-colors"
                >
                  <td className="px-4 py-2.5 text-[var(--text-tertiary)] tabular-nums">
                    {index + 1}
                  </td>
                  {fields.map((field) => (
                    <td key={field.id} className="data px-4 py-2.5 text-[var(--text-primary)]">
                      {formatValue(row[field.name])}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* JSON Preview */}
        <details className="border-t border-[var(--border-subtle)] group">
          <summary className="px-4 py-3 cursor-pointer text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors select-none">
            <span className="ml-1">View JSON</span>
          </summary>
          <div className="px-4 pb-4">
            <pre className="data p-3 rounded-lg bg-[var(--surface-inset)] text-xs text-[var(--text-secondary)] overflow-x-auto border border-[var(--border-subtle)] max-h-64">
              {JSON.stringify(results, null, 2)}
            </pre>
          </div>
        </details>
      </motion.div>
    );
  }

  // Single result - show as key-value pairs
  const singleResult = resultsArray[0];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="card-elevated rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--success-subtle)] flex items-center justify-center">
            <Check className="w-4 h-4 text-[var(--success)]" strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--text-primary)]">
              Complete
            </h3>
            <p className="text-xs text-[var(--text-tertiary)]">
              {fields.length} field{fields.length !== 1 ? "s" : ""} extracted
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-[var(--success)]" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </motion.button>
        </div>
      </div>

      {/* Results Table */}
      <div className="divide-y divide-[var(--border-subtle)]">
        {fields.map((field, index) => (
          <motion.div
            key={field.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.03 }}
            className="flex items-start gap-4 px-4 py-3 hover:bg-[var(--surface-overlay)]/30 transition-colors"
          >
            <div className="w-28 flex-shrink-0">
              <span className="data text-xs font-medium text-[var(--text-secondary)]">
                {field.name}
              </span>
              <span className="block text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mt-0.5">
                {field.type}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <span className="data text-sm text-[var(--text-primary)] break-words">
                {formatValue(singleResult[field.name])}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* JSON Preview */}
      <details className="border-t border-[var(--border-subtle)] group">
        <summary className="px-4 py-3 cursor-pointer text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors select-none">
          <span className="ml-1">View JSON</span>
        </summary>
        <div className="px-4 pb-4">
          <pre className="data p-3 rounded-lg bg-[var(--surface-inset)] text-xs text-[var(--text-secondary)] overflow-x-auto border border-[var(--border-subtle)]">
            {JSON.stringify(singleResult, null, 2)}
          </pre>
        </div>
      </details>
    </motion.div>
  );
}
