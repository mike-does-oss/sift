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
    <main className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="Sift home">
            <SiftWordmark markSize={28} textClassName="text-lg" />
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            <a href="#how-it-works" className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
              How it works
            </a>
            <a href="#pricing" className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
              Pricing
            </a>
            <a href={DOCS_URL} className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
              Docs
            </a>
            <a
              href={GITHUB_URL}
              aria-label="Sift on GitHub"
              className="text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <GitHubIcon className="h-4.5 w-4.5" />
            </a>
          </nav>
          <div className="flex items-center gap-4">
            {signedIn ? (
              <Link href="/dashboard" className="btn-primary rounded-lg px-4 py-2 text-sm">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/sign-in"
                  className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  Sign in
                </Link>
                <Link href="/auth/sign-up" className="btn-primary rounded-lg px-4 py-2 text-sm">
                  Start free
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center sm:pt-20">
        <h1 className="font-display mx-auto max-w-2xl text-balance text-[2.75rem] leading-[1.08] tracking-[-0.02em] sm:text-6xl">
          Turn documents into structured data
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-[var(--text-secondary)]">
          Define the fields you need, let AI extract them, and check every value against the exact
          place it appears in the source. Bank statements, contracts, invoices, emails — clean rows
          out, every time.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={ctaHref} className="btn-primary flex items-center gap-1.5 rounded-xl px-6 py-3 text-sm">
            Start free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href={GITHUB_URL}
            className="rounded-xl border border-[var(--border-default)] px-6 py-3 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-overlay)] hover:text-[var(--text-primary)]"
          >
            Run it locally
          </a>
        </div>
        <div className="mt-14">
          <ExtractionShowcase />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
        <h2 className="font-display text-center text-2xl sm:text-3xl">How it works</h2>
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
        <h2 className="font-display text-center text-2xl sm:text-3xl">
          Built for documents that matter
        </h2>
        <div className="mt-12 grid gap-x-14 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            icon={<Anchor className="h-4 w-4 text-[var(--accent)]" />}
            title="Grounded extraction"
            description="Values are tied to exact quotes in the source and highlighted where they appear — you can see why every cell says what it says."
          />
          <Feature
            icon={<FileStack className="h-4 w-4 text-[var(--accent)]" />}
            title="Every format"
            description="PDF, DOCX, PPTX, images, EML, TXT, CSV, and Markdown all go through the same pipeline."
          />
          <Feature
            icon={<LayoutTemplate className="h-4 w-4 text-[var(--accent)]" />}
            title="Templates + AI scaffolding"
            description="Save field sets as reusable templates, or let AI draft the fields for you from a sample document."
          />
          <Feature
            icon={<CalendarClock className="h-4 w-4 text-[var(--accent)]" />}
            title="Batches & schedules"
            description="Run a folder of documents through one template, or drop files into an inbox that processes itself on a daily or weekly cadence."
          />
          <Feature
            icon={<Table2 className="h-4 w-4 text-[var(--accent)]" />}
            title="Datasets & CSV export"
            description="Extractions accumulate into datasets you can browse, edit, and export as CSV for your spreadsheet or pipeline."
          />
          <Feature
            icon={<KeyRound className="h-4 w-4 text-[var(--accent)]" />}
            title="Your keys or ours"
            description="Use our metered plans, plug in your own Anthropic key, or go fully local with Ollama in the open-source edition."
          />
        </div>
      </section>

      {/* Open-source band — full-bleed inset surface, no card */}
      <section className="mt-16 border-y border-[var(--border-subtle)] bg-[var(--surface-inset)]">
        <div className="mx-auto max-w-5xl px-6 py-14 text-center">
          <h2 className="font-display text-2xl sm:text-3xl">Open source, local first</h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--text-secondary)]">
            Sift is AGPL-3.0. The same app ships as a desktop edition that runs entirely on your
            machine — your documents never leave it. One command on macOS:
          </p>
          <div className="mx-auto mt-6 flex w-fit max-w-full items-center gap-3 overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-4 py-3 shadow-sm">
            <span aria-hidden className="data flex-shrink-0 select-none text-xs text-[var(--accent)]">
              $
            </span>
            <code className="data whitespace-nowrap text-xs text-[var(--text-secondary)]">
              {INSTALL_ONE_LINER}
            </code>
          </div>
          <a
            href={GITHUB_URL}
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] hover:underline"
          >
            View on GitHub
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Pricing — generated from PLANS, never hardcoded */}
      <section id="pricing" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
        <h2 className="font-display text-center text-2xl sm:text-3xl">Pricing</h2>
        <p className="mt-3 text-center text-[var(--text-secondary)]">
          Start free, upgrade when you need more. Cancel anytime.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(PLANS) as Plan[]).map((plan) => {
            const cfg = PLANS[plan];
            const highlighted = plan === "pro";
            return (
              <div
                key={plan}
                className={`flex flex-col rounded-xl p-5 ${
                  highlighted
                    ? "card-elevated border border-[var(--accent-muted)] shadow-[var(--shadow-md)]"
                    : "border border-[var(--border-default)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                    {cfg.name}
                  </h3>
                  {highlighted && (
                    <span className="rounded-full bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent)]">
                      Popular
                    </span>
                  )}
                </div>
                <p className="mt-2">
                  <span className="font-display text-3xl">
                    <span className="align-top text-base">$</span>
                    {cfg.priceMonthly}
                  </span>
                  <span className="text-sm text-[var(--text-tertiary)]"> /mo</span>
                </p>
                <ul className="mt-4 flex-1 space-y-2">
                  {planFeatures(plan).map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm text-[var(--text-secondary)]"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)]" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={ctaHref}
                  className={`mt-5 rounded-lg px-4 py-2 text-center text-xs font-medium transition-colors ${
                    highlighted
                      ? "btn-primary"
                      : "border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)] hover:text-[var(--text-primary)]"
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

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-6 py-16">
        <h2 className="font-display text-center text-2xl sm:text-3xl">Questions</h2>
        <div className="mt-6 divide-y divide-[var(--border-default)] border-y border-[var(--border-default)]">
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
      <section className="mx-auto max-w-3xl px-6 pb-20 pt-4 text-center">
        <h2 className="font-display text-2xl sm:text-3xl">Stop retyping documents</h2>
        <p className="mt-3 text-[var(--text-secondary)]">
          Your first extractions are free — no card required.
        </p>
        <Link
          href={ctaHref}
          className="btn-primary mt-6 inline-flex items-center gap-1.5 rounded-xl px-6 py-3 text-sm"
        >
          Start free
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <div className="flex flex-col items-center gap-1.5 sm:items-start">
            <SiftWordmark markSize={22} textClassName="text-sm" />
            <span className="text-xs text-[var(--text-tertiary)]">
              Open-source document extraction · AGPL-3.0
            </span>
          </div>
          <nav className="flex items-center gap-5 text-xs text-[var(--text-tertiary)]">
            <a href={DOCS_URL} className="transition-colors hover:text-[var(--text-primary)]">
              Docs
            </a>
            <a href={GITHUB_URL} className="transition-colors hover:text-[var(--text-primary)]">
              GitHub
            </a>
            <Link href="/auth/sign-in" className="transition-colors hover:text-[var(--text-primary)]">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

// The step number is real information (the sequence is the point), set as a
// display numeral rather than boxed in a badge.
function Step({ n, title, description }: { n: number; title: string; description: string }) {
  return (
    <div className="border-t border-[var(--border-default)] pt-5 text-left">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-3xl leading-none text-[var(--accent)]">{n}</span>
        <h3 className="text-sm font-medium text-[var(--text-primary)]">{title}</h3>
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-[var(--text-tertiary)]">{description}</p>
    </div>
  );
}

// Editorial feature row — hairline rule, plain icon, no box.
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
    <div className="border-t border-[var(--border-default)] pt-5">
      <div className="flex items-center gap-2.5">
        {icon}
        <h3 className="text-sm font-medium text-[var(--text-primary)]">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-tertiary)]">{description}</p>
    </div>
  );
}

// Server-rendered disclosure — native <details> on hairline dividers, no
// client JS and no card chrome.
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
        {q}
        <span
          aria-hidden
          className="text-[var(--text-tertiary)] transition-transform duration-200 group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-[var(--text-tertiary)]">
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
