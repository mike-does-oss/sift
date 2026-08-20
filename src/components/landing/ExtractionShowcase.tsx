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
import { fieldColorVars } from "@/lib/fieldColors";

/**
 * Animated hero showcase — the instrument reading a document (DESIGN.md
 * "Signature interaction", Persuade mode). One machined bezel holds two
 * chambers: the PLATEN (an inset well where a full portrait PAGE sits as a
 * lit specimen — true paper aspect (5:7, ~300×420 at desktop), complete
 * document anatomy at miniature scale, fixed ink-on-paper colors in both
 * calibrations) and the READINGS panel (mono values, etched uppercase field
 * labels, a 2px field-color edge-tick per row — traces, not washes, law 2).
 *
 * Cycles bank statement → contract → invoice → email. Per cycle, each field's
 * value on the paper gets a 2px field-colored underline trace drawing on
 * (plus a ≤12% tint), its reading lands in the panel, and a hairline PROBE
 * LINE (SVG) draws from the mark to its reading — the signature motif. The
 * probe line is measured from layout offsets (offsetLeft/Top chains), not
 * getBoundingClientRect, so entrance transforms never skew it; it renders
 * only at sm+ where the two chambers sit side by side.
 *
 * The landing follows the visitor's calibration (founder 2026-08-20: "not
 * dark bg" — the .bench-dark pin is retired), so the readings side is
 * theme-following: edge-ticks via .field-tick and the probe line via
 * .field-trace-ink + currentColor, both resolving the field's light/dark
 * trace variant in CSS. Only the paper keeps a fixed light-ink palette —
 * it's a physical specimen, the same in both calibrations.
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
// palette in BOTH calibrations (never theme tokens). Its edge is the
// theme-following .sheet-rim line — a faint graphite seat on the lab bench,
// edge-lit against the graphite case (a line, not a blur — law 3; same
// treatment as .doc-sheet).
const PAPER: CSSProperties = {
  background: "linear-gradient(178deg, #fdfcf7 0%, #f8f6ef 100%)",
  color: "#2b2f33",
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

/* --------------------------------------------------------------- the pages
   Full proper documents (founder 2026-08-20): each specimen is a complete
   portrait page — letterhead to footer — typeset at miniature scale with
   genuine (illustrative) content and tabular figures. Every doc root is a
   h-full flex column so footers sit at the true bottom of the page, and
   every traced value is genuinely printed in the flow of its document. */

const NUM: CSSProperties = { fontVariantNumeric: "tabular-nums" };

function StatementRow({
  date,
  desc,
  amount,
  balance,
  credit = false,
}: {
  date: string;
  desc: string;
  amount: string;
  balance: string;
  credit?: boolean;
}) {
  return (
    <div
      className="flex items-baseline gap-1.5 border-b py-[2.5px] text-[6.8px] leading-none"
      style={{ borderColor: RULE, ...NUM }}
    >
      <span className="w-[50px] flex-shrink-0" style={{ color: INK_FAINT }}>
        {date}
      </span>
      <span className="min-w-0 truncate">{desc}</span>
      <span
        className="ml-auto w-[42px] flex-shrink-0 text-right"
        style={{ color: credit ? "#2f6f4e" : undefined }}
      >
        {amount}
      </span>
      <span className="w-[46px] flex-shrink-0 text-right">{balance}</span>
    </div>
  );
}

function StatementDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [date, desc, amount] = fields;
  return (
    <div className="flex h-full flex-col">
      {/* Letterhead: bank name + branch address block */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[9.5px] font-semibold leading-none tracking-[0.03em]">
            FIRST FEDERAL BANK
          </p>
          <p className="mt-[3px] text-[5.5px] leading-[1.5]" style={{ color: INK_FAINT }}>
            Personal Banking Division
          </p>
        </div>
        <div className="text-right text-[5.5px] leading-[1.5]" style={{ color: INK_FAINT }}>
          <p>271 Collins Street</p>
          <p>Melbourne VIC 3000</p>
          <p>firstfederal.example</p>
        </div>
      </div>
      <div className="mt-[6px] border-b" style={{ borderColor: RULE_STRONG }} />

      {/* Customer address block + statement meta */}
      <div className="mt-[8px] flex items-start justify-between">
        <div className="text-[6.5px] leading-[1.55]">
          <p>MR M WANG</p>
          <p>14 SAMPLE STREET</p>
          <p>SYDNEY NSW 2000</p>
        </div>
        <div className="text-right text-[6.5px] leading-[1.55]" style={NUM}>
          <p className="font-semibold">Statement of Account</p>
          <p style={{ color: INK_FAINT }}>Account 4402-19</p>
          <p style={{ color: INK_FAINT }}>Period 1–31 Mar 2026</p>
        </div>
      </div>

      {/* Account summary line */}
      <div
        className="mt-[9px] flex items-baseline justify-between border-y py-[3.5px] text-[6px]"
        style={{ borderColor: RULE, ...NUM }}
      >
        <span>
          <span style={{ color: INK_FAINT }}>Opening </span>6,014.22
        </span>
        <span>
          <span style={{ color: INK_FAINT }}>Credits </span>4,222.50
        </span>
        <span>
          <span style={{ color: INK_FAINT }}>Debits </span>1,203.33
        </span>
        <span>
          <span style={{ color: INK_FAINT }}>Closing </span>
          <span className="font-semibold">9,033.39</span>
        </span>
      </div>

      {/* Transaction table */}
      <div
        className="mt-[8px] flex items-baseline gap-1.5 border-b pb-[3px] text-[5.5px] uppercase tracking-[0.08em]"
        style={{ borderColor: RULE_STRONG, color: INK_FAINT }}
      >
        <span className="w-[50px] flex-shrink-0">Date</span>
        <span>Description</span>
        <span className="ml-auto w-[42px] flex-shrink-0 text-right">Amount</span>
        <span className="w-[46px] flex-shrink-0 text-right">Balance</span>
      </div>
      <StatementRow date="01 Mar 2026" desc="Opening balance" amount="" balance="6,014.22" />
      <StatementRow date="01 Mar 2026" desc="Ryde Utilities — direct debit" amount="−86.40" balance="5,927.82" />
      <StatementRow date="02 Mar 2026" desc="Grocer & Co — card 8802" amount="−64.19" balance="5,863.63" />
      {/* The traced transaction — printed in the table flow like any other */}
      <div
        className="flex items-baseline gap-1.5 border-b py-[2.5px] text-[6.8px] leading-none"
        style={{ borderColor: RULE, ...NUM }}
      >
        <span className="w-[50px] flex-shrink-0">
          <Hl i={0} instant={instant}>{date.value}</Hl>
        </span>
        <span className="min-w-0 truncate">
          <Hl i={1} instant={instant}>{desc.value}</Hl>
        </span>
        <span className="ml-auto w-[42px] flex-shrink-0 text-right" style={{ color: "#2f6f4e" }}>
          <Hl i={2} instant={instant}>{amount.value}</Hl>
        </span>
        <span className="w-[46px] flex-shrink-0 text-right">10,073.63</span>
      </div>
      <StatementRow date="04 Mar 2026" desc="Grocer & Co 1188" amount="−112.35" balance="9,961.28" />
      <StatementRow date="06 Mar 2026" desc="Transfer to savings" amount="−500.00" balance="9,461.28" />
      <StatementRow date="09 Mar 2026" desc="Caffe Duo — card 8802" amount="−9.80" balance="9,451.48" />
      <StatementRow date="12 Mar 2026" desc="City of Ryde — rates" amount="−214.60" balance="9,236.88" />
      <StatementRow date="15 Mar 2026" desc="Stream+ subscription" amount="−15.99" balance="9,220.89" />
      <StatementRow date="18 Mar 2026" desc="ATM withdrawal — George St" amount="−200.00" balance="9,020.89" />
      <StatementRow date="24 Mar 2026" desc="Refund — Grocer & Co" amount="+12.50" balance="9,033.39" credit />
      <div
        className="flex items-baseline justify-between py-[3.5px] text-[7px] font-semibold"
        style={NUM}
      >
        <span>Closing balance at 31 Mar 2026</span>
        <span>9,033.39</span>
      </div>

      {/* Page footer: page marker + disclaimer microtext */}
      <div className="mt-auto pt-2">
        <div
          className="flex items-baseline justify-between border-t pt-[4px] text-[5.5px]"
          style={{ borderColor: RULE, color: INK_FAINT }}
        >
          <span>Page 1 of 3</span>
          <span>First Federal Bank · AFSL 240012</span>
        </div>
        <p className="mt-[3px] text-[5.5px] leading-[1.5]" style={{ color: INK_FAINT }}>
          Please check the entries on this statement and report any discrepancy within 30 days.
          Interest is calculated daily and credited quarterly.
        </p>
      </div>
    </div>
  );
}

function ContractDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [party, effective, term] = fields;
  const serif: CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
  const label: CSSProperties = { color: INK_FAINT, fontFamily: "var(--font-body)" };
  return (
    <div className="flex h-full flex-col" style={serif}>
      <p className="text-center text-[8.5px] font-semibold tracking-[0.14em]">
        MASTER SERVICES AGREEMENT
      </p>
      <p className="mt-[3px] text-center text-[6.5px] italic" style={{ color: INK_FAINT }}>
        dated as of the Effective Date below
      </p>
      <p className="mt-[10px] text-justify text-[7px] leading-[1.6]">
        This Master Services Agreement (the &ldquo;Agreement&rdquo;) is entered into between{" "}
        <Hl i={0} instant={instant}>{party.value}</Hl>, a company registered in England and Wales
        (the &ldquo;Supplier&rdquo;), and Meridian Holdings Pty Ltd of Sydney, Australia (the
        &ldquo;Client&rdquo;), and takes effect on{" "}
        <Hl i={1} instant={instant}>{effective.value}</Hl> (the &ldquo;Effective Date&rdquo;).
      </p>
      <p className="mt-[7px] text-justify text-[7px] leading-[1.6]">
        <span className="font-semibold">1. Services.</span> The Supplier shall provide the
        document-processing services described in Schedule A with reasonable skill and care, in
        accordance with all applicable laws and the Client&rsquo;s reasonable written instructions.
      </p>
      <p className="mt-[7px] text-justify text-[7px] leading-[1.6]">
        <span className="font-semibold">2. Term.</span> This Agreement commences on the Effective
        Date and continues for an initial term of <Hl i={2} instant={instant}>{term.value}</Hl>,
        renewing automatically for successive twelve-month periods unless either party gives sixty
        (60) days&rsquo; written notice of non-renewal.
      </p>
      <p className="mt-[7px] text-justify text-[7px] leading-[1.6]">
        <span className="font-semibold">3. Fees.</span> The Client shall pay the fees set out in
        Schedule A within thirty (30) days of the date of a correctly rendered invoice. Fees are
        exclusive of GST unless stated otherwise.
      </p>
      <p className="mt-[7px] text-justify text-[7px] leading-[1.6]">
        <span className="font-semibold">4. Confidentiality.</span> Each party shall keep
        confidential all information of the other that is marked confidential or would reasonably
        be regarded as such, and shall use it solely to perform this Agreement.
      </p>

      {/* Signature block: two signature rules + date lines */}
      <div className="mt-auto grid grid-cols-2 gap-x-7 pt-3">
        {["Supplier", "Client"].map((p) => (
          <div key={p}>
            <div className="h-4 border-b" style={{ borderColor: RULE_STRONG }} />
            <p className="mt-[2px] text-[5.5px] uppercase tracking-[0.1em]" style={label}>
              Signed for the {p}
            </p>
            <div className="mt-[8px] h-3 w-2/3 border-b" style={{ borderColor: RULE_STRONG }} />
            <p className="mt-[2px] text-[5.5px] uppercase tracking-[0.1em]" style={label}>
              Date
            </p>
          </div>
        ))}
      </div>
      <p
        className="mt-[9px] border-t pt-[4px] text-center text-[5.5px]"
        style={{ borderColor: RULE, color: INK_FAINT, fontFamily: "var(--font-body)" }}
      >
        Master Services Agreement · Northwind Ltd — Meridian Holdings Pty Ltd · Execution version
      </p>
    </div>
  );
}

function InvoiceDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [number, due, total] = fields;
  return (
    <div className="flex h-full flex-col">
      {/* Letterhead: logo square + studio address block */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-[6px]">
          <span
            className="mt-[1px] h-[13px] w-[13px] flex-shrink-0"
            style={{ background: "#2b2f33" }}
          />
          <div>
            <p className="text-[8.5px] font-semibold leading-none tracking-[0.02em]">
              Fieldwork Studio
            </p>
            <p className="mt-[3px] text-[5.5px] leading-[1.5]" style={{ color: INK_FAINT }}>
              14 Sample Street, Sydney NSW 2000
              <br />
              ABN 12 004 044 937 · hello@fieldwork.example
            </p>
          </div>
        </div>
        <p className="text-[8px] font-semibold tracking-[0.16em]">TAX INVOICE</p>
      </div>

      {/* Invoice meta block */}
      <div
        className="mt-[10px] flex items-baseline justify-between border-y py-[4px] text-[6.5px]"
        style={{ borderColor: RULE_STRONG, ...NUM }}
      >
        <span>
          <span style={{ color: INK_FAINT }}>Invoice no </span>
          <Hl i={0} instant={instant}>{number.value}</Hl>
        </span>
        <span>
          <span style={{ color: INK_FAINT }}>Issued </span>31 Mar 2026
        </span>
        <span>
          <span style={{ color: INK_FAINT }}>Due </span>
          <Hl i={1} instant={instant}>{due.value}</Hl>
        </span>
      </div>

      {/* Bill-to address block */}
      <p className="mt-[9px] text-[5.5px] uppercase tracking-[0.1em]" style={{ color: INK_FAINT }}>
        Bill to
      </p>
      <div className="mt-[2px] text-[6.5px] leading-[1.55]">
        <p className="font-semibold">Meridian Holdings Pty Ltd</p>
        <p>Level 12, 88 Harbour Road</p>
        <p>Sydney NSW 2000</p>
      </div>

      {/* Line items */}
      <div
        className="mt-[10px] flex items-baseline border-b pb-[3px] text-[5.5px] uppercase tracking-[0.08em]"
        style={{ borderColor: RULE_STRONG, color: INK_FAINT }}
      >
        <span>Description</span>
        <span className="ml-auto w-[30px] text-right">Qty</span>
        <span className="w-[50px] text-right">Amount</span>
      </div>
      {[
        ["Field extraction setup", "1", "600.00"],
        ["Document processing — March", "412", "704.00"],
        ["Scheduled inbox (monthly)", "1", "150.00"],
        ["Template design — 2 templates", "2", "248.27"],
      ].map(([d, q, a]) => (
        <div
          key={d}
          className="flex items-baseline border-b py-[3.5px] text-[7px] leading-none"
          style={{ borderColor: RULE, ...NUM }}
        >
          <span>{d}</span>
          <span className="ml-auto w-[30px] text-right" style={{ color: INK_FAINT }}>
            {q}
          </span>
          <span className="w-[50px] text-right">{a}</span>
        </div>
      ))}

      {/* Totals: subtotal / GST / total under a double rule */}
      <div className="mt-[6px] ml-auto w-[120px] text-[6.8px]" style={NUM}>
        <div className="flex items-baseline justify-between py-[2px]">
          <span style={{ color: INK_FAINT }}>Subtotal</span>
          <span>1,702.27</span>
        </div>
        <div className="flex items-baseline justify-between py-[2px]">
          <span style={{ color: INK_FAINT }}>GST 10%</span>
          <span>170.23</span>
        </div>
        <div
          className="mt-[2px] flex items-baseline justify-between py-[3px] text-[7.5px] font-semibold"
          style={{
            borderTop: `1px solid ${RULE_STRONG}`,
            borderBottom: `1px double ${RULE_STRONG}`,
          }}
        >
          <span>Total due (AUD)</span>
          <span>
            <Hl i={2} instant={instant}>{total.value}</Hl>
          </span>
        </div>
      </div>

      {/* Payment terms footer */}
      <div className="mt-auto pt-2">
        <div
          className="border-t pt-[4px] text-[5.5px] leading-[1.5]"
          style={{ borderColor: RULE, color: INK_FAINT }}
        >
          <p>
            Pay to Fieldwork Studio · BSB 062-000 · Account 1146 8221 · within 30 days of issue.
          </p>
          <p>Please quote the invoice number on all payments. Thank you for your business.</p>
        </div>
      </div>
    </div>
  );
}

function EmailDoc({ fields, instant }: { fields: DocField[]; instant: boolean }) {
  const [from, subject, delivery] = fields;
  return (
    <div className="flex h-full flex-col">
      {/* Print header — the browser/client line a printed email carries */}
      <div
        className="flex items-baseline justify-between border-b pb-[3px] text-[5.5px]"
        style={{ borderColor: RULE, color: INK_FAINT, ...NUM }}
      >
        <span>mail — Delivery confirmation</span>
        <span>12/08/2026, 07:42</span>
      </div>

      {/* Header block: From / To / Date / Subject */}
      <div className="mt-[8px] space-y-[3px] text-[7px] leading-[1.45]" style={NUM}>
        <p>
          <span className="inline-block w-[38px]" style={{ color: INK_FAINT }}>
            From
          </span>
          Anna Silva &lt;<Hl i={0} instant={instant}>{from.value}</Hl>&gt;
        </p>
        <p>
          <span className="inline-block w-[38px]" style={{ color: INK_FAINT }}>
            To
          </span>
          mike@meridian.co
        </p>
        <p>
          <span className="inline-block w-[38px]" style={{ color: INK_FAINT }}>
            Date
          </span>
          Tue 11 Aug 2026, 09:14
        </p>
        <p className="font-semibold">
          <span className="inline-block w-[38px] font-normal" style={{ color: INK_FAINT }}>
            Subject
          </span>
          <Hl i={1} instant={instant}>{subject.value}</Hl>
        </p>
      </div>
      <div className="mt-[6px] border-b" style={{ borderColor: RULE_STRONG }} />

      {/* Body: greeting, paragraphs, sign-off */}
      <div className="mt-[9px] space-y-[7px] text-[7px] leading-[1.65]">
        <p>Hi Mike,</p>
        <p>
          Good news — your order <span style={NUM}>#88214</span> has been dispatched from our
          Eastern Creek facility and is on schedule to arrive on{" "}
          <Hl i={2} instant={instant}>{delivery.value}</Hl> before end of day.
        </p>
        <p>
          You can follow the courier link below for live tracking. No signature is required — the
          driver will leave the parcel in a safe place if you&rsquo;re not home.
        </p>
        <p>
          Thanks,
          <br />
          Anna · Parcel.io dispatch
        </p>
      </div>

      {/* Quoted reply fragment */}
      <div
        className="mt-[10px] border-l-2 pl-[7px] text-[6.5px] leading-[1.6]"
        style={{ borderColor: RULE_STRONG, color: INK_FAINT }}
      >
        <p>On Mon 10 Aug 2026 at 16:02, mike@meridian.co wrote:</p>
        <p className="mt-[3px]">&gt; Hi Anna — could you confirm when order #88214 will arrive?</p>
        <p>&gt; We need the delivery date for our records. Thanks, Mike</p>
      </div>

      {/* Footer microtext */}
      <p
        className="mt-auto border-t pt-[4px] text-[5.5px] leading-[1.5]"
        style={{ borderColor: RULE, color: INK_FAINT }}
      >
        Parcel.io · 12 Ferry Road, Brisbane QLD · You are receiving this message because you have
        an active shipment.
      </p>
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
   reading in the panel, drawn in the field's trace color (theme-following
   via .field-trace-ink + currentColor). Endpoints come from offsetLeft/Top
   chains up to the stage element — layout coordinates, immune to the
   entrance transforms framer applies — so the line is exact once the
   elements exist. */

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

// Queries are scoped to the active doc's [data-doc] containers: during an
// AnimatePresence cross-fade the OUTGOING sheet/rows are still in the DOM,
// and an unscoped querySelector can measure the old specimen's mark (seen
// live as a probe line rooted mid-page in reduced-motion, where the first
// client render briefly shows the statement before the static invoice).
function measureProbe(stage: HTMLElement, docId: DocDef["id"], i: number): ProbePt | null {
  const mark = stage.querySelector<HTMLElement>(`[data-doc="${docId}"] [data-probe-mark="${i}"]`);
  const row = stage.querySelector<HTMLElement>(`[data-doc="${docId}"] [data-probe-row="${i}"]`);
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
      // Static probe on the invoice's first field. The first client render
      // briefly shows the SSR statement, and AnimatePresence takes a frame
      // or two to swap in the invoice — so retry each frame until the
      // invoice's mark exists, then re-measure once web fonts land (they
      // shift the miniature type, and with no cycling there is no later
      // measurement to correct it).
      let cancelled = false;
      let raf = 0;
      let tries = 0;
      const measure = () => {
        if (cancelled) return false;
        const el = stageRef.current;
        const pt = el ? measureProbe(el, docId, 0) : null;
        if (pt) setProbe({ docId, i: 0, pt });
        return Boolean(pt);
      };
      const attempt = () => {
        if (!measure() && tries++ < 60) raf = requestAnimationFrame(attempt);
      };
      raf = requestAnimationFrame(attempt);
      document.fonts?.ready.then(measure);
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    }
    const timers = DOCS[0].fields.map((_, i) =>
      setTimeout(
        () => {
          const el = stageRef.current;
          if (!el) return;
          const pt = measureProbe(el, docId, i);
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
        const pt = measureProbe(el, p.docId, p.i);
        return pt ? { ...p, pt } : p;
      });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Render the probe only if it belongs to the specimen currently on the
  // platen (a stale one goes dark the moment the cycle advances).
  const liveProbe = probe && probe.docId === active.id ? probe : null;

  return (
    <figure
      role="img"
      aria-label="Demo of sift reading a bank statement, contract, invoice, and email — each a full document page, each value traced on the paper and linked by a probe line to its reading in the results panel"
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
            {/* The platen: an inset well; the full page sits on it as a lit
                specimen — true portrait paper aspect (5:7 ≈ 300×420 at
                desktop), the readings chamber centered beside it. */}
            <div className="flex items-center justify-center border-b border-[var(--hairline)] bg-[var(--well)] px-6 py-6 sm:border-b-0 sm:border-r sm:py-7">
              <div className="relative aspect-[5/7] w-full max-w-[300px]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={active.id}
                    data-doc={active.id}
                    className="sheet-rim absolute inset-0 overflow-hidden px-[24px] pb-[20px] pt-[24px]"
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

            {/* Readings — the display side of the instrument, vertically
                centered beside the full-height page */}
            <div className="flex flex-col justify-center p-4 sm:p-5">
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
                  data-doc={active.id}
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
                      // The reading's edge-tick (law 2): 2px left tick in the
                      // field color — .field-tick resolves the light/dark
                      // variant for the visitor's calibration (the landing
                      // follows the theme; only the paper is fixed-light).
                      className="field-tick flex items-baseline gap-3 py-2.5 pl-3 pr-1"
                      style={fieldColorVars(i) as CSSProperties}
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
              <div className="mt-3 flex items-center justify-between">
                <span className="data truncate text-[10px] text-[var(--ink-faint)]">
                  {active.file}
                </span>
                <span className="data flex-shrink-0 text-[10px] text-[var(--ink-faint)]">
                  3 fields
                </span>
              </div>
            </div>

            {/* The probe line — mark → reading, in the field's trace color
                (currentColor via .field-trace-ink, so it follows the
                calibration). Only where the chambers sit side by side (sm+). */}
            {liveProbe && (
              <svg
                className="field-trace-ink pointer-events-none absolute inset-0 hidden h-full w-full sm:block"
                style={fieldColorVars(liveProbe.i) as CSSProperties}
              >
                <motion.line
                  key={`${liveProbe.docId}-${liveProbe.i}`}
                  x1={liveProbe.pt.x1}
                  y1={liveProbe.pt.y1}
                  x2={liveProbe.pt.x2}
                  y2={liveProbe.pt.y2}
                  stroke="currentColor"
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
                  fill="currentColor"
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
