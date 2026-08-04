"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE, pageCount, pageRangeLabel } from "@/lib/pagination";

interface PaginationBarProps {
  /** 1-indexed. Callers own this state and are expected to keep it in range (see `clampPage`) — this component doesn't clamp on your behalf, it just renders whatever you give it and disables the button at whichever bound it's already on. */
  page: number;
  rowCount: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * Compact "1–25 of 137" + prev/next pager (§13, results/dataset pagination).
 * Shared by `ResultsDisplay`'s results table and the dataset detail page's
 * rows table so the two tables page identically. Callers gate rendering on
 * `rowCount > pageSize` themselves (a single page never needs a pager) — this
 * component always renders once mounted.
 */
export function PaginationBar({ page, rowCount, pageSize = PAGE_SIZE, onPageChange, className }: PaginationBarProps) {
  const pages = pageCount(rowCount, pageSize);
  return (
    <div
      className={`flex items-center justify-end gap-3 px-4 py-2 border-t border-[var(--border-subtle)] ${className ?? ""}`}
    >
      <span className="text-xs text-[var(--text-tertiary)] tabular-nums">
        {pageRangeLabel(page, rowCount, pageSize)}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
          className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
