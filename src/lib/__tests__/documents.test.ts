import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocument, detectExtension, assertZipNotTooComplex, ZIP_TOO_COMPLEX_ERROR } from "../documents";

// Minimal hand-built one-page PDF ("Hello Sift" as extractable text). pdf.js
// (via unpdf) tolerates this despite not being byte-perfect.
function buildPdfFixture(text: string): Buffer {
  const objs: Record<number, string> = {};
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] =
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 200] /Contents 5 0 R >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const content = `BT /F1 24 Tf 10 100 Td (${text}) Tj ET`;
  objs[5] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function buildPngFixture(): Buffer {
  // Real signature + a few arbitrary bytes; parseDocument only needs the
  // signature to classify — it doesn't decode the raster.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("fake-png-body"),
  ]);
}

function buildJpegFixture(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpeg-body")]);
}

function buildWebpFixture(): Buffer {
  const riff = Buffer.from("RIFF");
  const size = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  const webp = Buffer.from("WEBP");
  return Buffer.concat([riff, size, webp, Buffer.from("fake-webp-body")]);
}

// Minimal real .docx (Office Open XML / ZIP) — just enough for mammoth's
// extractRawText to find one paragraph. Built in-memory with jszip so no
// binary fixture is committed to the repo.
async function buildDocxFixture(paragraphText: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphText ? `<w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p>` : ""}</w:body>
</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

// Minimal real .pptx — two slides, each with a couple of text runs across
// paragraphs, enough to exercise slide ordering and run/paragraph joining.
async function buildPptxFixture(slides: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`
  );
  slides.forEach((paragraphs, i) => {
    const slideXml = paragraphs
      .map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`)
      .join("");
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>${slideXml}</p:spTree></p:cSld>
</p:sld>`
    );
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

// A well-formed but empty zip — no docx/pptx-specific parts inside, and
// no reliable extension either. Used to prove "zip magic, unknown/unmapped
// extension" is rejected as unsupported rather than guessed at.
async function buildPlainZipFixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("readme.txt", "just a regular zip, not office xml");
  return zip.generateAsync({ type: "nodebuffer" });
}

// Lower-level pptx builder that takes raw <p:spTree> body XML per slide,
// for fixtures that need control over paragraph/run structure that
// buildPptxFixture can't express — specifically multiple <a:r>/<a:t> runs
// within a single <a:p>, which is the shape that hid the TEXT_RUN_RE
// regression (buildPptxFixture only ever emits one run per paragraph).
async function buildPptxFromSlideBodies(slideBodies: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`
  );
  slideBodies.forEach((body, i) => {
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>${body}</p:spTree></p:cSld>
</p:sld>`
    );
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

const PLAIN_EML = `From: Alice <alice@example.com>
To: Bob <bob@example.com>
Subject: Test Invoice
Date: Mon, 01 Jun 2026 12:00:00 +0000
Content-Type: text/plain; charset="utf-8"

Invoice #123
Total: $45.00
`;

const HTML_ONLY_EML = `From: Carol <carol@example.com>
To: Dave <dave@example.com>
Subject: HTML Receipt
Date: Tue, 02 Jun 2026 08:30:00 +0000
Content-Type: text/html; charset="utf-8"

<html><body><p>Hello <b>World</b></p><p>Total: $10</p></body></html>
`;

describe("parseDocument — magic-byte detection", () => {
  it("detects a PDF by magic bytes, returning both base64 and extracted text", async () => {
    const buf = buildPdfFixture("Hello Sift");
    const result = await parseDocument(buf, "invoice.pdf");
    expect(result.kind).toBe("pdf");
    if (result.kind !== "pdf") throw new Error("expected pdf");
    expect(result.base64).toBe(buf.toString("base64"));
    expect(result.text).toContain("Hello Sift");
  });

  it("detects a PDF by magic bytes even with a misleading extension", async () => {
    const buf = buildPdfFixture("Sneaky");
    const result = await parseDocument(buf, "not-a-pdf.txt");
    expect(result.kind).toBe("pdf");
  });

  it("detects a PNG by magic bytes", async () => {
    const buf = buildPngFixture();
    const result = await parseDocument(buf, "receipt.png");
    expect(result).toEqual({ kind: "image", base64: buf.toString("base64"), mediaType: "image/png" });
  });

  it("detects a JPEG by magic bytes", async () => {
    const buf = buildJpegFixture();
    const result = await parseDocument(buf, "receipt.jpg");
    expect(result).toEqual({ kind: "image", base64: buf.toString("base64"), mediaType: "image/jpeg" });
  });

  it("detects a WEBP by magic bytes", async () => {
    const buf = buildWebpFixture();
    const result = await parseDocument(buf, "receipt.webp");
    expect(result).toEqual({ kind: "image", base64: buf.toString("base64"), mediaType: "image/webp" });
  });
});

describe("parseDocument — .eml", () => {
  it("composes a From/To/Subject/Date header block plus the plain-text body", async () => {
    const buf = Buffer.from(PLAIN_EML, "utf-8");
    const result = await parseDocument(buf, "message.eml");
    expect(result.kind).toBe("text");
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.text).toContain("From:");
    expect(result.text).toContain("alice@example.com");
    expect(result.text).toContain("To:");
    expect(result.text).toContain("bob@example.com");
    expect(result.text).toContain("Subject: Test Invoice");
    expect(result.text).toContain("Date:");
    expect(result.text).toContain("Invoice #123");
    expect(result.text).toContain("Total: $45.00");
  });

  it("falls back to a stripped-html body when there is no plain-text part", async () => {
    const buf = Buffer.from(HTML_ONLY_EML, "utf-8");
    const result = await parseDocument(buf, "receipt.eml");
    expect(result.kind).toBe("text");
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.text).toContain("Subject: HTML Receipt");
    expect(result.text).toContain("Hello");
    expect(result.text).toContain("World");
    expect(result.text).toContain("Total: $10");
    expect(result.text).not.toContain("<html>");
    expect(result.text).not.toContain("<b>");
  });
});

describe("parseDocument — plain text formats", () => {
  it("passes .txt content through as utf-8 text", async () => {
    const buf = Buffer.from("plain notes\nsecond line", "utf-8");
    const result = await parseDocument(buf, "notes.txt");
    expect(result).toEqual({ kind: "text", text: "plain notes\nsecond line" });
  });

  it("passes .md content through as utf-8 text", async () => {
    const buf = Buffer.from("# Heading\n\nBody", "utf-8");
    const result = await parseDocument(buf, "README.md");
    expect(result).toEqual({ kind: "text", text: "# Heading\n\nBody" });
  });

  it("passes .csv content through as utf-8 text", async () => {
    const buf = Buffer.from("a,b,c\n1,2,3", "utf-8");
    const result = await parseDocument(buf, "data.csv");
    expect(result).toEqual({ kind: "text", text: "a,b,c\n1,2,3" });
  });

  it("is case-insensitive on extension", async () => {
    const buf = Buffer.from("caps", "utf-8");
    const result = await parseDocument(buf, "FILE.TXT");
    expect(result).toEqual({ kind: "text", text: "caps" });
  });
});

describe("parseDocument — .docx", () => {
  it("extracts a paragraph's text via mammoth", async () => {
    const buf = await buildDocxFixture("Hello from a real docx fixture");
    const result = await parseDocument(buf, "resume.docx");
    expect(result).toEqual({ kind: "text", text: "Hello from a real docx fixture" });
  });

  it("returns empty text for a docx with no body content", async () => {
    const buf = await buildDocxFixture("");
    const result = await parseDocument(buf, "empty.docx");
    expect(result).toEqual({ kind: "text", text: "" });
  });
});

describe("parseDocument — .pptx", () => {
  it("extracts slide text in order, with slide markers, runs space-joined and paragraphs newline-joined", async () => {
    const buf = await buildPptxFixture([
      ["First slide run one", "first slide run two"],
      ["Second slide only run"],
    ]);
    const result = await parseDocument(buf, "deck.pptx");
    expect(result.kind).toBe("text");
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.text).toBe(
      "--- Slide 1 ---\nFirst slide run one\nfirst slide run two\n\n--- Slide 2 ---\nSecond slide only run"
    );
  });

  it("orders slides numerically (slide2 before slide10), not lexicographically", async () => {
    const slides = Array.from({ length: 11 }, (_, i) => [`Text for slide ${i + 1}`]);
    const buf = await buildPptxFixture(slides);
    const result = await parseDocument(buf, "big-deck.pptx");
    if (result.kind !== "text") throw new Error("expected text");
    const markerIndexes = [...result.text.matchAll(/--- Slide (\d+) ---/g)].map((m) => Number(m[1]));
    expect(markerIndexes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.text).toContain("Text for slide 1");
    expect(result.text).toContain("Text for slide 10");
  });
});

// Regression coverage for the TEXT_RUN_RE bug flagged in review: a paragraph
// with 2+ <a:r>/<a:t> runs is the normal case in real decks (any mid-sentence
// formatting change, autocorrect split, or run adjacent to a hyperlink run
// produces one), not an edge case — and every buildPptxFixture paragraph
// above has exactly one run, so none of it exercises this path. These
// fixtures fail against the old `<a:t[ >]?[^>]*>` regex (it drops the first
// run's text and splices raw XML into the capture) and pass against the
// fixed `<a:t(?:\s[^>]*)?>`.
describe("parseDocument — .pptx multi-run paragraphs (regression)", () => {
  it("joins two runs in one paragraph without dropping text or leaking XML markup, when both <a:t> tags are bare", async () => {
    // Mirrors the exact shape from review: a bold lead-in run followed by a
    // plain run, both with bare (attribute-less) <a:t> tags — the case the
    // old regex mishandled by backtracking across the first run's closing
    // tag into the second run's opening tag.
    const paragraph =
      '<a:p><a:r><a:rPr b="1"/><a:t>Revenue:</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t>$4.2M this quarter</a:t></a:r></a:p>';
    const buf = await buildPptxFromSlideBodies([paragraph]);
    const result = await parseDocument(buf, "deck.pptx");
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.text).toBe("--- Slide 1 ---\nRevenue: $4.2M this quarter");
    expect(result.text).not.toContain("<a:r>");
    expect(result.text).not.toContain("a:rPr");
    expect(result.text).not.toContain("</a:t");
  });

  it("handles three runs with a mix of bare and attributed <a:t> tags", async () => {
    const paragraph =
      "<a:p>" +
      "<a:r><a:t>Hello</a:t></a:r>" +
      '<a:r><a:rPr lang="en-US" dirty="0"/><a:t>brave</a:t></a:r>' +
      '<a:r><a:t xml:space="preserve">world</a:t></a:r>' +
      "</a:p>";
    const buf = await buildPptxFromSlideBodies([paragraph]);
    const result = await parseDocument(buf, "deck.pptx");
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.text).toBe("--- Slide 1 ---\nHello brave world");
  });
});

describe("parseDocument — .pptx entity decoding", () => {
  it("decodes numeric character references (decimal and hex) alongside named entities", async () => {
    const paragraph =
      "<a:p><a:r><a:t>Caf&#233; &amp; Ni&#241;o said &#8220;hi&#8221; &#x2014; &#x2019;twas fun</a:t></a:r></a:p>";
    const buf = await buildPptxFromSlideBodies([paragraph]);
    const result = await parseDocument(buf, "deck.pptx");
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.text).toBe("--- Slide 1 ---\nCafé & Niño said “hi” — ’twas fun");
  });
});

describe("parseDocument — unknown types", () => {
  it("throws a friendly error for unrecognized magic bytes and extension", async () => {
    const buf = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44]);
    await expect(parseDocument(buf, "mystery.xyz")).rejects.toThrow(/pdf|docx|pptx|eml|txt|md|csv|png|jpg|webp/i);
  });

  it("throws for a corrupted docx (zip magic present, but not a real zip)", async () => {
    const buf = Buffer.from("PK\x03\x04 fake docx bytes");
    await expect(parseDocument(buf, "resume.docx")).rejects.toThrow();
  });

  it("rejects a well-formed zip with an extension that isn't .docx/.pptx as unsupported", async () => {
    const buf = await buildPlainZipFixture();
    await expect(parseDocument(buf, "archive.zip")).rejects.toThrow(/unsupported file type/i);
  });
});

describe("detectExtension", () => {
  it("derives the real extension from content, ignoring a misleading filename", () => {
    expect(detectExtension(buildPdfFixture("x"), "not-a-pdf.txt")).toBe("pdf");
    expect(detectExtension(buildPngFixture(), "upload")).toBe("png");
    expect(detectExtension(buildWebpFixture(), "photo.jpeg")).toBe("webp");
  });

  it("preserves jpg vs jpeg naming when the filename already says so", () => {
    expect(detectExtension(buildJpegFixture(), "photo.jpeg")).toBe("jpeg");
    expect(detectExtension(buildJpegFixture(), "photo.jpg")).toBe("jpg");
    expect(detectExtension(buildJpegFixture(), "photo")).toBe("jpg");
  });

  it("falls back to the filename extension for eml/txt/md/csv", () => {
    expect(detectExtension(Buffer.from(PLAIN_EML), "message.eml")).toBe("eml");
    expect(detectExtension(Buffer.from("hi"), "notes.txt")).toBe("txt");
    expect(detectExtension(Buffer.from("hi"), "notes.md")).toBe("md");
    expect(detectExtension(Buffer.from("hi"), "data.csv")).toBe("csv");
  });

  it("throws a friendly error for unsupported types", () => {
    expect(() => detectExtension(Buffer.from([0x00, 0x11]), "mystery.xyz")).toThrow(/Unsupported file type/);
  });

  it("detects docx and pptx from zip magic plus extension", async () => {
    const docxBuf = await buildDocxFixture("hi");
    const pptxBuf = await buildPptxFixture([["hi"]]);
    expect(detectExtension(docxBuf, "resume.docx")).toBe("docx");
    expect(detectExtension(pptxBuf, "deck.pptx")).toBe("pptx");
  });

  it("throws a friendly error for a well-formed zip with an unmapped extension", async () => {
    const buf = await buildPlainZipFixture();
    expect(() => detectExtension(buf, "archive.zip")).toThrow(/Unsupported file type/);
  });
});

// assertZipNotTooComplex sums a jszip entry field (`_data.uncompressedSize`)
// that reflects the zip's central directory, not real inflated bytes —
// exercising the 64MB-cap boundary with a real fixture would mean actually
// compressing 64MB+ of content in-test. Since the guard is a pure function
// over `zip.files`, it's tested directly against shape-compatible fakes
// instead (per review guidance), which also lets each case pin an exact
// declared size rather than depending on how well a given payload compresses.
describe("assertZipNotTooComplex", () => {
  function fakeZip(entries: Array<{ dir?: boolean; uncompressedSize?: number }>): JSZip {
    const files: Record<string, unknown> = {};
    entries.forEach((e, i) => {
      files[`entry-${i}`] = {
        dir: e.dir ?? false,
        _data: e.uncompressedSize === undefined ? undefined : { uncompressedSize: e.uncompressedSize },
      };
    });
    return { files } as unknown as JSZip;
  }

  it("allows a zip whose total declared uncompressed size is under the 64MB cap", () => {
    const zip = fakeZip([{ uncompressedSize: 10 * 1024 * 1024 }, { uncompressedSize: 20 * 1024 * 1024 }]);
    expect(() => assertZipNotTooComplex(zip)).not.toThrow();
  });

  it("rejects a zip whose total declared uncompressed size exceeds the 64MB cap", () => {
    const zip = fakeZip([{ uncompressedSize: 40 * 1024 * 1024 }, { uncompressedSize: 30 * 1024 * 1024 }]);
    expect(() => assertZipNotTooComplex(zip)).toThrow(ZIP_TOO_COMPLEX_ERROR);
  });

  it("excludes directory entries from the size total", () => {
    const zip = fakeZip([
      { dir: true, uncompressedSize: 1_000_000_000 },
      { uncompressedSize: 1024 },
    ]);
    expect(() => assertZipNotTooComplex(zip)).not.toThrow();
  });

  it("fails closed: an entry with no readable declared size is treated as unbounded", () => {
    const zip = fakeZip([{ uncompressedSize: undefined }]);
    expect(() => assertZipNotTooComplex(zip)).toThrow(ZIP_TOO_COMPLEX_ERROR);
  });
});
