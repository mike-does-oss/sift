"use client";

import Link from "next/link";
import { Lock } from "lucide-react";

// §SaaS-1 T6 (donor: extracto-app LockedFeature, restyled to §13): the
// hosted-profile locked state for a whole page whose feature the current
// plan doesn't include (batches below Pro, schedules below Business). The
// API already answers 403 UPGRADE_REQUIRED for writes; this is the friendly
// face on top. Never rendered on the local profile.
export function LockedFeature({
  title,
  description,
  requiredPlan,
}: {
  title: string;
  description: string;
  requiredPlan: string;
}) {
  return (
    <div className="card-elevated rounded-xl p-8 flex flex-col items-center text-center space-y-3">
      <div className="w-10 h-10 rounded-lg bg-[var(--surface-inset)] flex items-center justify-center border border-[var(--border-subtle)]">
        <Lock className="w-4.5 h-4.5 text-[var(--text-tertiary)]" />
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-[var(--text-primary)]">{title}</h2>
        <p className="text-sm text-[var(--text-tertiary)] max-w-sm">{description}</p>
      </div>
      <Link href="/dashboard/settings" className="px-4 py-2 rounded-lg btn-primary text-xs">
        Upgrade to {requiredPlan}
      </Link>
    </div>
  );
}
