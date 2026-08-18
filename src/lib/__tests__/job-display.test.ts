import { describe, it, expect } from "vitest";
import {
  filterJobs,
  jobIdentity,
  snapshotSummary,
  snapshotTemplateName,
  snapshotResultView,
  formatResultValue,
  type HistoryFilter,
} from "../job-display";

const snapshot = {
  fields: [
    { id: "f1", name: "vendor", type: "text" },
    { id: "f2", name: "total", type: "number" },
    { id: "f3", name: "date", type: "date" },
  ],
  prompt: "",
  extractMultiple: false,
};

describe("jobIdentity (display precedence)", () => {
  it("prefers the joined document filename", () => {
    expect(jobIdentity("invoice.pdf", "upload.pdf", snapshot)).toBe("invoice.pdf");
  });
  it("falls back to the job's own sourceFilename when there is no documents row", () => {
    expect(jobIdentity(null, "upload.pdf", snapshot)).toBe("upload.pdf");
  });
  it("falls back to the template-derived summary — never a bare dash", () => {
    expect(jobIdentity(null, null, snapshot)).toBe("3 fields");
    expect(jobIdentity(null, undefined, snapshot)).not.toBe("—");
  });
  it("still names a job whose snapshot is unreadable", () => {
    expect(jobIdentity(null, null, "corrupted")).toBe("Extraction");
    expect(jobIdentity(null, null, null)).toBe("Extraction");
  });
});

describe("snapshotSummary", () => {
  it("counts fields with singular/plural", () => {
    expect(snapshotSummary(snapshot)).toBe("3 fields");
    expect(snapshotSummary({ fields: [{ name: "total" }] })).toBe("1 field");
  });
  it("appends grounded when the snapshot ran grounded", () => {
    expect(snapshotSummary({ ...snapshot, grounded: true })).toBe("3 fields · grounded");
    expect(snapshotSummary({ ...snapshot, grounded: false })).toBe("3 fields");
  });
  it("ignores unnamed/blank fields", () => {
    expect(snapshotSummary({ fields: [{ name: "a" }, { name: "  " }, {}] })).toBe("1 field");
  });
});

describe("snapshotTemplateName", () => {
  it("reads a name the snapshot carries", () => {
    expect(snapshotTemplateName({ ...snapshot, name: "Invoice header" })).toBe("Invoice header");
  });
  it("is null for older snapshots without one (or junk)", () => {
    expect(snapshotTemplateName(snapshot)).toBeNull();
    expect(snapshotTemplateName({ name: "   " })).toBeNull();
    expect(snapshotTemplateName(null)).toBeNull();
  });
});

describe("filterJobs (history filter chips)", () => {
  const rows = [
    { job: { id: "a", status: "completed", source: "single" } },
    { job: { id: "b", status: "failed", source: "single" } },
    { job: { id: "c", status: "completed", source: "batch" } },
    { job: { id: "d", status: "failed", source: "schedule" } },
  ];
  const ids = (filter: HistoryFilter) => filterJobs(rows, filter).map((r) => r.job.id);

  it("passes everything through for 'all'", () => {
    expect(ids("all")).toEqual(["a", "b", "c", "d"]);
  });
  it("'failed' filters by status across every source", () => {
    expect(ids("failed")).toEqual(["b", "d"]);
  });
  it("source filters keep both completed and failed jobs of that source", () => {
    expect(ids("single")).toEqual(["a", "b"]);
    expect(ids("batch")).toEqual(["c"]);
    expect(ids("schedule")).toEqual(["d"]);
  });
});

describe("snapshotResultView (expanded-row mini table)", () => {
  it("projects a single-object result onto the snapshot's fields", () => {
    const view = snapshotResultView(snapshot, { vendor: "Acme", total: 91.4, date: "2026-08-01" });
    expect(view).not.toBeNull();
    expect(view!.fieldNames).toEqual(["vendor", "total", "date"]);
    expect(view!.rows).toHaveLength(1);
    expect(view!.extras).toBeNull();
  });
  it("keeps multi-row results as rows", () => {
    const view = snapshotResultView(snapshot, [{ vendor: "A" }, { vendor: "B" }]);
    expect(view!.rows).toHaveLength(2);
  });
  it("surfaces values outside the snapshot as extras (raw-JSON fallback)", () => {
    const view = snapshotResultView(snapshot, { vendor: "Acme", surprise: "yes" });
    expect(view!.extras).toEqual([{ surprise: "yes" }]);
  });
  it("returns null when there is nothing table-shaped", () => {
    expect(snapshotResultView({}, { vendor: "Acme" })).toBeNull(); // no snapshot fields
    expect(snapshotResultView(snapshot, null)).toBeNull();
    expect(snapshotResultView(snapshot, "just a string")).toBeNull();
    expect(snapshotResultView(snapshot, [1, 2])).toBeNull();
    expect(snapshotResultView(snapshot, [])).toBeNull();
  });
});

describe("formatResultValue", () => {
  it("renders strings verbatim and empties as a dash", () => {
    expect(formatResultValue("Acme Pty Ltd")).toBe("Acme Pty Ltd");
    expect(formatResultValue(null)).toBe("—");
    expect(formatResultValue(undefined)).toBe("—");
  });
  it("stringifies numbers, booleans, and structures", () => {
    expect(formatResultValue(91.4)).toBe("91.4");
    expect(formatResultValue(true)).toBe("true");
    expect(formatResultValue(["a", "b"])).toBe('["a","b"]');
  });
});
