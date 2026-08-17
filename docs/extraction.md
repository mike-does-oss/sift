# Extraction

How Sift turns a document plus a field configuration into structured data.

## Fields

An extraction is defined by a list of fields. Each field has:

- **Name** — becomes the JSON key / CSV column.
- **Type** — one of `text`, `number`, `date`, `boolean`, `array`. The model is instructed to return dates in ISO 8601 (`YYYY-MM-DD`) and numbers without currency symbols.
- **Description** (optional) — a plain-language hint the model reads as extraction guidance, e.g. "Money out; null if this row is a credit". This is the main lever when a field extracts the wrong thing.

By default, values are copied verbatim: the model is told not to translate, reformat, or normalize unless a field description says otherwise. A missing value comes back as `null`.

You can also add a free-text **prompt** that gives the model context for the whole document ("This is a utility bill; amounts are in AUD").

## Multi-value extraction

Toggle **Extract multiple** when one document contains many records — every transaction on a bank statement, every line item on a purchase order. You get one result row per record instead of a single record per document. Preset templates that are naturally row-shaped (bank statement transactions, purchase order lines) have it on already.

## Grounded mode

Grounded mode is an opt-in toggle that makes extractions verifiable:

- For every field, the model also returns a **source quote** — the exact text it took the value from, or `null` if the value isn't directly in the document.
- Quotes anchor the highlights in the document view precisely, instead of relying on finding the value text verbatim.
- Values the model couldn't ground are flagged in the results table (dashed underline, with the hint "Value not found verbatim in the document — verify manually"), so you know exactly which cells deserve a second look before export.

## Scaffolding fields with AI

Instead of building fields by hand, describe the task in plain language (up to 4,000 characters) — "pull the vendor, date, and total from supplier invoices" — and Sift asks the model to design the extraction for you: field names, types, one-line descriptions, a refined prompt, and whether the task is single- or multi-record. Scaffolding runs on whatever provider is currently active and produces at most 12 fields. The result lands in the field editor for you to adjust before running.

## Per-template examples

Templates can carry up to 5 few-shot examples — sample outputs that show the model exactly what correct results look like. Examples are appended to every extraction prompt for that template, which helps steer smaller local models toward the right shape and formatting. Combined size is capped at 8 KB.

## Supported formats and caps

| Format | Extensions | How it's read | Size cap |
|---|---|---|---|
| PDF | `.pdf` | Text layer extracted for text-only providers; Claude and OpenAI also read the PDF natively (including scanned pages) | 32 MB |
| Word | `.docx` | Raw document text | 32 MB |
| PowerPoint | `.pptx` | Slide text only, in slide order, with `--- Slide N ---` separators; speaker notes are skipped | 32 MB |
| Email | `.eml` | From/To/Subject/Date headers plus the body (HTML bodies are stripped to text) | 32 MB |
| Plain text | `.txt`, `.md`, `.csv` | As-is | 32 MB |
| Images | `.png`, `.jpg`, `.jpeg`, `.webp` | Vision models only | 8 MB |

Details worth knowing:

- **File type is detected from content**, not the file name — a renamed file is stored and handled as what it actually is, and unsupported types are rejected up front.
- **Text window**: every text-shaped source (PDF text layer, Word, PowerPoint, email, plain text) is capped at 40,000 characters. Anything beyond that is cut and the text ends with a `[document truncated]` marker — fields whose values live past the cut will come back `null`.
- **Multi-page documents**: PDF pages are merged into one text stream for text-based extraction and highlighting; providers with native PDF support (Claude, OpenAI) see the full document, pages and all.
- **Scanned PDFs** have no text layer. Text-only providers (Ollama, OpenAI-compatible) return an error for them — use a cloud provider that reads PDFs natively, or upload the page as an image to a local vision model.
- **Word/PowerPoint bombs**: a `.docx`/`.pptx` whose declared uncompressed content exceeds 64 MB is rejected ("File is too complex to process.") rather than inflated.

## Review, edit, export

Every extraction is reviewable before it leaves the app. Click a value to edit it (arrays are edited as JSON); edited cells are marked and can be reset to the extracted value. Copy JSON / download CSV / download JSON always export the **edited** values. To accumulate rows across documents, save them to a [dataset](datasets.md).
