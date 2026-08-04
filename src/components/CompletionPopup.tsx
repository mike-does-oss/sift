"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { prefersReducedMotion } from "@/lib/motion";

/** How long the popup stays up before it dismisses itself. */
const AUTO_DISMISS_MS = 2200;

export interface CompletionPopupInfo {
  /** Number of fields the extraction request was configured with. */
  fieldsCount: number;
  /** Number of records in the result — 1 for a single (non-multi) extraction. */
  rowCount: number;
  /** Whether "Extract multiple rows" was on for this request — drives "N rows × M fields" vs "N fields extracted". */
  isMulti: boolean;
  /** Display label for the provider (e.g. "Anthropic"), already resolved from the providers list — empty string if unknown. */
  providerLabel: string;
  model: string;
}

interface CompletionPopupProps {
  /** `null` renders nothing; a fresh object (re)starts the auto-dismiss timer. */
  info: CompletionPopupInfo | null;
  onDismiss: () => void;
}

/**
 * Transient, non-blocking confirmation shown after a successful extraction
 * (task-done-popup brief — founder ask: "have a modal done popup when
 * finished extracting"). Visually borrows the expand modal's backdrop+card
 * language (see ResultsDisplay) but is a fraction of the size and weight:
 * no buttons — it's a confirmation, not a decision (§4 voice) — no focus
 * steal, no body-scroll lock (it's here and gone), and it never waits to be
 * told to close: a timer, any click, or Escape all dismiss it immediately.
 * Deliberately NOT shown on failure — errors already render prominently in
 * the results pane — and can't coexist with the expand-results modal, since
 * starting a new extraction (the only way this appears) already closes it.
 */
export function CompletionPopup({ info, onDismiss }: CompletionPopupProps) {
  const reduceMotion = prefersReducedMotion();

  useEffect(() => {
    if (!info) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
    // Re-armed whenever a new completion fires (`info`'s identity changes on
    // every extraction, even a repeat with identical counts), and whenever
    // the dismiss callback itself changes.
  }, [info, onDismiss]);

  const subline = info
    ? info.isMulti
      ? `${info.rowCount} row${info.rowCount === 1 ? "" : "s"} × ${info.fieldsCount} field${info.fieldsCount === 1 ? "" : "s"}`
      : `${info.fieldsCount} field${info.fieldsCount === 1 ? "" : "s"} extracted`
    : "";

  return (
    <AnimatePresence>
      {info && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
          onClick={onDismiss}
          role="status"
          aria-live="polite"
        >
          {/* Lighter than .modal-backdrop (20% vs 45%) — this sits over live
              results, not blocking content behind a true modal, so the table
              must stay legible through it. */}
          <div className="absolute inset-0 popup-backdrop" aria-hidden="true" />
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
            className="relative w-full max-w-[360px] card-elevated rounded-2xl p-6 flex flex-col items-center gap-3 text-center"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center">
              <Check className="w-5 h-5 text-[var(--accent)]" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Extraction complete</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">{subline}</p>
            </div>
            {info.model && (
              <p className="data text-[11px] text-[var(--text-tertiary)]">
                {info.providerLabel ? `${info.providerLabel} · ${info.model}` : info.model}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
