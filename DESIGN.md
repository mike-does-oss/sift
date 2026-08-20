# DESIGN.md — sift · "Bench Instrument"

Chosen 2026-08-20 (impeccable new-work roll; founder locked). Replaces the §13 field-green/cream world everywhere — hosted, local, desktop, landing. The old look is anti-reference ("toy like"); product truth (PRODUCT.md) is untouched. Craft bar: Linear/Vercel-grade engineering seriousness, expressed through this world, not theirs.

## The world
Sift is a **calibrated measurement instrument for documents**. Every extraction is a *reading*; every reading shows its *probe point* in the source. The interface is the instrument's front panel: machined graphite, etched labels, calibration ticks, and one phosphor signal that means "live/valid" — nothing else glows.

## Palette

### Dark (default calibration)
| Token | Value | Role |
|---|---|---|
| `--case` | `#101214` | app ground (the instrument case) |
| `--panel` | `#16191c` | primary surfaces |
| `--panel-raised` | `#1b1f23` | raised panels, popovers |
| `--well` | `#0b0d0e` | inset wells (inputs, document platen surround) |
| `--ink` | `#e9ebe7` | primary text |
| `--ink-dim` | `#a9ada7` | secondary text (≥7:1 on panel) |
| `--ink-faint` | `#878b86` | tertiary text (≥4.5:1 on panel — hard floor) |
| `--hairline` | `#26292d` | 1px structure |
| `--hairline-strong` | `#34383d` | emphasized rules, tick marks |
| `--phosphor` | `#35e0a0` | THE signal: live state, primary action, active nav |
| `--phosphor-dim` | `#1e8f68` | signal at rest (borders, quiet accents) |
| `--phosphor-well` | `#0f2a20` | signal-tinted surface (active fills) |
| `--warn` | `#e0a845` | amber: attention, degraded |
| `--fault` | `#e5655a` | red: failure only |

### Light ("lab bench" calibration — its own design, not an inversion)
Brushed-aluminum lab, cool and clinical, zero cream: `--case #f2f2f0`, `--panel #fbfbfa`, `--well #e9eae7`, `--ink #17191b`, `--ink-dim #4c4f4c`, `--ink-faint #6b6e6a`, hairlines `#d8d9d5`/`#bfc1bc`, `--phosphor #0e7a55` (text-safe on light), `--phosphor-well #e2f2ea`, warn `#9a6a12`, fault `#b3362c`.

Legacy token names (`--bg --surface* --text-* --border-* --accent*`) remain as aliases onto the new set so the whole app re-skins through the token layer first.

## Laws (from the roll's raises — these are binding)
1. **Accent budget**: phosphor covers ≤8% of any screen. It marks live state and the single primary action. Two glowing things on one view is a defect.
2. **Field colors are traces, not washes**: a marked value in the document = its ink color + a 2px field-colored underline trace + a faint (≤14% alpha) tint; a results cell = a 2px left edge-tick in the field color. The golden-angle hue system and two-way linking survive; the highlighter look does not.
3. **Elevation by line, not blur**: everything separates with 1px hairlines. `box-shadow` exists only on true overlays (modals, popovers, toasts) and is tight, offset, dark.

## Form language
- **Radius**: machined, not friendly — 4px controls, 6px panels, 0 on tables/wells. `rounded-xl/2xl` and pill buttons are retired (pills remain only for tiny status LEDs/chips ≤20px tall).
- **Micro-labels**: section headers and panel labels are etched — Space Grotesk, 10.5px, uppercase, +0.08em tracking, `--ink-faint`; sit ON the hairline rule (label interrupts the line, instrument-style).
- **Calibration ticks**: the signature ornament, used sparingly — tick-ruled edges (4px hairline ticks at 8px pitch) on the workspace gutter, section rules on landing, pagination rail. One tick-ruled element per view maximum.
- **Type**: Space Grotesk (display + etched labels), Inter (body), IBM Plex Mono (every reading: values, filenames, ids, addresses, numbers — `tabular-nums` always). Mono means data — unchanged law.
- **Controls**: buttons are machined plates — `--panel-raised` + hairline, 4px radius; the ONE primary action per view is a phosphor plate (`--phosphor` bg, `#07130e` text). Inputs sit in wells (`--well`, inset hairline). Toggles read as instrument switches (square-ish, phosphor when on). Focus ring: 2px phosphor outline, 2px offset — unchanged.
- **Status grammar**: tiny square LEDs (8px, 2px radius) + mono caps text — phosphor=completed/active, amber=processing/pending, fault=failed, hairline-outline=idle. Never colored text alone.

## Signature interaction (the product truth, re-expressed)
The document sits on a **platen** (a light sheet — paper stays physically light in BOTH themes, like a specimen under instrument light, edge-lit against the dark case). Extracted values in the results panel are **readings**: mono, tabular, each with its field-color edge-tick. Hover/click linking draws the existing behaviors with trace styling; the "verify manually" hint becomes a dashed amber trace. The landing hero shows exactly this: the instrument reading a document.

## Motion
Instrument damping: 120–180ms exponential ease-out, needle-settle (no bounce). One authored moment per surface (workspace: the reading landing in the panel + trace drawing; landing: the showcase). Reduced-motion honored everywhere, as now.

## Brand
New mark, drawn in this world's language, same concept (unstructured → structured): a graphite tile (12% radius) with a phosphor **trace glyph** — a jagged signal line entering a sieve rule and exiting as three aligned dots. Wordmark stays lowercase "sift" in Space Grotesk. Favicon/app icons re-cut; 16px legibility verified by render, as before.

## Modes
- Dashboard = Operate: density welcome, expression only through the instrument grammar; task/state clarity outrank everything.
- Landing = Persuade: dark bench hero, lit-paper specimen, phosphor readings; pricing/features re-set in the same grammar; §4 voice.

## Quality gates
WCAG 4.5:1 for all text incl. placeholders (both calibrations); detector clean; accent budget audited by eye per view; both themes designed, not derived; 15px base density kept.
