"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  User,
  Gauge,
  KeyRound,
  Lock,
  Check,
  X,
} from "lucide-react";
import { PLANS, planFeatures, cheapestByoKeyPlan, type Plan } from "@/lib/plans";

// §SaaS-1 T6 hosted Settings (plan decision 10, donor: extracto-app
// settings). Three sections — Account, Plan & usage, Bring your own key —
// in the same §13 card idiom as the local page. Provider configuration, the
// Ollama panel, and hardware recommendations deliberately do not exist here:
// on hosted the provider/model pair is a billing decision (see
// resolveProvider's hosted branch), not a setting.

interface UsageInfo {
  used: number;
  limit: number;
  plan: Plan;
  byoKeyActive: boolean;
  hasBilling: boolean;
}

const PAID_PLANS: Exclude<Plan, "free">[] = ["starter", "pro", "business"];

type KeyState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "stored"; masked: string }
  | { status: "locked" };

function UsageMeter({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const nearLimit = pct >= 80;
  return (
    <div className="space-y-1.5">
      <div className="h-2 rounded-full bg-[var(--surface-overlay)] overflow-hidden">
        <div
          className={`h-full transition-all ${nearLimit ? "bg-[var(--error)]" : "bg-[var(--accent)]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[var(--text-tertiary)] tabular-nums">
        {used.toLocaleString()} of {limit.toLocaleString()} extractions used this month
      </p>
    </div>
  );
}

export default function HostedSettingsPage({ email }: { email: string }) {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [usageError, setUsageError] = useState(false);
  const [keyState, setKeyState] = useState<KeyState>({ status: "loading" });
  const [keyInput, setKeyInput] = useState("");
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [isRemovingKey, setIsRemovingKey] = useState(false);
  const [billingBusy, setBillingBusy] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<"success" | "canceled" | null>(null);

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.unlimited) return; // local shape — never rendered by this page
      setUsage(data as UsageInfo);
      setUsageError(false);
    } catch {
      setUsageError(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadUsage();
    })();
  }, [loadUsage]);

  // Post-checkout toast: Stripe redirects back with ?checkout=success|canceled
  // (see /api/stripe/checkout). Read once on mount, then clean the URL so a
  // refresh doesn't re-announce a stale outcome.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout === "success" || checkout === "canceled") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the URL (external system) on mount
      setCheckoutNotice(checkout);
      params.delete("checkout");
      const query = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
    }
  }, []);

  const plan = usage ? PLANS[usage.plan] : null;
  const byoEligible = usage ? PLANS[usage.plan].byoKey : false;

  const loadKey = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/byo-key");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setKeyState(data.masked ? { status: "stored", masked: data.masked } : { status: "none" });
    } catch {
      setKeyState({ status: "none" });
    }
  }, []);

  useEffect(() => {
    if (!usage) return;
    if (!byoEligible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from the freshly loaded plan
      setKeyState({ status: "locked" });
      return;
    }
    (async () => {
      await loadKey();
    })();
  }, [usage, byoEligible, loadKey]);

  const handleSaveKey = async () => {
    if (!keyInput.trim() || isSavingKey) return;
    setIsSavingKey(true);
    setKeyError(null);
    try {
      const res = await fetch("/api/settings/byo-key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKeyError(data.error || "Couldn't save the key.");
        return;
      }
      setKeyState({ status: "stored", masked: data.masked });
      setKeyInput("");
      await loadUsage(); // byoKeyActive changed — refresh the plan card copy
    } catch {
      setKeyError("Couldn't save the key. Check your connection.");
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleRemoveKey = async () => {
    if (isRemovingKey) return;
    setIsRemovingKey(true);
    setKeyError(null);
    try {
      const res = await fetch("/api/settings/byo-key", { method: "DELETE" });
      if (!res.ok) {
        setKeyError("Couldn't remove the key.");
        return;
      }
      setKeyState({ status: "none" });
      await loadUsage();
    } catch {
      setKeyError("Couldn't remove the key. Check your connection.");
    } finally {
      setIsRemovingKey(false);
    }
  };

  // Upgrade / manage-billing both resolve to a Stripe-hosted URL we redirect
  // into; `billingBusy` keys the pressed button so only it shows a spinner.
  const goToStripe = async (endpoint: string, body: Record<string, string> | null, busyKey: string) => {
    setBillingBusy(busyKey);
    setBillingError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : "{}",
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setBillingError(data.error || "Couldn't open billing. Try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setBillingError("Couldn't open billing. Check your connection.");
    } finally {
      setBillingBusy(null);
    }
  };

  const upgradeTargets = usage
    ? PAID_PLANS.filter((p) => PLANS[p].priceMonthly > PLANS[usage.plan].priceMonthly)
    : [];

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-2xl text-[var(--text-primary)] flex items-center gap-3">
          <SettingsIcon className="w-6 h-6 text-[var(--accent)]" />
          Settings
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          Your account, plan, and API key.
        </p>
      </div>

      {checkoutNotice && (
        <div
          className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-sm ${
            checkoutNotice === "success"
              ? "border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]"
              : "border-[var(--border-default)] bg-[var(--surface-overlay)] text-[var(--text-secondary)]"
          }`}
        >
          <span className="flex items-center gap-2">
            {checkoutNotice === "success" ? <Check className="w-4 h-4 flex-shrink-0" /> : null}
            {checkoutNotice === "success"
              ? "Payment complete — your new plan is active. It can take a few seconds to show up here."
              : "Checkout canceled — your plan is unchanged."}
          </span>
          <button
            onClick={() => setCheckoutNotice(null)}
            className="flex-shrink-0 p-0.5 rounded-md hover:bg-[var(--surface-overlay)] transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Account */}
      <section className="card-elevated rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--surface-inset)] flex items-center justify-center border border-[var(--border-subtle)] flex-shrink-0">
            <User className="w-4 h-4 text-[var(--text-tertiary)]" />
          </div>
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
            Account
          </h2>
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">Email</p>
          <p className="text-sm text-[var(--text-primary)]">{email || "—"}</p>
        </div>
      </section>

      {/* Plan & usage */}
      <section className="card-elevated rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--surface-inset)] flex items-center justify-center border border-[var(--border-subtle)] flex-shrink-0">
            <Gauge className="w-4 h-4 text-[var(--text-tertiary)]" />
          </div>
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
            Plan &amp; usage
          </h2>
        </div>

        {usageError && (
          <p className="text-sm text-[var(--error)]">Couldn&apos;t load your plan. Refresh to try again.</p>
        )}
        {!usage && !usageError && (
          <div className="h-5 w-40 rounded-full bg-[var(--surface-overlay)] animate-pulse" />
        )}

        {usage && plan && (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {plan.name}
                <span className="text-[var(--text-tertiary)] font-normal">
                  {" "}
                  · ${plan.priceMonthly}/mo
                </span>
              </p>
              {usage.hasBilling && (
                <button
                  onClick={() => goToStripe("/api/stripe/portal", null, "portal")}
                  disabled={billingBusy !== null}
                  className="px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors disabled:opacity-50"
                >
                  {billingBusy === "portal" ? "Opening…" : "Manage billing"}
                </button>
              )}
            </div>

            <UsageMeter used={usage.used} limit={usage.limit} />
            {usage.byoKeyActive && (
              <p className="text-xs text-[var(--text-tertiary)]">
                Extractions on your own key don&apos;t count toward this limit.
              </p>
            )}

            {upgradeTargets.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-[var(--border-subtle)]">
                {upgradeTargets.map((p) => {
                  const cfg = PLANS[p];
                  return (
                    <div
                      key={p}
                      className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {cfg.name}
                          <span className="text-[var(--text-tertiary)] font-normal"> · ${cfg.priceMonthly}/mo</span>
                        </p>
                        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          {planFeatures(p).join(" · ")}
                        </p>
                      </div>
                      <button
                        onClick={() => goToStripe("/api/stripe/checkout", { plan: p }, p)}
                        disabled={billingBusy !== null}
                        className="px-3 py-2 rounded-lg btn-primary text-xs disabled:opacity-50 flex-shrink-0"
                      >
                        {billingBusy === p ? "Opening…" : `Upgrade to ${cfg.name}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {billingError && <p className="text-sm text-[var(--error)]">{billingError}</p>}
          </>
        )}
      </section>

      {/* Bring your own key */}
      <section className="card-elevated rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--surface-inset)] flex items-center justify-center border border-[var(--border-subtle)] flex-shrink-0">
            {keyState.status === "locked" ? (
              <Lock className="w-4 h-4 text-[var(--text-tertiary)]" />
            ) : (
              <KeyRound className="w-4 h-4 text-[var(--text-tertiary)]" />
            )}
          </div>
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
            Bring your own key
          </h2>
        </div>

        {keyState.status === "locked" ? (
          <div className="rounded-lg border border-dashed border-[var(--border-default)] p-4 space-y-2">
            <p className="text-sm text-[var(--text-primary)]">
              Use your own Anthropic API key — extractions on it are unmetered and run on the most
              capable model.
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">
              Available from the {PLANS[cheapestByoKeyPlan()].name} plan ($
              {PLANS[cheapestByoKeyPlan()].priceMonthly}/mo).
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-[var(--text-tertiary)]">
              Extractions on your own Anthropic key don&apos;t count toward your monthly limit and run
              on the most capable model. The key is encrypted at rest and only used to run your
              extractions.
            </p>

            {keyState.status === "stored" && (
              <div className="flex items-center gap-2">
                <span className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface-inset)] border border-[var(--border-subtle)] text-sm font-mono text-[var(--text-secondary)]">
                  {keyState.masked}
                </span>
                <button
                  onClick={handleRemoveKey}
                  disabled={isRemovingKey}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors disabled:opacity-50 flex-shrink-0"
                >
                  {isRemovingKey ? "Removing…" : "Remove key"}
                </button>
              </div>
            )}

            {keyState.status !== "loading" && (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={keyState.status === "stored" ? "Replace with a new key…" : "sk-ant-..."}
                  autoComplete="off"
                  className="flex-1 px-3 py-2 rounded-lg input-base text-sm font-mono"
                  aria-label="Anthropic API key"
                />
                <button
                  onClick={handleSaveKey}
                  disabled={!keyInput.trim() || isSavingKey}
                  className="px-3 py-2 rounded-lg btn-primary text-xs disabled:opacity-50 flex-shrink-0"
                >
                  {isSavingKey ? "Validating…" : keyState.status === "stored" ? "Replace key" : "Save key"}
                </button>
              </div>
            )}

            {keyState.status === "loading" && (
              <div className="h-9 rounded-lg bg-[var(--surface-overlay)] animate-pulse" />
            )}

            {keyError && <p className="text-xs text-[var(--error)]">{keyError}</p>}
          </>
        )}
      </section>
    </div>
  );
}
