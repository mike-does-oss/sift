/**
 * The sift mark: documents sifted into structure. Two text bars (unstructured
 * lines) pass through a perforated sieve line and come out beneath as a neat
 * row of dots (structured records). Single source of truth for the geometry —
 * src/app/icon.svg and public/logo.svg hand-copy these exact coordinates, so
 * any change here must be mirrored there.
 *
 * Geometry is aligned to a 16px pixel grid (every horizontal edge of the bars,
 * sieve, and dots lands on an integer pixel when the 32-unit viewBox renders
 * at 16px) so the favicon stays crisp — keep coordinates on this grid.
 *
 * Server component — no hooks, safe to render anywhere.
 */
export function SiftMark({
  size = 32,
  tile = true,
  className,
}: {
  /** Rendered width/height in px. */
  size?: number;
  /**
   * With the rounded field-green tile behind the glyph (default). Pass false
   * on green/accent surfaces: the glyph then draws in `currentColor`.
   */
  tile?: boolean;
  className?: string;
}) {
  const glyph = tile ? "#fff" : "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {tile && (
        <rect width="32" height="32" rx="7" fill="var(--accent, #2f6f4e)" />
      )}
      <g stroke={glyph} strokeLinecap="round" fill="none">
        <line x1="9" y1="6" x2="23" y2="6" strokeWidth="4" />
        <line x1="9" y1="12" x2="17" y2="12" strokeWidth="4" />
        <line
          x1="7"
          y1="19"
          x2="25"
          y2="19"
          strokeWidth="2"
          strokeLinecap="butt"
          strokeDasharray="4 3"
        />
      </g>
      <g fill={glyph}>
        <circle cx="9" cy="26" r="2" />
        <circle cx="16" cy="26" r="2" />
        <circle cx="23" cy="26" r="2" />
      </g>
    </svg>
  );
}
