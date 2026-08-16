import { redirect } from "next/navigation";
import Link from "next/link";
import { Layers, Anchor, CalendarClock, KeyRound, Check, GitBranch } from "lucide-react";
import { isHosted } from "@/lib/profile";
import { PLANS, planFeatures, type Plan } from "@/lib/plans";

const GITHUB_URL = "https://github.com/mike-does-oss/sift";

// §SaaS-1 T6 (plan decision 10): on the local profile `/` stays a straight
// redirect into the dashboard — there is nothing to market on your own
// machine. Hosted renders the landing + pricing page below: a server
// component end to end (no client JS needed — CTAs are links), with every
// pricing number read from PLANS so plan changes never leave stale copy here.
export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isHosted()) redirect("/dashboard");

  // Signed-in visitors skip the funnel and go straight to the workspace.
  // Best-effort: a missing/unreachable auth backend must never take the
  // public landing page down — it just renders the signed-out variant.
  let signedIn = false;
  try {
    const { getAuth } = await import("@/lib/auth/server");
    const { data: session } = await getAuth().getSession();
    signedIn = Boolean(session?.user);
  } catch {
    // auth not configured or unreachable — treat as signed out
  }
  const ctaHref = signedIn ? "/dashboard" : "/auth/sign-up";

  return (
    <main className="min-h-screen bg-[var(--surface-base)] grain-overlay text-[var(--text-primary)]">
      {/* Header */}
      <header className="max-w-5xl mx-auto flex items-center justify-between px-6 h-16">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-muted)]">
            <Layers className="h-4 w-4 text-white" />
          </div>
          <span className="font-display text-lg">Sift</span>
        </div>
        <nav className="flex items-center gap-4">
          <a
            href={GITHUB_URL}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            GitHub
          </a>
          {signedIn ? (
            <Link href="/dashboard" className="px-4 py-2 rounded-lg btn-primary text-sm">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/auth/sign-in"
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Sign in
              </Link>
              <Link href="/auth/sign-up" className="px-4 py-2 rounded-lg btn-primary text-sm">
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <h1 className="font-display text-4xl sm:text-5xl leading-tight">
          Turn documents into structured data
        </h1>
        <p className="mt-4 text-lg text-[var(--text-secondary)]">
          Define the fields you need, drop in a PDF, and get clean rows back — grounded in the
          source, ready for your spreadsheet or pipeline.
        </p>
        <p className="mt-3 text-sm text-[var(--text-tertiary)]">
          Sift is open source. Prefer to run it yourself, fully local?{" "}
          <a href={GITHUB_URL} className="text-[var(--accent)] font-medium hover:underline">
            Grab the self-hosted edition on GitHub
          </a>
          .
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href={ctaHref} className="px-6 py-3 rounded-xl btn-primary text-sm">
            Start extracting free
          </Link>
          <a
            href="#pricing"
            className="px-6 py-3 rounded-xl border border-[var(--border-default)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors"
          >
            See pricing
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-3">
          <FeatureCard
            icon={<Anchor className="w-4 h-4 text-[var(--accent)]" />}
            title="Grounded extraction"
            description="Every value can be anchored to an exact quote in the source document, highlighted side by side — so you can trust what came back."
          />
          <FeatureCard
            icon={<CalendarClock className="w-4 h-4 text-[var(--accent)]" />}
            title="Batches & schedules"
            description="Run a whole folder of documents through one template, or drop files into an inbox that processes itself on a daily or weekly cadence."
          />
          <FeatureCard
            icon={<KeyRound className="w-4 h-4 text-[var(--accent)]" />}
            title="Bring your own key"
            description="Plug in your own Anthropic API key: extractions on it are unmetered, run on the most capable model, and your key is encrypted at rest."
          />
        </div>
      </section>

      {/* Pricing — generated from PLANS, never hardcoded */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 pb-20 scroll-mt-6">
        <h2 className="font-display text-2xl text-center mb-8">Pricing</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(PLANS) as Plan[]).map((plan) => {
            const cfg = PLANS[plan];
            const highlighted = plan === "pro";
            return (
              <div
                key={plan}
                className={`card-elevated rounded-xl p-5 flex flex-col ${
                  highlighted ? "border border-[var(--accent-muted)]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                    {cfg.name}
                  </h3>
                  {highlighted && (
                    <span className="px-1.5 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[10px] font-medium text-[var(--accent)] uppercase tracking-wide">
                      Popular
                    </span>
                  )}
                </div>
                <p className="mt-2">
                  <span className="font-display text-3xl">${cfg.priceMonthly}</span>
                  <span className="text-sm text-[var(--text-tertiary)]"> /mo</span>
                </p>
                <ul className="mt-4 space-y-2 flex-1">
                  {planFeatures(plan).map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                      <Check className="w-3.5 h-3.5 text-[var(--accent)] mt-0.5 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={ctaHref}
                  className={`mt-5 px-4 py-2 rounded-lg text-center text-xs font-medium transition-colors ${
                    highlighted
                      ? "btn-primary"
                      : "border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)]"
                  }`}
                >
                  {cfg.priceMonthly === 0 ? "Start free" : `Choose ${cfg.name}`}
                </Link>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-xs text-[var(--text-tertiary)]">
          Extractions on a bring-your-own key don&apos;t count toward monthly limits.
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)]">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--text-tertiary)]">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5" />
            <span>Sift — open-source document extraction, AGPL-3.0.</span>
          </div>
          <a
            href={GITHUB_URL}
            className="flex items-center gap-1.5 hover:text-[var(--text-primary)] transition-colors"
          >
            <GitBranch className="w-3.5 h-3.5" />
            github.com/mike-does-oss/sift
          </a>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="card-elevated rounded-xl p-5">
      <div className="w-9 h-9 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-medium text-[var(--text-primary)]">{title}</h3>
      <p className="mt-1.5 text-sm text-[var(--text-tertiary)]">{description}</p>
    </div>
  );
}
