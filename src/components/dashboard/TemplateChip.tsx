import { FileJson } from "lucide-react";

/**
 * Quiet template-name chip — names what a schedule or batch extracts, on
 * cards and detail headers. Same rounded-pill idiom as the status badges,
 * but on the inset surface so it reads as metadata, not state.
 */
export function TemplateChip({ name }: { name: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--surface-inset)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] max-w-full [font-family:var(--font-body)]"
      title={`Template: ${name}`}
    >
      <FileJson className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" strokeWidth={1.75} />
      <span className="truncate">{name}</span>
    </span>
  );
}
