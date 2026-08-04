"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { FileText, Image as ImageIcon, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { FileUpload } from "./FileUpload";
import { PDFPreview } from "./PDFPreview";
import type { ExtractionData, ExtractionField } from "@/types";
import { computeMatchRanges, type MatchRange, type Quotes } from "@/lib/highlight";
import { fieldColorVars } from "@/lib/fieldColors";
import { prefersReducedMotion } from "@/lib/motion";

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
  /** Per-field/row source quotes from a grounded extraction — undefined when the engine/response didn't ground. Quote matches take precedence over value matching (see `computeMatchRanges`). */
  quotes?: Quotes;
  /**
   * Ordered field list — same array (same filter, same order) ResultsDisplay
   * renders its columns from, so a mark's color-by-index always agrees with
   * its column's swatch. Only used to look up each mark's palette index by
   * field name; an unknown field (shouldn't happen — marks only come from
   * `results`, which is produced against these same fields) falls back to
   * index 0 rather than throwing.
   */
  fields: ExtractionField[];
  /** The field currently hovered in either pane (lifted to DashboardPage) — lets a mark whose field is hovered from the *results table* pick up the same "linked" emphasis a directly-hovered mark gets. `null` when nothing is hovered. */
  hoveredField: string | null;
  /** Reports document-side hover in/out of a mark, by field name (`null` on leave) — drives ResultsDisplay's column tint the other direction. */
  onHoverField: (field: string | null) => void;
  /** Clicking a mark — reverse of ResultsDisplay's crosshair jump: tells the parent to flash+scroll the matching results cell into view. */
  onMarkClick: (field: string, row: number) => void;
  /**
   * Collapsed rail state — lives in the parent (DashboardPage) because it
   * also drives the two-pane width split, not just this component's own
   * markup. Only takes visual effect at the `lg` breakpoint (desktop
   * two-pane layout); on narrow/stacked viewports the pane always renders
   * in full, matching the "collapse control hidden — stacking already
   * handles space" rule.
   */
  collapsed: boolean;
  /** Explicit setter (not a toggle) — scrollToMark needs to force-expand without accidentally collapsing an already-expanded pane. */
  onCollapsedChange: (collapsed: boolean) => void;
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

/**
 * Renders each anchored range as a `<mark>` tinted with its field's color
 * (§13 signature, now per-field — see `fieldColors.ts`). `fieldIndex` maps
 * field name → position in the shared `fields` order so the hue agrees with
 * ResultsDisplay's column for the same field. `hoveredField` (set from
 * either pane) gets a "linked" emphasis so hovering a results cell lights up
 * every mark for that field, not just the one under the cursor.
 */
function renderHighlightedText(
  text: string,
  ranges: MatchRange[],
  fieldIndex: Map<string, number>,
  hoveredField: string | null
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) nodes.push(text.slice(cursor, r.start));
    const vars = fieldColorVars(fieldIndex.get(r.field) ?? 0);
    const linked = hoveredField !== null && hoveredField === r.field;
    nodes.push(
      <mark
        key={`mark-${i}`}
        className={`sift-mark${linked ? " sift-mark--linked" : ""}`}
        style={vars as CSSProperties}
        data-field={r.field}
        data-row={r.row}
      >
        {text.slice(r.start, r.end)}
      </mark>
    );
    cursor = r.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * Document pane (playbook §13 left half of the two-pane workspace). Renders
 * the upload dropzone when empty; once a file is picked, shows the native
 * preview for its kind (PDF/image/text) and — once an extraction has
 * returned `extractedText` — an "Extracted text" toggle that anchors every
 * verbatim-matching result value with a `<mark>` (the product's signature).
 */
export const DocumentView = forwardRef<DocumentViewHandle, DocumentViewProps>(function DocumentView(
  {
    file,
    onFileSelect,
    onClear,
    results,
    extractedText,
    quotes,
    fields,
    hoveredField,
    onHoverField,
    onMarkClick,
    collapsed,
    onCollapsedChange,
  },
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

  const { ranges } = useMemo(
    () => computeMatchRanges(extractedText ?? "", results, quotes),
    [extractedText, results, quotes]
  );
  // Same order ResultsDisplay derives its column index from (see page.tsx —
  // both panes are handed the identical filtered `fields` array), so a
  // field's hue always agrees between its marks here and its column there.
  const fieldIndex = useMemo(() => new Map(fields.map((f, i) => [f.name, i] as const)), [fields]);
  const segments = useMemo(
    () => renderHighlightedText(extractedText ?? "", ranges, fieldIndex, hoveredField),
    [extractedText, ranges, fieldIndex, hoveredField]
  );

  // Event delegation on the extracted-text container rather than a handler
  // per `<mark>` — keeps `segments`'s memoization independent of the hover/
  // click callbacks' identity (which page.tsx doesn't memoize) and scales to
  // documents with many marks without attaching 3 listeners each.
  const handleMarkMouseOver = (e: MouseEvent<HTMLElement>) => {
    const mark = (e.target as HTMLElement).closest<HTMLElement>("mark[data-field]");
    if (mark?.dataset.field) onHoverField(mark.dataset.field);
  };
  const handleMarkMouseOut = (e: MouseEvent<HTMLElement>) => {
    const mark = (e.target as HTMLElement).closest<HTMLElement>("mark[data-field]");
    if (mark) onHoverField(null);
  };
  const handleMarkClick = (e: MouseEvent<HTMLElement>) => {
    const mark = (e.target as HTMLElement).closest<HTMLElement>("mark[data-field]");
    if (mark?.dataset.field) onMarkClick(mark.dataset.field, Number(mark.dataset.row ?? "0"));
  };

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
        // A jump while the pane is collapsed must not silently no-op — expand
        // it first, then (also switching to the extracted-text view if
        // needed) wait for things to settle before measuring/scrolling to
        // the mark.
        const needsExpand = collapsed;
        const needsViewSwitch = Boolean(extractedText) && view !== "extracted";
        if (needsExpand) onCollapsedChange(false);
        if (needsViewSwitch) setView("extracted");
        if (needsExpand) {
          // Force-expanding animates the pane wrapper's width over 200ms
          // (`transition-[width] duration-200` in page.tsx, which this
          // component doesn't own a ref to). The extracted-text container
          // re-wraps as the pane widens, so the mark's position keeps
          // shifting throughout that animation — a couple of rAFs (enough
          // for the DOM/view-switch itself to commit) is nowhere near enough
          // for the width transition to settle, and scrolling mid-transition
          // computes an offset against a pane that's still nearly collapsed.
          // Wait past the transition instead.
          setTimeout(activate, 250);
        } else if (needsViewSwitch) {
          requestAnimationFrame(() => requestAnimationFrame(activate));
        } else {
          activate();
        }
      },
    }),
    [extractedText, view, collapsed, onCollapsedChange]
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
      {/* Collapsed rail — desktop only (`lg:`); on narrow/stacked viewports
          the collapse control is hidden entirely, so this stays hidden and
          the full pane below (via its sibling `lg:hidden`) renders instead. */}
      {collapsed && (
        <div className="hidden lg:flex h-full w-full flex-col items-center gap-3 py-3">
          <button
            onClick={() => onCollapsedChange(false)}
            aria-label="Expand document pane"
            title="Expand"
            className="flex-shrink-0 p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
          >
            <PanelLeftOpen className="w-4 h-4" strokeWidth={1.75} />
          </button>
          <span title={file.name} className="flex-shrink-0">
            {kind === "image" ? (
              <ImageIcon className="w-4 h-4 text-[var(--text-tertiary)]" strokeWidth={1.75} />
            ) : (
              <FileText className="w-4 h-4 text-[var(--text-tertiary)]" strokeWidth={1.75} />
            )}
          </span>
        </div>
      )}

      <div className={`h-full flex flex-col min-h-0 ${collapsed ? "lg:hidden" : ""}`}>
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
            onClick={() => onCollapsedChange(true)}
            aria-label="Collapse document pane"
            title="Collapse document pane"
            className="hidden lg:inline-flex flex-shrink-0 p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" strokeWidth={1.75} />
          </button>

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
            <div
              ref={extractedContainerRef}
              onMouseOver={handleMarkMouseOver}
              onMouseOut={handleMarkMouseOut}
              onClick={handleMarkClick}
              className="h-full overflow-auto p-6 bg-[var(--surface-inset)]"
            >
              <div className="doc-sheet">
                <pre className="data whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text-primary)]">
                  {segments}
                </pre>
              </div>
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
              <div className="doc-sheet">
                <pre className="data whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text-primary)]">
                  {rawText}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
