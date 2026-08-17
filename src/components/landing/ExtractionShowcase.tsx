"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { fieldColorVars } from "@/lib/fieldColors";

/**
 * Animated hero showcase, "paperwork on a desk" treatment: a realistic paper
 * miniature (typeset with real content — no skeleton bars, no fake window
 * chrome) sits slightly rotated on the page surface while sift's results
 * card floats beside it. Cycles bank statement → contract → invoice → email;
 * per cycle, marker-style highlight sweeps land on the paper and the matching
 * rows populate the results card in the same field colors the real app uses
 * (fieldColorVars).
 *
 * The paper is always light, in both themes — it's a photographed object,
 * not a UI surface — so its palette is fixed ink-on-paper values and its
 * highlights always use the light-mode mark vars. The results card is an app
 * artifact and follows the theme normally.
 *
 * This is the landing page's only client island and the page's one authored
 * motion moment. prefers-reduced-motion: static invoice, fully highlighted,
 * no cycling. Hover pauses the cycle.
 */

interface DocField {
  name: string;
  value: string;
}

interface DocDef {
  id: "statement" | "contract" | "invoice" | "email";
  label: string;
  file: string;
  rotate: number; // resting tilt of the sheet, degrees
  fields: DocField[]; // order = field color index = animation order
}

const DOCS: DocDef[] = [
  {
    id: "statement",
    label: "Bank statement",
    file: "statement_mar.pdf",
    rotate: -1.1,
    fields: [
      { name: "date", value: "03 Mar 2026" },
      { name: "description", value: "ACME PAYROLL" },
      { name: "amount", value: "+4,210.00" },
    ],
  },
  {
    id: "contract",
    label: "Contract",
    file: "msa_northwind.pdf",
    rotate: 0.9,
    fields: [
      { name: "party", value: "Northwind Ltd" },
      { name: "effective_date", value: "1 February 2026" },
      { name: "term", value: "24 months" },
    ],
  },
  {
    id: "invoice",
    label: "Invoice",
    file: "inv-2041.pdf",
    rotate: -0.6,
    fields: [
      { name: "invoice_no", value: "INV-2041" },
      { name: "due_date", value: "30 Apr 2026" },
      { name: "total", value: "1,872.50" },
    ],
  },
  {
    id: "email",
    label: "Email",
    file: "delivery.eml",
    rotate: 1.2,
    fields: [
      { name: "from", value: "anna@parcel.io" },
      { name: "subject", value: "Delivery confirmation" },
      { name: "delivery_date", value: "12 Aug 2026" },
    ],
  },
];

const CYCLE_MS = 4600;
const SWEEP_START = 0.8; // s after the sheet lands
const STAGGER = 0.45; // s between fields
const ROW_LAG = 0.35; // s between a sweep starting and its row landing

// Reduced-motion users get a static, fully-highlighted invoice.
const STATIC_DOC_INDEX = 2;

/* -------------------------------------------------------------- paper ink */
// The sheet is a physical object: fixed light-paper palette in both themes.
const PAPER: CSSProperties = {
  background: "linear-gradient(176deg, #fdfcf7 0%, #faf8f1 100%)",
  color: "#2b2f33",
  boxShadow:
    "0 1px 2px rgba(43, 47, 51, 0.10), 0 10px 28px -10px rgba(43, 47, 51, 0.28)",
};
const INK_FAINT = "#787d80"; // secondary print on paper, ~4.6:1 on #fdfcf7
const RULE = "rgba(43, 47, 51, 0.14)"; // hairlines on paper
const RULE_STRONG = "rgba(43, 47, 51, 0.42)";

/** Marker highlight on paper: organic radius, sweeps in like a real stroke. */
function Hl({ i, instant, children }: { i: number; instant: boolean; children: ReactNode }) {
  return (
    <span
      className="relative inline-block whitespace-nowrap px-[3px]"
      style={{
        ...(fieldColorVars(i) as CSSProperties),
        color: "var(--mark-text-light)",
        borderRadius: "0.45em 0.65em 0.5em 0.35em",
      }}
    >
      <motion.span
        aria-hidden
        className="absolute inset-0"
        style={{
          originX: 0,
          background: "var(--mark-bg-light)",
          borderRadius: "0.45em 0.65em 0.5em 0.35em",
          transform: "rotate(-0.4deg)",
        }}
        initial={instant ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: SWEEP_START + i * STAGGER, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      />
      <span className="relative">{children}</span>
    </span>
  );
}

/* --------------------------------------------------------------- the sheets
   Real miniature documents: genuine (illustrative) content, real typography,
   tabular figures. Sizes are tiny by design — these read as paperwork at
   arm's length, and every highlighted value is genuinely printed on the page. */

function StatementRow({ date, desc, amount, neg = true }: { date: string; desc: string; amount: string; neg?: boolean }) {
  return (
    <div
      className="flex items-baseline gap-2 border-b py-[3px] text-[7.5px] leading-none"
      style={{ borderColor: RULE, fontVariantNumeric: "tabular-nums" }}
    >
      <span style={{ color: INK_FAINT }}>{date}</span>
      <span className="truncate">{desc}</span>
      <span className="ml-auto" style={{ color: neg ? undefined : "#2f6f4e" }}>
        {amount}
      </span>
    </div>
  );
}

function StatementDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [date, desc, amount] = fields;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] font-semibold tracking-[0.02em]">FIRST FEDERAL</span>
        <span className="text-[6.5px]" style={{ color: INK_FAINT }}>
          Account 4402-19 · Statement period 1–31 Mar 2026
        </span>
      </div>
      <div
        className="mt-2 flex items-baseline gap-2 border-b pb-[3px] text-[6.5px] uppercase tracking-[0.08em]"
        style={{ borderColor: RULE_STRONG, color: INK_FAINT }}
      >
        <span className="w-[52px]">Date</span>
        <span>Description</span>
        <span className="ml-auto">Amount</span>
      </div>
      <div style={{ fontVariantNumeric: "tabular-nums" }}>
        <StatementRow date="27 Feb" desc="Opening balance" amount="6,014.22" />
        <StatementRow date="01 Mar" desc="Ryde Utilities — direct debit" amount="−86.40" />
        <div className="flex items-baseline gap-2 border-b py-[3px] text-[7.5px] leading-none" style={{ borderColor: RULE }}>
          <span>
            <Hl i={0} instant={instant}>{date.value}</Hl>
          </span>
          <span>
            <Hl i={1} instant={instant}>{desc.value}</Hl>
          </span>
          <span className="ml-auto">
            <Hl i={2} instant={instant}>{amount.value}</Hl>
          </span>
        </div>
        <StatementRow date="04 Mar" desc="Grocer &amp; Co 1188" amount="−112.35" />
        <StatementRow date="06 Mar" desc="Transfer to savings" amount="−500.00" />
        <StatementRow date="09 Mar" desc="Caffe Duo — card 8802" amount="−9.80" />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between text-[7px]" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span style={{ color: INK_FAINT }}>Page 1 of 3</span>
        <span>
          Closing balance <span className="font-semibold">9,515.67</span>
        </span>
      </div>
    </div>
  );
}

function ContractDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [party, effective, term] = fields;
  const serif: CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
  return (
    <div style={serif}>
      <p className="text-center text-[8px] font-semibold tracking-[0.14em]">MASTER SERVICES AGREEMENT</p>
      <p className="mt-0.5 text-center text-[6.5px] italic" style={{ color: INK_FAINT }}>
        dated as of the Effective Date below
      </p>
      <p className="mt-2 text-justify text-[7px] leading-[1.55]">
        This Agreement is entered into between <Hl i={0} instant={instant}>{party.value}</Hl> (the
        &ldquo;Supplier&rdquo;) and Meridian Holdings Pty Ltd (the &ldquo;Client&rdquo;), effective{" "}
        <Hl i={1} instant={instant}>{effective.value}</Hl> (the &ldquo;Effective Date&rdquo;).
      </p>
      <p className="mt-1.5 text-justify text-[7px] leading-[1.55]">
        <span className="font-semibold">2. Term.</span> This Agreement commences on the Effective
        Date and continues for an initial term of <Hl i={2} instant={instant}>{term.value}</Hl>,
        renewing automatically unless either party gives sixty (60) days&rsquo; written notice.
      </p>
      <p className="mt-1.5 text-justify text-[7px] leading-[1.55]" style={{ color: INK_FAINT }}>
        <span className="font-semibold" style={{ color: "#2b2f33" }}>3. Fees.</span> The Client shall
        pay the fees set out in Schedule A within thirty (30) days of invoice.
      </p>
      <div className="mt-2.5 flex items-end justify-between gap-6">
        <div className="flex-1">
          <div className="h-3 border-b" style={{ borderColor: RULE_STRONG }} />
          <p className="mt-0.5 text-[6px] uppercase tracking-[0.1em]" style={{ color: INK_FAINT, fontFamily: "var(--font-body)" }}>
            Supplier signature
          </p>
        </div>
        <div className="flex-1">
          <div className="h-3 border-b" style={{ borderColor: RULE_STRONG }} />
          <p className="mt-0.5 text-[6px] uppercase tracking-[0.1em]" style={{ color: INK_FAINT, fontFamily: "var(--font-body)" }}>
            Client signature
          </p>
        </div>
      </div>
    </div>
  );
}

function InvoiceDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [number, due, total] = fields;
  const num: CSSProperties = { fontVariantNumeric: "tabular-nums" };
  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[8.5px] font-semibold tracking-[0.02em]">Fieldwork Studio</p>
          <p className="text-[6.5px]" style={{ color: INK_FAINT }}>
            14 Sample St, Sydney NSW · ABN 12 004 044 937
          </p>
        </div>
        <div className="text-right">
          <p className="text-[8px] font-semibold tracking-[0.16em]">TAX INVOICE</p>
          <p className="text-[7px]" style={num}>
            <Hl i={0} instant={instant}>{number.value}</Hl>
          </p>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[6.5px]" style={{ color: INK_FAINT }}>
        <span>
          Billed to: <span style={{ color: "#2b2f33" }}>Meridian Holdings Pty Ltd</span>
        </span>
        <span style={num}>
          Due <Hl i={1} instant={instant}>{due.value}</Hl>
        </span>
      </div>
      <div
        className="mt-2 flex items-baseline border-b pb-[3px] text-[6.5px] uppercase tracking-[0.08em]"
        style={{ borderColor: RULE_STRONG, color: INK_FAINT }}
      >
        <span>Description</span>
        <span className="ml-auto w-[34px] text-right">Qty</span>
        <span className="w-[52px] text-right">Amount</span>
      </div>
      {[
        ["Field extraction setup", "1", "600.00"],
        ["Document processing (Mar)", "412", "1,102.50"],
        ["GST 10%", "", "170.00"],
      ].map(([d, q, a]) => (
        <div key={d} className="flex items-baseline border-b py-[3.5px] text-[7.5px] leading-none" style={{ borderColor: RULE, ...num }}>
          <span>{d}</span>
          <span className="ml-auto w-[34px] text-right" style={{ color: INK_FAINT }}>{q}</span>
          <span className="w-[52px] text-right">{a}</span>
        </div>
      ))}
      <div className="mt-[5px] flex items-baseline justify-between text-[8px] font-semibold" style={num}>
        <span>Total due (AUD)</span>
        <span style={{ borderTop: `1px solid ${RULE_STRONG}`, borderBottom: `1px double ${RULE_STRONG}`, padding: "2px 0" }}>
          <Hl i={2} instant={instant}>{total.value}</Hl>
        </span>
      </div>
    </div>
  );
}

function EmailDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [from, subject, delivery] = fields;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-semibold text-white"
          style={{ background: "#8a6d4a" }}
        >
          A
        </span>
        <div className="min-w-0 text-[7px] leading-[1.5]">
          <p>
            <span style={{ color: INK_FAINT }}>From&nbsp;&nbsp;</span>
            <Hl i={0} instant={instant}>{from.value}</Hl>
          </p>
          <p>
            <span style={{ color: INK_FAINT }}>To&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            mike@meridian.co
          </p>
        </div>
        <span className="ml-auto self-start text-[6.5px]" style={{ color: INK_FAINT }}>
          Tue 09:14
        </span>
      </div>
      <p className="mt-1.5 border-b pb-1 text-[8px] font-semibold" style={{ borderColor: RULE }}>
        <Hl i={1} instant={instant}>{subject.value}</Hl>
      </p>
      <div className="mt-1.5 space-y-1 text-[7px] leading-[1.6]">
        <p>Hi Mike,</p>
        <p>
          Good news — your order <span style={{ fontVariantNumeric: "tabular-nums" }}>#88214</span> has
          shipped and is on schedule to arrive on{" "}
          <Hl i={2} instant={instant}>{delivery.value}</Hl> before end of day.
        </p>
        <p style={{ color: INK_FAINT }}>
          You can follow the courier link below for live tracking. No signature is required.
        </p>
        <p>
          Thanks,
          <br />
          Anna · Parcel.io dispatch
        </p>
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
    <figure
      role="img"
      aria-label="Demo of sift extracting fields from a bank statement, contract, invoice, and email — each value marked on the paper and mirrored in a results card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="mx-auto w-full max-w-3xl text-left"
    >
      <div aria-hidden>
        {/* Which paper is on the desk right now — quiet filename tags */}
        <div className="mb-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5">
          {DOCS.map((doc) => (
            <span
              key={doc.id}
              className="data pb-0.5 text-[11px] transition-colors duration-300"
              style={{
                color: doc.id === active.id ? "var(--text-primary)" : "var(--text-tertiary)",
                boxShadow: doc.id === active.id ? "inset 0 -2px 0 var(--accent)" : "none",
              }}
            >
              {doc.file}
            </span>
          ))}
        </div>

        <div className="grid items-center gap-6 sm:grid-cols-[1.15fr_1fr] sm:gap-8">
          {/* The paper, resting on the page itself — no frame, no chrome */}
          <div className="relative mx-auto h-[248px] w-full max-w-[356px]">
            {/* A second sheet peeking out beneath the stack */}
            <div
              className="absolute inset-x-2 bottom-[-5px] top-[9px]"
              style={{
                background: "#f6f4ec",
                transform: "rotate(1.6deg)",
                borderRadius: 2,
                boxShadow: "0 6px 18px -8px rgba(43,47,51,0.25)",
              }}
            />
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active.id}
                className="absolute inset-0 px-4 py-3.5"
                style={{ ...PAPER, borderRadius: 2 }}
                initial={reduced ? false : { opacity: 0, y: -14, rotate: active.rotate + 2.5 }}
                animate={{ opacity: 1, y: 0, rotate: active.rotate }}
                exit={reduced ? undefined : { opacity: 0, y: 10, transition: { duration: 0.18 } }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <Doc fields={active.fields} instant={reduced} />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Results — an actual sift artifact, so it follows the app theme */}
          <div
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-3.5"
            style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.05), 0 12px 32px -16px rgba(0,0,0,0.18)" }}
          >
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <span className="data truncate text-[11px] text-[var(--text-secondary)]">{active.file}</span>
              <span className="flex flex-shrink-0 items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                grounded
              </span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active.id}
                exit={reduced ? undefined : { opacity: 0, transition: { duration: 0.18 } }}
                className="divide-y divide-[var(--border-subtle)]"
              >
                {active.fields.map((field, i) => (
                  <motion.div
                    key={field.name}
                    initial={reduced ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: SWEEP_START + ROW_LAG + i * STAGGER,
                      duration: 0.32,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="flex items-center gap-2.5 py-2 first:pt-0.5 last:pb-0.5"
                    style={fieldColorVars(i) as CSSProperties}
                  >
                    <span className="field-swatch h-2 w-2 flex-shrink-0 rounded-[3px]" />
                    <span className="data text-[11px] text-[var(--text-tertiary)]">{field.name}</span>
                    <span
                      className="data ml-auto truncate text-[11px] font-medium text-[var(--text-primary)]"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {field.value}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </figure>
  );
}
