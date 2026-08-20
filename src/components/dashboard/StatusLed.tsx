// Status grammar (DESIGN.md "Bench Instrument"): tiny square LED + mono caps
// text — never colored text alone, never a tinted pill. One component so the
// five surfaces that show job/batch/schedule state (overview, history, batch
// detail, runs, schedule inbox) speak the identical grammar.
//
// LED mapping per DESIGN.md: phosphor = completed/active · amber =
// processing/pending · fault = failed · hairline outline = idle/paused.

const LED_CLASS: Record<string, string> = {
  completed: "led-on",
  active: "led-on",
  processing: "led-warn",
  pending: "led-warn",
  failed: "led-fault",
  idle: "led-idle",
  paused: "led-idle",
};

export function StatusLed({
  status,
  label,
  className = "",
}: {
  status: string;
  /** Display text; defaults to the status itself. */
  label?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`led ${LED_CLASS[status] ?? "led-idle"}`} aria-hidden />
      <span className="data text-[11px] uppercase tracking-[0.06em] text-[var(--ink-dim)] whitespace-nowrap">
        {label ?? status}
      </span>
    </span>
  );
}
