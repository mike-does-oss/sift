"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import {
  OutputSettingsFields,
  type OutputSettingsValue,
  DeliverySettingsFields,
  type DeliverySettingsValue,
  type DatasetOption,
} from "@/components";
import { LockedFeature } from "@/components/dashboard/LockedFeature";
import { useHosted } from "@/components/ProfileContext";
import { PLANS, type Plan } from "@/lib/plans";

interface Template {
  id: string;
  name: string;
}

interface Schedule {
  id: string;
  name: string;
  templateId: string;
  cadence: "daily" | "weekly";
  hourUtc: number;
  dayOfWeek: number | null;
  active: boolean;
  lastRunAt: string | null;
  outputDir: string | null;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// §INBOX T3: fresh-form delivery defaults — mirror the schema defaults
// (ingest mode "auto", digest on).
const DEFAULT_DELIVERY: DeliverySettingsValue = {
  ingestMode: "auto",
  processOnArrival: false,
  allowedSenders: "",
  datasetId: "",
  notifyEmail: true,
};

function describeCadence(s: Schedule): string {
  const hour = `${String(s.hourUtc).padStart(2, "0")}:00 UTC`;
  if (s.cadence === "daily") return `Daily at ${hour}`;
  return `Weekly on ${DAYS[s.dayOfWeek ?? 0]} at ${hour}`;
}

// UI-2 U1: the former /dashboard/schedules page body, rendered as the
// Schedules tab of /dashboard/runs. Keeps its own data fetching; the runs
// page owns the header, tab bar, and outer container.
export function SchedulesPanel() {
  // §SaaS-1 T6 hosted gating: schedules are a plan feature
  // (PLANS[plan].schedules — Business). The server's scheduleGate (403
  // UPGRADE_REQUIRED) stays the real enforcement; this is the friendly face.
  // Local profile: `hosted` is false and none of this renders or fetches.
  const hosted = useHosted();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [locked, setLocked] = useState(false);

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
  const [hourUtc, setHourUtc] = useState(9);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [output, setOutput] = useState<OutputSettingsValue>({
    outputDir: "",
    outputFormat: "csv",
    keepResults: true,
  });
  // §INBOX T3: hosted-only delivery settings + the dataset picker's options.
  const [delivery, setDelivery] = useState<DeliverySettingsValue>(DEFAULT_DELIVERY);
  const [datasets, setDatasets] = useState<DatasetOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [templatesRes, schedulesRes, usageRes, datasetsRes] = await Promise.all([
        fetch("/api/templates"),
        fetch("/api/schedules"),
        hosted ? fetch("/api/usage") : Promise.resolve(null),
        hosted ? fetch("/api/datasets") : Promise.resolve(null),
      ]);
      if (templatesRes.ok) setTemplates((await templatesRes.json()).templates ?? []);
      if (schedulesRes.ok) setSchedules((await schedulesRes.json()).schedules ?? []);
      if (datasetsRes?.ok) setDatasets((await datasetsRes.json()).datasets ?? []);
      if (usageRes?.ok) {
        const usage = await usageRes.json();
        if (!usage.unlimited && usage.plan) {
          setLocked(!PLANS[usage.plan as Plan].schedules);
        }
      }
    } catch {
      // transient network failure — the page renders with whatever loaded
    } finally {
      setIsLoading(false);
    }
  }, [hosted]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (isLoading) {
    return <div className="h-6 w-40 rounded-full bg-[var(--surface-overlay)] animate-pulse" />;
  }

  const canSubmit = name.trim() && templateId && !isSubmitting;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          templateId,
          cadence,
          hourUtc,
          dayOfWeek: cadence === "weekly" ? dayOfWeek : undefined,
          // Output folders are a local-filesystem feature; the hosted form
          // hides the section and sends nothing (the server rejects any
          // outputDir on hosted regardless). Hosted sends the email-in
          // delivery settings instead — null for unset senders/dataset so
          // the server stores a clean absence.
          ...(hosted
            ? {
                ingestMode: delivery.ingestMode,
                processOnArrival: delivery.processOnArrival,
                allowedSenders: delivery.allowedSenders.trim() || null,
                datasetId: delivery.datasetId || null,
                notifyEmail: delivery.notifyEmail,
              }
            : {
                outputDir: output.outputDir.trim() || undefined,
                outputFormat: output.outputFormat,
                keepResults: output.keepResults,
              }),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        // Plan downgrades land server-side first — flip to the locked card.
        if (data.code === "UPGRADE_REQUIRED") setLocked(true);
        setError(data.error || "Failed to create schedule");
        return;
      }
      setSchedules((prev) => [data.schedule, ...prev]);
      setName("");
      setTemplateId("");
      setOutput({ outputDir: "", outputFormat: "csv", keepResults: true });
      setDelivery(DEFAULT_DELIVERY);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleActive = async (schedule: Schedule) => {
    const response = await fetch(`/api/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !schedule.active }),
    });
    if (!response.ok) return;
    const data = await response.json();
    setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? data.schedule : s)));
  };

  const handleDelete = async (id: string) => {
    const response = await fetch(`/api/schedules/${id}`, { method: "DELETE" });
    if (!response.ok) return;
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    setConfirmDeleteId(null);
  };

  return (
    <div className="max-w-3xl space-y-8">
      <p className="text-sm text-[var(--text-tertiary)]">
        Automatically extract from documents dropped into a schedule&apos;s inbox.
      </p>

      {locked ? (
        <LockedFeature
          title="Schedules are a Business feature"
          description="Drop documents into an inbox and have them extracted automatically on a daily or weekly cadence. Available on the Business plan."
          requiredPlan={PLANS.business.name}
        />
      ) : (
      <section className="card-elevated rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
          New schedule
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Schedule name"
            className="px-3 py-2 rounded-lg input-base text-sm"
          />
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="px-3 py-2 rounded-lg input-base text-sm"
            aria-label="Template"
          >
            <option value="">Select a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {templates.length === 0 && (
          <p className="text-xs text-[var(--text-tertiary)]">
            No templates yet.{" "}
            <Link href="/dashboard/templates" className="text-[var(--accent)] font-medium">
              Create one
            </Link>{" "}
            to schedule a run.
          </p>
        )}

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="radio"
              checked={cadence === "daily"}
              onChange={() => setCadence("daily")}
            />
            Daily
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="radio"
              checked={cadence === "weekly"}
              onChange={() => setCadence("weekly")}
            />
            Weekly
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            value={hourUtc}
            onChange={(e) => setHourUtc(Number(e.target.value))}
            className="px-3 py-2 rounded-lg input-base text-sm"
            aria-label="Hour (UTC)"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00 UTC
              </option>
            ))}
          </select>
          {cadence === "weekly" && (
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className="px-3 py-2 rounded-lg input-base text-sm"
              aria-label="Day of week"
            >
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </div>

        {hosted && <DeliverySettingsFields value={delivery} onChange={setDelivery} datasets={datasets} />}
        {!hosted && <OutputSettingsFields value={output} onChange={setOutput} />}

        {error && <p className="text-sm text-[var(--error)]">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-3 px-6 rounded-xl btn-primary text-sm disabled:opacity-50"
        >
          {isSubmitting ? "Creating…" : "Create schedule"}
        </button>
      </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
          Your schedules
        </h2>
        {schedules.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">No schedules yet.</p>
        ) : (
          <div className="space-y-2">
            {schedules.map((s) => (
              <div key={s.id} className="card-elevated rounded-xl p-4 flex items-center gap-4">
                <Link href={`/dashboard/schedules/${s.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{s.name}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    {describeCadence(s)}
                  </p>
                </Link>

                <button
                  onClick={() => toggleActive(s)}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                    s.active ? "bg-[var(--accent)]" : "bg-[var(--surface-overlay)]"
                  }`}
                  aria-label={s.active ? "Deactivate schedule" : "Activate schedule"}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                      s.active ? "left-6" : "left-1"
                    }`}
                  />
                </button>

                {confirmDeleteId === s.id ? (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="px-2 py-1.5 rounded-md text-xs font-medium text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1.5 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(s.id)}
                    className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-subtle)] transition-colors flex-shrink-0"
                    aria-label={`Delete ${s.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
