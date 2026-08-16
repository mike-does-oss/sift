import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { readFileSync, writeFileSync, rmSync } from "fs";
import path from "path";
import { saveBuffer, readDocument } from "../storage";
import { DATA_DIR } from "../dataDir";

// Redirect DATA_DIR to a throwaway temp dir so local-backend tests never
// touch a real data directory.
vi.mock("../dataDir", async () => {
  const os = await import("os");
  const p = await import("path");
  const { mkdtempSync, mkdirSync } = await import("fs");
  const dir = mkdtempSync(p.join(os.tmpdir(), "sift-storage-test-"));
  mkdirSync(p.join(dir, "files"), { recursive: true });
  return { DATA_DIR: dir };
});

const putMock = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ put: putMock }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  putMock.mockReset();
});

afterAll(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
});

function hosted() {
  vi.stubEnv("SIFT_PROFILE", "hosted");
}

describe("local profile (default)", () => {
  it("saveBuffer writes files/<uuid>.<ext> under DATA_DIR and returns the relative path", async () => {
    const buf = Buffer.from("%PDF-1.4 fake");
    const { filePath, sizeBytes } = await saveBuffer(buf, "invoice.pdf", "pdf");

    expect(filePath).toMatch(/^files\/[0-9a-f-]{36}\.pdf$/);
    expect(sizeBytes).toBe(buf.length);
    expect(readFileSync(path.join(DATA_DIR, filePath))).toEqual(buf);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("readDocument round-trips a saved buffer through the async wrapper", async () => {
    const buf = Buffer.from("round-trip bytes");
    const { filePath } = await saveBuffer(buf, "note.txt", "txt");
    await expect(readDocument(filePath)).resolves.toEqual(buf);
  });

  it("readDocument still enforces the path-traversal guard", async () => {
    // A real file just outside DATA_DIR proves the guard (not ENOENT) rejects.
    const outside = path.join(DATA_DIR, "..", `sift-outside-${process.pid}`);
    writeFileSync(outside, "secret");
    try {
      await expect(readDocument(`../${path.basename(outside)}`)).rejects.toThrow("Invalid file path");
      await expect(readDocument(outside)).rejects.toThrow("Invalid file path"); // absolute path
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

describe("hosted profile", () => {
  it("saveBuffer uploads via @vercel/blob put() and stores the returned url", async () => {
    hosted();
    putMock.mockResolvedValue({ url: "https://abc.public.blob.vercel-storage.com/docs/invoice-xYz1.pdf" });

    const buf = Buffer.from("%PDF-1.4 fake");
    const { filePath, sizeBytes } = await saveBuffer(buf, "invoice.pdf", "pdf");

    expect(putMock).toHaveBeenCalledWith("docs/invoice.pdf", buf, {
      access: "public",
      addRandomSuffix: true,
    });
    expect(filePath).toBe("https://abc.public.blob.vercel-storage.com/docs/invoice-xYz1.pdf");
    expect(sizeBytes).toBe(buf.length);
  });

  it("saveBuffer sanitizes the filename and stamps the detected extension", async () => {
    hosted();
    putMock.mockResolvedValue({ url: "https://abc.public.blob.vercel-storage.com/docs/x.png" });

    await saveBuffer(Buffer.from("png"), "../we ird/ná me.JPG", "png");
    expect(putMock.mock.calls[0][0]).toBe("docs/n_me.png");

    await saveBuffer(Buffer.from("png"), "...", "png");
    expect(putMock.mock.calls[1][0]).toBe("docs/document.png");
  });

  it("readDocument fetches the blob url and returns the bytes", async () => {
    hosted();
    const bytes = Buffer.from("blob bytes");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    vi.stubGlobal("fetch", fetchMock);

    const url = "https://abc.public.blob.vercel-storage.com/docs/invoice-xYz1.pdf";
    await expect(readDocument(url)).resolves.toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(url);
  });

  it("readDocument rejects non-blob hosts without fetching", async () => {
    hosted();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const bad of [
      "https://evil.com/doc.pdf",
      "https://vercel-storage.com.evil.com/doc.pdf", // suffix spoof
      "https://foovercel-storage.com/doc.pdf", // missing dot boundary
      "http://abc.public.blob.vercel-storage.com/doc.pdf", // not https
      "files/abc.pdf", // local-style relative path in a hosted row
    ]) {
      await expect(readDocument(bad)).rejects.toThrow(/Invalid document URL/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("readDocument throws with the status on a non-2xx blob response", async () => {
    hosted();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(
      readDocument("https://abc.public.blob.vercel-storage.com/docs/gone.pdf")
    ).rejects.toThrow("status 404");
  });
});
