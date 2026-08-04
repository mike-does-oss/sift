import { extractText, getDocumentProxy } from "unpdf";
import { simpleParser, type AddressObject } from "mailparser";
import mammoth from "mammoth";
import JSZip from "jszip";

// Shared truncation cap for every text-shaped ParsedDocument (PDF text
// layer, .eml, and .txt/.md/.csv) — without it, an oversized text-only
// source becomes an unbounded prompt for every extraction engine (and, on
// the /api/extract path, an unbounded response body echoed to the browser).
const MAX_TEXT_CHARS = 40_000;

function capText(s: string): string {
  return s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) + "\n[document truncated]" : s;
}

export type ParsedDocument =
  | { kind: "text"; text: string }
  | { kind: "image"; base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" }
  | { kind: "pdf"; base64: string; text: string };

const TEXT_EXTENSIONS = new Set(["txt", "md", "csv"]);
export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

export const UNSUPPORTED_TYPE_ERROR =
  "Unsupported file type. Sift accepts PDF, DOCX, PPTX, EML, TXT, MD, CSV, PNG, JPG, and WEBP files.";

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

function isPdf(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).toString("latin1") === "%PDF";
}

function isPng(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  );
}

// .docx and .pptx are both ZIP containers (Office Open XML) — the local file
// header magic is shared, so content alone can't tell them apart. Extension
// discriminates between them (see parseDocument/detectExtension); a zip with
// neither extension is rejected as unsupported rather than guessed at.
function isZip(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  );
}

// Safety cap on total *uncompressed* content of a .docx/.pptx before any of
// it is inflated. DEFLATE's practical worst-case ratio (~1000:1) means a
// modest upload (well under the 32MB upload cap) can carry an entry that
// decompresses to gigabytes — enough to exceed the V8 heap and crash the
// process with an uncatchable OOM abort, unlike every other error path here
// (corrupt zip, wrong format, empty text), which fail cleanly into a caught
// Error.
const MAX_UNCOMPRESSED_ZIP_BYTES = 64 * 1024 * 1024;

export const ZIP_TOO_COMPLEX_ERROR = "File is too complex to process.";

interface JSZipInternalData {
  uncompressedSize?: number;
}

/**
 * jszip doesn't publicly expose a pre-inflation size for an entry, but
 * `_data.uncompressedSize` is a stable internal field (jszip 3.x) populated
 * by `loadAsync`'s central-directory parse — before anything is inflated
 * (verified empirically: available within ~1ms of `loadAsync` resolving,
 * even for an entry that would decompress to 20MB+). Treated defensively:
 * an entry whose size we can't read is assumed unbounded rather than
 * silently trusted, so a malformed/unusual entry can't slip past the guard.
 */
function uncompressedSizeOf(file: JSZip.JSZipObject): number {
  const internal = (file as unknown as { _data?: JSZipInternalData })._data;
  return typeof internal?.uncompressedSize === "number" ? internal.uncompressedSize : Infinity;
}

/**
 * Rejects a zip (.docx/.pptx) whose total declared uncompressed size
 * exceeds the safety cap, computed entirely from the central directory —
 * no entry is inflated to compute this. Exported so it's unit-testable
 * directly against a shape-compatible fake `JSZip` without needing to
 * actually build/compress a 64MB+ fixture.
 */
export function assertZipNotTooComplex(zip: JSZip): void {
  let total = 0;
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    total += uncompressedSizeOf(file);
  }
  if (total > MAX_UNCOMPRESSED_ZIP_BYTES) {
    throw new Error(ZIP_TOO_COMPLEX_ERROR);
  }
}

async function loadZipSafely(buf: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(buf);
  assertZipNotTooComplex(zip);
  return zip;
}

/**
 * Extracts selectable text from a PDF via unpdf/pdf.js. Used to build the
 * `pdf` ParsedDocument's `text` field — feeds the text-only engines (ollama,
 * openai-compatible) directly; base64 stays available for engines that read
 * PDFs natively (claude, openai) regardless of whether a text layer exists.
 * Never throws: scanned/corrupted PDFs just yield an empty string, and it's
 * up to callers that need text (not vision) to decide that's unusable.
 */
async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    if (!text.trim()) return "";
    return capText(text);
  } catch {
    return "";
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addressText(addr: AddressObject | AddressObject[] | undefined): string {
  if (!addr) return "";
  return Array.isArray(addr) ? addr.map((a) => a.text).join(", ") : addr.text;
}

async function parseEml(buf: Buffer): Promise<{ kind: "text"; text: string }> {
  const parsed = await simpleParser(buf);
  const body = parsed.text?.trim()
    ? parsed.text.trim()
    : parsed.html
      ? stripHtmlTags(parsed.html)
      : "";
  const header = [
    `From: ${addressText(parsed.from)}`,
    `To: ${addressText(parsed.to)}`,
    `Subject: ${parsed.subject ?? ""}`,
    `Date: ${parsed.date ? parsed.date.toISOString() : ""}`,
  ].join("\n");
  return { kind: "text", text: capText(`${header}\n\n${body}`.trimEnd()) };
}

async function parseDocx(buf: Buffer): Promise<{ kind: "text"; text: string }> {
  // Guard before handing off to mammoth (which parses the zip itself
  // internally) — see assertZipNotTooComplex.
  await loadZipSafely(buf);
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return { kind: "text", text: capText(value.trim()) };
}

const XML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
};

// Named entities plus numeric character references (decimal &#39; and hex
// &#x2019;) — PowerPoint's autocorrect/"Insert Symbol" commonly emit curly
// quotes, em-dashes, etc. as numeric refs rather than the predefined set.
const NAMED_OR_NUMERIC_ENTITY_RE = /&lt;|&gt;|&quot;|&apos;|&amp;|&#(\d+);|&#x([0-9a-fA-F]+);/g;

function decodeXmlEntities(s: string): string {
  return s.replace(NAMED_OR_NUMERIC_ENTITY_RE, (m, dec, hex) => {
    if (dec !== undefined) return String.fromCodePoint(parseInt(dec, 10));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return XML_ENTITIES[m];
  });
}

const SLIDE_PATH_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const PARAGRAPH_RE = /<a:p[ >][\s\S]*?<\/a:p>/g;
// Requires whitespace before any attribute block (`<a:t xml:space="...">`)
// rather than making the boundary optional-then-greedy. The looser form
// this replaced (`<a:t[ >]?[^>]*>`) let the regex engine backtrack across a
// paragraph's *second* `<a:t>` tag whenever the first run was a bare
// `<a:t>` with no attributes — silently dropping that run's text and
// splicing raw XML (closing/opening run tags) into the capture group. Any
// PowerPoint paragraph with 2+ runs (formatting change, autocorrect split,
// adjacent hyperlink run) triggers the old bug; see
// src/lib/__tests__/documents.test.ts for a regression fixture.
const TEXT_RUN_RE = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;

/**
 * Minimal PPTX text extraction (v1): no heavyweight office suite, just
 * unzip + regex over the slide XML. Slides only — notesSlides are skipped
 * (often noise). Order comes from a natural sort of the slideN.xml file
 * names, not the (more correct but more involved) presentation.xml slide
 * ID list — good enough for a first cut.
 */
async function parsePptx(buf: Buffer): Promise<{ kind: "text"; text: string }> {
  const zip = await loadZipSafely(buf);
  const slideNames = Object.keys(zip.files)
    .filter((name) => SLIDE_PATH_RE.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(SLIDE_PATH_RE)![1], 10);
      const nb = parseInt(b.match(SLIDE_PATH_RE)![1], 10);
      return na - nb;
    });

  const slideTexts: string[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.files[slideNames[i]].async("text");
    const paragraphs = xml.match(PARAGRAPH_RE) ?? [];
    const paraTexts = paragraphs
      .map((p) => {
        const runs = [...p.matchAll(TEXT_RUN_RE)].map((m) => decodeXmlEntities(m[1]));
        return runs.join(" ").trim();
      })
      .filter((t) => t.length > 0);
    slideTexts.push(`--- Slide ${i + 1} ---\n${paraTexts.join("\n")}`);
  }
  return { kind: "text", text: capText(slideTexts.join("\n\n").trim()) };
}

/**
 * Detects the document kind and parses it into a shape the extraction
 * engines can consume. Detection is magic-bytes-first (content wins over a
 * misleading extension); extension is only consulted as a fallback for
 * formats that have no reliable signature (.eml/.txt/.md/.csv), or to
 * discriminate within a signature shared by multiple formats (.docx/.pptx
 * are both ZIP containers).
 */
export async function parseDocument(buf: Buffer, filename: string): Promise<ParsedDocument> {
  if (isPdf(buf)) {
    const text = await extractPdfText(buf);
    return { kind: "pdf", base64: buf.toString("base64"), text };
  }
  if (isPng(buf)) return { kind: "image", base64: buf.toString("base64"), mediaType: "image/png" };
  if (isJpeg(buf)) return { kind: "image", base64: buf.toString("base64"), mediaType: "image/jpeg" };
  if (isWebp(buf)) return { kind: "image", base64: buf.toString("base64"), mediaType: "image/webp" };

  const ext = extOf(filename);
  if (isZip(buf)) {
    if (ext === "docx") return parseDocx(buf);
    if (ext === "pptx") return parsePptx(buf);
    throw new Error(UNSUPPORTED_TYPE_ERROR);
  }
  if (ext === "eml") return parseEml(buf);
  if (TEXT_EXTENSIONS.has(ext)) return { kind: "text", text: capText(buf.toString("utf-8")) };

  throw new Error(UNSUPPORTED_TYPE_ERROR);
}

/**
 * Determines the extension to store the upload under, from content first
 * (magic bytes) and filename second — used by the upload route both to
 * reject unsupported/mislabeled files up front and to name the file on disk
 * with its real type rather than trusting the client's extension.
 */
export function detectExtension(buf: Buffer, filename: string): string {
  if (isPdf(buf)) return "pdf";
  if (isPng(buf)) return "png";
  if (isJpeg(buf)) {
    const ext = extOf(filename);
    return ext === "jpg" || ext === "jpeg" ? ext : "jpg";
  }
  if (isWebp(buf)) return "webp";

  const ext = extOf(filename);
  if (isZip(buf)) {
    if (ext === "docx" || ext === "pptx") return ext;
    throw new Error(UNSUPPORTED_TYPE_ERROR);
  }
  if (ext === "eml") return "eml";
  if (TEXT_EXTENSIONS.has(ext)) return ext;

  throw new Error(UNSUPPORTED_TYPE_ERROR);
}
