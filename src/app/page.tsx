import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Anchor,
  ArrowRight,
  CalendarClock,
  Check,
  FileStack,
  KeyRound,
  LayoutTemplate,
  Table2,
} from "lucide-react";
import { isHosted } from "@/lib/profile";
import { PLANS, planFeatures, type Plan } from "@/lib/plans";
import { SiftWordmark } from "@/components/brand/SiftWordmark";
import { ExtractionShowcase } from "@/components/landing/ExtractionShowcase";

const GITHUB_URL = "https://github.com/mike-does-oss/sift";
const DOCS_URL = "https://github.com/mike-does-oss/sift/tree/main/docs";
const INSTALL_ONE_LINER =
  "curl -fsSL https://raw.githubusercontent.com/mike-does-oss/sift/main/install.sh | sh";

// §SaaS-1 T6 (plan decision 10): on the local profile `/` stays a straight
// redirect into the dashboard — there is nothing to market on your own
// machine. Hosted renders the marketing page below: server-rendered end to
// end except the animated ExtractionShowcase (the page's only client
// island), with every pricing number read from PLANS so plan changes never
// leave stale copy here (guarded by src/app/__tests__/landing-pricing.test.ts).
//
// Bench-instrument re-execution (DESIGN.md, Persuade mode): the page is the
// dark instrument case regardless of the visitor's calibration (.bench-dark
// pins the tokens — the lit-paper hero only works against graphite).
// Grammar: sections separate by hairlines; the ONE tick-rule ornament is the
// hero's bottom edge; the ONE phosphor plate in the hero viewport is the
// hero CTA (the header CTA is a machined plate for that reason), and in the
// pricing viewport it's the recommended tier's CTA.
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
    <main className="bench-dark min-h-screen bg-[var(--case)] text-[var(--ink)]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[color-mix(in_srgb,var(--case)_88%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="Sift home">
            <SiftWordmark markSize={26} textClassName="text-lg" />
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            <a href="#how-it-works" className="text-sm text-[var(--ink-dim)] transition-colors hover:text-[var(--ink)]">
              How it works
            </a>
            <a href="#pricing" className="text-sm text-[var(--ink-dim)] transition-colors hover:text-[var(--ink)]">
              Pricing
            </a>
            <a href={DOCS_URL} className="text-sm text-[var(--ink-dim)] transition-colors hover:text-[var(--ink)]">
              Docs
            </a>
            <a
              href={GITHUB_URL}
              aria-label="Sift on GitHub"
              className="text-[var(--ink-dim)] transition-colors hover:text-[var(--ink)]"
            >
              <GitHubIcon className="h-4.5 w-4.5" />
            </a>
          </nav>
          {/* Machined plates only up here — the hero CTA below is the view's
              one phosphor plate (law 1). */}
          <div className="flex items-center gap-4">
            {signedIn ? (
              <Link href="/dashboard" className="btn-plate px-4 py-1.5 text-sm">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/sign-in"
                  className="text-sm text-[var(--ink-dim)] transition-colors hover:text-[var(--ink)]"
                >
                  Sign in
                </Link>
                <Link href="/auth/sign-up" className="btn-plate px-4 py-1.5 text-sm">
                  Start free
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero — the instrument reading a document */}
      <section className="mx-auto max-w-4xl px-6 pb-0 pt-16 text-center sm:pt-20">
        <h1 className="font-display mx-auto max-w-2xl text-balance text-[2.75rem] leading-[1.08] tracking-[-0.02em] sm:text-6xl">
          Turn documents into structured data
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-[var(--ink-dim)]">
          Define the fields you need, let AI extract them, and check every value against the exact
          place it appears in the source. Bank statements, contracts, invoices, emails — clean rows
          out, every time.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={ctaHref} className="btn-primary flex items-center gap-1.5 px-6 py-3 text-sm">
            Start free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a href={GITHUB_URL} className="btn-plate px-6 py-3 text-sm">
            Run it locally
          </a>
        </div>
        <div className="mt-14">
          <ExtractionShowcase />
        </div>
      </section>

      {/* Hero edge — the page's ONE tick-rule ornament */}
      <div className="mx-auto mt-16 max-w-6xl px-6">
        <div className="tick-rule" />
      </div>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
        <div className="etched-label etched-label--rule">Method</div>
        <h2 className="font-display mt-4 text-2xl sm:text-3xl">How it works</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          <Step
            n={1}
            title="Upload any document"
            description="Drop in a PDF, Word doc, slide deck, scanned image, email, or plain text. One file or a whole folder."
          />
          <Step
            n={2}
            title="Describe the fields"
            description="Name each field, pick a type, add a plain-language description. No regex, no training, no setup."
          />
          <Step
            n={3}
            title="Get verified data"
            description="Every value comes back anchored to a quote in the source, highlighted side by side — review it, then export."
          />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="etched-label etched-label--rule">Capabilities</div>
        <h2 className="font-display mt-4 text-2xl sm:text-3xl">
          Built for documents that matter
        </h2>
        <div className="mt-10 grid gap-x-14 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            icon={<Anchor className="h-4 w-4 text-[var(--ink-dim)]" />}
            title="Grounded extraction"
            description="Values are tied to exact quotes in the source and highlighted where they appear — you can see why every cell says what it says."
          />
          <Feature
            icon={<FileStack className="h-4 w-4 text-[var(--ink-dim)]" />}
            title="Every format"
            description="PDF, DOCX, PPTX, images, EML, TXT, CSV, and Markdown all go through the same pipeline."
          />
          <Feature
            icon={<LayoutTemplate className="h-4 w-4 text-[var(--ink-dim)]" />}
            title="Templates + AI scaffolding"
            description="Save field sets as reusable templates, or let AI draft the fields for you from a sample document."
          />
          <Feature
            icon={<CalendarClock className="h-4 w-4 text-[var(--ink-dim)]" />}
            title="Batches & schedules"
            description="Run a folder of documents through one template, or drop files into an inbox that processes itself on a daily or weekly cadence."
          />
          <Feature
            icon={<Table2 className="h-4 w-4 text-[var(--ink-dim)]" />}
            title="Datasets & CSV export"
            description="Extractions accumulate into datasets you can browse, edit, and export as CSV for your spreadsheet or pipeline."
          />
          <Feature
            icon={<KeyRound className="h-4 w-4 text-[var(--ink-dim)]" />}
            title="Your keys or ours"
            description="Use our metered plans, plug in your own Anthropic key, or go fully local with Ollama in the open-source edition."
          />
        </div>
      </section>

      {/* Open-source band — a machined full-bleed panel */}
      <section className="border-y border-[var(--hairline)] bg-[var(--panel)]">
        <div className="mx-auto max-w-5xl px-6 py-14 text-center">
          <div className="etched-label">Open source</div>
          <h2 className="font-display mt-3 text-2xl sm:text-3xl">Open source, local first</h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--ink-dim)]">
            Sift is AGPL-3.0. The same app ships as a desktop edition that runs entirely on your
            machine — your documents never leave it. One command on macOS:
          </p>
          <div className="mx-auto mt-6 flex w-fit max-w-full items-center gap-3 overflow-x-auto rounded-[4px] border border-[var(--hairline)] bg-[var(--well)] px-4 py-3">
            <span aria-hidden className="data flex-shrink-0 select-none text-xs text-[var(--phosphor-dim)]">
              $
            </span>
            <code className="data whitespace-nowrap text-xs text-[var(--ink-dim)]">
              {INSTALL_ONE_LINER}
            </code>
          </div>
          <a href={GITHUB_URL} className="btn-plate mt-6 inline-flex items-center gap-1.5 px-4 py-2 text-sm">
            View on GitHub
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Pricing — generated from PLANS, never hardcoded */}
      {/* pb-24 here + FAQ py-24 + CTA pt-24: keeps the recommended tier's
          phosphor CTA and the bottom CTA's phosphor plate from sharing a
          900px viewport (law 1 — one glowing thing per view). */}
      <section id="pricing" className="mx-auto max-w-5xl scroll-mt-20 px-6 pb-24 pt-16">
        <div className="etched-label etched-label--rule">Plans</div>
        <h2 className="font-display mt-4 text-2xl sm:text-3xl">Pricing</h2>
        <p className="mt-3 text-[var(--ink-dim)]">
          Start free, upgrade when you need more. Cancel anytime.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(PLANS) as Plan[]).map((plan) => {
            const cfg = PLANS[plan];
            const recommended = plan === "pro";
            return (
              // Hairline panels, elevation by line (law 3 — the old
              // shadow-md on this card is retired). The recommended tier
              // earns a stronger hairline and an LED tag; its CTA is the
              // section's ONE phosphor plate.
              <div
                key={plan}
                className={`flex flex-col rounded-[6px] border bg-[var(--panel)] p-5 ${
                  recommended ? "border-[var(--hairline-strong)]" : "border-[var(--hairline)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="etched-label">{cfg.name}</h3>
                  {recommended && (
                    <span className="flex items-center gap-1.5">
                      <span className="led led-on" aria-hidden />
                      <span className="etched-label">Recommended</span>
                    </span>
                  )}
                </div>
                <p className="mt-3">
                  <span className="data text-3xl font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>
                    <span className="align-top text-base">$</span>
                    {cfg.priceMonthly}
                  </span>
                  <span className="text-sm text-[var(--ink-faint)]"> /mo</span>
                </p>
                <ul className="mt-4 flex-1 space-y-2 border-t border-[var(--hairline)] pt-4">
                  {planFeatures(plan).map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm text-[var(--ink-dim)]"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--ink-faint)]" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={ctaHref}
                  className={`mt-5 px-4 py-2 text-center text-xs ${
                    recommended ? "btn-primary" : "btn-plate"
                  }`}
                >
                  {cfg.priceMonthly === 0 ? "Start free" : `Choose ${cfg.name}`}
                </Link>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-[var(--ink-faint)]">
          Extractions on a bring-your-own key don&apos;t count toward monthly limits.
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-6 py-28">
        <div className="etched-label etched-label--rule">FAQ</div>
        <h2 className="font-display mt-4 text-2xl sm:text-3xl">Questions</h2>
        <div className="mt-6 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          <Faq q="Where does my data go?">
            On the hosted service, documents are processed via the Anthropic API and stored in your
            private workspace — never used to train models. If your documents can&apos;t leave your
            machine, the open-source desktop edition runs fully local with Ollama.
          </Faq>
          <Faq q="What does &quot;grounded&quot; mean?">
            Every extracted value is anchored to the exact quote in the source document it came
            from, and the two are highlighted side by side in matching colors. You&apos;re never
            asked to trust a number you can&apos;t trace.
          </Faq>
          <Faq q="How does bring-your-own-key work?">
            On any paid plan you can add your own Anthropic API key. Extractions on your key run on
            the most capable model, don&apos;t count toward your monthly quota, and the key is
            encrypted at rest.
          </Faq>
          <Faq q="What formats and sizes are supported?">
            PDF, DOCX, PPTX, images, EML, TXT, CSV, and Markdown, up to 32MB per file. Extraction
            reads up to a 40,000-character text window per document.
          </Faq>
          <Faq q="Can I cancel anytime?">
            Yes. Manage or cancel your subscription anytime from the billing portal in settings —
            you keep your plan until the end of the paid period, then drop back to the free tier.
          </Faq>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="mx-auto max-w-3xl border-t border-[var(--hairline)] px-6 pb-20 pt-24 text-center">
        <h2 className="font-display text-2xl sm:text-3xl">Stop retyping documents</h2>
        <p className="mt-3 text-[var(--ink-dim)]">
          Your first extractions are free — no card required.
        </p>
        <Link
          href={ctaHref}
          className="btn-primary mt-6 inline-flex items-center gap-1.5 px-6 py-3 text-sm"
        >
          Start free
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--hairline)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex flex-col items-center gap-1.5 sm:items-start">
            <SiftWordmark markSize={22} textClassName="text-sm" />
            <span className="text-xs text-[var(--ink-faint)]">
              Open-source document extraction · AGPL-3.0
            </span>
          </div>
          <nav className="flex items-center gap-5 text-xs text-[var(--ink-faint)]">
            <a href={DOCS_URL} className="transition-colors hover:text-[var(--ink)]">
              Docs
            </a>
            <a href={GITHUB_URL} className="transition-colors hover:text-[var(--ink)]">
              GitHub
            </a>
            <Link href="/auth/sign-in" className="transition-colors hover:text-[var(--ink)]">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

// The step number is real information (the sequence is the point) — a mono
// index, etched register (numbers are data).
function Step({ n, title, description }: { n: number; title: string; description: string }) {
  return (
    <div className="border-t border-[var(--hairline)] pt-5 text-left">
      <div className="flex items-baseline gap-3">
        <span className="data text-sm text-[var(--ink-faint)]" style={{ fontVariantNumeric: "tabular-nums" }}>
          0{n}
        </span>
        <h3 className="text-sm font-medium text-[var(--ink)]">{title}</h3>
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-[var(--ink-faint)]">{description}</p>
    </div>
  );
}

// Etched-label feature row — hairline rule, quiet icon, no box, no accent
// (phosphor marks live state and the primary action only — law 1).
function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="border-t border-[var(--hairline)] pt-5">
      <div className="flex items-center gap-2.5">
        {icon}
        <h3 className="text-sm font-medium text-[var(--ink)]">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--ink-faint)]">{description}</p>
    </div>
  );
}

// Server-rendered disclosure — native <details> on hairline dividers, no
// client JS and no card chrome.
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-[var(--ink)] [&::-webkit-details-marker]:hidden">
        {q}
        <span
          aria-hidden
          className="text-[var(--ink-faint)] transition-transform duration-200 group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-[var(--ink-faint)]">
        {children}
      </p>
    </details>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
