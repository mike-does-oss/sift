"use client";

// Instrument switch (DESIGN.md form language): toggles read as machined
// switches — square-ish, phosphor when on — replacing the retired pill
// toggle whose white knob was near-invisible on the light calibration.
// Renders the visual track/knob plus an sr-only checkbox; callers wrap it
// (with their own copy) in a <label>, or pass aria-label for standalone use.
export function InstrumentSwitch({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-block h-5 w-9 flex-shrink-0 rounded border transition-colors ${
        checked
          ? "border-[var(--phosphor-dim)] bg-[var(--phosphor-well)]"
          : "border-[var(--hairline-strong)] bg-[var(--well)]"
      } ${disabled ? "opacity-50" : ""} ${className}`}
    >
      <span
        aria-hidden
        className={`absolute top-[3px] h-3 w-3.5 rounded-[2px] transition-all ${
          checked ? "left-[19px] bg-[var(--phosphor)]" : "left-[3px] bg-[var(--ink-faint)]"
        }`}
      />
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className="sr-only"
      />
    </span>
  );
}
