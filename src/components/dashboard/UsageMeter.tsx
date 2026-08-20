"use client";

// §SaaS-1 T6 usage meter (extracted from HostedSettings for UI-2 U1 so the
// dashboard overview's usage card and the settings plan card render the same
// bar). Pure presentational — callers fetch /api/usage themselves.
export function UsageMeter({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const nearLimit = pct >= 80;
  return (
    <div className="space-y-1.5">
      <div className="h-2 rounded-[2px] bg-[var(--well)] border border-[var(--hairline)] overflow-hidden">
        <div
          className={`h-full transition-all ${nearLimit ? "bg-[var(--warn)]" : "bg-[var(--phosphor)]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[var(--text-tertiary)] tabular-nums">
        {used.toLocaleString()} of {limit.toLocaleString()} extractions used this month
      </p>
    </div>
  );
}
