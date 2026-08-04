/**
 * Per-field color identity for the LangExtract-style highlight linking
 * between DocumentView's `<mark>`s and ResultsDisplay's result columns
 * (playbook §13 — muted, not neon). Pure, no React/DOM — a field's color is
 * a deterministic function of its position in the `fields` array (not its
 * name or id), so reordering fields reshuffles colors but renaming one
 * doesn't, and the two panes always agree without passing color values
 * between them (only the index needs to travel).
 *
 * Hue is a golden-angle rotation (`h = (index * 137.508) % 360`) — the
 * irrational-angle trick that keeps consecutive indices maximally spread
 * around the wheel instead of drifting through neighboring hues. Saturation
 * and lightness are fixed per theme so every field lands in the same
 * §13-muted register (pastel tint in light mode, deep desaturated tint in
 * dark mode) — only the hue varies.
 */

const GOLDEN_ANGLE = 137.508;

/** Golden-angle hue for `index`, normalized to [0, 360). */
export function fieldHue(index: number): number {
  return (((index * GOLDEN_ANGLE) % 360) + 360) % 360;
}

export interface FieldColorShade {
  bg: string;
  text: string;
}

export interface FieldColor {
  light: FieldColorShade;
  dark: FieldColorShade;
}

/** Deterministic bg/text color pair for both themes, keyed on the field's order (index) in the fields array. */
export function fieldColor(index: number): FieldColor {
  const h = fieldHue(index);
  return {
    light: { bg: `hsl(${h}, 45%, 87%)`, text: `hsl(${h}, 45%, 25%)` },
    dark: { bg: `hsl(${h}, 40%, 26%)`, text: `hsl(${h}, 45%, 80%)` },
  };
}

/**
 * CSS-var-ready form of `fieldColor(index)` — spread directly into a React
 * inline `style` object. Both theme variants are set at once (as custom
 * properties, not resolved colors) so the DOM node carries both and plain
 * CSS (`html.dark` — see globals.css) selects the active one; no JS theme
 * sniffing needed, and the element stays correct across a live theme toggle
 * with no re-render.
 */
export interface FieldColorVars {
  "--mark-bg-light": string;
  "--mark-text-light": string;
  "--mark-bg-dark": string;
  "--mark-text-dark": string;
}

export function fieldColorVars(index: number): FieldColorVars {
  const { light, dark } = fieldColor(index);
  return {
    "--mark-bg-light": light.bg,
    "--mark-text-light": light.text,
    "--mark-bg-dark": dark.bg,
    "--mark-text-dark": dark.text,
  };
}
