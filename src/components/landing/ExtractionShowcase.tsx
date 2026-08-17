"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { fieldColorVars } from "@/lib/fieldColors";

/**
 * Animated hero showcase (UI-2 U2): a stylized two-pane app frame — document
 * on the left, extracted fields on the right — cycling through four document
 * types (bank statement → contract → invoice → email) on a ~4s loop. Per
 * cycle the document pane swaps to that type's silhouette, 2–3 spans get
 * staggered color-highlight sweeps (the same golden-angle field palette the
 * real app uses, via fieldColorVars), then the results rows populate with the
 * matching values in the matching colors.
 *
 * Everything is drawn with divs/spans — no images or screenshots. Content is
 * data-driven from the 4-entry DOCS array; the per-type silhouette renderers
 * below read their text from it, so editing a value updates both panes.
 *
 * This is the landing page's only client island. Respects
 * prefers-reduced-motion: static invoice frame, fully highlighted, no cycling.
 * Hovering the frame pauses the cycle.
 */

interface DocField {
  name: string;
  value: string;
}

interface DocDef {
  id: "statement" | "contract" | "invoice" | "email";
  label: string;
  fields: DocField[]; // order = field color index = animation order
}

const DOCS: DocDef[] = [
  {
    id: "statement",
    label: "Bank statement",
    fields: [
      { name: "date", value: "03 Mar 2026" },
      { name: "description", value: "ACME PAYROLL" },
      { name: "amount", value: "+4,210.00" },
    ],
  },
  {
    id: "contract",
    label: "Contract",
    fields: [
      { name: "party", value: "Northwind Ltd" },
      { name: "effective_date", value: "01 Feb 2026" },
      { name: "term", value: "24 months" },
    ],
  },
  {
    id: "invoice",
    label: "Invoice",
    fields: [
      { name: "invoice_no", value: "INV-2041" },
      { name: "due_date", value: "30 Apr 2026" },
      { name: "total", value: "1,872.50" },
    ],
  },
  {
    id: "email",
    label: "Email",
    fields: [
      { name: "from", value: "anna@parcel.io" },
      { name: "subject", value: "Delivery confirmation" },
      { name: "delivery_date", value: "12 Aug 2026" },
    ],
  },
];

const CYCLE_MS = 4200;
const SWEEP_START = 0.7; // s after doc appears
const STAGGER = 0.45; // s between fields
const ROW_LAG = 0.35; // s between a sweep starting and its row landing

// Reduced-motion users get a static, fully-highlighted invoice frame.
const STATIC_DOC_INDEX = 2;

/** Skeleton text line. */
function Bar({ w, className = "" }: { w: string; className?: string }) {
  return (
    <span
      className={`block h-[5px] rounded-full bg-[var(--line)] ${className}`}
      style={{ width: w }}
    />
  );
}

/** A highlighted span: field-colored background sweeps in left-to-right. */
function Hl({
  i,
  instant,
  children,
}: {
  i: number;
  instant: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className="showcase-hl relative inline-block whitespace-nowrap rounded-[3px] px-0.5"
      style={fieldColorVars(i) as CSSProperties}
    >
      <motion.span
        aria-hidden
        className="field-swatch absolute inset-0 rounded-[3px]"
        style={{ originX: 0 }}
        initial={instant ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: SWEEP_START + i * STAGGER, duration: 0.45, ease: "easeOut" }}
      />
      <span className="relative">{children}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- doc pane */

function StatementDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [date, desc, amount] = fields;
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold tracking-wide text-[var(--ink)]">
          First Federal
        </span>
        <span className="data text-[9px] text-[var(--ink-tertiary)]">Statement · Mar 2026</span>
      </div>
      <div className="border-t border-[var(--line)] pt-2 flex gap-4">
        <Bar w="18%" />
        <Bar w="34%" />
        <Bar w="16%" className="ml-auto" />
      </div>
      <div className="flex items-center gap-4">
        <Bar w="20%" />
        <Bar w="30%" />
        <Bar w="12%" className="ml-auto" />
      </div>
      <div className="data flex items-center gap-3 text-[10px] leading-5">
        <Hl i={0} instant={instant}>{date.value}</Hl>
        <Hl i={1} instant={instant}>{desc.value}</Hl>
        <span className="ml-auto">
          <Hl i={2} instant={instant}>{amount.value}</Hl>
        </span>
      </div>
      <div className="flex items-center gap-4">
        <Bar w="20%" />
        <Bar w="42%" />
        <Bar w="14%" className="ml-auto" />
      </div>
      <div className="flex items-center gap-4">
        <Bar w="20%" />
        <Bar w="26%" />
        <Bar w="10%" className="ml-auto" />
      </div>
    </div>
  );
}

function ContractDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [party, effective, term] = fields;
  return (
    <div className="space-y-2.5">
      <span className="block text-[10px] font-semibold tracking-wide text-[var(--ink)]">
        Master services agreement
      </span>
      <div className="space-y-1.5 pt-1">
        <Bar w="100%" />
        <Bar w="96%" />
      </div>
      <p className="data text-[10px] leading-5 text-[var(--ink-tertiary)]">
        between <Hl i={0} instant={instant}>{party.value}</Hl> and the Client, effective{" "}
        <Hl i={1} instant={instant}>{effective.value}</Hl>
      </p>
      <div className="space-y-1.5">
        <Bar w="100%" />
        <Bar w="92%" />
        <Bar w="97%" />
      </div>
      <p className="data text-[10px] leading-5 text-[var(--ink-tertiary)]">
        for an initial term of <Hl i={2} instant={instant}>{term.value}</Hl>
      </p>
      <div className="flex items-end justify-between pt-1.5">
        <div className="space-y-1.5 w-1/2">
          <Bar w="90%" />
          <Bar w="70%" />
        </div>
        <div className="w-[38%]">
          <div className="border-b border-[var(--line-strong)] h-4" />
          <span className="mt-1 block text-[8px] uppercase tracking-wider text-[var(--ink-tertiary)]">
            Signature
          </span>
        </div>
      </div>
    </div>
  );
}

function InvoiceDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [number, due, total] = fields;
  return (
    <div className="space-y-2.5">
      <div className="flex items-start justify-between">
        <span className="block h-5 w-5 rounded bg-[var(--accent-tint)]" />
        <div className="text-right">
          <span className="block text-[10px] font-semibold tracking-[0.14em] text-[var(--ink)]">
            INVOICE
          </span>
          <span className="data block text-[10px] leading-5">
            <Hl i={0} instant={instant}>{number.value}</Hl>
          </span>
        </div>
      </div>
      <p className="data text-[10px] leading-5 text-[var(--ink-tertiary)]">
        Due <Hl i={1} instant={instant}>{due.value}</Hl>
      </p>
      <div className="space-y-2 border-t border-[var(--line)] pt-2">
        <div className="flex items-center gap-4">
          <Bar w="42%" />
          <Bar w="8%" className="ml-auto" />
          <Bar w="14%" />
        </div>
        <div className="flex items-center gap-4">
          <Bar w="34%" />
          <Bar w="8%" className="ml-auto" />
          <Bar w="12%" />
        </div>
        <div className="flex items-center gap-4">
          <Bar w="46%" />
          <Bar w="8%" className="ml-auto" />
          <Bar w="10%" />
        </div>
      </div>
      <div className="data flex items-center justify-between border-t border-[var(--line-strong)] pt-2 text-[10px] leading-5">
        <span className="font-semibold text-[var(--ink)]">Total</span>
        <Hl i={2} instant={instant}>{total.value}</Hl>
      </div>
    </div>
  );
}

function EmailDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [from, subject, delivery] = fields;
  return (
    <div className="space-y-2.5">
      <div className="data space-y-1 text-[10px] leading-5">
        <p>
          <span className="text-[var(--ink-tertiary)]">From:&nbsp;</span>
          <Hl i={0} instant={instant}>{from.value}</Hl>
        </p>
        <p>
          <span className="text-[var(--ink-tertiary)]">Subject:&nbsp;</span>
          <Hl i={1} instant={instant}>{subject.value}</Hl>
        </p>
      </div>
      <div className="space-y-1.5 border-t border-[var(--line)] pt-2.5">
        <Bar w="88%" />
        <Bar w="96%" />
      </div>
      <p className="data text-[10px] leading-5 text-[var(--ink-tertiary)]">
        your order is arriving <Hl i={2} instant={instant}>{delivery.value}</Hl>
      </p>
      <div className="space-y-1.5">
        <Bar w="92%" />
        <Bar w="60%" />
        <Bar w="34%" className="mt-2.5" />
      </div>
    </div>
  );
}

const DOC_RENDERERS: Record<DocDef["id"], typeof StatementDoc> = {
  statement: StatementDoc,
  contract: ContractDoc,
  invoice: InvoiceDoc,
  email: EmailDoc,
};

/* ---------------------------------------------------------------- showcase */

// "Am I hydrated yet?" via useSyncExternalStore: the server snapshot is false,
// the client snapshot is true, so SSR and the first client render agree.
const subscribeNoop = () => () => {};
const snapshotTrue = () => true;
const snapshotFalse = () => false;

export function ExtractionShowcase() {
  // The server can't know the visitor's motion preference, so SSR always
  // renders the reduced=false tree; honoring the media query before mount
  // would make the first client render disagree with it (hydration error).
  const prefersReduced = useReducedMotion() ?? false;
  const mounted = useSyncExternalStore(subscribeNoop, snapshotTrue, snapshotFalse);
  const reduced = mounted && prefersReduced;
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduced || paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % DOCS.length), CYCLE_MS);
    return () => clearInterval(t);
  }, [reduced, paused]);

  const active = reduced ? DOCS[STATIC_DOC_INDEX] : DOCS[idx];
  const Doc = DOC_RENDERERS[active.id];

  return (
    <div
      role="img"
      aria-label="Demo of sift extracting fields from a bank statement, contract, invoice, and email — each value highlighted in the document and mirrored in a results table"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="card-elevated mx-auto w-full max-w-3xl rounded-2xl text-left"
    >
      {/* Highlight text colors follow the same per-field vars the app's marks
          use; plain CSS picks the light/dark variant. */}
      <style>{`.showcase-hl{color:var(--mark-text-light)}html.dark .showcase-hl{color:var(--mark-text-dark)}`}</style>

      <div aria-hidden>
        {/* Chrome bar: window dots + doc-type tabs */}
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-2 sm:px-4">
          <div className="hidden items-center gap-1.5 sm:flex">
            <span className="h-2 w-2 rounded-full bg-[var(--line-strong)]" />
            <span className="h-2 w-2 rounded-full bg-[var(--line-strong)]" />
            <span className="h-2 w-2 rounded-full bg-[var(--line-strong)]" />
          </div>
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {DOCS.map((doc) => (
              <span
                key={doc.id}
                className={`whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-medium transition-colors duration-300 ${
                  doc.id === active.id
                    ? "bg-[var(--accent-tint)] text-[var(--accent)]"
                    : "text-[var(--ink-tertiary)]"
                }`}
              >
                {doc.label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-[1.15fr_1fr]">
          {/* Document pane */}
          <div className="border-b border-[var(--line)] bg-[var(--surface-inset)] p-3 sm:border-b-0 sm:border-r sm:p-4">
            <div className="h-52 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 shadow-sm">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active.id}
                  initial={reduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  <Doc fields={active.fields} instant={reduced} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Results pane */}
          <div className="p-3 sm:p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--ink-tertiary)]">
                Extracted fields
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-[var(--ink-tertiary)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                grounded
              </span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active.id}
                exit={reduced ? undefined : { opacity: 0, transition: { duration: 0.18 } }}
                className="space-y-1.5"
              >
                {active.fields.map((field, i) => (
                  <motion.div
                    key={field.name}
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: SWEEP_START + ROW_LAG + i * STAGGER,
                      duration: 0.3,
                      ease: "easeOut",
                    }}
                    className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2"
                    style={fieldColorVars(i) as CSSProperties}
                  >
                    <span className="field-swatch h-2 w-2 flex-shrink-0 rounded-[3px]" />
                    <span className="data text-[10px] text-[var(--muted)]">{field.name}</span>
                    <span className="data ml-auto truncate text-[10px] font-medium text-[var(--ink)]">
                      {field.value}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
