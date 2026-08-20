"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { fieldColor, fieldColorVars } from "@/lib/fieldColors";

/**
 * Animated hero showcase — the instrument reading a document (DESIGN.md
 * "Signature interaction", Persuade mode). One machined bezel holds two
 * chambers: the PLATEN (an inset well where a realistic paper miniature sits
 * as a lit specimen — fixed ink-on-paper colors in both calibrations, edge-lit
 * against the graphite case) and the READINGS panel (mono values, etched
 * uppercase field labels, a 2px field-color edge-tick per row — traces, not
 * washes, law 2).
 *
 * Cycles bank statement → contract → invoice → email. Per cycle, each field's
 * value on the paper gets a 2px field-colored underline trace drawing on
 * (plus a ≤12% tint — the marker sweep is retired), its reading lands in the
 * panel, and a hairline PROBE LINE (SVG) draws from the mark to its reading —
 * the signature motif. The probe line is measured from layout offsets
 * (offsetLeft/Top chains), not getBoundingClientRect, so entrance transforms
 * never skew it; it renders only at sm+ where the two chambers sit side by
 * side.
 *
 * The showcase always renders in the dark calibration (the landing <main> is
 * .bench-dark), so readings use the dark field-color variants explicitly,
 * mirroring the paper's fixed light variants.
 *
 * This is the landing page's only client island and the page's one authored
 * motion moment. prefers-reduced-motion: static invoice, traces fully drawn,
 * probe line static, no cycling. Hover pauses the cycle (unchanged).
 */

interface DocField {
  name: string;
  value: string;
}

interface DocDef {
  id: "statement" | "contract" | "invoice" | "email";
  label: string;
  file: string;
  fields: DocField[]; // order = field color index = animation order
}

const DOCS: DocDef[] = [
  {
    id: "statement",
    label: "Bank statement",
    file: "statement_mar.pdf",
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
const ROW_LAG = 0.35; // s between a trace starting and its reading landing

// Reduced-motion users get a static, fully-traced invoice.
const STATIC_DOC_INDEX = 2;

/* -------------------------------------------------------------- paper ink */
// The sheet is a physical specimen under instrument light: fixed light-paper
// palette in BOTH calibrations (never theme tokens). Edge-lit against the
// case — a 1px light rim where the platen light catches the paper's edge
// (a line, not a blur — law 3 stays honored; same treatment as .doc-sheet).
const PAPER: CSSProperties = {
  background: "linear-gradient(178deg, #fdfcf7 0%, #f8f6ef 100%)",
  color: "#2b2f33",
  boxShadow: "0 0 0 1px rgba(233, 235, 231, 0.14)",
};
const INK_FAINT = "#787d80"; // secondary print on paper, ~4.6:1 on #fdfcf7
const RULE = "rgba(43, 47, 51, 0.14)"; // hairlines on paper
const RULE_STRONG = "rgba(43, 47, 51, 0.42)";

/**
 * A marked value on the paper (law 2): the value keeps the paper's own ink
 * color and carries its field identity as a 2px underline trace drawing on
 * left→right plus a faint (12%) tint. Paper is a light object, so the trace
 * always uses the light-variant field color regardless of theme.
 */
function Hl({ i, instant, children }: { i: number; instant: boolean; children: ReactNode }) {
  return (
    <span
      data-probe-mark={i}
      className="relative inline-block whitespace-nowrap px-[2px]"
      style={fieldColorVars(i) as CSSProperties}
    >
      <motion.span
        aria-hidden
        className="absolute inset-0"
        style={{ background: "color-mix(in srgb, var(--mark-text-light) 12%, transparent)" }}
        initial={instant ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: SWEEP_START + i * STAGGER, duration: 0.25 }}
      />
      <motion.span
        aria-hidden
        className="absolute inset-x-0 bottom-[-1px] h-[2px]"
        style={{ originX: 0, background: "var(--mark-text-light)" }}
        initial={instant ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: SWEEP_START + i * STAGGER, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      />
      <span className="relative">{children}</span>
    </span>
  );
}

/* --------------------------------------------------------------- the sheets
   Real miniature documents: genuine (illustrative) content, real typography,
   tabular figures. Sizes are tiny by design — these read as paperwork under
   the instrument's light, and every traced value is genuinely printed on the
   page. (Typeset content unchanged from the desk-era showcase — only the
   mark treatment moved from marker sweeps to underline traces.) */

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

/* --------------------------------------------------------------- the probe
   The signature motif: a hairline SVG line from a mark on the paper to its
   reading in the panel, drawn in the field's (dark-variant) trace color.
   Endpoints come from offsetLeft/Top chains up to the stage element — layout
   coordinates, immune to the entrance transforms framer applies — so the
   line is exact once the elements exist. */

interface ProbePt {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function layoutOffset(stage: HTMLElement, el: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== stage) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

function measureProbe(stage: HTMLElement, i: number): ProbePt | null {
  const mark = stage.querySelector<HTMLElement>(`[data-probe-mark="${i}"]`);
  const row = stage.querySelector<HTMLElement>(`[data-probe-row="${i}"]`);
  if (!mark || !row) return null;
  const m = layoutOffset(stage, mark);
  const r = layoutOffset(stage, row);
  return {
    x1: m.x + mark.offsetWidth + 3,
    y1: m.y + mark.offsetHeight / 2,
    x2: r.x - 1,
    y2: r.y + row.offsetHeight / 2,
  };
}

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
  // The probe carries the doc id it was measured against: a stale probe
  // (from the previous specimen) simply stops rendering when the cycle
  // advances — no synchronous state clearing needed in the effect below.
  const [probe, setProbe] = useState<{ docId: DocDef["id"]; i: number; pt: ProbePt } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced || paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % DOCS.length), CYCLE_MS);
    return () => clearInterval(t);
  }, [reduced, paused]);

  const active = reduced ? DOCS[STATIC_DOC_INDEX] : DOCS[idx];
  const Doc = DOC_RENDERERS[active.id];

  // Probe stepping: as each reading lands, re-aim the probe line at that
  // field's mark→reading pair (measured fresh — the new doc's marks are in
  // the DOM from mount even while their traces are still delayed).
  useEffect(() => {
    if (!mounted) return;
    const docId = active.id;
    if (reduced) {
      // Static probe on the invoice's first field, measured after paint.
      const raf = requestAnimationFrame(() => {
        const el = stageRef.current;
        if (!el) return;
        const pt = measureProbe(el, 0);
        if (pt) setProbe({ docId, i: 0, pt });
      });
      return () => cancelAnimationFrame(raf);
    }
    const timers = DOCS[0].fields.map((_, i) =>
      setTimeout(
        () => {
          const el = stageRef.current;
          if (!el) return;
          const pt = measureProbe(el, i);
          setProbe(pt ? { docId, i, pt } : null);
        },
        (SWEEP_START + ROW_LAG + i * STAGGER) * 1000 + 150,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [active.id, reduced, mounted]);

  // Keep the current probe line true across resizes.
  useEffect(() => {
    const onResize = () =>
      setProbe((p) => {
        const el = stageRef.current;
        if (!p || !el) return p;
        const pt = measureProbe(el, p.i);
        return pt ? { ...p, pt } : p;
      });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Render the probe only if it belongs to the specimen currently on the
  // platen (a stale one goes dark the moment the cycle advances).
  const liveProbe = probe && probe.docId === active.id ? probe : null;
  const probeColor = liveProbe ? fieldColor(liveProbe.i).dark.text : undefined;

  return (
    <figure
      role="img"
      aria-label="Demo of sift reading a bank statement, contract, invoice, and email — each value traced on the paper, linked by a probe line to its reading in the results panel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="mx-auto w-full max-w-3xl text-left"
    >
      <div aria-hidden>
        {/* The instrument bezel: one machined panel, hairline-divided */}
        <div className="overflow-hidden rounded-[6px] border border-[var(--hairline)] bg-[var(--panel)]">
          {/* Header strip: etched specimen labels (which paper is on the platen) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--hairline)] px-4 py-2.5 sm:px-5">
            <span className="etched-label mr-1">Specimen</span>
            {DOCS.map((doc) => (
              <span
                key={doc.id}
                className="data pb-px text-[10px] tracking-[0.02em] transition-colors duration-300"
                style={{
                  color: doc.id === active.id ? "var(--ink)" : "var(--ink-faint)",
                  boxShadow:
                    doc.id === active.id ? "inset 0 -2px 0 var(--hairline-strong)" : "none",
                }}
              >
                {doc.file}
              </span>
            ))}
          </div>

          <div ref={stageRef} className="relative grid sm:grid-cols-[1.15fr_1fr]">
            {/* The platen: an inset well; the paper sits on it as a lit specimen */}
            <div className="border-b border-[var(--hairline)] bg-[var(--well)] px-4 py-5 sm:border-b-0 sm:border-r sm:px-6 sm:py-6">
              <div className="relative mx-auto h-[248px] w-full max-w-[356px]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={active.id}
                    className="absolute inset-0 px-4 py-3.5"
                    style={{ ...PAPER, borderRadius: 2 }}
                    initial={reduced ? false : { opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0, y: 8, transition: { duration: 0.18 } }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Doc fields={active.fields} instant={reduced} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* Readings — the phosphor-lit display side of the instrument */}
            <div className="flex flex-col p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="etched-label">Readings</span>
                <span className="flex flex-shrink-0 items-center gap-1.5">
                  <span className="led led-on" />
                  <span className="data text-[10px] uppercase tracking-[0.08em] text-[var(--ink-dim)]">
                    grounded
                  </span>
                </span>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active.id}
                  exit={reduced ? undefined : { opacity: 0, transition: { duration: 0.18 } }}
                  className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]"
                >
                  {active.fields.map((field, i) => (
                    <motion.div
                      key={field.name}
                      data-probe-row={i}
                      initial={reduced ? false : { opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        delay: SWEEP_START + ROW_LAG + i * STAGGER,
                        duration: 0.32,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="flex items-baseline gap-3 py-2.5 pl-3 pr-1"
                      // The reading's edge-tick (law 2): 2px left tick in the
                      // field color. Always the dark variant — the landing is
                      // pinned to the dark calibration (.bench-dark) — the
                      // mirror of the paper hardcoding the light variant.
                      style={{ boxShadow: `inset 2px 0 0 0 ${fieldColor(i).dark.text}` }}
                    >
                      <span className="data text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
                        {field.name}
                      </span>
                      <span
                        className="data ml-auto truncate text-[11.5px] font-medium text-[var(--ink)]"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {field.value}
                      </span>
                    </motion.div>
                  ))}
                </motion.div>
              </AnimatePresence>
              <div className="mt-auto flex items-center justify-between pt-3">
                <span className="data truncate text-[10px] text-[var(--ink-faint)]">
                  {active.file}
                </span>
                <span className="data flex-shrink-0 text-[10px] text-[var(--ink-faint)]">
                  3 fields
                </span>
              </div>
            </div>

            {/* The probe line — mark → reading, in the field's trace color.
                Only where the chambers sit side by side (sm+). */}
            {liveProbe && probeColor && (
              <svg className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block">
                <motion.line
                  key={`${liveProbe.docId}-${liveProbe.i}`}
                  x1={liveProbe.pt.x1}
                  y1={liveProbe.pt.y1}
                  x2={liveProbe.pt.x2}
                  y2={liveProbe.pt.y2}
                  stroke={probeColor}
                  strokeWidth={1}
                  initial={reduced ? undefined : { pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.85 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                />
                <motion.circle
                  key={`${liveProbe.docId}-${liveProbe.i}-dot`}
                  cx={liveProbe.pt.x1}
                  cy={liveProbe.pt.y1}
                  r={2}
                  fill={probeColor}
                  initial={reduced ? undefined : { opacity: 0 }}
                  animate={{ opacity: 0.85 }}
                  transition={{ duration: 0.2 }}
                />
              </svg>
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}
