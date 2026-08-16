import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { resolveOutputDir, parseOutputDirInput, writeOutputs } from "../output-writer";

describe("parseOutputDirInput on the hosted profile", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects any non-empty output folder — no server filesystem exists there (§SaaS-1 T6)", () => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    expect(parseOutputDirInput("/tmp/sift-out")).toEqual({
      error: "Output folders aren't available on the hosted service.",
    });
    expect(parseOutputDirInput("~/Documents/sift-exports")).toEqual({
      error: "Output folders aren't available on the hosted service.",
    });
  });

  it("still treats absent/empty as 'no output folder' (the hosted forms send nothing)", () => {
    vi.stubEnv("SIFT_PROFILE", "hosted");
    expect(parseOutputDirInput(undefined)).toEqual({ value: null });
    expect(parseOutputDirInput("")).toEqual({ value: null });
  });

  it("keeps accepting absolute paths on local", () => {
    expect(parseOutputDirInput("/tmp/sift-out")).toEqual({ value: path.resolve("/tmp/sift-out") });
  });
});

describe("resolveOutputDir", () => {
  it("expands a leading ~/ against the real home dir", () => {
    expect(resolveOutputDir("~/Documents/sift-exports")).toBe(
      path.resolve(os.homedir(), "Documents/sift-exports")
    );
  });

  it("expands a bare ~ to the home dir itself", () => {
    expect(resolveOutputDir("~")).toBe(path.resolve(os.homedir()));
  });

  it("passes an already-absolute path through resolved", () => {
    expect(resolveOutputDir("/tmp/sift-out")).toBe(path.resolve("/tmp/sift-out"));
  });

  it("normalizes redundant separators/segments on an absolute path", () => {
    expect(resolveOutputDir("/tmp//sift-out/../sift-out")).toBe(path.resolve("/tmp/sift-out"));
  });

  it("rejects a relative path", () => {
    expect(() => resolveOutputDir("exports")).toThrow(/absolute path/i);
  });

  it("rejects a relative path with dot segments", () => {
    expect(() => resolveOutputDir("./exports")).toThrow(/absolute path/i);
  });

  it("rejects an empty string", () => {
    expect(() => resolveOutputDir("")).toThrow(/absolute path/i);
  });
});

describe("writeOutputs", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  const rows = [
    { _document: "invoice.txt", vendor: "Acme", total: "45.00" },
    { _document: "receipt.eml", vendor: "Widgets Co", total: "10.00" },
  ];
  const fields = ["vendor", "total"];
  const fixedNow = new Date(2026, 6, 28, 9, 5, 3); // 2026-07-28 09:05:03 local

  it("sanitizes the name and stamps a yyyyMMdd-HHmmss suffix", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sift-output-writer-"));
    const { written } = writeOutputs({
      name: 'weird/name "with" bad chars',
      rows,
      fields,
      dir: tmpDir,
      format: "csv",
      now: fixedNow,
    });
    expect(written).toHaveLength(1);
    expect(path.basename(written[0])).toBe('weird_name _with_ bad chars-20260728-090503.csv');
  });

  it("falls back to 'output' when the name sanitizes to nothing", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sift-output-writer-"));
    const { written } = writeOutputs({ name: "   ", rows, fields, dir: tmpDir, format: "json", now: fixedNow });
    expect(path.basename(written[0])).toBe("output-20260728-090503.json");
  });

  it("writes only a .csv file when format is csv", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sift-output-writer-"));
    const { written } = writeOutputs({ name: "batch-1", rows, fields, dir: tmpDir, format: "csv", now: fixedNow });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/\.csv$/);
    expect(existsSync(written[0])).toBe(true);
  });

  it("writes only a .json file when format is json", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sift-output-writer-"));
    const { written } = writeOutputs({ name: "batch-1", rows, fields, dir: tmpDir, format: "json", now: fixedNow });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/\.json$/);
    expect(existsSync(written[0])).toBe(true);
  });

  it("writes both files when format is both", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sift-output-writer-"));
    const { written } = writeOutputs({ name: "batch-1", rows, fields, dir: tmpDir, format: "both", now: fixedNow });
    expect(written).toHaveLength(2);
    expect(written.some((p) => p.endsWith(".csv"))).toBe(true);
    expect(written.some((p) => p.endsWith(".json"))).toBe(true);
  });

  it("creates the target directory recursively when it doesn't exist", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sift-output-writer-"));
    const nested = path.join(tmpDir, "a", "b", "c");
    const { written } = writeOutputs({ name: "batch-1", rows, fields, dir: nested, format: "csv", now: fixedNow });
    expect(existsSync(written[0])).toBe(true);
  });

  it("writes CSV rows with _document first, then fields in template order, ignoring model key order", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sift-output-writer-"));
    const scrambled = [{ total: "45.00", _document: "invoice.txt", vendor: "Acme" }];
    const { written } = writeOutputs({
      name: "batch-1",
      rows: scrambled,
      fields: ["vendor", "total"],
      dir: tmpDir,
      format: "csv",
      now: fixedNow,
    });
    const content = readFileSync(written[0], "utf-8");
    const [header, dataRow] = content.split("\n");
    expect(header).toBe("_document,vendor,total");
    expect(dataRow).toBe("invoice.txt,Acme,45.00");
  });

  it("writes JSON as a pretty-printed array of row objects", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sift-output-writer-"));
    const { written } = writeOutputs({ name: "batch-1", rows, fields, dir: tmpDir, format: "json", now: fixedNow });
    const content = readFileSync(written[0], "utf-8");
    expect(content).toContain("\n"); // pretty-printed, not minified
    const parsed = JSON.parse(content);
    expect(parsed).toEqual([
      { _document: "invoice.txt", vendor: "Acme", total: "45.00" },
      { _document: "receipt.eml", vendor: "Widgets Co", total: "10.00" },
    ]);
  });

  it("writes a headers-only CSV when there are no rows", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sift-output-writer-"));
    const { written } = writeOutputs({ name: "batch-1", rows: [], fields, dir: tmpDir, format: "csv", now: fixedNow });
    expect(readFileSync(written[0], "utf-8")).toBe("_document,vendor,total");
  });

  it("expands ~ against the real home dir when writing", () => {
    const marker = `sift-output-writer-home-${Date.now()}`;
    tmpDir = path.join(os.homedir(), marker);
    const { written } = writeOutputs({
      name: "batch-1",
      rows,
      fields,
      dir: `~/${marker}`,
      format: "csv",
      now: fixedNow,
    });
    expect(written[0].startsWith(path.resolve(os.homedir(), marker))).toBe(true);
    expect(existsSync(written[0])).toBe(true);
  });
});
