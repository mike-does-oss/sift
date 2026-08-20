"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Layers } from "lucide-react";
import { BatchesPanel } from "./BatchesPanel";
import { SchedulesPanel } from "./SchedulesPanel";
import { HistoryPanel } from "./HistoryPanel";

// UI-2 U1 consolidation: Batches, Schedules, and History were three sibling
// nav destinations; they're all "things my extractions ran as", so they live
// here as tabs. The tab is a query param (?tab=) so the old routes can
// redirect into a specific tab and bookmarks/back-buttons keep working.
// Each panel keeps fetching its own data — only the shell moved.

const TABS = [
  { key: "batches", label: "Batches" },
  { key: "schedules", label: "Schedules" },
  { key: "history", label: "History" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((t) => t.key === value);
}

function RunsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : "batches";

  const selectTab = (tab: TabKey) => {
    // replace (not push) — flipping tabs is a view change, not a place the
    // back button should walk through one flip at a time.
    router.replace(`/dashboard/runs?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl text-[var(--text-primary)] flex items-center gap-3">
          <Layers className="w-6 h-6 text-[var(--ink-dim)]" />
          Runs
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          Batch runs, scheduled runs, and the history of every extraction.
        </p>
      </div>

      {/* §13 segmented pill tab bar — same idiom as the templates page. */}
      <div className="flex items-center rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-0.5 text-sm font-medium w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => selectTab(tab.key)}
            aria-pressed={activeTab === tab.key}
            className={`px-3.5 py-1.5 rounded-[3px] transition-colors ${
              activeTab === tab.key
                ? "bg-[var(--panel-raised)] text-[var(--text-primary)] border border-[var(--hairline-strong)]"
                : "border border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "batches" && <BatchesPanel />}
      {activeTab === "schedules" && <SchedulesPanel />}
      {activeTab === "history" && <HistoryPanel />}
    </div>
  );
}

export default function RunsPage() {
  // useSearchParams requires a Suspense boundary above it; the fallback never
  // paints in practice (the dashboard layout renders dynamically).
  return (
    <Suspense fallback={null}>
      <RunsPageInner />
    </Suspense>
  );
}
