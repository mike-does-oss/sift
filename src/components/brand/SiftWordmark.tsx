import { SiftMark } from "./SiftMark";

/**
 * Mark + "sift" set lowercase in the display font (real HTML text in the site
 * font stack, not SVG text — it inherits next/font's Space Grotesk exactly).
 * Used by the dashboard sidebar, the auth shell, and the landing header.
 */
export function SiftWordmark({
  markSize = 30,
  textClassName = "text-lg",
  className = "",
}: {
  /** Mark width/height in px. */
  markSize?: number;
  /** Type-size utility for the word, e.g. "text-lg" / "text-2xl". */
  textClassName?: string;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <SiftMark size={markSize} />
      <span
        className={`font-display text-[var(--text-primary)] ${textClassName}`}
        style={{ letterSpacing: "-0.03em" }}
      >
        sift
      </span>
    </span>
  );
}
