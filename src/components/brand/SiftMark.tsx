/**
 * The sift mark — bench-instrument brand (DESIGN.md): a graphite tile (12%
 * radius) carrying a phosphor TRACE glyph. Same concept as ever (unstructured
 * → structured), redrawn in the instrument's language: a jagged signal line
 * enters a sieve rule and exits as three aligned dots (readings).
 *
 * Single source of truth for the geometry — src/app/icon.svg and
 * public/logo.svg hand-copy these exact coordinates, so any change here must
 * be mirrored there.
 *
 * Colors are FIXED brand values, not theme tokens: the tile is the dark
 * instrument case (#16191c + #34383d hairline) and the glyph is dark-phosphor
 * #35e0a0 in BOTH calibrations — the mark is a little lit instrument screen,
 * the one place that stays dark on the lab bench. (The light theme's
 * text-safe phosphor would die on the graphite tile.)
 *
 * Geometry is tuned against real 16px renders (2 viewBox units = 1px at
 * 16px): the sieve rule is a 2-unit stroke centered on odd y=19 so it fills
 * exactly one pixel row, and the dash pitch (5 on / 3 off) keeps it reading
 * as a broken RULE rather than a second row of dots.
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
   * With the graphite tile behind the glyph (default). Pass false to draw
   * the trace glyph alone in `currentColor` (e.g. on phosphor surfaces).
   */
  tile?: boolean;
  className?: string;
}) {
  const glyph = tile ? "#35e0a0" : "currentColor";
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
        <>
          <rect width="32" height="32" rx="4" fill="#16191c" />
          <rect
            x="1"
            y="1"
            width="30"
            height="30"
            rx="3.4"
            fill="none"
            stroke="#34383d"
            strokeWidth="2"
          />
        </>
      )}
      <polyline
        points="6,8 10,12 14,8 18,12 22,8 26,12"
        fill="none"
        stroke={glyph}
        strokeWidth="2"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      <line
        x1="6"
        y1="19"
        x2="26"
        y2="19"
        stroke={glyph}
        strokeWidth="2"
        strokeDasharray="5 3"
        strokeLinecap="butt"
      />
      <g fill={glyph}>
        <circle cx="8" cy="25" r="2.25" />
        <circle cx="16" cy="25" r="2.25" />
        <circle cx="24" cy="25" r="2.25" />
      </g>
    </svg>
  );
}
