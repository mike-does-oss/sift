"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileText, Image as ImageIcon, X } from "lucide-react";
import { FileUpload } from "./FileUpload";
import { PDFPreview } from "./PDFPreview";
import type { ExtractionData } from "@/types";
import { computeMatchRanges, type MatchRange } from "@/lib/highlight";

export interface DocumentViewHandle {
  /** Scrolls the first matching `<mark>` for this field/row into view and flashes it (playbook §13 signature). No-op if the value wasn't anchored (never appeared verbatim in the text). */
  scrollToMark: (fieldName: string, rowIndex?: number) => void;
}

interface DocumentViewProps {
  file: File | null;
  onFileSelect: (file: File) => void;
  onClear: () => void;
  /** Original extracted values (immutable per extraction) — drives the anchored highlights. */
  results: ExtractionData | null;
  /** The document text the model saw, from the extract response — undefined for images. */
  extractedText?: string;
}

type ClientKind = "pdf" | "image" | "text";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

// Client-side classification for *display* only — a lightweight mirror of
// src/lib/documents.ts's magic-byte detection, which is server-only (unpdf /
// mailparser pull in Node built-ins). Extension-based guessing is fine here:
// the server is still the source of truth for what's actually processed.
function clientKindOf(filename: string): ClientKind {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "text";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderHighlightedText(text: string, ranges: MatchRange[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) nodes.push(text.slice(cursor, r.start));
    nodes.push(
      <mark key={`mark-${i}`} className="sift-mark" data-field={r.field} data-row={r.row}>
        {text.slice(r.start, r.end)}
      </mark>
    );
    cursor = r.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Document pane (playbook §13 left half of the two-pane workspace). Renders
 * the upload dropzone when empty; once a file is picked, shows the native
 * preview for its kind (PDF/image/text) and — once an extraction has
 * returned `extractedText` — an "Extracted text" toggle that anchors every
 * verbatim-matching result value with a `<mark>` (the product's signature).
 */
export const DocumentView = forwardRef<DocumentViewHandle, DocumentViewProps>(function DocumentView(
  { file, onFileSelect, onClear, results, extractedText },
  ref
) {
  const [view, setView] = useState<"document" | "extracted">("document");
  const [rawText, setRawText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const extractedContainerRef = useRef<HTMLDivElement>(null);

  const kind = file ? clientKindOf(file.name) : null;

  // Reset to the native view and (re)load display content whenever the file
  // changes — a fresh upload shouldn't inherit the previous file's toggle
  // state or cached text/image.
  useEffect(() => {
    setView("document");
    setRawText("");
    setImageUrl("");
    if (!file) return;
    const k = clientKindOf(file.name);
    if (k === "text") {
      let cancelled = false;
      file
        .text()
        .then((t) => {
          if (!cancelled) setRawText(t);
        })
        .catch(() => {
          if (!cancelled) setRawText("");
        });
      return () => {
        cancelled = true;
      };
    }
    if (k === "image") {
      const url = URL.createObjectURL(file);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  const ranges = useMemo(
    () => computeMatchRanges(extractedText ?? "", results),
    [extractedText, results]
  );
  const segments = useMemo(
    () => renderHighlightedText(extractedText ?? "", ranges),
    [extractedText, ranges]
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToMark(fieldName: string, rowIndex = 0) {
        const activate = () => {
          const container = extractedContainerRef.current;
          if (!container) return;
          let el: HTMLElement | null = null;
          try {
            el = container.querySelector<HTMLElement>(
              `mark[data-field="${CSS.escape(fieldName)}"][data-row="${rowIndex}"]`
            );
          } catch {
            el = null;
          }
          if (!el) return;
          el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
          // Restart the flash animation even if this mark was just flashed.
          el.classList.remove("flash");
          void el.offsetWidth;
          el.classList.add("flash");
        };
        if (extractedText && view !== "extracted") {
          setView("extracted");
          requestAnimationFrame(() => requestAnimationFrame(activate));
        } else {
          activate();
        }
      },
    }),
    [extractedText, view]
  );

  if (!file) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <FileUpload onFileSelect={onFileSelect} selectedFile={null} onClear={onClear} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50">
        {kind === "image" ? (
          <ImageIcon className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" strokeWidth={1.75} />
        ) : (
          <FileText className="w-4 h-4 text-[var(--text-tertiary)] flex-shrink-0" strokeWidth={1.75} />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate text-[var(--text-primary)]">{file.name}</p>
          <p className="text-[11px] text-[var(--text-tertiary)]">{formatFileSize(file.size)}</p>
        </div>

        {extractedText && (
          <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-0.5 text-xs font-medium flex-shrink-0">
            <button
              type="button"
              onClick={() => setView("document")}
              aria-pressed={view === "document"}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                view === "document"
                  ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Document
            </button>
            <button
              type="button"
              onClick={() => setView("extracted")}
              aria-pressed={view === "extracted"}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                view === "extracted"
                  ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Extracted text
            </button>
          </div>
        )}

        <button
          onClick={onClear}
          className="flex-shrink-0 p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-all"
          aria-label="Remove file"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {view === "extracted" && extractedText ? (
          <div ref={extractedContainerRef} className="h-full overflow-auto p-6 bg-[var(--surface-inset)]">
            <pre className="data whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text-primary)]">
              {segments}
            </pre>
          </div>
        ) : kind === "pdf" ? (
          <PDFPreview file={file} />
        ) : kind === "image" ? (
          <div className="h-full overflow-auto p-6 bg-[var(--surface-inset)] flex items-start justify-center">
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- local blob: URL, next/image can't optimize it
              <img src={imageUrl} alt={file.name} className="max-w-full h-auto rounded-sm shadow-lg" />
            )}
          </div>
        ) : (
          <div className="h-full overflow-auto p-6 bg-[var(--surface-inset)]">
            <pre className="data whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text-primary)]">
              {rawText}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
});
