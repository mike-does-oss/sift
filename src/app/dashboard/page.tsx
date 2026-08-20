"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Layers, FileJson, Gauge, Lock, ArrowRight } from "lucide-react";
import { UsageMeter } from "@/components/dashboard/UsageMeter";
import { StatusLed } from "@/components/dashboard/StatusLed";
import { useHosted } from "@/components/ProfileContext";
import { PLANS, type Plan } from "@/lib/plans";
import { isProviderId, type ProviderId } from "@/lib/api";
import { jobIdentity } from "@/lib/job-display";

// UI-2 U1: /dashboard is now an overview home (founder ask: "logged in should
// hit dashboard instead of straight into the processing page"). The extract
// workspace moved verbatim to /dashboard/extract. Quick actions, a hosted
// usage card, and recent activity — nothing here is a new data source, just
// /api/history and (hosted) /api/usage.

interface Job {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  source: "single" | "batch" | "schedule";
  sourceFilename: string | null;
  templateSnapshot: unknown;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

interface JobRow {
  job: Job;
  filename: string | null;
}

interface UsageInfo {
  used: number;
  limit: number;
  plan: Plan;
}

// Record<ProviderId, string> so adding a provider id without a label here is
// a compile error, not silent drift (same convention as the history panel).
const PROVIDER_LABELS: Record<ProviderId, string> = {
  ollama: "Local",
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  "openai-compatible": "OpenAI-compatible",
};

function labelForProvider(id: string): string {
  return isProviderId(id) ? PROVIDER_LABELS[id] : id;
}

/** "just now", "12m ago", "3h ago", "2d ago" — coarse on purpose; the history tab has exact timestamps. */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function OverviewPage() {
  const hosted = useHosted();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  // Greeting is time-of-day in the *viewer's* timezone, so it's computed
  // after mount (SSR would use the server clock and mismatch on hydrate).
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the client clock (external system) on mount
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [historyRes, usageRes] = await Promise.all([
          fetch("/api/history?limit=5"),
          hosted ? fetch("/api/usage") : Promise.resolve(null),
        ]);
        if (historyRes.ok) setJobs((await historyRes.json()).jobs ?? []);
        else setJobs([]);
        if (usageRes?.ok) {
          const data = await usageRes.json();
          if (!data.unlimited && typeof data.used === "number") setUsage(data as UsageInfo);
        }
      } catch {
        // transient network failure — the page renders with whatever loaded
        setJobs((prev) => prev ?? []);
      }
    })();
  }, [hosted]);

  // Batches are plan-gated on hosted (PLANS[plan].batch); the runs tab shows
  // the full locked card — the quick action just hints instead of hiding.
  const batchLocked = hosted && usage !== null && !PLANS[usage.plan].batch;
  const nearLimit = usage !== null && usage.limit > 0 && usage.used / usage.limit >= 0.8;

  const quickActions = [
    {
      href: "/dashboard/extract",
      icon: Sparkles,
      title: "New extraction",
      description: "Upload a document and pull structured data out of it.",
      locked: false,
    },
    {
      href: "/dashboard/runs?tab=batches",
      icon: Layers,
      title: "New batch",
      description: "Run one template across a stack of documents.",
      locked: batchLocked,
    },
    {
      href: "/dashboard/templates",
      icon: FileJson,
      title: "Templates",
      description: "Save field sets you extract with again and again.",
      locked: false,
    },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-2xl text-[var(--text-primary)]">
          {greeting ?? "Overview"}
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          What would you like to extract today?
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="card-elevated p-5 group hover:border-[var(--hairline-strong)] transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded bg-[var(--well)] border border-[var(--hairline)] flex items-center justify-center">
                  <Icon className="w-4 h-4 text-[var(--ink-dim)]" strokeWidth={1.75} />
                </div>
                {action.locked && (
                  <span
                    className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-tertiary)]"
                    title="Available on the Pro plan and higher"
                  >
                    <Lock className="w-3 h-3" />
                    Pro
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                {action.title}
                <ArrowRight className="w-3.5 h-3.5 text-[var(--text-tertiary)] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">{action.description}</p>
            </Link>
          );
        })}
      </div>

      {/* Usage — hosted only; the local profile is unmetered. */}
      {usage && (
        <section className="card-elevated p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded bg-[var(--well)] border border-[var(--hairline)] flex items-center justify-center flex-shrink-0">
                <Gauge className="w-4 h-4 text-[var(--ink-faint)]" />
              </div>
              <h2 className="etched-label">Usage</h2>
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">
              {PLANS[usage.plan].name} plan
            </span>
          </div>
          <UsageMeter used={usage.used} limit={usage.limit} />
          {nearLimit && (
            <p className="text-xs text-[var(--text-secondary)]">
              You&apos;re close to this month&apos;s limit —{" "}
              <Link
                href="/dashboard/settings"
                className="font-medium underline underline-offset-2 hover:text-[var(--text-primary)]"
              >
                upgrade in Settings
              </Link>
              .
            </p>
          )}
        </section>
      )}

      {/* Recent activity */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="etched-label etched-label--rule flex-1">Recent activity</h2>
          {jobs !== null && jobs.length > 0 && (
            <Link
              href="/dashboard/runs?tab=history"
              className="text-xs text-[var(--text-secondary)] font-medium hover:text-[var(--text-primary)] hover:underline"
            >
              View all
            </Link>
          )}
        </div>

        {jobs === null ? (
          <div className="h-6 w-40 rounded bg-[var(--surface-overlay)] animate-pulse" />
        ) : jobs.length === 0 ? (
          <div className="card-elevated p-6 text-center space-y-2">
            <p className="text-sm text-[var(--text-primary)]">No extractions yet.</p>
            <p className="text-xs text-[var(--text-tertiary)]">
              Upload a document and pull your first fields out of it.
            </p>
            <Link
              href="/dashboard/extract"
              className="inline-flex items-center gap-2 px-4 py-2 btn-primary text-xs mt-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Run your first extraction
            </Link>
          </div>
        ) : (
          <div className="card-elevated overflow-hidden divide-y divide-[var(--border-subtle)]">
            {/* Each row opens the full history tab — these look like the
                history panel's expandable rows, so they must go somewhere. */}
            {jobs.map(({ job, filename }) => (
              <Link
                key={job.id}
                href="/dashboard/runs?tab=history"
                className="px-4 py-3 flex items-center gap-4 hover:bg-[var(--surface-overlay)]/30 transition-colors"
              >
                <StatusLed status={job.status} className="w-28 flex-shrink-0" />
                <span className="data flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">
                  {jobIdentity(filename, job.sourceFilename, job.templateSnapshot)}
                </span>
                <span className="data w-40 flex-shrink-0 text-xs text-[var(--text-tertiary)] truncate hidden sm:block">
                  {job.provider ? `${labelForProvider(job.provider)} · ${job.model ?? "—"}` : "—"}
                </span>
                <span className="w-20 flex-shrink-0 text-right text-xs text-[var(--text-tertiary)] tabular-nums">
                  {relativeTime(job.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
